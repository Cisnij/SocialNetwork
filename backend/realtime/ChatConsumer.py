"""flow là khi người dùng gửi tin nhắn thì chạy connect trước, sau đó là chạy receive() để server nhận tin nhắn từ người dùng
sau đó, thông qua hàm chat_message() thì server sẽ gửi tin nhắn về ng dùng(vì thế nên bắt buộc phải lấy đúng event từ receive, vì nếu k có nó thì sao gửi)
connect-> receive(server) -> send -> client"""
"""
-flow từ back tới front end
-Frontend: User gọi tất cả đoạn chat và gán id cho từng cái đó, front-end gọi new WebSocket và khởi tạo url với conversation_id đó khi click tương ứng,sau đó chạy open
-Backend: chạy hàm connect và group add conversation_id đó sau đó chạy accept (group add lưu tên room trong redis kèm theo đó là các máy connect với room để gửi data)
-Frontend: socket.send tin nhắn 
-Backend: Chạy receive nhận data từ fe dưới dạng json và lưu db, sau đó chạy group_send lấy từ db vừa save gửi vào các kết nối trong room trong redis, chuẩn bị data và gửi tín hiệu, cuối cùng chạy send để gửi tới fe
-Frontend: Nhận tin nhắn và chạy onmessage
-Frontend: out ra đoạn chat thì chạy socket.close

ng dùng gọi api websocket trước xong kích hoạt application mới gọi middleware
"""

'''
Máy A ->> [SER] ->> [Máy A]
Máy B ->> [VER] ->> [Máy B]
server nhận,lưu và gửi tín hiệu event các máy trong group, sau đó dùng gọi hàm tương ứng(chat_message) và send để các máy nhận và load ra

Mở rộng ra, cứ nghĩ cái backend là server chỉ nhận và truyền. Thì ng dùng nhập typing hay gì đó sẽ gọi type:'type" cho backend xử lý và trả lại json cho toàn bộ 
group send và send luôn đi chung, 1 cái gửi tín hiệu và cái còn lại gửi dữ liệu json cho fe load ra
'''
import asyncio
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from api.models import ConversationMember, Message, Conversation, Notification, MessageAttachment, Profile
from friendship.models import Block
from django.utils import timezone
from django.contrib.auth.models import User
from api.tasks import push_notification_task
from api.AI_Bot import get_gemini_reply
from backend.env_config import env
from django.db import transaction
from django.contrib.contenttypes.models import ContentType
from reaction.models import Reaction, UserReaction, ReactionSettings
from django.db.models import Count

class HeartbeatMixin:
    '''giúp tự kết nối khi bị ngắt, flow là server gửi ping sau 30s, client còn sống thì gửi pong. Nếu k gửi pong thì server disconnect và client k nhận ping cũng sẽ tự reconnect 3s chỉ sau khi server close'''
    '''
    lần 1 start heartbeat là true mặc định
    lần 2 _hearbeat chạy sau 30s, pong_received=True ở lần 1, chạy set lại pong_received=False và gửi client ping,
        client trả về pong ở recieve thì chạy handle và set pong_received=True lại, lặp lại n lần
        nếu gửi mà client k trả pong thì nó chạy lần nữa sau 30s check là false thì disconnect
    lần n: sau 30s ,pong_received=True ở lần n-1, chạy set lại pong_received=False, gửi client ping,
        client không trả pong ở receive, def handle chạy kiểm tra không có pong và set pong_received=False
    lần n+1: sau 30s,pong_received=False ở lần n, chạy close()
    client khi 3s sau close sẽ tự chạy reconnect, có 2 dạng là client biết disconnect và không biết disconnect mặc đù đang connect nên cần tới cách ping pong
    '''
    async def start_heartbeat(self):
        self.pong_received = True  # mặc định kết nối là True
        self.ping_task = asyncio.create_task(self._heartbeat())  # tạo hàm chạy ngầm vòng lặp của hàm _heartbeat

    async def stop_heartbeat(self):
        if hasattr(self, 'ping_task') and self.ping_task:  # kiểm tra có ping_task đang chạy k
            self.ping_task.cancel()  # cancel task chạy ngầm

    async def _heartbeat(self):  # hàm private
        while True:
            await asyncio.sleep(30)  # vòng lặp, cứ 30s sau sleep là ping 1 lần
            try:
                if not self.pong_received:  # nếu không nhận pong sau n giây thì đóng connect vì client ngắt
                    await self.close()
                    break
                self.pong_received = False  # mỗi 30s reset false đợi client trả về mới set True
                await self.send(text_data=json.dumps({'type': 'ping'}))
            except Exception:
                break

    def handle_pong(self, data):  # hàm check, nếu có gửi thì set True lại
        if data.get('type') == 'pong':
            self.pong_received = True  # đánh dấu client còn sống
            return True
        return False


