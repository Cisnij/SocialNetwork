#Setting Xác thực với dj-rest-auth và allauth và axes[ipware], corsheaders

from .settings import *

SITE_ID=1
REST_FRAMEWORK={ #Cấu hình token
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',  #Spectacular
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',  # Để debug trực tiếp bằng trình duyệt
    ),
    'DEFAULT_AUTHENTICATION_CLASSES':[
        'rest_framework_simplejwt.authentication.JWTAuthentication',#xác thực jwt
        
    ],
    'DEFAULT_THROTTLE_CLASSES': [ #Chống spam và bruteforce
    'rest_framework.throttling.UserRateThrottle',
    'rest_framework.throttling.AnonRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'user': '1000/day',
        'anon': '100/day',
    }

    
}
REST_AUTH={ #Đăng kí trả về json
    'USE_JWT':True,
    'VERIFY_EMAIL_SERIALIZER': 'dj_rest_auth.registration.serializers.VerifyEmailSerializer',
    'CONFIRM_EMAIL_SERIALIZER': 'dj_rest_auth.registration.serializers.ConfirmEmailSerializer',
    'PASSWORD_RESET_SERIALIZER': 'dj_rest_auth.serializers.PasswordResetSerializer',
    'PASSWORD_RESET_CONFIRM_SERIALIZER': 'dj_rest_auth.serializers.PasswordResetConfirmSerializer',
    'PASSWORD_CHANGE_SERIALIZER': 'dj_rest_auth.serializers.PasswordChangeSerializer',
    'USER_DETAILS_SERIALIZER':'dj_rest_auth.serializers.UserDetailsSerializer',
    'REGISTER_SERIALIZER': 'api.serializers.CustomRegisterSerializer',#bên serializers.py
    'LOGOUT_ON_PASSWORD_CHANGE':True, #logout khi change pass
    'TOKEN_MODEL': None,
    'OLD_PASSWORD_FIELD_ENABLED' : True # Phải nhập mk cũ mới đc đổi mk
}

from datetime import timedelta
SIMPLE_JWT={
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,

    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,

    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_HEADER_NAME": "HTTP_AUTHORIZATION",

    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",

    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
    
}
#Vào trang này tạo password để google gửi mail https://myaccount.google.com/apppasswords?rapt=AEjHL4OhamB7RBkSZ38jKPnEu25PBC4T4-xJR0tR_zwRuRKLuIxCsaVVe9zJ-HYQ2_s2jMSm4Vbx7iyUBPzT33DjKWuyBe8dR4BWZwv7UejQeB1ttZLWcJ8
#Này là gửi mail xác nhận
EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend'#PHƯƠNG THỨC GỬI MAIL
EMAIL_HOST='smtp.gmail.com' #MÁY CHỦ
EMAIL_PORT=587
EMAIL_USE_TLS=True #MÃ HÓA BẢO VỆ THÔNG TIN
EMAIL_HOST_USER=env('EMAIL_HOST_USER')
EMAIL_HOST_PASSWORD=env('EMAIL_HOST_PASSWORD')
DEFAULT_FROM_EMAIL='Social Network Support <trannghi1672004@gmail.com>' # EMAIL SẼ THẤY GỬI TỪ FROM:

#NÀY LÀ NGƯỜI DÙNG DÙNG MAIL XÁC THƯC allauth
ACCOUNT_LOGIN_METHODS = ['email'] #Dùng email đăng nhập  
ACCOUNT_SIGNUP_FIELDS = ['email*']#các trường bắt buộc để tạo account
ACCOUNT_EMAIL_VERIFICATION='mandatory' #để confirm email, và bắt buộc phải confirm để đăng nhập 
ACCOUNT_UNIQUE_EMAIL=True #mỗi email chỉ 1 tài khoản duy nhất
ACCOUNT_CONFIRM_EMAIL_ON_GET=False 
ACCOUNT_EMAIL_CONFIRMATION_EXPIRE_DAYS = 1 #Thời hạn hết hạn verify
ACCOUNT_RATE_LIMITS={'confirm_email':'180/m'} # Thời gian cool down sau mỗi lần resend link  
ACCOUNT_EMAIL_VALIDATORS = ['allauth.account.email_validators.ValidateEmailDomain',] #xác thực phải là email thật 
ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION=True #đăng nhập luôn sau khi confirm email
ACCOUNT_AUTHENTICATED_REDIRECT_URL = 'http://192.168.1.5:3000/'# redirect khi login
ACCOUNT_EMAIL_CONFIRMATION_ANONYMOUS_REDIRECT_URL = "http://127.0.0.1:3000/register/success-regis/"#redirect sau khi thành công xác thực
ACCOUNT_EMAIL_CONFIRMATION_AUTHENTICATED_REDIRECT_URL = "http://127.0.0.1:3000/register/success-regis/"
ACCOUNT_PASSWORD_MIN_LENGTH = 8 #độ dài tối thiểu mk là 8
ACCOUNT_USERNAME_MIN_LENGTH = 5 #độ dài tối thiểu username là 5

AUTHENTICATION_BACKENDS=[
    'axes.backends.AxesStandaloneBackend',#axes
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',#allauth
]
#đăng kí với gg và fb để đăng nhập đc
SOCIALACCOUNT_PROVIDERS={
    'google':{
        'APP':{
            'client_id': env('GOOGLE_CLIENT_ID'),
            'secret':env('GOOGLE_SECRET'),
            'key':''
        }
    },
    # 'facebook':{
    #     'APP':{
    #         'client_id':'',
    #         'secret':'',
    #         'key':''

    #     }
    # }
}
AXES_ENABLED=True
AXES_FAILURE_LIMIT=4 #giới hạn lần sai
AXES_CACHE_TIMEOUT = 60 * 60 # reset lại sau từ n lần sai thành 0 nếu sau 1h
AXES_COOLOFF_TIME=timedelta(hours=1) #Số giờ cooldown sau 4 lần sai
AXES_LOCK_OUT_AT_FAILURE = True # Khoá tài khoản sau khi vượt quá số lần đăng nhập sai
AXES_RESET_ON_SUCCESS=True #reset khi đăng nhập thành công
AXES_LOCKOUT_PARAMETERS=['username','ip_address'] #lockout theo username và ip
USE_X_FORWARDED_HOST=True
CORS_ALLOW_CREDENTIALS = True
X_FRAME_OPTIONS = 'DENY'
REFERRER_POLICY = 'same-origin'
IPWARE_USE_X_FORWARDED_FOR = True
IPWARE_IP_HEADER = 'HTTP_X_FORWARDED_FOR'
CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS')
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS')
from corsheaders.defaults import default_headers
CORS_ALLOW_HEADERS=list(default_headers)+['authorization','X-CSRFToken'] #thêm csrf token và bearer vào cho phép truy cập

if not DEBUG:
     SECURE_CONTENT_TYPE_NOSNIFF = True
     SECURE_BROWSER_XSS_FILTER = True
     SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO','https')
     SECURE_HSTS_SECONDS = 31536000  # nếu dùng HTTPS
     SECURE_HSTS_INCLUDE_SUBDOMAINS = True
     SECURE_HSTS_PRELOAD = True
     SECURE_SSL_REDIRECT = True #chuyển hướng http-> https(sau này deploy bật)
