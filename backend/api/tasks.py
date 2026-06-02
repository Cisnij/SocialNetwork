from celery import shared_task
from django.core.mail import send_mail
import logging
from django.contrib.auth import get_user_model
from api.firebase import push_to_user

logger = logging.getLogger(__name__)

# shared_task: dùng được ở mọi app mà không cần import trực tiếp celery app
# bind=True: cho phép dùng self để retry
# max_retries=3: thử lại tối đa 3 lần nếu lỗi
# default_retry_delay=10: chờ 10 giây trước khi retry

# ===== NOTIFICATION =====
@shared_task(bind=True, max_retries=3, default_retry_delay=10)
def push_notification_task(self, user_id, title, body):
    try:
        User = get_user_model()
        user = User.objects.get(id=user_id)
        push_to_user(user, title=title, body=body)
    except Exception as exc:
        logger.error(f"Push notification error: {exc}")
        raise self.retry(exc=exc)  # tự retry 3 lần nếu lỗi

# ===== EMAIL =====
@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def send_email_task(self, subject, message, recipient_list):
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=None,  # dùng DEFAULT_FROM_EMAIL
            recipient_list=recipient_list,
        )
    except Exception as exc:
        logger.error(f"Send email error: {exc}")
        raise self.retry(exc=exc)


# ===== CLEANUP =====
@shared_task
def cleanup_expired_tokens():
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
    from django.utils import timezone
    OutstandingToken.objects.filter(expires_at__lt=timezone.now()).delete()