class ChatConsumer(HeartbeatMixin, AsyncWebsocketConsumer):  # chỉ kết nối khi gọi tới url ở routing, khi out đoạn chat sẽ chạy disconnect

    # ===== CONNECT =====
    async def connect(self):
        self.ping_task = None
        self.room_name = None  #  set None trước tránh AttributeError trong disconnect nếu connect fail(connect fail vì k có group)
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']  # lấy conversation_id từ url
        self.user = self.scope['user']  # lấy user từ middleware (JWT đã xác thực ở middleware)

        # check đăng nhập, middleware JWT không hợp lệ sẽ bị đóng
        if self.user.is_anonymous:
            await self.close()
            return

        is_member = await self.is_member()
        if not is_member:  # check có phải thành viên không
            await self.close()
            return

        self.room_name = f'chat_{self.conversation_id}'  # tên phòng để group_send, lưu tên phòng vào redis

        # Cache các giá trị dùng nhiều lần tránh query lặp lại mỗi lần receive
        self.sender_name = await self.get_sender_name()
        bot_user = await self._get_bot_user_if_bot_conv()
        self.is_bot = bot_user is not None  # True nếu conv có bot và bot user tồn tại trong DB, nó là biểu thức bot_user có none k ->True/false
        self.bot_user = bot_user            # None nếu không phải conv bot hoặc bot chưa tạo

        await self.channel_layer.group_add(self.room_name, self.channel_name)  # thêm vào group phòng chat trong redis
        await self.accept()  # chấp nhận kết nối WebSocket
        await self.start_heartbeat()

    # ===== DISCONNECT =====
    async def disconnect(self, close_code):
        await self.stop_heartbeat()  # nếu có ping-task chạy thì tắt hẳn
        if getattr(self, 'room_name', None):  #  dùng getattr tránh AttributeError nếu connect fail trước khi set room_name
            await self.channel_layer.group_discard(self.room_name, self.channel_name)  # rời khỏi group khi ngắt kết nối, xóa khỏi redis

    # ===== RECEIVE - nhận tin nhắn từ client =====
    async def receive(self, text_data): # tên mặc định của class, hàm này chạy tự động khi fe gọi ws.send
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        if self.handle_pong(data):  # lấy data server nhận đưa vào hàm kiểm tra có pong k, có true không false và false thì dừng
            return

        # xử lý typing — dùng sender_name đã cache, không query thêm
        if data.get('type') == 'typing':
            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type': 'typing_indicator',
                    'sender_id': self.user.id,
                    'sender': self.sender_name,  # dùng cached
                    'is_typing': data.get('is_typing', False),  # lấy giá trị is_typing không thì default false
                }
            )
            return
        # xử lý reaction
        if data.get('type') == 'reaction':
            message_id = data.get('message_id')
            reaction_type = data.get('reaction_type')
            if not reaction_type: return
            saved = await self.save_reaction(message_id, reaction_type)
            if saved:
                await self.channel_layer.group_send(
                    self.room_name,
                    {
                        'type': 'message_reaction',
                        'message_id': message_id,
                        'reaction_type': saved['reaction_type'],
                        'status': saved['status'],
                        'count': saved['count'],
                        'sender_id': self.user.id,
                    }
                )
                member_ids = await self.get_member_ids()
                for user_id in member_ids:
                    if user_id == self.user.id:  # bỏ qua chính mình
                        continue
                    await self.channel_layer.group_send(
                        f'conv_list_{user_id}',
                        {
                            'type': 'conversation_updated',
                            'conversation_id': self.conversation_id,
                            'last_message': f"{self.sender_name} đã thả cảm xúc vào tin nhắn",
                            'sender_id': self.user.id,
                            'sender_name': self.sender_name,
                            'created_at': timezone.now().isoformat(),
                        }
                    )
            return

        message = data.get('message', '').strip()  # lấy message và xóa khoảng trắng
        message_type = data.get('message_type', 'text')  # mặc định là text
        if message_type.startswith('system_'):
            return
        reply_to_id = data.get('reply_to_id')  # nhận vào id
        attachment_ids = data.get('attachment_ids', [])  # nhận vào id của attachment đã đc tạo hoặc rỗng
        if not message and not attachment_ids:  # không cho gửi tin rỗng
            return

        # check các điều kiện trước khi lưu (block, pending status...)
        if not self.is_bot:
            allowed, reason = await self.can_send()  # reason là trả về lỗi khi cái await sai, chứa giá trị true/false và reason
            if not allowed:
                await self.send(text_data=json.dumps({'error': reason}))  # báo lỗi về client, chuyển thành chuỗi json
                return

        # lưu vào db
        msg = await self.save_message(message, message_type, reply_to_id, attachment_ids)  # save sẽ trả về 1 object đầy đủ
        if not msg:  # lưu thất bại
            await self.send(text_data=json.dumps({'error': 'Không thể gửi tin nhắn'}))
            return

        attachments = []
        if attachment_ids:
            attachments = await self.get_attachments(msg.id)  # gọi hàm lấy ra nhiều objects attachments trong 1 id message 1-N

        # broadcast tới tất cả client trong phòng
        await self.channel_layer.group_send(
            self.room_name,  # send tới tên group
            {
                'type': 'chat_message',  # maps tới hàm chat_message bên dưới
                'id': msg.id,
                'message': message,
                'sender': self.sender_name,
                'sender_id': self.user.id,
                'message_type': message_type,
                'created_at': msg.created_at.isoformat(),
                'reply_to_id': reply_to_id,
                'reply_to_id_content': msg.reply_to.content if msg.reply_to else None,  # lấy content từ obj trả về sau lưu
                'attachments': attachments,
            }
        )

        # bot reply — dùng self.is_bot đã cache, không query thêm
        if self.is_bot:
            async def bot_task():
                try:
                    old_messages = await self.get_context_messages() # lấy context 10 tin gần nhất
                    bot_reply_text = await get_gemini_reply(message, self.sender_name, old_messages) # gọi api truyền context, messafge hiện tại và trả ra answer
                    bot_message = await self.save_bot_message(bot_reply_text) # lưu tin nhắn bot trả về
                    await self.channel_layer.group_send(
                        self.room_name,
                        {
                            'type': 'chat_message',
                            'id': bot_message.id,
                            'message': bot_reply_text,
                            'sender': env('BOT_USERNAME'),
                            'sender_id': bot_message.sender_id,
                            'message_type': 'text',
                            'created_at': bot_message.created_at.isoformat(),
                            'reply_to_id': None,
                            'reply_to_id_content': None,
                            'attachments': [],
                        }
                    )
                except Exception as e:
                    print(f"Bot task error: {e}")
            
            asyncio.create_task(bot_task())


        member_ids = await self.get_member_ids()
        for user_id in member_ids:
            if user_id != self.user.id:
                push_notification_task.delay(
                    user_id=user_id,
                    title=f'{self.sender_name} gửi tin nhắn' if message else f'{self.user.username} gửi file',  # dùng cached
                    body=message if message else 'File đính kèm'
                )
        conv_update_tasks = []
        for user in member_ids:
            conv_update_tasks.append(
                self.channel_layer.group_send(
                    f'conv_list_{user}',
                    {
                        'type': 'conversation_updated',
                        'conversation_id': self.conversation_id,
                        'last_message': message,
                        'sender_id': self.user.id,
                        'sender_name': self.sender_name,  # dùng cached
                        'message_type': message_type,
                        'created_at': msg.created_at.isoformat(),
                    }
                )
            )

        # 2. Kích hoạt toàn bộ các tác vụ chạy SONG SONG cùng một lúc
        if conv_update_tasks:
            await asyncio.gather(*conv_update_tasks, return_exceptions=True)

    # ===== CHAT_MESSAGE - gửi tin nhắn tới từng client trong group =====
    # hàm này chạy sau group_send, bắt buộc tên phải giống type trong group_send, lấy ra từ group send và gửi đi
    # send sẽ chạy từng người ví dụ conv có 5 thì send 5 lần, groupsend thì gửi hàng loạt tín hiệu tới group conv đó
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'id': event['id'],
            'message': event['message'],
            'sender': event['sender'],
            'sender_id': event['sender_id'],
            'message_type': event.get('message_type', 'text'),
            'created_at': event['created_at'],
            'reply_to_id': event['reply_to_id'],
            'reply_to_id_content': event['reply_to_id_content'],
            'attachments': event.get('attachments', []),
        }))

    # ===== SEEN MESSAGE - đồng bộ trạng thái đã xem giữa các thiết bị =====
    async def seen_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'seen_message',
            'user_id': event['user_id'],
            'last_message_id': event['last_message_id'],
        }))

    # ===== UPDATE MESSAGE =====
    async def chat_message_updated(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_updated',
            'id': event['id'],
            'content': event['content'],
            'edited': event['edited'],
        }))

    # ===== DELETE MESSAGE =====
    async def chat_message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'id': event['id'],
        }))

    # ===== REACTION MESSAGE =====
    async def message_reaction(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_reaction',
            'message_id': event['message_id'],
            'reaction_type': event['reaction_type'],  # None nếu status=removed
            'status': event['status'],                 # added / removed / changed
            'count': event['count'],                   # list [{'settings__name': 'like', 'total': 3}, ...]
            'sender_id': event['sender_id'],
        }))

    #===TYPING===========
    async def typing_indicator(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'sender_id': event['sender_id'],
            'sender': event['sender'],
            'is_typing': event['is_typing'],
        }))

    # ===== SYSTEM MESSAGE =====
    async def system_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'system_message',
            'message': event['message'],
            'message_type': event['message_type'],
        }))

    async def start_call(self):
        await self.send(text_data=json.dumps({
            'type': 'start_call',

        }))

    async def stop_call(self):
        await self.send(text_data=json.dumps({
            'type': 'stop_call',
        }))


    # ===== MODEL CHECK =====
    @database_sync_to_async
    def is_member(self):  # check có phải thành viên conversation không
        return ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user=self.user,
            is_active=True
        ).exists()

    @database_sync_to_async
    def can_send(self):  # check đủ điều kiện gửi tin nhắn chưa

        member = ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user=self.user,
            is_active=True
        ).select_related('conversation').first()
        if not member:
            return False, "Bạn không có trong đoạn chat"

        if not member.conversation.is_group:
            # check block - lấy tất cả member khác trong phòng
            other_ids = list(
                ConversationMember.objects
                .filter(conversation=self.conversation_id, is_active=True)
                .exclude(user=self.user)
                .values_list('user_id', flat=True)
            )

            is_blocked = Block.objects.filter(
                # chiều 1: người khác block mình
                blocker_id__in=other_ids, blocked=self.user
            ).exists() or Block.objects.filter(
                # chiều 2: mình block người khác
                blocker=self.user, blocked_id__in=other_ids
            ).exists()

            if is_blocked:  # nếu bị block thì không gửi được
                return False, "Bạn đã bị chặn bởi người dùng này"

            # nếu conversation đang pending thì người nhận phải accept trước mới reply được
            if member.conversation.status == 'pending':
                first_message = (
                    Message.objects
                    .filter(conversation=self.conversation_id)
                    .order_by('created_at')
                    .first()
                )
                if first_message and self.user != first_message.sender: # người gửi đầu thì đc gửi tiếp trong conv pending, còn người nhận thì báo lỗi
                    return False, "Bạn phải chấp nhận yêu cầu tin nhắn trước khi trả lời"

        return True, None

    @database_sync_to_async
    def save_message(self, message, message_type='text', reply_to_id=None, attachment_ids=None):  # ✅ None thay vì [] tránh mutable default argument bug
        attachment_ids = attachment_ids or []
        try:
            reply_to = None  # mặc định object là None
            if reply_to_id:
                reply_to = Message.objects.filter(id=reply_to_id, conversation_id=self.conversation_id).first()  # validate trước khi tạo xem có message để reply
            msg = Message.objects.create(
                conversation_id=self.conversation_id,
                sender=self.user,
                content=message or None,
                message_type=message_type,
                reply_to=reply_to
            )
            if attachment_ids:  # update field message của n file nếu có
                MessageAttachment.objects.filter(
                    id__in=attachment_ids,
                    conversation_id=self.conversation_id,
                    uploaded_by=self.user,
                    message=None  # chỉ lọc cái chưa gắn message và gắn
                ).update(message=msg)
            # Update updated_at của conversation để sort list chat
            Conversation.objects.filter(id=self.conversation_id).update(updated_at=timezone.now())
            ConversationMember.objects.filter(conversation_id=self.conversation_id, is_hidden=True, is_active=True).update(is_hidden=False)
            return msg
        except Exception as e:
            print(f"Save message error: {e}")
            return None

    @database_sync_to_async
    def get_attachments(self, message_id):
        attachments = MessageAttachment.objects.filter(message_id=message_id)
        return [
            {
                'id': a.id,
                'file_url': a.file_url,
                'file_type': a.file_type,
                'file_name': a.file_name,
                'file_size': a.file_size,
            }
            for a in attachments
        ]

    @database_sync_to_async
    def get_member_ids(self):
        return list(ConversationMember.objects.filter(
            conversation_id=self.conversation_id, is_active=True
        ).values_list('user_id', flat=True))  # chỉ lấy 1 field user_id

    @database_sync_to_async
    def get_sender_name(self):
        profile = Profile.objects.filter(user=self.user).first()
        return profile.full_name if profile else self.user.username

    # ===== AI BOT =====
    @database_sync_to_async
    def _get_bot_user_if_bot_conv(self):
        # Gộp check bot conversation và lấy bot_user vào 1 query — cache khi connect
        # Trả về bot_user nếu conv có bot, None nếu không phải conv bot hoặc bot chưa tạo trong DB
        bot_username = env("BOT_USERNAME")
        is_bot_conv = ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user__username=bot_username
        ).exists()
        if not is_bot_conv:
            return None
        return User.objects.filter(username=bot_username).first()

    @database_sync_to_async
    def save_bot_message(self, content):
        # dùng self.bot_user đã cache từ connect, không query thêm
        return Message.objects.create(
            conversation_id=self.conversation_id,
            sender=self.bot_user,
            content=content,
            message_type='text'
        )
    @database_sync_to_async
    def get_context_messages(self):
        messages = (
            Message.objects.filter(conversation_id=self.conversation_id)
            .select_related('sender__profile')
            .order_by('-created_at')[:10]
            .values('content', 'sender__profile__last_name')
        )

        messages_list = list(messages)
        if not messages_list:
            return "Chưa có tin nhắn nào trước đây."

        messages_list.reverse()

        return "\n".join([ # join là phương thức list -> string và mỗi lần in là \n xuống dòng
            f"{msg['sender__profile__last_name'] or 'Ẩn danh'}: {msg['content'] or '[File đính kèm]'}"
            for msg in messages_list
        ])

    @database_sync_to_async
    def save_reaction(self, message_id, reaction_type_name):
        try:
            ct = ContentType.objects.get_for_model(Message)
            reaction_setting = ReactionSettings.objects.get(name=reaction_type_name) # lấy cái name emoji truyền vào
            
            with transaction.atomic():
                reaction, _ = Reaction.objects.select_related('settings').get_or_create( # lâys hoặc tạo bảng đại diện type đó
                    content_type=ct,
                    object_id=message_id,
                    settings=reaction_setting,
                )
                
                user_reaction = UserReaction.objects.select_related('reaction__settings').filter( # kiểm tra user đã thả reaction chưa
                    user=self.user,
                    reaction__content_type=ct,
                    reaction__object_id=message_id,
                ).first()
                
                react_emoji = reaction_setting.react_emoji.first() # lấy ra emoji
                
                if not user_reaction: # tạo mới khi chưa có, trả về add và slug emoji
                    UserReaction.objects.create(
                        user=self.user,
                        reaction=reaction,
                        react=react_emoji
                    )
                    status = "added"
                    returned_type = reaction_type_name
                elif user_reaction.reaction.settings == reaction_setting: # trả về remonve và 0 emoji
                    user_reaction.delete()
                    status = "removed"
                    returned_type = None
                else: # trả về change
                    user_reaction.reaction = reaction
                    user_reaction.react = react_emoji
                    user_reaction.save(update_fields=["reaction", "react"])
                    status = "changed"
                    returned_type = reaction_type_name
                    
                # Cập nhật updated_at của Conversation để khi F5 list chat vẫn nằm trên cùng
                Conversation.objects.filter(id=self.conversation_id).update(updated_at=timezone.now())
                    
            count = list(
                Reaction.objects.filter(
                    content_type=ct,
                    object_id=message_id,
                ).values('settings__name').annotate(total=Count('reactions')) # count theo user reaction ở cái reaction này , groupby slug emoji đó
            )
            return {
                "status": status,
                "reaction_type": returned_type,
                "count": count
            }
        except Exception as e:
            print(f"Error saving reaction: {e}")
            return None






