from .env_config import env,SECRET_KEY,DEBUG
import os
#=======================================SILK=============================================================================
SILKY_PYTHON_PROFILER = False            # Bật profiling cho Python code
SILKY_PYTHON_PROFILER_BINARY = True     # Lưu profile ở dạng binary (có thể dùng với tools như SnakeViz)
SILKY_MAX_REQUEST_BODY_SIZE = -1        # Lưu toàn bộ body request (mặc định là 100kb)
SILKY_MAX_RESPONSE_BODY_SIZE = -1       # Lưu toàn bộ body response
SILKY_INTERCEPT_PERCENT = 100           # % request được Silk ghi nhận

#=================== Django activity stream settings ============================================================================
ACTSTREAM_SETTINGS = {
    'MANAGER': 'actstream.managers.ActionManager', # Hàm mặc định có sẵn các chức năng quản lý hành động sẵn
    'FETCH_RELATIONS':True, #dùng để join các thứ có lien quan đến action khi truy vấn và giảm lượng querry nhưng tăng tốc độ ram
    'USE_JSONFIELD': True, #sử dụng jsonfield để lưu trữ dữ liệu bổ sung
    'USE_PREFETCH': True,
    'GFK_FETCH_DEPTH': 1, #chỉ định độ sâu khi truy xuất các đối tượng liên quan thông qua GenericForeignKey, 1 là chỉ truy vấn các cái liên quan, 2 là đi sâu thêm 1 tầng
}
#actor: ai thực hiện (thường là request.user hoặc model đã đăng ký)
#verb: hành động (chuỗi) — ví dụ 'created', 'liked', 'commented'
#action_object: đối tượng cụ thể tạo ra hành động (ví dụ một comment)
#target: đối tượng bị tác động (ví dụ bài viết, group)
#timestamp tự động lưu.

# =====================================================================================================================================================================================
# cacheops
SESSION_ENGINE = "django.contrib.sessions.backends.cached_db"
SESSION_CACHE_ALIAS = "default"
REDIS_HOST = env("REDIS_HOST", default="127.0.0.1")

CACHEOPS_REDIS = {
    'host': REDIS_HOST,
    'port': 6379,
    'db': 1,  # db 1
    'password' : env('REDIS_PASSWORD', default=''),
    'socket_timeout': 3,
}
CACHEOPS_DEFAULTS = {
    'timeout': 60*15,
    'local_get': True,#lưu và lấy từ RAM máy trước, không thấy mới hỏi Redis
}
CACHEOPS = {
    # ở tất cả bảng, cache(lưu vào bộ nhớ phụ và reuse) ví dụ get,filter,count...trong 15p.
    #ví dụ ng dùng gọi api lần 1 nó lưu vào cache, nó phát hiện có bài đăng mới nó sẽ tự gọi lại và lưu cache mà k cần đợi timeout

    'auth.user': {'ops': 'all', 'timeout': 60*60}, #24h
    # cache user từ auth, ví dụ cache khi lấy ra user, lọc user
    'api.profile': {'ops': 'all', 'timeout': 60*30},
    # ops là cache querry gì kiểu get,count,filter...timeout là bao lâu thì xóa
    'api.pendingProfile': {'ops': 'all', 'timeout': 60*60*24},
    'api.setting': {'ops': 'all', 'timeout': 60*10},  # 10 phút
    'contenttypes.contenttype': {'ops': 'all', 'timeout': 60*60*24*30},

    #  Cache vừa — thay đổi vừa
    'api.post': {'ops': 'all', 'timeout': 60 * 20},
    'api.postarticle': {'ops': 'all', 'timeout': 60 * 20},
    'api.postphoto': {'ops': 'all', 'timeout': 60 * 20},
    'api.comment': {'ops': 'all', 'timeout': 60 * 5},
    'api.notification': {'ops': 'all', 'timeout': 60 * 5},
    'api.searchHistory': {'ops': 'all', 'timeout': 60 * 5},
    'api.postshare':{'ops': 'all', 'timeout': 60 * 20},
    'api.report':{'ops':'all', 'timeout': 60*10},
    'api.supportticket':{'ops':'all', 'timeout': 60*10},
    #  Cache ngắn — realtime
    'api.conversation': {'ops': 'all', 'timeout': 60 * 5},
    'api.conversationMember': {'ops': 'all', 'timeout': 60 * 5},
    'api.task':{'ops':'all', 'timeout': 60*5},
    'api.vote':{'ops':'all', 'timeout': 60*5},
    'api.voteoption':{'ops':'all', 'timeout': 60*2},
    'api.uservote':{'ops':'all', 'timeout': 60*1},
    # thư viện
    'friendship.*': {'ops': 'all', 'timeout': 60 * 60},
    'actstream.action': {'ops': 'all', 'timeout': 60 * 5},
    'reaction.*': {'ops': 'all', 'timeout': 60 * 15},

}


# ==========================================================================================================================================================================================================
# Channels
ASGI_APPLICATION = "backend.asgi.application"  # setting để runserver có thể chạy asgi
# redis chạy channels
# dùng daphne để chạy cả http + websocket

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [f"redis://:{env('REDIS_PASSWORD', default='')}@{REDIS_HOST}:6379/0"],  # db 0
            "capacity": 1500,  # Giới hạn hàng đợi tin nhắn
            "expiry": 30,     # Tin nhắn chờ trong 30s nếu ko ai nhận thì hủy
            "symmetric_encryption_keys": [env('SECRET_KEY')], # bảo mật dữ liệu
        },
    },
}

