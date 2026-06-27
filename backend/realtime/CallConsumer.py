import json

from channels.layers import get_channel_layer
from django.utils import timezone
import asyncio
from api.models import ConversationMember, CallParticipant, Profile, VideoRoom, Message, Conversation
from channels.db import database_sync_to_async
from .ChatConsumer import HeartbeatMixin
from channels.generic.websocket import AsyncWebsocketConsumer

# Tất cả user vào web
#   → connect ws/notifications/  ← sống suốt session, nhận call popup
#
# Caller bấm gọi
#   → POST /video/create/
#   → server push incoming_call tới notification_<uid> của tất cả callee
#   → caller connect ws/call/<conv_id>/ → connect LiveKit
#   → FE callee nhận qua ws/notifications/ → hiện popup "ABC đang gọi..."
#
# Callee bấm Accept
#   → POST /video/join/ → nhận token
#   → connect ws/call/<conv_id>/z`
#   → connect LiveKit → đang gọi
#
# Callee bấm Decline
#   → POST /video/decline/  (REST, không cần WS)
#   → 1-1: server báo caller qua ws/call/<conv_id>/, và đóng phòng
#   → FE caller nhận call_ended → đóng màn hình gọi
#
# Caller huỷ trước khi ai bắt
#   → WS gửi end_call → end_reason = cancelled
#   → server push call_cancelled tới notification_<uid> callee
#   → FE callee nhận → tắt popup đi
#
# Đang gọi, caller end
#   → WS gửi end_call → end_reason = completed
#   → broadcast call_ended trong ws/call/<conv_id>/
#   → hiện system message thời gian cuộc gọi

# ngoài cuộc gọi(tức là tất cả chưa connect vào ws):
     # call incoming: notification
     # created by hủy: notification
    # user decline: call consumer broadcast thông qua api
# trong cuộc gọi tức là tất cả đã connect vào ws
     # user leave: call consumer
     # call end: call consumer

