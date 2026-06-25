import json

from django.utils import timezone

from api.models import ConversationMember, CallParticipant, Profile, VideoRoom, Message, Conversation
from channels.db import database_sync_to_async
from rules import is_active
from .ChatConsumer import HeartbeatMixin
from channels.generic.websocket import AsyncWebsocketConsumer

class ConversationConsumer(HeartbeatMixin, AsyncWebsocketConsumer):
    async def connect(self):
        self.ping_task = None
        if not self.scope['user'].is_authenticated:
            await self.close()
            return
        self.user = self.scope['user']
        self.group_name = f'conv_list_{self.user.id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.start_heartbeat()

    async def disconnect(self, code):
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

    async def conversation_updated(self, event):
        await self.send(text_data=json.dumps({
            'conversation_id': event['conversation_id'],
            'last_message': event.get('last_message'),
            'sender_id': event.get('sender_id'),
            'sender_name': event.get('sender_name'),
            'message_type': event.get('message_type'),
            'created_at': event.get('created_at'),
        }))

# cần lặp group send vì không như chat mn chung 1 group, conv list thì mỗi user 1 conv list