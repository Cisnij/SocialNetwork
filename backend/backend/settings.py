
from pathlib import Path
from .env_config import env
import os
BASE_DIR = Path(__file__).resolve().parent.parent

#===========================================================================================================================
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

INSTALLED_APPS = [
    'jazzmin',  #giao diện admin
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'api',
    'realtime',
    'cacheops', # lưu các truy vấn đã truy vấn và trả về luôn, save tài nguyên
    'django_extensions',# công cụ tiện ích 
    'debug_toolbar',#hiển thị các tiến trình
    'silk', #theo dõi sâu
    'corsheaders',#corsheader 
    # Phần bảo mật
    'django.contrib.sites',
    'rest_framework',
    'rest_framework.authtoken',
    'dj_rest_auth',
    'dj_rest_auth.registration',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'allauth.socialaccount.providers.google',
    'axes',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'csp',
    'django_pwned_passwords',
    #Phần dưới là spectacular sinh ra tài liệu 
    'drf_spectacular',
    'drf_spectacular_sidecar',
    #django cleanup
    "django_cleanup.apps.CleanupConfig",
    #Phần like và thả reaction post,comments
    'reaction.apps.ReactionConfig',
    #lọc filter cho restframework
    'django_filters',
    #safe delete
    'safedelete',
    #activity stream
    'actstream',
    #django-friendship để xây dựng follow
    'friendship',
    #django-channels 
    'channels',
    #cloud lưu ảnh, video và file
    'cloudinary_storage',
    'django.contrib.staticfiles',
    'cloudinary',
    #elastic search
    'django_elasticsearch_dsl',




]
MIDDLEWARE = [
    'whitenoise.middleware.WhiteNoiseMiddleware', #whitenoise
    "csp.middleware.CSPMiddleware",#csp
    'corsheaders.middleware.CorsMiddleware',# corsheader

    'django.middleware.security.SecurityMiddleware', # các header bảo mật
    'django.contrib.sessions.middleware.SessionMiddleware', #Quản lý session
    'django.middleware.common.CommonMiddleware', # Xử lý các request thông thường
    'django.middleware.csrf.CsrfViewMiddleware',# CSRF chống giả mạo request
    'django.contrib.auth.middleware.AuthenticationMiddleware', #Xác thực user
    
    'realtime.middleware.OnlineStatusMiddleware', # middleware tự custome cho đánh dấu online
    'django.contrib.messages.middleware.MessageMiddleware',# Hệ thống message Django
    'django.middleware.clickjacking.XFrameOptionsMiddleware', #bảo vệ web khỏi bị nhúng iframe
    'axes.middleware.AxesMiddleware',#axes
    "silk.middleware.SilkyMiddleware",#silk
    'debug_toolbar.middleware.DebugToolbarMiddleware',#debug tool bar
    'allauth.account.middleware.AccountMiddleware',#allauth
    
]

ROOT_URLCONF = 'backend.urls'
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR/'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                
            ],
        },
    },
]
WSGI_APPLICATION = 'backend.wsgi.application'

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": env("DB_NAME"),
        "USER": env("DB_USER"),
        "PASSWORD": env('DB_PASSWORD'),
        "HOST": env('DB_HOST'),
        "PORT": env('DB_PORT', default='3306'),

        # Performance
        "CONN_MAX_AGE": 300,  # tái sử dụng cổng đã mở, tái sử dụng connection lâu hơn
        "CONN_HEALTH_CHECKS": True,  # kiểm tra connection còn sống không trước khi dùng

        "OPTIONS": {
            # SQL mode chuẩn production
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",

            "charset": "utf8mb4",  # support emoji, ký tự đặc biệt

            # Giảm latency kết nối
            "connect_timeout": 5,

            # SSL — bật nếu DB ở server khác giúp mã hóa dữ liệu truyền qua mạng
            # "ssl": {
            #     "ca": "/path/to/ca-cert.pem",
            # },
        },
    }
}


AUTH_PASSWORD_VALIDATORS = [ 
    {
        "NAME": "pwned_passwords_django.validators.PwnedPasswordsValidator", #pwn_password 
        
    },
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'vi'

TIME_ZONE = 'Asia/Ho_Chi_Minh'

USE_I18N = True
USE_L10N = True
USE_TZ = False

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
]

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
#lưu ảnh
# MEDIA_ROOT=os.path.join(BASE_DIR,'media') #basedir là tìm trong thư mục gốc có media
MEDIA_URL='/media/' #ví dụ media/abc.jpg

# cấu hình các file setting nhỏ phụ thuộc
from .settings_authentication import *
from .settings_admin import *
from .settings_backend import *