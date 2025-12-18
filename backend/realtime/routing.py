from django.urls import re_path
from . import consumers

wsPattern =[
    re_path(r'^ws/chat/(?P<conversation_id>[\w\-]+)/$', consumers.ChatConsumer.as_asgi()),
]