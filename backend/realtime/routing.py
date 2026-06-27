from django.urls import re_path
from .CallConsumer import CallConsumer
from .NotificationConsumer import NotificationConsumer
from .ChatConsumer import ChatConsumer
from .ConversationConsumer import ConversationConsumer
wsPattern =[
    re_path(r'^ws/chat/(?P<conversation_id>[\w\-]+)/$', ChatConsumer.as_asgi()), # \w là chữ cái/số/dấu, \- là dấu - đc phép, + là trên 1 kí tự, $ là kết thúc
    re_path(r'^ws/notifications/$', NotificationConsumer.as_asgi()), # $ để kết thúc cuối cùng k đc thêm gì
    re_path(r'^ws/conversations/$', ConversationConsumer.as_asgi()),
    re_path(r'^ws/call/(?P<conv_id>[\w\-]+)/$', CallConsumer.as_asgi()),

]