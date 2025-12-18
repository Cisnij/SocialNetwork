from dj_rest_auth.views import LoginView,LogoutView
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework import status
from rest_framework_simplejwt.views import TokenRefreshView  
from rest_framework.throttling import ScopedRateThrottle
from dj_rest_auth.registration.views import SocialLoginView
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from .google_login import FixedOAuth2Client
from .models import Profile,PendingProfile
#--LƯU Ý cái này dùng để xây http only cho web và tạo ra endpoint mới như api/auth/web/login
#-- Còn khi xây mobile sẽ dùng endpoint bth là api/auth/login để trả về token trong json


class CookieLoginView(LoginView): #ghi đè hàm login để trả về token trong cookie http only và set refresh token vào cookie 
    def get_response(self): # hàm mặc định của Login view sẽ trả về response sau khi login thành công
        original_response = super().get_response() #lấy về response gốc từ LoginView gồm user info...
        data=original_response.data
        #Lấy refresh token và set vào cookie
        refreshToken=data.pop('refresh', None) #xóa khỏi json trả về
        if refreshToken:# nếu có refresh token thì set vào cookie và thêm vào response gốc 
            original_response.set_cookie(
                key='refreshToken',
                value=refreshToken,
                httponly=True,
                secure=False,  # Chỉ dùng False nếu đang phát triển trên localhost, vì prod sẽ tự chuyển sang https
                samesite='Lax',
                path='/api/auth/web/',  # Chỉ gửi cookie cho endpoint này
                max_age=7*24*60*60
            )
        return original_response

class CookieTokenRefreshView(TokenRefreshView): #ghi đè lấy refresh token từ cookie và trả về access token mới
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='cookie_refresh' 

    def post(self, request, *args, **kwargs):
        refreshToken= request.COOKIES.get('refreshToken')#lấy refresh token từ cookie
        
        if not refreshToken: # nếu không có 
            return Response({"detail": "No refresh token cookie."}, status=status.HTTP_401_UNAUTHORIZED)
        
        try: #nếu có 
            refresh=RefreshToken(refreshToken) # xác minh refresh token được gửi từ cookie
            access_token=str(refresh.access_token)# tạo access token từ refresh token
            return Response({"access": access_token}, status=status.HTTP_200_OK)
        except Exception:
            return Response({"detail": "Invalid refresh token."}, status=status.HTTP_401_UNAUTHORIZED)
        

class CookieLogoutView(LogoutView): #ghi đè hàm logout để xóa cookie
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs) #lấy về response gốc từ LogoutView
        response.delete_cookie('refreshToken', path='/api/auth/web/') #xóa cookie refresh token
        return response

class CookieGoogleLoginView(SocialLoginView):#ghi đè hàm login google để trả vể refresh token cho web
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='google_login'

    adapter_class = GoogleOAuth2Adapter
    callback_url = 'http://localhost:3000/google/callback/'
    client_class = FixedOAuth2Client

    def post(self, request, *args, **kwargs):
        original_response = super().post(request, *args, **kwargs) #bắt đầu xử lý đăng nhập và báo status, ở dưới là sau khi thành công sẽ set cookie(tạo user, pending profile, tạo profile, xóa pending)
        # Allauth đã gán sẵn: self.user, self.sociallogin, self.sociallogin.account.extra_data sau khi super().post()

        if original_response.status_code != 200:
            return original_response
        
        user = self.user  # allauth đã gán sẵn
        social_account = user.socialaccount_set.filter(provider='google').first() # lọc ra social account của user trước sau đó lấy ra extra data
        extra = social_account.extra_data if social_account else {}
        
        # Tạo profile nếu chưa có
        profile, created = Profile.objects.get_or_create(
            user=user,
            defaults={
                "auth_provider": "google",
                "first_name": extra.get("given_name"),
                "last_name": extra.get("family_name"),
            }
        ) 
        # lấy extra data của google gán luôn vào profile, chỉ áp dụng với mới profile mới tạo ở trên, đã custome hay connect thì k đc 
        if created:
            profile.first_name = extra.get("given_name")
            profile.last_name = extra.get("family_name")
            profile.auth_provider = "google"
            profile.save()

        # Xóa PendingProfile do đã set bên signal tạo user sẽ tạo pending profile
        PendingProfile.objects.filter(user=user).delete()

        if user:
            refreshToken = str(RefreshToken.for_user(user))
            original_response.set_cookie(
                key='refreshToken',
                value=refreshToken,
                httponly=True,
                secure=False, #Sau này sửa lại True
                samesite='Lax', 
                path='/api/auth/web/',
                max_age=7*24*60*60
            )
        return original_response