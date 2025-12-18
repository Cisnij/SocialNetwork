import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from api.models import ConversationMember,Message

class ChatConsumer(AsyncWebsocketConsumer):
    # Kết nối đến WebSocket
    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']#lấy tên phòng từ url nhập
        self.user=self.scope['user'] # lấy user đang trong tiến trình
        self.room_name=f'chat_{self.conversation_id}' #tên phòng

        if not self.user.is_authenticated: #check đăng nhập
            await self.close()  # Đóng kết nối nếu người dùng chưa xác thực
            return
        
        is_member= await self.is_member()
        if not is_member: 
            await self.close()  # Đóng kết nối nếu người dùng không phải thành viên
            return
        
        await self.channel_layer.group_add( #thêm phòng vào group
            self.room_name, 
            self.channel_name 
        )
        
        await self.accept() #chấp nhận kết nối từ client

    # Ngắt kết nối
    async def disconnect(self,close_code):
        await self.channel_layer.group_discard(
            self.room_name,
            self.channel_name
        )

    # Đây là nơi xử lý khi nhận dữ liệu từ client từ sendMessage ở frontend và gửi lại cho nhóm phòng
    async def receive(self, text_data): #text data bắt buộc ghi đúng 
        
        #nhận message từ client và lấy ra từ json
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        message = data['message']
        if not message:
            return
        
        #lưu vào db
        msg= await self.save_message(message) #dùng hàm ở dưới save message vào db
        # Gửi đến nhóm phòng
        await self.channel_layer.group_send(
            self.room_name,  
            {
                'type':'chat_message',  # Loại sự kiện
                'message':message,  # Tin nhắn từ client
                'sender': self.user.username,  # Tên người dùng gửi tin nhắn
                'id': msg.id,
                'created_at': msg.created_at.isoformat()
            }
        )

    #sau khi chạy receive rồi thì chạy hàm này 
    # chat_message sẽ chạy khi 'type' ở receive chạy  
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message': event['message'],
            'user': event['user'],
            }))
        

    #làm việc với db phải dùng database_sync_to_async
    async def is_memeber(self):#kiểm tra xem có là thành viên
        return await database_sync_to_async(
            ConversationMember.objects.filter(
                conversation_id=self.conversation_id,
                user=self.user
            ).exists
        )()
    #lưu vào cơ sở dữ liệu sau khi nhận tin nhắn từ client
    @database_sync_to_async
    def save_message(self, message):
        return Message.objects.create(conversation_id=self.conversation_id, sender=self.user, content=message)