class CallConsumer(HeartbeatMixin, AsyncWebsocketConsumer):

    async def connect(self):
        self.ping_task = None
        self.user = self.scope['user']
        if self.user.is_anonymous:
            await self.close()
            return

        self.conv_id = self.scope['url_route']['kwargs']['conv_id']
        self.room_name = f'call_{self.conv_id}'
        self.user_name = await self.get_profile_fullname()

        is_member = await self.is_member()
        if not is_member:
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name)
        await self.accept()
        await self.start_heartbeat()

    async def disconnect(self, close_code):
        await self.stop_heartbeat()
        if getattr(self, 'room_name', None):
            await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        if self.handle_pong(data):
            return

        handlers = {
            'leave_call': self.handle_leave_call,
            'end_call':   self.handle_end_call,
        }
        handler = handlers.get(data.get('type'))
        if handler:
            await handler(data)

    async def handle_leave_call(self, data):
        room = await self._get_active_room()
        if not room:
            return

        await CallParticipant.objects.filter(
            room=room, user=self.user
        ).aupdate(left_at=timezone.now())

        if room.conversation.is_group:
            # Nhóm: báo mọi người trong phòng có người rời
            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type':      'call_user_left',
                    'user_id':   self.user.id,
                    'user_name': self.user_name,
                    'conv_id':   self.conv_id,
                }
            )
        else:
            # 1-1: 1 người rời = kết thúc cuộc gọi
            await self.handle_end_call(data)

    async def handle_end_call(self, data):
        room = await self._get_active_room()
        if not room:
            return

        # Nhóm: chỉ caller mới được end toàn phòng, member thì chuyển sang leave
        if room.conversation.is_group and room.created_by_id != self.user.id:
            await self.handle_leave_call(data)
            return

        # nếu 1-1 hoặc là chủ phòng thì end luôn
        has_others_joined = await CallParticipant.objects.filter(
            room=room, status='accepted'
        ).exclude(user=self.user).aexists()

        end_reason = 'completed' if has_others_joined else 'cancelled' # nếu có ng đã từng tham gia tồn tại thì completed không thì
        await self._close_room(room, end_reason)

        msg_type = (
            'system_call_completed' if end_reason == 'completed'
            else 'system_call_missed'
        )
        await self._create_system_message(room, msg_type)
        duration = await self._get_duration(room)

        # Báo tất cả trong ws/call/<conv_id>/
        await self.channel_layer.group_send(
            self.room_name,
            {
                'type':             'call_ended',
                'end_reason':       end_reason,
                'duration_seconds': duration,
                'conv_id':          self.conv_id,
            }
        )

        # Nếu cancelled (chưa ai bắt máy) → callee vẫn đang thấy popup
        # cần push call_cancelled qua notification để FE tắt popup
        if end_reason == 'cancelled':
            member_ids = await self._get_member_ids(room)
            channel_layer = get_channel_layer()
            tasks = [
                channel_layer.group_send(
                    f'notification_{uid}',
                    {
                        'type':      'call_cancelled',
                        'conv_id':   self.conv_id,
                        'room_name': room.room_name,
                    }
                )
                for uid in member_ids
                if uid != self.user.id
            ]
            await asyncio.gather(*tasks)

    # SERVER → CLIENT
    async def call_user_left(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_ended(self, event):
        await self.send(text_data=json.dumps(event))

    async def call_cancelled(self, event):
        await self.send(text_data=json.dumps(event))

    # ── DB helpers ───────────────────────────────────────────

    @database_sync_to_async
    def is_member(self):
        return ConversationMember.objects.filter(
            conversation_id=self.conv_id,   # sửa: conv_id → conversation_id
            user=self.user,
            is_active=True
        ).exists()

    @database_sync_to_async
    def get_profile_fullname(self):
        profile = Profile.objects.filter(user=self.user).first()
        return profile.full_name if profile else self.user.username

    @database_sync_to_async
    def _get_active_room(self):
        return VideoRoom.objects.select_related(
            'conversation', 'created_by'
        ).filter(
            conversation_id=self.conv_id, is_active=True
        ).first()

    @database_sync_to_async
    def _close_room(self, room, end_reason):
        VideoRoom.objects.filter(id=room.id).update(
            is_active=False,
            ended_at=timezone.now(),
            end_reason=end_reason,
        )
        CallParticipant.objects.filter(
            room=room, status='pending'
        ).update(status='missed')

    @database_sync_to_async
    def _get_duration(self, room):
        room.refresh_from_db(fields=['started_at', 'ended_at'])
        return room.duration_call

    @database_sync_to_async
    def _get_member_ids(self, room):
        return list(
            CallParticipant.objects.filter(
                room=room
            ).values_list('user_id', flat=True)
        )

    @database_sync_to_async
    def _check_all_rejected(self, room):
        others   = CallParticipant.objects.filter(room=room).exclude(user=room.created_by)
        total    = others.count()
        rejected = others.filter(status__in=['declined', 'missed']).count()
        if total > 0 and total == rejected:
            VideoRoom.objects.filter(id=room.id).update(
                is_active=False,
                ended_at=timezone.now(),
                end_reason='missed',
            )
            return True
        return False

    @database_sync_to_async
    def _create_system_message(self, room, msg_type):
        room.refresh_from_db(fields=['started_at', 'ended_at'])
        secs = room.duration_call
        content_map = {
            'system_call_completed': f'Cuộc gọi video · {secs // 60}:{secs % 60:02d}',
            'system_call_missed':    'Cuộc gọi video nhỡ',
            'system_call_declined':  'Cuộc gọi video bị từ chối',
            'system_call_cancelled': 'Cuộc gọi video bị huỷ',
        }
        msg = Message.objects.create(
            conversation_id=self.conv_id,
            sender=room.created_by,
            content=content_map[msg_type],
            message_type=msg_type,
        )
        Conversation.objects.filter(id=self.conv_id).update(updated_at=timezone.now())
        return msg

