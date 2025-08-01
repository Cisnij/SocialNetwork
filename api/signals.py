from django.db.models.signals import post_save #post save là ngay khi tạo user thì trigger tạo profile
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import Profile

@receiver(post_save,sender=User)# có nghĩa là chạy sau khi sender là user gửi tín hiệu, đây là mặc định
def auto_create_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)
