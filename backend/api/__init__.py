#IMPORT KHI CHẠY APP
#chạy signals
default_app_config='api.apps.ApiConfig'

#celery
from backend.celery import app as celery_app
__all__ = ('celery_app',)