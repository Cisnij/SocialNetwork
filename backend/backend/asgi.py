"""
ASGI config for backend project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from realtime.routing import wsPattern
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

application = ProtocolTypeRouter({
            "http": get_asgi_application(), # Xử lý các yêu cầu HTTP thông thường
            "websocket": AllowedHostsOriginValidator( # Bảo vệ các kết nối WebSocket từ các nguồn không được phép
                AuthMiddlewareStack( # Xử lý xác thực người dùng cho WebSocket
                    URLRouter(
                        wsPattern  # Lấy ra từ routing
                    )
                )
            ),     


        })