# ============================================================================================
# lưu query vào cache  tránh gọi trong db
CACHES = {  # xài redis, set cache default là redis db 2
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": f"redis://:{env('REDIS_PASSWORD', default='')}@{REDIS_HOST}:6379/2",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "IGNORE_EXCEPTIONS": True, #  Redis sập web vẫn sống
            "CONNECTION_POOL_KWARGS": {
                "max_connections": 100, #giữ kết nối redis
                "retry_on_timeout": True,#và tự kết nối lại
                "health_check_interval": 30,  #  Kiểm tra sức khỏe kết nối
                "socket_connect_timeout": 5,  # Không bắt User đợi lâu khi treo
                "socket_keepalive": True,     # Giữ kết nối luôn sẵn sàng
            },
            "PICKLE_VERSION": -1, #chọn bảng cao nhất hỗ trợ để nhanh hơn dùng nén dữ liệu lưu vào redis
        },
        "TIMEOUT": 300, # xóa dữ liệu sau 5p
        }
    }

# Channels  → DB 0
# Caches redis  → DB 2
# Cacheops  → DB 1
# celery -> DB 3
# ============================================================================================
# django-extensions
REST_FRAMEWORK_EXTENSIONS = {
    'DEFAULT_CACHE_RESPONSE_TIMEOUT': 60 * 15,  # 15 phút mặc định
}

# ==============================================================================================
# lưu ảnh vào cloudinary
CLOUDINARY_STORAGE = {
    'CLOUD_NAME': env('CLOUDINARY_NAME'),
    'API_KEY': env('CLOUDINARY_API_KEY'),
    'API_SECRET': env('CLOUDINARY_API_SECRET'),
}
# DEFAULT_FILE_STORAGE = 'cloudinary_storage.storage.MediaCloudinaryStorage'
STORAGES = {
    "default": {
        "BACKEND": "cloudinary_storage.storage.MediaCloudinaryStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage", #whitenoise
    },
}
#===============================================================================================
#Elastic search
ELASTICSEARCH_DSL = {
    'default': {
        'hosts': env('ELASTICSEARCH_URL', default='http://localhost:9200')
    }
}
#=============sửa cấu hình spectacular lấy thằng api lỗi luôn=========================
SPECTACULAR_SETTINGS = {
    'AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication', # dùng kiểu xác thực nào
    ),
    'SWAGGER_UI_SETTINGS': {
        'persistAuthorization': True,  # Giữ token sau khi refresh trang
        'docExpansion': 'none',  # Thu gọn tất cả endpoint mặc định
        'filter': True,  # Hiện ô tìm kiếm
        'displayRequestDuration': True, # hiện ms latency khi test endpoint
    },
    #dùng offline đc thay vì load từ cdn third party
    'SWAGGER_UI_DIST': 'SIDECAR',
    'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR',
}

#=======================StructLog=========================================================
os.makedirs('logs', exist_ok=True) # lệnh win tạo dir

import os

LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,

    'formatters': {

        # production JSON log
        'json': {
            '()': 'pythonjsonlogger.jsonlogger.JsonFormatter',

            'format': (
                '%(asctime)s '
                '%(levelname)s '
                '%(name)s '
                '%(message)s'
            ),
        },

        # dev readable log
        'plain': {
            'format': (
                '%(asctime)s | '
                '%(levelname)s | '
                '%(name)s | '
                '%(message)s'
            ),
        },
    },

    'handlers': {

        # console output
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'plain' if DEBUG else 'json',
        },

    },

    # global root logger
    'root': {
        'handlers': ['console'],
        'level': LOG_LEVEL,
    },

    'loggers': {

        # django request log
        'django.request': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },

        # django server log
        'django.server': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },

        # django structlog
        'django_structlog': {
            'handlers': ['console'],
            'level': LOG_LEVEL,
            'propagate': False,
        },

        # axes spam
        'axes': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },

        # cloudinary spam reduction
        'cloudinary': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },

        # suppress annoying django host spam
        'django.security.DisallowedHost': {
            'handlers': [],
            'propagate': False,
        },
    },
}
#=================================META tạo preview card ===================================
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:3000')
if DEBUG:
    META_SITE_PROTOCOL = 'https'
META_USE_OG_PROPERTIES = True      # Facebook Open Graph
META_USE_TWITTER_PROPERTIES = True  # Twitter Card
META_USE_TITLE_TAG = True
#======================CELERY============================================
CELERY_BROKER_URL = env('CELERY_BROKER_URL', default='redis://localhost:6379/3') # Redis làm nơi chứa task chờ xử lý
CELERY_RESULT_BACKEND = 'django-db' #lưu kết quả task vào Django DB

# định dạng data khi truyền task
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Asia/Ho_Chi_Minh'

# production — giới hạn task
CELERY_TASK_TIME_LIMIT = 300        # task chạy tối đa 5 phút, quá 5p thì kill
CELERY_TASK_SOFT_TIME_LIMIT = 240   # cảnh báo trước 1 phút trước khi kill task để cleanup
CELERY_WORKER_MAX_TASKS_PER_CHILD = 1000  # restart worker sau 1000 task tránh memory leak
CELERY_TASK_ACKS_LATE = True        # chỉ xác nhận task sau khi chạy xong,nếu chưa xong mà lỗi thì retry, tránh mất task khi worker crash
CELERY_WORKER_PREFETCH_MULTIPLIER = 1  # mỗi worker chỉ lấy 1 task, tránh 1 worker ôm hết

# queue riêng cho từng loại task
CELERY_TASK_ROUTES = {
    'api.tasks.push_notification_task': {'queue': 'notifications'},
    'api.tasks.send_email_task': {'queue': 'emails'},
}
#====================django-fernet-encrypted-fields======================
SALT_KEY = env('SALT_KEY')