from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView,SocialConnectView

from allauth.socialaccount.providers.oauth2.client import OAuth2Client

class FixedOAuth2Client(OAuth2Client):
    def __init__(self, *args, **kwargs):
        # Bỏ tham số scope_delimiter nếu đã có để tránh lỗi truyền nhiều lần
        kwargs.pop('scope_delimiter', None)
        super().__init__(*args, **kwargs)

#Liên kết với google
class GoogleLogin(SocialLoginView): 
    adapter_class = GoogleOAuth2Adapter
    callback_url = 'http://localhost:3000/google/callback/'
    client_class = FixedOAuth2Client

#Liên kết tài khoản thường với gg
class GoogleConnect(SocialConnectView):
    adapter_class = GoogleOAuth2Adapter

#Ngắt liên kết
class GoogleDisconnect(SocialConnectView):
    adapter_class = GoogleOAuth2Adapter

