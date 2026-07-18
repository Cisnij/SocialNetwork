import json

from django.utils import timezone

from api.models import ConversationMember, CallParticipant, Profile, VideoRoom, Message, Conversation, Notification
from channels.db import database_sync_to_async
from rules import is_active
from .ChatConsumer import HeartbeatMixin
from channels.generic.websocket import AsyncWebsocketConsumer

class NotificationConsumer(HeartbeatMixin, AsyncWebsocketConsumer):  # chịu trách nhiệm kết nối khi vào app và đếm số count noti ngay khi vào app
    async def connect(self):
        self.ping_task = None
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        self.user = self.scope['user']  # lấy ra user trong consumer giống request.user
        self.group_name = f'notification_{self.user.id}'  # lưu tên kèm user id vào redis để gửi kết nối và data tới n thiết bị có tên đó
        await self.channel_layer.group_add(self.group_name, self.channel_name)  # add vào redis tên group và tên channels tạo
        await self.accept()
        await self.start_heartbeat()

        count = await self.get_unread_count()
        await self.send(text_data=json.dumps({'unread_count': count}))  # chuyển thành chuỗi json

    async def disconnect(self, close_code):
        await self.stop_heartbeat()
        if getattr(self, 'group_name', None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            if self.handle_pong(data):
                return
        except json.JSONDecodeError:
            pass

    async def send_notification(self, event):  # event là cái group send gửi lên, event[''] là dữ liệu th group send
        try:
            await self.send(text_data=json.dumps(event['data']))  # chuyển data của event thành json
        except RuntimeError:
            pass  # client đã đóng kết nối, bỏ qua

    async def event_reminder(self, event):
        try:
            await self.send(text_data=json.dumps(event))
        except RuntimeError:
            pass

    async def group_notification(self, event):
        try:
            await self.send(text_data=json.dumps(event))
        except RuntimeError:
            pass

    async def incoming_call(self, event):
        try:
            await self.send(text_data=json.dumps(event))
        except RuntimeError:
            pass

    async def call_cancelled(self, event):
        try:
            await self.send(text_data=json.dumps(event))
        except RuntimeError:
            pass

    @database_sync_to_async
    def get_unread_count(self):  # count ban đầu khi vào app
        return Notification.objects.filter(
            reciever=self.user,
            is_read=False
        ).count()
