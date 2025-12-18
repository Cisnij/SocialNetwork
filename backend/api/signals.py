from django.db.models.signals import post_save, post_delete, pre_delete #post save là ngay khi tạo user thì trigger tạo profile
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import Profile,PendingProfile,Setting,Post,PostArticle,Comment,Log
from reaction.models import UserReaction
from allauth.account.signals import email_confirmed, user_logged_in
from django.contrib.auth import get_user_model
import json
from django.dispatch import Signal
#django activity stream
from actstream import action
from actstream.models import Action
#django friendship
from friendship.models import Friend,FriendshipRequest,Follow,Block
from friendship.signals import (
    friendship_request_created,
    friendship_request_rejected,
    friendship_request_canceled,
    friendship_request_accepted,
)

# #xây tín hiệu tự động tạo pending profile khi tạo user
# @receiver(post_save,sender=User)# có nghĩa là chạy sau khi sender là user gửi tín hiệu, đây là mặc định, post la sau khi tạo user
# def auto_create_profile(sender, instance, created, **kwargs):
#     if created:
#         PendingProfile.objects.get_or_create(user=instance)

#tự động tạo profile và xóa pending profile khi xác nhân email, kèm theo tạo setting default
@receiver(email_confirmed)
def create_profile(sender, request, email_address, **kwargs):
    user = email_address.user
    pending_profile=PendingProfile.objects.filter(user=user).first()
    if pending_profile:
        first_name=pending_profile.first_name
        last_name=pending_profile.last_name
        date_of_birth=pending_profile.date_of_birth
        phone_number=pending_profile.phone_number
    else:
        first_name=None
        last_name=None
        date_of_birth = None
        phone_number = None    
    Profile.objects.create(user=email_address.user, first_name=first_name,last_name=last_name ,date_of_birth=date_of_birth, phone_number=phone_number)
    Setting.objects.create(user=email_address.user)
    PendingProfile.objects.filter(user=email_address.user).delete()

# tạo setting khi đăng nhập bằng google
@receiver(user_logged_in)
def create_setting(sender,request,user,**kwargs):
    if user.socialaccount_set.filter(provider='google').exists():
        setting, created = Setting.objects.get_or_create(user=user)
        setting.darkmode = False
        setting.save()

#=======================tạo tự động ghi log bằng activity stream để thông báo===========================
    
@receiver(post_save, sender=Profile)
def create_user_profile_log(sender, instance, created, **kwargs):
    verb = "created profile" if created else "updated profile"
    action.send(
        instance.user,
        verb=verb,
        target=instance,
        data={  #metadata để lưu thông tin nhằm truy xuất log nhanh hơn và dễ dàng hơn 
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Profile",
            "target_id": instance.pk,
            "action": verb,
        }
    )

@receiver(post_delete, sender=Profile)
def delete_profile_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="hard-deleted profile",
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Profile",
            "target_id": instance.pk,
            "action": "deleted",
        }
    )

@receiver(post_save, sender=Post)
def create_post_log(sender, instance, created, **kwargs):
    verb = "created post" if created else "updated post"
    action.send(
        instance.user,
        verb=verb,
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "is_deleted": getattr(instance, "is_deleted", False),
            "action": verb,
        }
    )

@receiver(post_delete, sender=Post)
def delete_post_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="hard-deleted post",
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "deleted",
        }
    )

@receiver(post_save, sender=PostArticle)
def create_postarticle_log(sender, instance, created, **kwargs):
    verb = "created post article" if created else "updated post article"
    action.send(
        instance.user,
        verb=verb,
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "PostArticle",
            "target_id": instance.pk,
            "title": instance.title,
            "is_deleted": getattr(instance, "is_deleted", False),
            "action": verb,
        }
    )

@receiver(post_delete, sender=PostArticle)
def delete_postarticle_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="hard-deleted post article",
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "PostArticle",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "deleted",
        }
    )

@receiver(post_save, sender=Comment)
def create_comment_log(sender, instance, created, **kwargs):
    verb = "created comment" if created else "updated comment"
    action.send(
        instance.user,
        verb=verb,
        target=instance.post,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Comment",
            "target_id": instance.pk,
            "post_id": instance.post_id,
            "content": instance.content[:50],
            "action": verb,
        }
    )

@receiver(post_delete, sender=Comment)
def delete_comment_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="deleted comment",
        target=instance.post,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Comment",
            "target_id": instance.pk,
            "post_id": instance.post_id,
            "content": instance.content[:50],
            "action": "deleted",
        }
    )


@receiver(post_save, sender=UserReaction)
def reaction_activity(sender, instance, created, **kwargs):
    reaction = getattr(instance, "reaction", None) # kiểm tra xem có thuộc tính reaction trong instance không, nếu có thì lấy ra, không có thì trả về None
    target = getattr(reaction, "object", None) or getattr(instance, "content_object", None) or instance # ưu tiên lấy reaction.object, nếu không có thì lấy content_object, nếu không có thì lấy instance
    emoji_name = getattr(getattr(reaction, "settings", None), "name", None)

    if created:
        verb = f"reacted '{emoji_name}'" if emoji_name else "reacted" # nếu có emoji name thì hiển thị kh thì reacted
    else:
        verb = f"changed reaction -> '{emoji_name}'" if emoji_name else "changed reaction"

    action.send(
        instance.user,
        verb=verb,
        target=target,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "UserReaction",
            "target_id": getattr(instance, "pk", None),
            "emoji": emoji_name,
            "target_object_id": getattr(target, "pk", None),
            "action": verb,
        }
    )

