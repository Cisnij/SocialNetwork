from django.urls import re_path
from . import consumers

wsPattern =[
    re_path(r'^ws/chat/(?P<conversation_id>[\w\-]+)/$', consumers.ChatConsumer.as_asgi()), # \w là chữ cái/số/dấu, \- là dấu - đc phép, + là trên 1 kí tự, $ là kết thúc
    re_path(r'^ws/notifications/$', consumers.NotificationConsumer.as_asgi()), # $ để kết thúc cuối cùng k đc thêm gì
    re_path(r'^ws/conversations/$', consumers.ConversationConsumer.as_asgi()),

]