from .env_config import env
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
CACHEOPS_REDIS = {
    'host': 'localhost',
    'port': 6379,
    'db': 1,  # db 1
    'socket_timeout': 3,
}

CACHEOPS = {
    # ở tất cả bảng, cache(lưu vào bộ nhớ phụ và reuse) ví dụ get,filter,count...trong 15p.
    '''ví dụ ng dùng gọi api lần 1 nó lưu vào cache, nó phát hiện có bài đăng mới nó sẽ tự gọi lại và lưu cache mà k cần đợi timeout'''

    'auth.user': {'ops': ('get', 'filter'), 'timeout': 60 * 60},
    # cache user từ auth, ví dụ cache khi lấy ra user, lọc user
    'api.Profile': {'ops': 'all', 'timeout': 60 * 30},
    # ops là cache querry gì kiểu get,count,filter...timeout là bao lâu thì xóa
    'api.PendingProfile': {'ops': 'all', 'timeout': 60 * 30},
    'api.Setting': {'ops': 'all', 'timeout': 60 * 60},

    #  Cache vừa — thay đổi vừa
    'api.Post': {'ops': 'all', 'timeout': 60 * 10},
    'api.PostArticle': {'ops': 'all', 'timeout': 60 * 10},
    'api.PostPhoto': {'ops': 'all', 'timeout': 60 * 10},
    'api.Comment': {'ops': 'all', 'timeout': 60 * 10},
    'api.Notification': {'ops': 'all', 'timeout': 60 * 5},
    'api.SearchHistory': {'ops': 'all', 'timeout': 60 * 5},
    #  Cache ngắn — realtime
    'api.Conversation': {'ops': 'all', 'timeout': 60 * 2},
    'api.ConversationMember': {'ops': 'all', 'timeout': 60 * 2},
}

# ==========================================================================================================================================================================================================

INTERNAL_IPS = [  # xem ip nào đc xem toolbar
    "127.0.0.1",
]

# ==========================================================================================================================================================================================================
# Channels
ASGI_APPLICATION = "backend.asgi.application"  # setting để runserver có thể chạy asgi
# redis chạy channels
# dùng daphne để chạy cả http + websocket

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("127.0.0.1", 6379)],  # db 0
        },
    },
}

# ============================================================================================
# lưu query vào cache  tránh gọi trong db
CACHES = {  # xài redis, set cache default là redis db 2
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": "redis://127.0.0.1:6379/2",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        }
    }
}
# Channels  → DB 0
# Caches redis  → DB 2
# Cacheops  → DB 1
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