from celery import shared_task
from django.core.mail import send_mail
import logging
from django.contrib.auth import get_user_model
from api.firebase import push_to_user
from django.utils import timezone
from datetime import timedelta
from api.models import Post
import subprocess
import os
from datetime import datetime
from django.conf import settings
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

@shared_task
def cleanup_soft_deleted_post(): #đăng kí để trang admin biết mà chọn
    threshold = timezone.now() - timedelta(days=30) #mốc thời gian 30 ngày trước
    Post.deleted_objects.filter(deleted_lt = threshold).delete() # ngày xóa < ngày bắt đầu tính thì xóa (ví dụ 15/4 < 1/5 tức là đã trừ 30 ngày còn 1/5 mà vẫn bé hơn thì xóa)

#backup db
@shared_task
def backup_database():
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S') # năm/tháng/ngày_ /h/phút/giây
    backup_dir = 'backups/'
    os.makedirs(backup_dir, exist_ok=True) #tạo dir
    filename = f"{backup_dir}backup_{timestamp}.sql"

    db = settings.DATABASES['default'] # lấy db default

    # chạy mysqldump trong container Percona
    command = [
        'mysqldump',
        f"-u{db['USER']}",
        f"-p{db['PASSWORD']}",
        f"-h{db['HOST']}",
        f"-P{db['PORT']}",
        db['NAME'],
        '--single-transaction',
        '--quick',
        '--routines',
    ]

    with open(filename, 'w') as f:
        subprocess.run(command, stdout=f, check=True)

    # xóa backup cũ hơn 7 ngày
    cutoff = datetime.now().timestamp() - 7 * 24 * 60 * 60
    for file in os.listdir(backup_dir):
        path = os.path.join(backup_dir, file)
        if os.path.getmtime(path) < cutoff:
            os.remove(path)