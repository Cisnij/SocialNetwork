from django.db.models.signals import post_save, post_delete, pre_delete, \
    m2m_changed  # post save là ngay khi tạo user thì trigger tạo profile
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import Profile,PendingProfile,Setting,Post,PostArticle,Comment,Log,Notification,Message,ConversationMember
from reaction.models import UserReaction
from allauth.account.signals import email_confirmed, user_logged_in
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
from django.contrib.contenttypes.models import ContentType
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
#firebase notification
from .firebase import push_to_user
#safe delete
from safedelete.signals import post_softdelete, post_undelete

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

@receiver(post_undelete, sender=Post)
def post_undelete_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="restored post",
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "restored",
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


@receiver(post_undelete, sender=PostArticle)
def postarticle_undelete_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="restored post article",
        target=instance,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "target_type": "PostArticle",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "restored",
        }
    )
@receiver(post_save, sender=Comment)
def create_comment_log(sender, instance, created, **kwargs):
    verb = "created comment" if created else "updated comment"
    action.send(
        instance.user,
        verb=verb,
        action_object=instance,
        target=instance.post,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "action_object_type": "Comment",              # chủ thể hành động
            "action_object_id": instance.pk,              # id Comment
            "target_type": "Post",                        # đối tượng bị tác động
            "target_id": instance.post_id,                # id Post             
            "content": instance.content[:50],
        }
    )

@receiver(post_delete, sender=Comment)
def delete_comment_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="deleted comment",
        action_object=instance,
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
    target = getattr(reaction, "content_object", None) # láy cái post đang được react tới 
    emoji_name = getattr(getattr(reaction, "settings", None), "name", None) # truy xuất ra setting có name k 

    if created:
        verb = f"reacted '{emoji_name}'" if emoji_name else "reacted" # nếu có emoji name thì hiển thị kh thì reacted
    else:
        verb = f"changed reaction -> '{emoji_name}'" if emoji_name else "changed reaction"

    action.send(
        instance.user,
        verb=verb,
        action_object=instance,
        target=target,
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "action_object_type": "UserReaction",       # loại chủ thể hành động
            "action_object_id": getattr(instance, "pk", None), # id của UserReaction
            "target_type": "Post",                      # loại đối tượng bị tác động
            "target_id": getattr(target, "pk", None),   # id của Post
            "emoji": emoji_name,
            "action": verb,
        }
    )

@receiver(post_delete, sender=UserReaction)
def reaction_removed(sender, instance, **kwargs):
    reaction = getattr(instance, "reaction", None)
    target = getattr(reaction, "content_object", None) if reaction else None # guard nếu reaction là None
    emoji_name = getattr(getattr(reaction, "settings", None), "name", None)

    verb = f"removed '{emoji_name}'" if emoji_name else "removed reaction"

    action.send(
        instance.user,
        verb=verb,
        action_object=instance, # UserReaction là chủ thể hành động
        target=target,          # Post là đối tượng bị tác động
        data={
            "user_id": instance.user.id,
            "username": instance.user.username,
            "action_object_type": "UserReaction",            # loại chủ thể hành động
            "action_object_id": getattr(instance, "pk", None), # id của UserReaction
            "target_type": "Post",                           # loại đối tượng bị tác động
            "target_id": getattr(target, "pk", None),        # id của Post
            "emoji": emoji_name,
            "action": verb,
        }
    )

@receiver(post_save, sender=Message) #log thêm sửa tin nhắn 
def message_log(sender, instance, created, **kwargs):
    if created:
        action.send(
            instance.sender,
            verb="send message",
            action_object=instance,
            target=instance.conversation,
            data={
                "user_id": instance.sender.id,
                "username": instance.sender.username,
                "action_object_type": "Message",
                "action_object_id": instance.pk,
                "target_type": "Conversation",
                "conversation_id": instance.conversation_id,
                "content": instance.content[:50],
                "action": "send message",
            }
        )
    else:
        verb = "edited message"
        action.send(
            instance.sender,
            verb=verb,
            action_object=instance,
            target=instance.conversation,
            data={
                "user_id": instance.sender.id,
                "username": instance.sender.username,
                "action_object_type": "Message",
                "action_object_id": instance.pk,
                "target_type": "Conversation",
                "conversation_id": instance.conversation_id,
                "content": instance.content[:50],
                "action": verb,
            }
        )
@receiver(post_softdelete, sender=Message) # log xóa message 
def message_soft_delete_log(sender, instance, **kwargs):
    action.send(
        instance.sender,
        verb="deleted message",
        action_object=instance,
        target=instance.conversation,
        data={
            "user_id": instance.sender.id,
            "username": instance.sender.username,
            "action_object_type": "Message",
            "action_object_id": instance.pk,
            "target_type": "Conversation",
            "conversation_id": instance.conversation_id,
            "content": instance.content[:50],
            "action": "deleted message",
        }
    )
#=======================================Log cho logout login dùng ipware===============================
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver
from ipware import get_client_ip
from actstream import action
@receiver(user_logged_in)
def log_login(sender, request, user, **kwargs):
    ip, is_routable = get_client_ip(request) # lấy ip dùng ipware 
    user_agent = request.META.get("HTTP_USER_AGENT", "") #có sẵn trong request
    action.send(
        user,
        verb="logged in",
        data={
            "user_id": user.id,
            "username": user.username,
            "ip": ip,
            "device": user_agent,
            "login_type": (
                "google" if user.socialaccount_set.filter(provider="google").exists() # nếu login bằng google thì allauth sẽ tạo bảng nên nó biết đc 
                else "password"
            ),
        }
    )
