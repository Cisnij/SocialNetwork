from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView,SocialConnectView
from django.http import HttpResponse
from allauth.account.models import EmailConfirmation,EmailConfirmationHMAC
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.status import HTTP_200_OK,HTTP_400_BAD_REQUEST
#Liên kết với google
class GoogleLogin(SocialLoginView): 
    adapter_class = GoogleOAuth2Adapter
    callback_url = 'http://localhost:8000/accounts/google/login/callback/'
    client_class = OAuth2Client

#Liên kết tài khoản thường với gg
class GoogleConnect(SocialConnectView):
    adapter_class = GoogleOAuth2Adapter

#Ngắt liên kết
class GoogleDisconnect(SocialConnectView):
    adapter_class = GoogleOAuth2Adapter

