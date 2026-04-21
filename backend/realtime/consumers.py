import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from api.models import ConversationMember,Message
from friendship.models import Block
# class ChatConsumer(AsyncWebsocketConsumer):
#     # Kết nối đến WebSocket
#     async def connect(self):
#         self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']#lấy tên phòng từ url nhập
#         self.user=self.scope['user'] # lấy user đang trong tiến trình
#         self.room_name=f'chat_{self.conversation_id}' #tên phòng

#         if not self.user.is_authenticated: #check đăng nhập
#             await self.close()  # Đóng kết nối nếu người dùng chưa xác thực
#             return
        
#         is_member= await self.is_member()
#         if not is_member: 
#             await self.close()  # Đóng kết nối nếu người dùng không phải thành viên
#             return
        
#         await self.channel_layer.group_add( self.room_name, self.channel_name)#thêm phòng vào group
#         await self.accept() #chấp nhận kết nối từ client

#     # Ngắt kết nối
#     async def disconnect(self,close_code):
#         await self.channel_layer.group_discard(self.room_name,self.channel_name)

#     # Đây là nơi xử lý khi nhận dữ liệu từ client từ sendMessage ở frontend và lưu(server)
#     async def receive(self, text_data): #text data bắt buộc ghi đúng 
#         #nhận message từ client và lấy ra từ json
#         try:
#             data = json.loads(text_data)
#         except json.JSONDecodeError:
#             return
#         message = data['message']
        
#         if not message:
#             return
        
#         #lưu vào db
#         msg= await self.save_message(message) #dùng hàm ở dưới save message vào db
#         # Gửi đến nhóm phòng
#         await self.channel_layer.group_send(
#             self.room_name,  
#             {
#                 'type':'chat_message',  # Loại sự kiện
#                 'message':message,  # Tin nhắn từ client
#                 'sender': self.user.username,  # Tên người dùng gửi tin nhắn
#                 'id': msg.id,
#                 'created_at': msg.created_at.isoformat()
#             }
#         )

#     #sau khi chạy receive rồi thì chạy hàm này 
#     # chat_message sẽ chạy khi 'type' ở receive chạy, hiểu nôm na là hàm này gửi tin nhắn server đến fe dạng json và load ra, bắt buộc phải giống khai báo của group_send
#     async def chat_message(self, event):
#         await self.send(text_data=json.dumps({
#             'id': event['id'],
#             'message': event['message'],
#             'sender': event['sender'],
#             'created_at': event['created_at'],
#             }))
        
#     # seen message đồng bộ giữa các thiết bị
#     # async def seen_message(self, event): 
#     #     await self.send(text_data=json.dumps({
#     #         'type': 'seen_message',
#     #         'user_id': event['user_id'],
#     #         'last_message_id': event['last_message_id'],
#     #     }))
        

#     #làm việc với db phải dùng database_sync_to_async
#     async def is_member(self):#kiểm tra xem có là thành viên
#         return await database_sync_to_async(
#             ConversationMember.objects.filter(
#                 conversation_id=self.conversation_id,
#                 user=self.user
#             ).exists
#         )()

#     #lưu vào cơ sở dữ liệu sau khi nhận tin nhắn từ client
#     @database_sync_to_async
#     def save_message(self, message):
#         return Message.objects.create(conversation_id=self.conversation_id, sender=self.user, content=message)
    


"""flow là khi người dùng gửi tin nhắn thì chạy connect trước, sau đó là chạy receive() để server nhận tin nhắn từ người dùng
sau đó, thông qua hàm chat_message() thì server sẽ gửi tin nhắn về ng dùng(vì thế nên bắt buộc phải lấy đúng event từ receive, vì nếu k có nó thì sao gửi)
connect-> receive(server) -> send -> client"""

"""
-flow từ back tới front end
-Frontend: User gọi tất cả đoạn chat và gán id cho từng cái đó, front-end gọi new WebSocket và khởi tạo url với conversation_id đó khi click tương ứng,sau đó chạy open
-Backend: chạy hàm connect và group add conversation_id đó sau đó chạy accept
-Frontend: socket.send tin nhắn 
-Backend: Chạy receive nhận data từ fe dưới dạng json và lưu db, sau đó chạy group_send lấy từ db vừa save, chuẩn bị data và gửi tín hiệu, cuối cùng chạy chat_message send load data từ groupsend để gửi về fe load ra
-Frontend: Nhận tin nhắn và chạy onmessage

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
from api.models import ConversationMember, Message, Conversation
from friendship.models import Block
from django.contrib.auth.models import User
from api.firebase import push_to_user

class ChatConsumer(AsyncWebsocketConsumer):

    # ===== CONNECT =====
    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id'] # lấy conversation_id từ url
        self.user = self.scope['user'] # lấy user từ middleware (JWT đã xác thực ở middleware) 
        self.room_name = f'chat_{self.conversation_id}' # tên phòng để group_send
        # check đăng nhập, middleware JWT không hợp lệ sẽ bị đây
        if self.user.is_anonymous:
            await self.close()
            return

        is_member = await self.is_member()
        if not is_member: # check có phải thành viên không
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name) # thêm vào group phòng chat
        await self.accept() # chấp nhận kết nối WebSocket
        print("CONNECT:", self.channel_name)

    # ===== DISCONNECT =====
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_name, self.channel_name) # rời khỏi group khi ngắt kết nối

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
            await self.send(text_data=json.dumps({'error': reason})) # báo lỗi về client
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
    # hàm này chạy sau group_send, bắt buộc tên phải giống type trong group_send, lấy ra từ db và gửi đi
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