@receiver(post_delete, sender=UserReaction)
def reaction_removed(sender, instance, **kwargs):
    reaction = getattr(instance, "reaction", None)
    target = getattr(reaction, "object", None) or getattr(instance, "content_object", None) or instance
    emoji_name = getattr(getattr(reaction, "settings", None), "name", None)

    verb = f"removed '{emoji_name}'" if emoji_name else "removed reaction"

    action.send(
        instance.user,
        verb=verb,
        target=target,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "UserReaction",
            "target_id": getattr(instance, "pk", None),
            "emoji": emoji_name,
            "target_object_id": getattr(target, "pk", None),
            "action": "removed",
        }
    )

@receiver(post_save, sender=Action)
def copy_to_log(sender, instance, created, **kwargs):
    if created:
        meta = instance.data #cách lấy meta data từ activity stream
        Log.objects.create(metadata_json=json.dumps(meta, ensure_ascii=False)) # json.dumps để chuyển dict thành chuỗi json 


#=======================LOG CHO FRIENDSHIP ============================================================================
@receiver(friendship_request_created) #gửi lời mời kết bạn
def log_friend_request_created(sender, **kwargs):
    action.send(
        sender.from_user,
        verb="sent friend request",
        target=sender.to_user,
        data={
            "friendship_request_id": sender.pk,
            "from_user_id": sender.from_user.id,
            "to_user_id": sender.to_user.id,
            "status": "send friend request",
        }
    )

@receiver(friendship_request_canceled) #log hủy lời mời kết bạn
def log_friend_request_canceled(sender, **kwargs):
    action.send(
        sender.to_user,
        verb="canceled friend request",
        target=sender.from_user,
        data={
            "friendship_request_id": sender.pk,   # sẽ là None vì delete rồi
            "from_user_id": sender.from_user.id,
            "to_user_id": sender.to_user.id,
            "status": "canceled friend request"
        }
    )

@receiver(friendship_request_rejected)  # log từ chối lời mời kết bạn
def log_friend_request_rejected(sender, **kwargs):
    action.send(
        sender.to_user,
        verb="rejected friend request",
        target=sender.from_user,
        data={
            "friendship_request_id": sender.pk,
            "from_user_id": sender.from_user.id,
            "to_user_id": sender.to_user.id,
            "status": "rejected friend request"
        }
    )

@receiver(friendship_request_accepted)  # log chấp nhận lời mời kết bạn
def log_friend_request_accepted(sender, **kwargs):
    action.send(
        sender.to_user,
        verb="accepted friend request",
        target=sender.from_user,
        data={
            "friendship_request_id": sender.pk,
            "from_user_id": sender.from_user.id,
            "to_user_id": sender.to_user.id,
            "status": "accepted friend request"
        }
    )



unfriended_log=Signal()#cách custome hook thẳng vào view, sau đó lấy từ view ra và dùng activity stream để ghi log

@receiver(unfriended_log) #log hủy kết bạn
def log_unfriended(sender, user, target, verb, **kwargs): #lấy từ view ra mỗi khi có tín hiệu  
        action.send(
        user,
        verb=verb,
        target=target,
        data={
            "user_id": user.id,
            "target_id": target.id,
            "action": verb
        }
    )

@receiver(post_save, sender=Follow) #log khi theo dõi người dùng
def log_follow_created(sender, instance, created, **kwargs):
    if created:
        action.send(
            instance.follower,
            verb="followed user",
            target=instance.followee,
            data={
                "follower_id": instance.follower.id,
                "followee_id": instance.followee.id,
                "status": "followed user"
            }
        )

@receiver(post_delete, sender=Follow) #log khi hủy theo dõi
def log_follow_deleted(sender, instance, **kwargs):
    """ Hủy theo dõi """
    action.send(
        instance.follower,
        verb="unfollowed user",
        target=instance.followee,
        data={
            "follower_id": instance.follower.id,
            "followee_id": instance.followee.id,
            "status": "unfollow user"
        }
    )


@receiver(post_save, sender=Block) #log khi block người dùng
def log_block_created(sender, instance, created, **kwargs):
    if created:
        action.send(
            instance.blocker,
            verb="blocked user",
            target=instance.blocked,
            data={
                "blocker_id": instance.blocker.id,
                "blocked_id": instance.blocked.id,
                "status": "block user"
            }
        )

@receiver(post_delete, sender=Block) #log khi bỏ block
def log_block_deleted(sender, instance, **kwargs):
    """ Bỏ block """
    action.send(
        instance.blocker,
        verb="unblocked user",
        target=instance.blocked,
        data={
            "blocker_id": instance.blocker.id,
            "blocked_id": instance.blocked.id,
            "status": "unblock user"
        }
    )
