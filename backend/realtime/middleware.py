from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth import get_user_model

User = get_user_model()

@database_sync_to_async
def get_user_from_token(token_key): # hàm nhận vào token 
    try:
        token = AccessToken(token_key) # xác minh token 
        return User.objects.get(id=token['user_id']) # lấy user qua token 
    except Exception:
        return AnonymousUser() # không thì là anon 


class JwtOrSessionMiddleware: #api websocket cho cả web và mobile, web thì dùng cookie để biết user, mobile thì dùng token truyền vào url biết user 
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope["query_string"].decode()) #giải mã từ url 
        token = query.get("token", [None])[0] #lấy ra sau token

        # Nếu có token → dùng JWT cho mobile
        if token:
            scope["user"] = await get_user_from_token(token) #lấy ra user 

        # Nếu không có token → KHÔNG set user
        # để AuthMiddlewareStack xử lý session cookie

        return await self.inner(scope, receive, send)