from django.shortcuts import render

# Create your views here.
#========================================================
#throttling
from rest_framework.throttling import ScopedRateThrottle 
from dj_rest_auth.registration.views import RegisterView
from dj_rest_auth.views import PasswordResetView

class CustomeRegisterView(RegisterView):# giới hạn đăng kí
    throttle_classes = [ScopedRateThrottle]
    throttle_scope= 'register' #đặt tên scope là register để dùng trong settings

class CustomePasswordResetView(PasswordResetView):# giới hạn reset pass
    throttle_classes = [ScopedRateThrottle]
    throttle_scope= 'reset_password'