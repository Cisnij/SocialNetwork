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

# có 3 trạng thái
    # nếu user call mà nhấn gọi api decline thì cập nhật status là decline
    # nếu trước khi close room accepted -> left và pending -> missed
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
        if getattr(self, 'room_name', None): # nếu có room name và user disconnect thì thử leave call
            # Tự động leave/end call nếu user đóng tab đột ngột
            try:
                await self.handle_leave_call({'type': 'leave_call'})
            except Exception as e:
                import traceback
                print(f"Error in disconnect handle_leave_call: {e}")
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
        handler = handlers.get(data.get('type')) # FE truyền sẽ kiểm tra và lấy ra 2 type trên, kiểm tra có key thì gọi đúng function đó ra truyền data vào
        if handler:
            await handler(data)

    async def handle_leave_call(self, data): # flow là mỗi khi user out room thì check xem có bao user đang active, nếu không thì đóng room
        try:
            room = await self._get_active_room()
            if not room:
                return

            await CallParticipant.objects.filter( # khi đc gọi khi nhán end call thì update user left
                room=room, user_id=self.user.id
            ).aupdate(left_at=timezone.now(), status='left')

            active_count = await CallParticipant.objects.filter( # nếu có user đang tham gia trong room thì count>0, nếu chủ phòng vẫn trong đó thì không tính là out và vãn còn room, vì là group thì còn chủ phòng vẫn là còn
                room=room, status='accepted'
            ).acount()

            should_close_room = False
            if not room.conversation.is_group: # check đầu là 1-1 thì should close=True
                should_close_room = True
            elif active_count == 0: # check nếu không còn user nào trong phòng thì should close=True
                should_close_room = True

            if should_close_room: #nếu true
                end_reason = 'completed' if room.started_at else 'cancelled' #nếu room có thời gian bắt đầu tức là có người join thì completed
                await self._close_room(room, end_reason) # đóng room và user pending sẽ là miss, user accepted sẽ là left(tức đã tham gia)
                msg_type = 'system_call_completed' if end_reason == 'completed' else 'system_call_missed'
                await self._create_system_message(room, msg_type)
                
                duration = await self._get_duration(room) #lấy thời gian room bdau và kết thúc trừ nhau
                await self.channel_layer.group_send(
                    self.room_name,
                    {
                        'type':             'call_ended',
                        'end_reason':       end_reason,
                        'duration_seconds': duration,
                        'conv_id':          self.conv_id,
                    }
                )
                
                if end_reason == 'cancelled': # nếu là cancel thì phải broadcast qua notification để tắt popup của các user chưa join nên chưa vào ws call
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
            else: # nếu room không nên đóng should_close=False ( tức là còn user và đây là group call)
                if room.conversation.is_group:
                    await self.channel_layer.group_send( # gửi broadcast user left
                        self.room_name,
                        {
                            'type':      'call_user_left',
                            'user_id':   self.user.id,
                            'user_name': self.user_name,
                            'conv_id':   self.conv_id,
                        }
                    )
        except Exception as e:
            import traceback
            print("ERROR IN handle_leave_call:", e)
            traceback.print_exc()

    async def handle_end_call(self, data):
        try:
            room = await self._get_active_room()
            if not room:
                return

            # Nhóm: chỉ caller mới được end toàn phòng, member thì chuyển sang leave
            if room.conversation.is_group and room.created_by_id != self.user.id:
                await self.handle_leave_call(data)
                return

            # nếu 1-1 hoặc là chủ phòng thì end luôn
            has_others_joined = await CallParticipant.objects.filter( # check xem đã có ai join trước khi close room chưa, close room thì sẽ k count đc accept nào vì chuyển sang left
                room=room, status='accepted'
            ).exclude(user_id=self.user.id).aexists()

            end_reason = 'completed' if has_others_joined else 'cancelled'
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

            # Nếu cancelled (chưa ai bắt máy mà caller đang gọi nhấn hủy) , callee vẫn đang thấy popup nên cần push call_cancelled qua notification để FE tắt popup
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
        except Exception as e:
            import traceback
            print("ERROR IN handle_end_call:", e)
            traceback.print_exc()

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
            conversation_id=self.conv_id,
            user_id=self.user.id,
            is_active=True
        ).exists()

    @database_sync_to_async
    def get_profile_fullname(self):
        profile = Profile.objects.filter(user_id=self.user.id).first()
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
        now = timezone.now()
        VideoRoom.objects.filter(id=room.id).update(
            is_active=False,
            ended_at=now,
            end_reason=end_reason,
        )
        # pending → missed, accepted → left
        CallParticipant.objects.filter(
            room=room, status='pending'
        ).update(status='missed')
        CallParticipant.objects.filter(
            room=room, status='accepted'
        ).update(status='left', left_at=now)

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

