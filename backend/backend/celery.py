import os
from celery import Celery

# báo cho Django biết dùng settings nào khi Celery chạy độc lập (không qua manage.py)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# tạo Celery app, 'backend' là tên project
app = Celery('backend')

# đọc config từ Django settings, chỉ lấy các key bắt đầu bằng CELERY_
app.config_from_object('django.conf:settings', namespace='CELERY')

# tự động tìm file tasks.py trong tất cả INSTALLED_APPS
app.autodiscover_tasks()


# # worker xử lý notification
# celery -A backend worker -Q notifications --loglevel=info

# # worker xử lý email
# celery -A backend worker -Q emails --loglevel=info


# # beat scheduler chạy task định kỳ
#celery beat để lên lich và celery workers để triển khai lịch khi nhận tín hiệu từ beat
# celery -A backend beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler

# Clocked — lên lịch chạy đúng 1 lần vào thời điểm cụ thể, ví dụ 2024-12-31 23:59:00
# Crontabs — lên lịch theo cú pháp cron, ví dụ 0 0 * * * là mỗi ngày lúc 0h (lên lịch theo ngày)
# Intervals — lên lịch theo khoảng thời gian lặp lại, ví dụ mỗi 1 ngày, mỗi 30 phút (lên lịch theo chu kì ví dụ 30p làm 1 lần)
# Periodic Tasks — nơi tạo task định kỳ, gắn với 1 trong 3 loại lịch trên (Clocked/Crontab/Interval)
# Solar Events — lên lịch theo sự kiện mặt trời như sunrise/sunset, ít dùng