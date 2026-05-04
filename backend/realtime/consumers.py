

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
server nhận,lưu và gửi tín hiệu event các máy trong group, sau đó dùng chat_message để các máy nhận và load ra

Mở rộng ra, cứ nghĩ cái backend là server chỉ nhận và truyền. Thì ng dùng nhập typing hay gì đó sẽ gọi type:'type" cho backend xử lý và trả lại json cho toàn bộ 
group send và send luôn đi chung, 1 cái gửi tín hiệu và cái còn lại gửi dữ liệu json cho fe load ra
'''

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from api.models import ConversationMember, Message, Conversation, Notification
from friendship.models import Block
from django.contrib.auth.models import User
from api.firebase import push_to_user

class ChatConsumer(AsyncWebsocketConsumer): # chỉ kết nối khi gọi tới url ở routing, khi out đoạn chat sẽ chạy disconnect

    # ===== CONNECT =====
    async def connect(self):
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

        await self.channel_layer.group_add(self.room_name, self.channel_name) # thêm vào group phòng chat trong redis, room name là tên lưu trong redis, channel name là tên channels tự sinh ra unique cụ thể
        await self.accept() # chấp nhận kết nối WebSocket
        print("CONNECT:", self.channel_name)

    # ===== DISCONNECT =====
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_name, self.channel_name) # rời khỏi group khi ngắt kết nối, xóa khỏi redis

    # ===== RECEIVE - nhận tin nhắn từ client =====
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message = data.get('message', '').strip() # lấy message và xóa khoảng trắng
        message_type = data.get('message_type', 'text') # mặc định là text

        if not message: # không cho gửi tin rỗng
            return

        # check các điều kiện trước khi lưu (block, pending status...)
        allowed, reason = await self.can_send() # reason là trả về lỗi khi cái await sai, chứa giá trị true/false và reason
        if not allowed:
            await self.send(text_data=json.dumps({'error': reason})) # báo lỗi về client, chuyển thành chuỗi json
            return

        # lưu vào db
        msg = await self.save_message(message, message_type)
        if not msg: # lưu thất bại
            await self.send(text_data=json.dumps({'error': 'Không thể gửi tin nhắn'}))
            return

        # broadcast tới tất cả client trong phòng
        await self.channel_layer.group_send(
            self.room_name,
            {
                'type': 'chat_message', # maps tới hàm chat_message bên dưới
                'id': msg.id,
                'message': message,
                'sender': self.user.username,
                'sender_id': self.user.id,
                'message_type': message_type,
                'created_at': msg.created_at.isoformat(),
            }
        )

        # push notification sau cùng, tách hoàn toàn, lỗi firebase không ảnh hưởng message đã lưu và đã broadcast
        await self.push_notifications(message)

    # ===== CHAT_MESSAGE - gửi tin nhắn tới từng client trong group =====
    # hàm này chạy sau group_send, bắt buộc tên phải giống type trong group_send, lấy ra từ group send và gửi đi
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'id': event['id'],
            'message': event['message'],
            'sender': event['sender'],
            'sender_id': event['sender_id'],
            'message_type': event.get('message_type', 'text'),
            'created_at': event['created_at'],
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
        
    # ===== CHECK =====
    @database_sync_to_async
    def is_member(self): # check có phải thành viên conversation không
        return ConversationMember.objects.filter(
            conversation_id=self.conversation_id,
            user=self.user
        ).exists()

    @database_sync_to_async
    def can_send(self): # check đủ điều kiện gửi tin nhắn chưa
        try:
            conv = Conversation.objects.get(id=self.conversation_id)
        except Conversation.DoesNotExist:
            return False, "Conversation not found"

        # check block - lấy tất cả member khác trong phòng
        other_ids = list(
            ConversationMember.objects
            .filter(conversation=conv)
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
    def save_message(self, message, message_type='text'): # chỉ lưu DB, không làm gì khác
        try:
            return Message.objects.create(
                conversation_id=self.conversation_id,
                sender=self.user,
                content=message,
                message_type=message_type,
            )
        except Exception as e:
            print(f" Save message error: {e}")
            return None

    @database_sync_to_async
    def push_notifications(self, message): # tách riêng, lỗi ở đây không ảnh hưởng gì cả
        try:
            # push notification cho các member khác
            members = ConversationMember.objects.filter(
                conversation_id=self.conversation_id
            ).select_related('user')

            for m in members:
                if m.user_id == self.user.id:
                    continue
                push_to_user( # gọi firebase push
                    m.user,
                    title=f'{self.user.username} gửi tin nhắn',
                    body=message
                )
        except Exception as e:
            print(f" Push notification error: {e}")

class NotificationConsumer(AsyncWebsocketConsumer): # chịu trách nhiệm kết nối khi vào app và đếm số count noti ngay khi vào app, khi nhấn vào noti sẽ broadcast từ signal qua và đặt lại 0
    async def connect(self):
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        self.user = self.scope['user'] #lấy ra user trong consumer giống request.user
        self.group_name = f'notification_{self.user.id}' # lưu tên kèm user id vào redis để gửi kết nối và data tới n thiết bị có tên đó
        await self.channel_layer.group_add(self.group_name, self.channel_name)# add vào redis tên group và tên channels tạo
        await self.accept()

        count = await self.get_unread_count()
        await self.send(text_data=json.dumps({'unread_count': count})) # chuyển thành chuỗi json

    async def disconnect(self, close_code):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self,text_data):
            pass

    async def send_notification(self,event): #event là cái group send gửi lên, event[''] là dữ liệu th group send
            await self.send(text_data=json.dumps(event['data']))# chuyển data của event thành json

    @database_sync_to_async
    def get_unread_count(self): # count ban đầu khi vào app
            return Notification.objects.filter(
                reciever=self.user,
                is_read=False
            ).count()