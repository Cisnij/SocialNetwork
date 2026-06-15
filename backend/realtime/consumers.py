

"""flow là khi người dùng gửi tin nhắn thì chạy connect trước, sau đó là chạy receive() để server nhận tin nhắn từ người dùng
sau đó, thông qua hàm chat_message() thì server sẽ gửi tin nhắn về ng dùng(vì thế nên bắt buộc phải lấy đúng event từ receive, vì nếu k có nó thì sao gửi)
connect-> receive(server) -> send -> client"""
import asyncio


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

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from api.models import ConversationMember, Message, Conversation, Notification, MessageAttachment, Profile
from friendship.models import Block
from django.utils import timezone
from django.contrib.auth.models import User
from api.tasks import push_notification_task

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
        self.pong_received =True # mặc định kết nối là True
        self.ping_task = asyncio.create_task(self._heartbeat()) #tạo hàm chạy ngầm vòng lặp của hàm _heartbeat
    async def stop_heartbeat(self):
        if hasattr(self, 'ping_task') and self.ping_task: #kiểm tra có ping_task đang chạy k
            self.ping_task.cancel() #cancel task chạy ngầm

    async def _heartbeat(self): # hàm private
        while True:
            await asyncio.sleep(30) # vòng lặp, cứ 30s sau sleep là ping 1 lần
            try:
                if not self.pong_received:  # nếu không nhận pong sau n giây thì đóng connect vì client ngắt
                    await self.close()
                    break
                self.pong_received = False # mỗi 30s reset false đợi client trả về mới set True
                await self.send(text_data=json.dumps({'type': 'ping'}))
            except Exception:
                break
    def handle_pong(self,data): # hàm check, nếu có gửi thì set True lại
        if data.get('type') == 'pong':
            self.pong_received = True  # đánh dấu client còn sống
            return True
        return False

