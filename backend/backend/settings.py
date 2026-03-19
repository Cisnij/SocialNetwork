
from pathlib import Path
import os
BASE_DIR = Path(__file__).resolve().parent.parent

#===========================================================================================================================
#Biến môi trường env 
import environ

env=environ.Env(DEBUG=(bool,False))
environ.Env.read_env(BASE_DIR/".env")
#==================================================================================================================================

SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG",default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["*"])

INSTALLED_APPS = [
    'jazzmin',  #giao diện admin 
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
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
    


]
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage' #whitenoise 
MIDDLEWARE = [
    'whitenoise.middleware.WhiteNoiseMiddleware', #whitenoise
    "csp.middleware.CSPMiddleware",#csp
    'corsheaders.middleware.CorsMiddleware',# corsheader

    'django.middleware.security.SecurityMiddleware', # các header bảo mật
    'django.contrib.sessions.middleware.SessionMiddleware', #Quản lý session
    'django.middleware.common.CommonMiddleware', # Xử lý các request thông thường
    'django.middleware.csrf.CsrfViewMiddleware',# CSRF chống giả mạo request
    'django.contrib.auth.middleware.AuthenticationMiddleware', #Xác thực user
    
    
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
        'DIRS': [],
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
        "OPTIONS": {
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'",
        },
        'CONN_MAX_AGE': 60, #dùng kết nối cũ để query, sẽ tự đóng trong n thời gian 
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

STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')


DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

MEDIA_ROOT=os.path.join(BASE_DIR,'media') #basedir là tìm trong thư mục gốc có media
MEDIA_URL='/media/'

#=====================================================================================================================================================================================
#cacheops
CACHEOPS_REDIS={
    'host':'localhost',
    'port': 6379,
    'db':1,
    'socket_timeout':3,
}

CACHEOPS={
    # ở tất cả bảng, cache(lưu vào bộ nhớ phụ và reuse) ví dụ get,filter,count...trong 15p.
    '''ví dụ ng dùng gọi api lần 1 nó lưu vào cache, nó phát hiện có bài đăng mới nó sẽ tự gọi lại và lưu cache mà k cần đợi timeout'''
    'auth.user':{'ops':('get','filter'),'timeout':60*60}, # cache user từ auth, ví dụ cache khi lấy ra user, lọc user
    'api.Profile':          {'ops': 'all', 'timeout': 60*30}, #ops là cache querry gì kiểu get,count,filter...timeout là bao lâu thì xóa
    'api.PendingProfile':   {'ops': 'all', 'timeout': 60*30},
    'api.Setting':          {'ops': 'all', 'timeout': 60*60},

    #  Cache vừa — thay đổi vừa
    'api.Post':             {'ops': 'all', 'timeout': 60*10},
    'api.PostArticle':      {'ops': 'all', 'timeout': 60*10},
    'api.PostPhoto':        {'ops': 'all', 'timeout': 60*10},
    'api.Comment':          {'ops': 'all', 'timeout': 60*10},
    'api.Notification':     {'ops': 'all', 'timeout': 60*5},
    'api.SearchHistory':    {'ops': 'all', 'timeout': 60*5},
    #  Cache ngắn — realtime
    'api.Conversation':     {'ops': 'all', 'timeout': 60*2},
    'api.ConversationMember': {'ops': 'all', 'timeout': 60*2},
}

#==========================================================================================================================================================================================================

INTERNAL_IPS = [ # xem ip nào đc xem toolbar 
    "127.0.0.1",
]
#cấu hình các file setting nhỏ phụ thuộc
from .settings_authentication import *
from .settings_admin import *
from .settings_backend import *
#==========================================================================================================================================================================================================
#Channels
ASGI_APPLICATION  = "backend.asgi.application" # setting để runserver có thể chạy asgi 
#redis chạy channels 
# dùng daphne để chạy cả http + websocket 

# if DEBUG:
#     CHANNEL_LAYERS = {
#         "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
#     }
# else:
#     CHANNEL_LAYERS = {
#         'default': {
#             'BACKEND': 'channels_redis.core.RedisChannelLayer',
#             'CONFIG': {'hosts': [('127.0.0.1', 6379)]},
#         }
#     }
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)],
        },
    },
}
#============================================================================================
# lưu query vào cache  tránh gọi trong db
CACHES = {  #xài redis
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": "redis://127.0.0.1:6379/2",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        }
    }
}
# Channels  → DB 0
# Caches    → DB 2  
# Cacheops  → DB 1 
#============================================================================================
#django-extensions
REST_FRAMEWORK_EXTENSIONS = {
    'DEFAULT_CACHE_RESPONSE_TIMEOUT': 60*15,  # 15 phút mặc định
}