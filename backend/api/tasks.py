from celery import shared_task
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.contrib.contenttypes.models import ContentType
from django.core.mail import send_mail
import logging
from django.contrib.auth import get_user_model
from api.firebase import push_to_user
from django.utils import timezone
from datetime import timedelta
from api.models import Post, Message, ConversationMember, Profile, Event, EventParticipant, Conversation, Notification, \
    GroupMember, Group, VideoRoom, CallParticipant
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

#==== TASK ======
@shared_task(bind=True, max_retries=3)
def send_event_reminder(self, event_id, content_type_id):
    try:
        event = (
            Event.objects
            .filter(id=event_id, content_type_id=content_type_id)
            .select_related('created_by', 'created_by__profile')
            .first()
        )
        if not event:
            return

        participant_ids = list(
            EventParticipant.objects.filter(
                event=event, status='accept'
            ).values_list('user_id', flat=True)
        )
        if not participant_ids:
            return

        # Xác định event thuộc Group hay Chat để truyền group_id đúng
        group_ct = ContentType.objects.get_for_model(Group)
        is_group_event = (event.content_type_id == group_ct.id)
        notif_group_id = event.object_id if is_group_event else None

        Notification.objects.bulk_create([
            Notification(
                reciever_id=uid,
                actor_id=event.created_by_id,
                type='event_reminder',
                event_id=event.id,
                group_id=notif_group_id,  # None nếu là chat event
                message=f"Sự kiện {event.title} sắp diễn ra trong ít phút nữa",
            )
            for uid in participant_ids
        ])

        channel_layer = get_channel_layer()
        for uid in participant_ids:
            async_to_sync(channel_layer.group_send)(
                f'notification_{uid}',
                {
                    'type':       'event_reminder',
                    'event_id':   event.id,
                    'title':      event.title,
                    'start_time': event.start_time.isoformat(),
                    # group_id nếu là group event, conv_id nếu là chat event
                    'group_id':   notif_group_id,
                    'conv_id':    None if is_group_event else event.object_id,
                    'message':    f'Sắp bắt đầu: {event.title}',
                }
            )
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60) # thử lại sau 60s

#=====GROUP==============
@shared_task(bind=True, max_retries=3)
def make_notification_group(self, group_id, post_id, admin_id):
    try:
        group = Group.objects.filter(id=group_id).first()
        post = Post.objects.filter(post_id=post_id, group_id=group_id, post_status='approved').first()
        if not group or not post:
            logger.error(f"make_notification_group: group={group_id} hoặc post={post_id} không tồn tại")
            return
        member_ids = list(
            GroupMember.objects.filter(
                group_id=group_id,
                is_active=True
            )
            .exclude(user_id=admin_id) #k gửi cho admin
            .values_list("user_id", flat=True)
        )
        Notification.objects.bulk_create([ #bulk create thì không chạy signal
            Notification(
                reciever_id=uid,
                actor_id=admin_id,
                type="group_notification",
                group_id=group_id,
                post_id=post_id,
                message=f"Admin đã gửi thông báo thông qua post '{post.title}' trong group '{group.name}'",
            )
            for uid in member_ids
        ])

        channel_layer = get_channel_layer()

        for uid in member_ids:
            async_to_sync(channel_layer.group_send)(
                f"notification_{uid}",
                {
                    "type": "group_notification",
                    "group_id": group_id,
                    "post_id": post_id,
                    "message": f"Admin đã gửi thông báo thông qua post '{post.title}' trong group '{group.name}'",
                },
            )

    except Exception as exc:
        logger.exception(exc)
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


@shared_task
def cleanup_stale_video_rooms():
    cutoff = timezone.now() - timedelta(minutes=2)
    for room in VideoRoom.objects.filter(is_active=True, created_at__lt=cutoff):
        still_active = CallParticipant.objects.filter(
            room=room, status='accepted', left_at__isnull=True
        ).exists()
        if not still_active:
            room.is_active = False
            room.ended_at = timezone.now()
            room.end_reason = room.end_reason or 'missed'
            room.save(update_fields=['is_active', 'ended_at', 'end_reason'])