@receiver(user_logged_out)
def log_logout(sender, request, user, **kwargs):
    ip, is_routable = get_client_ip(request)
    user_agent = request.META.get("HTTP_USER_AGENT", "")
    if user:
        action.send(
            user,
            verb="logged out",
            data={
                "user_id": user.id,
                "username": user.username,
                "ip": ip,
                "device": user_agent,
            }
        )
#=================================copy log=============================================
@receiver(post_save, sender=Action)
def copy_to_log(sender, instance, created, **kwargs):
    if created:
        meta = instance.data #cách lấy meta data từ activity stream
        Log.objects.create(metadata_json=json.dumps(meta, ensure_ascii=False)) # json.dumps để chuyển dict thành chuỗi json 


#=======================LOG CHO FRIENDSHIP ============================================================================
@receiver(friendship_request_created) #log gửi lời mời kết bạn 
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


@receiver(friendship_request_canceled) #log hủy lời mời kb 
def log_friend_request_canceled(sender, instance, **kwargs):
    action.send(
        sender.from_user,
        verb='canceled',
        target=sender.to_user,
        data={
            "friendship_request_id": sender.pk,
            "from_user_id": sender.from_user.id,
            "to_user_id": sender.to_user.id,
            "status": "canceled friend request",
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
    
#===================================Notification========================================
#gừi qua firebase
# @receiver(post_save,sender=Notification)
# def push_from_activity(sender,instance,created,**kwargs):
#     if created:
#         push_to_user(
#             instance.reciever,
#             title=instance.type,
#             body=instance.message
#         )

#in-app notification 
@receiver(post_save, sender=Comment)
def notify_comment(sender, instance, created, **kwargs):
    if not created: return
    instance = Comment.objects.select_related(
        'user__profile',
        'post',
        'parent__user__profile',
    ).get(pk=instance.pk)
    if instance.user != instance.post.user: # nếu ng comment vào post k phải chủ bài post thì mới thông báo
        Notification.objects.create(
            reciever=instance.post.user, #thông báo cho chủ post
            actor=instance.user,
            type='comment_on_post',
            object_id=instance.id,
            post_id=instance.post.post_id,
            message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} commented on your post {instance.post.title}'
        )
    if instance.parent: # nếu mới tạo và có parent
        if instance.user != instance.parent.user: #nếu user comment cha mà không phải là user hiện tại thì tạo
            Notification.objects.create(
                reciever=instance.parent.user, # thông báo cho comment gốc rằng có reply
                actor=instance.user,
                type='reply_on_comment',
                object_id=instance.id,
                post_id=instance.parent.post_id,
                message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} replied to your comment'
            )

@receiver(m2m_changed,sender=Comment.tagged_users.through) #nếu trong comment field tagged user mà many to many field change thì chạy
def notify_tagged_users(sender,instance,action, pk_set,**kwargs):#pk_set lấy ra loạt id trong m2m field
    if action == 'post_add' and pk_set: # post_add giống post save và nếu có field mới đc thêm vào many to many field, pk_set là các khóa ngoại trả về
        instance = Comment.objects.select_related('user__profile', 'post').get(pk=instance.pk)
        Notification.objects.bulk_create([
            Notification(
                reciever=user,
                actor=instance.user,
                type='tagged_in_reply',
                object_id=instance.id,
                post_id=instance.post_id,
                message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} tagged you on post {instance.post.title}'
            )
            for user in User.objects.filter(pk__in=pk_set).select_related('profile').exclude(pk=instance.user.pk) # trừ user chủ động tag
        ])

@receiver(post_save, sender=UserReaction)
def notify_reaction(sender, instance, created, **kwargs):
    if not created:
        return
    instance = UserReaction.objects.select_related('user__profile', 'reaction').get(pk=instance.pk)
    reaction = getattr(instance, 'reaction', None)
    target = getattr(reaction, 'content_object', None)
    if not hasattr(target, 'user') or target.user == instance.user:
        return
    # phân biệt react vào post hay comment
    if isinstance(target, Comment):
        msg = f'{instance.user.profile.first_name} {instance.user.profile.last_name} reacted to your comment'
        type = 'reaction_on_comment'
    else:
        msg = f'{instance.user.profile.first_name} {instance.user.profile.last_name} reacted to your post'
        type = 'reaction_on_post'

    Notification.objects.create(
        reciever=target.user,
        actor=instance.user,
        type=type,
        object_id=reaction.object_id,
        post_id=target.post_id,
        message=msg
    )
@receiver(post_save, sender=Follow)
def notify_follow(sender, instance, created, **kwargs):
    if created:
        instance = Follow.objects.select_related('follower__profile','followee',).get(pk=instance.pk)
        Notification.objects.create(
            reciever=instance.followee,
            actor=instance.follower,
            type='follow',
            post_id=None,
            message=f'{instance.follower.profile.first_name} {instance.follower.profile.last_name} followed you'
        )

@receiver(post_save, sender=FriendshipRequest)
def notify_friend_request(sender, instance, created, **kwargs):
    if created:
        instance = FriendshipRequest.objects.select_related('from_user__profile','to_user',).get(pk=instance.pk)
        Notification.objects.create(
            reciever =instance.to_user,
            actor=instance.from_user,
            type='friend_request',
            post_id=None,
            message=f'{instance.from_user.profile.first_name} {instance.from_user.profile.last_name} sent you a friend request'
        )
#==============================================================================
@receiver(email_confirmed) # khi 1 email đã xác nhận, xóa các email trùng tên chưa xác nhận khỏi db 
def delete_unverified_email(sender, request, email_address, **kwargs):
    # xóa tất cả bản ghi unverified của email này thuộc user khác
    EmailAddress.objects.filter(
        email=email_address.email,  # email vừa verified
        verified=False,             # chưa verified
    ).exclude(user=email_address.user).delete()  # trừ user vừa verify

