from urllib.parse import parse_qs
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.exceptions import AuthenticationFailed

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
    

class MobileAllowedOriginValidator: # mobile thì k gửi origin nên bỏ qua
    """ 
    Giống AllowedHostsOriginValidator nhưng cho phép mobile
    (mobile thường không gửi Origin header), orgin là nguồn gốc ví dụ facebook.com gọi google.com thì origin là facebook.com
    nếu k có origin thì bypass, còn web đều đa số bắt buộc gửi origin nên k thể lọt vào trường hợp k có để bypass, kiểm tra trong allowed host
    """
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            headers = dict(scope.get("headers", []))
            origin = headers.get(b"origin", None) #lấy origin thử

            # mobile không gửi origin → cho qua
            if origin is None:
                return await self.inner(scope, receive, send)

            # có origin → kiểm tra như AllowedHostsOriginValidator
            from django.conf import settings
            origin_str = origin.decode("utf-8")
            allowed = [
                f"http://{host}" for host in settings.ALLOWED_HOSTS
            ] + [
                f"https://{host}" for host in settings.ALLOWED_HOSTS
            ]

            if "*" in settings.ALLOWED_HOSTS or any(
                origin_str.startswith(a) for a in allowed
            ):
                return await self.inner(scope, receive, send)

            # origin không hợp lệ → đóng kết nối
            await send({"type": "websocket.close", "code": 4403})
            return

        return await self.inner(scope, receive, send)
    
    

class OnlineStatusMiddleware: #middleware đánh dấu onl/off dùng redis
    """
        Middleware theo dõi trạng thái online của user.
        Mỗi request có JWT hợp lệ → đánh dấu online trong Redis 5 phút.
        Không gọi API 5 phút → Redis tự xóa → offline.
        Hoạt động cho cả web lẫn mobile vì đều dùng JWT header.
    """
    def __init__(self, get_response):
        self.get_response = get_response
        
    def __call__(self, request):
        self._set_online(request)
        return self.get_response(request)

    def _set_online(self, request):
        # decode JWT để lấy user, không phụ thuộc vào django session
        # hoạt động với cả web (browser) và mobile (app)
        try: # dùng lấy headers mobile có token k
            jwt_auth = JWTAuthentication()
            result = jwt_auth.authenticate(request) # lấy token ở header khi gửi request và tự decode xác thực lấy ra user 
            if result is not None:
                jwt_user, _ = result # result trả ra user và token, k cần token nên k lấy user,_ thay vì user,token =
                # set online — timeout 300s (5 phút)
                # mỗi lần gọi API sẽ reset lại 300s
                cache.set(f'online_user:{jwt_user.id}', True, timeout=300) # dùng cache set của django, mà django khai báo CACHES của redis là mặc định nên vẫn là dùng redis lưu vào ram
        except (AuthenticationFailed, Exception):
            pass  # token lỗi hoặc không có token → bỏ qua, không raise
        
        
        # k phải mobile thì là web 
        if hasattr(request, 'user') and request.user.is_authenticated: # nếu k có header token mà dùng session thì dùng, tìm trong request từ cookie có user k
            user= request.user
            if user is not None:
                cache.set(f"online_user:{user.id}",True,timeout=300) # cặp key_value là: 'online_user:5' và 'True'
        return self.get_response(request)