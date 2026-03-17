"""
ASGI config for backend project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os
import django
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup() 

# Import channels SAU khi django.setup() chạy xong
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator
from realtime.routing import wsPattern
from realtime.middleware import *
application = ProtocolTypeRouter({
            "http": get_asgi_application(), # Xử lý các yêu cầu HTTP thông thường
            "websocket": MobileAllowedOriginValidator( # Bảo vệ các kết nối WebSocket từ các nguồn không được phép
                JwtOrSessionMiddleware( #custome xử lý cho cả mobile và web                       
                    AuthMiddlewareStack( # Xử lý xác thực người dùng cho WebSocket, chỉ dùng cho web vì nó đọc cookie xác thực
                        URLRouter(
                            wsPattern  # Lấy ra từ routing
                        )
                    )
                ),
            ),     
        })