class ChatConsumer(HeartbeatMixin, AsyncWebsocketConsumer): # chỉ kết nối khi gọi tới url ở routing, khi out đoạn chat sẽ chạy disconnect

    # ===== CONNECT =====
    async def connect(self):
        self.ping_task=None
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id'] # lấy conversation_id từ url
        self.user = self.scope['user'] # lấy user từ middleware (JWT đã xác thực ở middleware) 
        self.room_name = f'chat_{self.conversation_id}' # tên phòng để group_send, lưu tên phòng vào redis
        # check đăng nhập, middleware JWT không hợp lệ sẽ bị đóng
        if self.user.is_anonymous:
            await self.close()
            return

        is_member = await self.is_member()
        if not is_member: # check có phải thành viên không
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name) # thêm vào group phòng chat trong redis, room name là tên lưu trong redis, channel name là tên channels tự sinh ra unique cụ thể gắn với connect của user, khi kết nối sẽ group send cho các connect này mặc dù k biết user
        await self.accept() # chấp nhận kết nối WebSocket
        await self.start_heartbeat()

    # ===== DISCONNECT =====
    async def disconnect(self, close_code):
        await self.stop_heartbeat() # nếu có ping-task chạy thì tắt hẳn
        if self.room_name: # nếu có roomname mới ngắt kết nối, tránh lỗi khi k truyền roomname vào
            await self.channel_layer.group_discard(self.room_name, self.channel_name) # rời khỏi group khi ngắt kết nối, xóa khỏi redis

    # ===== RECEIVE - nhận tin nhắn từ client =====
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if self.handle_pong(data): # lấy data server nhận đưa vào hàm kiểm tra có pong k, có true không false và false thì dừng
            return
        # xử lý typing
        if data.get('type') == 'typing':
            await self.channel_layer.group_send(
                    self.room_name,
        {
                    'type' : 'typing_indicator',
                    'sender_id' : self.user.id,
                    'sender' : self.user.username,
                    'is_typing': data.get('is_typing', False), # lấy giá trị is_typing không thì default false, fe gửi is_typing=True  khi user nhập 
                }
            )
            return

        message = data.get('message', '').strip() # lấy message và xóa khoảng trắng
        message_type = data.get('message_type', 'text') # mặc định là text
        if message_type.startswith('system_'):
            return
        reply_to_id = data.get('reply_to_id') # nhận vào id
        attachment_ids = data.get('attachment_ids', []) # nhận vào id của attachment đã đc tạo hoặc rỗng
        if not message and not attachment_ids: # không cho gửi tin rỗng
            return

        # check các điều kiện trước khi lưu (block, pending status...)
        allowed, reason = await self.can_send() # reason là trả về lỗi khi cái await sai, chứa giá trị true/false và reason
        if not allowed:
            await self.send(text_data=json.dumps({'error': reason})) # báo lỗi về client, chuyển thành chuỗi json
            return

        # lưu vào db
        msg = await self.save_message(message, message_type,reply_to_id,attachment_ids) # save sẽ trả về 1 object đầy đủ
        if not msg: # lưu thất bại
            await self.send(text_data=json.dumps({'error': 'Không thể gửi tin nhắn'}))
            return
        attachments = await self.get_attachments(msg.id) # gọi hàm lấy ra nhiều objects attachments trong 1 id message 1-N
        # broadcast tới tất cả client trong phòng
        await self.channel_layer.group_send(
            self.room_name, # send tới tên group
            {
                'type': 'chat_message', # maps tới hàm chat_message bên dưới
                'id': msg.id,
                'message': message,
                'sender': self.user.username,
                'sender_id': self.user.id,
                'message_type': message_type,
                'created_at': msg.created_at.isoformat(),
                'reply_to_id':reply_to_id,
                'reply_to_id_content':msg.reply_to.content if msg.reply_to else None, # lấy content từ obj trả về sau lưu
                'attachments': attachments,
            }
        )

        member_ids = await self.get_member_ids()
        sender_name = await self.get_sender_name()
        for user_id in member_ids:
            if user_id != self.user.id:
                push_notification_task.delay(
                    user_id=user_id,
                    title=f'{sender_name} gửi tin nhắn' if message else f'{self.user.username} gửi file',
                    body=message if message else 'File đính kèm'
                )
        for user in member_ids:
            await self.channel_layer.group_send(
                f'conv_list_{user}',
                {
                    'type': 'conversation_updated',
                    'conversation_id': self.conversation_id,
                    'last_message': message,
                    'sender_id': self.user.id,
                    'sender_name': sender_name,
                    'message_type': message_type,
                    'created_at': msg.created_at.isoformat(),
                }
            )



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
    # ===== UPDATE MESSAGE - thêm mới =====
    async def chat_message_updated(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_updated',
            'id': event['id'],
            'content': event['content'],
            'edited': event['edited'],
        }))
    #=======DELETE MESSAGE================
    async def chat_message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'id': event['id'],
        }))
    #=========TYPING========================
    async def typing_indicator(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'sender_id': event['sender_id'],
            'sender': event['sender'],
            'is_typing': event['is_typing'],
        }))
    #========SYSTEM MESSAGE==================
    async def system_message(self,event):
        await self.send(text_data=json.dumps({
            'type': 'system_message',
            'message': event['message'],
            'message_type': event['message_type'],
        }))
    # ===== CHECK =====
    @database_sync_to_async
    def is_member(self): # check có phải thành viên conversation không
        return ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user=self.user,
            is_active=True
        ).exists()

    @database_sync_to_async
    def can_send(self): # check đủ điều kiện gửi tin nhắn chưa
        try:
            conv = Conversation.objects.get(id=self.conversation_id)
        except Conversation.DoesNotExist:
            return False, "Conversation not found"

        # check user còn active trong conversation không
        member = ConversationMember.objects.filter(
            conversation=conv,
            user=self.user,
            is_active=True
        ).first()
        if not member:
            return False, "Bạn không có trong đoạn chat"
        if not conv.is_group:
            # check block - lấy tất cả member khác trong phòng
            other_ids = list(
                ConversationMember.objects
                .filter(conversation=conv,is_active=True)
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

            if is_blocked: # nếu bị block thì không gửi được
                return False, "Bạn đã bị chặn bởi người dùng này"

            # nếu conversation đang pending thì người nhận phải accept trước mới reply được
            if conv.status == 'pending':
                first_message = (
                    Message.objects
                    .filter(conversation=conv)
                    .order_by('created_at')
                    .first()
                )
                if first_message and self.user != first_message.sender:
                    return False, "Bạn phải chấp nhận yêu cầu tin nhắn trước khi trả lời"

        return True, None

    @database_sync_to_async
    def save_message(self, message, message_type='text',reply_to_id=None,attachment_ids=[]): # chỉ lưu DB, không làm gì khác, mặc định reply_id là none, mặc định msg type là text
        try:
            reply_to=None# mặc định object là None
            if reply_to_id:
                reply_to=Message.objects.filter(id=reply_to_id,conversation_id=self.conversation_id).first()# validate trước khi tạo xem có message để reply
            msg = Message.objects.create(
                conversation_id=self.conversation_id,
                sender=self.user,
                content=message or None,
                message_type=message_type,
                reply_to=reply_to
            )
            if attachment_ids: #update field message của n file nếu có
                MessageAttachment.objects.filter(
                    id__in=attachment_ids,
                    conversation_id=self.conversation_id,
                    uploaded_by=self.user,
                    message=None # chỉ lọc cái chưa gắn message và gắn
                ).update(message=msg)
            # Update updated_at của conversation để sort list chat
            Conversation.objects.filter(id=self.conversation_id).update(updated_at=timezone.now())
            ConversationMember.objects.filter(conversation_id=self.conversation_id,is_hidden=True,is_active=True).update(is_hidden=False)
            return msg
        except Exception as e:
            print(f" Save message error: {e}")
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
        return list(ConversationMember.objects.filter(conversation_id=self.conversation_id,is_active=True).values_list('user_id', flat=True)) # chỉ lấy 1 field user_id
    @database_sync_to_async
    def get_sender_name(self):
        profile = Profile.objects.filter(user=self.user).first()
        return profile.full_name if profile else self.user.username
    
class NotificationConsumer(HeartbeatMixin,AsyncWebsocketConsumer): # chịu trách nhiệm kết nối khi vào app và đếm số count noti ngay khi vào app, khi nhấn vào noti sẽ broadcast từ signal qua và đặt lại 0
    async def connect(self):
        self.ping_task=None
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        self.user = self.scope['user'] #lấy ra user trong consumer giống request.user
        self.group_name = f'notification_{self.user.id}' # lưu tên kèm user id vào redis để gửi kết nối và data tới n thiết bị có tên đó
        await self.channel_layer.group_add(self.group_name, self.channel_name)# add vào redis tên group và tên channels tạo
        await self.accept()
        await self.start_heartbeat()

        count = await self.get_unread_count()
        await self.send(text_data=json.dumps({'unread_count': count})) # chuyển thành chuỗi json

    async def disconnect(self, close_code):
        await self.stop_heartbeat()
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self,text_data):
        try:
            data = json.loads(text_data)
            if self.handle_pong(data):
                return
        except json.JSONDecodeError:
            pass

    async def send_notification(self,event): #event là cái group send gửi lên, event[''] là dữ liệu th group send
            await self.send(text_data=json.dumps(event['data']))# chuyển data của event thành json

    @database_sync_to_async
    def get_unread_count(self): # count ban đầu khi vào app
            return Notification.objects.filter(
                reciever=self.user,
                is_read=False
            ).count()

class ConversationConsumer(HeartbeatMixin,AsyncWebsocketConsumer):
    async def connect(self):
        self.ping_task=None
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        self.user = self.scope['user']
        self.group_name= f'conv_list_{self.user.id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.start_heartbeat()


    async def disconnect(self, code):
        await self.stop_heartbeat()
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            if self.handle_pong(data):
                return
        except json.JSONDecodeError:
            pass

    async def conversation_updated(self,event):
        await self.send(text_data=json.dumps({
            'conversation_id': event['conversation_id'],
            'last_message': event.get('last_message'),
            'sender_id': event.get('sender_id'),
            'sender_name': event.get('sender_name'),
            'message_type': event.get('message_type'),
            'created_at': event.get('created_at'),
        }))

# cần lặp group send vì không như chat mn chung 1 group, conv list thì môi user 1 conv list