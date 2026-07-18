from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models.signals import post_save, post_delete, pre_delete, \
    m2m_changed  # post save là ngay khi tạo user thì trigger tạo profile
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import Profile, PendingProfile, Setting, Post, PostArticle, Comment, Log, Notification, Message, PostShare, \
    Vote, Conversation, ConversationMember, MessageAttachment, Report, SupportTicket, SearchHistory, Task, VideoRoom, \
    Event, Group, GroupDepartment, GroupRole, GroupMember, GroupJoinRequest
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

'''
    chuẩn của activity stream : thần chú là cái nào tạo trong cái nào( member tạo trong group, event tạo trong chat)
    
            'action_object_type': ' Group Member', # cái gì đc tạo
            'action_object_id': instance.pk,
            'target_type': 'Group', # tạo ở đâu
            'target_id': instance.group_id,
'''
#tự động tạo profile và xóa pending profile khi xác nhân email, kèm theo tạo setting default
@receiver(email_confirmed)
def create_profile(sender, request, email_address, **kwargs):
    user = email_address.user
    # Đã có profile thì đây là flow verify add email phụ
    if Profile.objects.filter(user=user).exists():
        return
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
def create_setting(sender, request, user, **kwargs):
    if user.socialaccount_set.filter(provider="google").exists():
        Setting.objects.get_or_create(user=user, defaults={"darkmode": False})

#=======================tạo tự động ghi log bằng activity stream để thông báo===========================
    
@receiver(post_save, sender=Profile)
def create_user_profile_log(sender, instance, created, **kwargs):
    verb = "created profile" if created else "updated profile"
    action.send(
        instance.user,
        verb=verb,
        target=instance,
        data={  #metadata để lưu thông tin nhằm truy xuất log nhanh hơn và dễ dàng hơn 
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "is_deleted": getattr(instance, "is_deleted", False),
            "action": verb,
            "group_id": instance.group_id if instance.group_id else None,
            'post_status':instance.post_status if instance.group_id else None,
        }
    )

@receiver(post_delete, sender=Post)
def delete_post_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="hard-deleted post",
        target=instance,
        data={
            "user_id": instance.user_id,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "deleted",
            "group_id": instance.group_id if instance.group_id else None,
            'post_status': instance.post_status if instance.group_id else None,
        }
    )

@receiver(post_undelete, sender=Post)
def post_undelete_log(sender, instance, **kwargs):
    action.send(
        instance.user,
        verb="restored post",
        target=instance,
        data={
            "user_id": instance.user_id,
            "target_type": "Post",
            "target_id": instance.pk,
            "title": instance.title,
            "action": "restored",
            "group_id": instance.group_id if instance.group_id else None,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
            "user_id": instance.user_id,
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
                "user_id": instance.sender_id,
                "action_object_type": "Message",
                "action_object_id": instance.pk,
                "target_type": "Conversation",
                "conversation_id": instance.conversation_id,
                "content": (instance.content or '')[:50],
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
                "user_id": instance.sender_id,
                "action_object_type": "Message",
                "action_object_id": instance.pk,
                "target_type": "Conversation",
                "conversation_id": instance.conversation_id,
                "content": (instance.content or '')[:50],
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
            "user_id": instance.sender_id,
            "action_object_type": "Message",
            "action_object_id": instance.pk,
            "target_type": "Conversation",
            "conversation_id": instance.conversation_id,
            "content": (instance.content or '')[:50],
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
            "from_user_id": sender.from_user_id,
            "to_user_id": sender.to_user_id,
            "status": "send friend request",
        }
    )


@receiver(friendship_request_canceled) #log hủy lời mời kb 
def log_friend_request_canceled(sender, **kwargs):
    action.send(
        sender.from_user,
        verb='canceled',
        target=sender.to_user,
        data={
            "friendship_request_id": sender.pk,
            "from_user_id": sender.from_user_id,
            "to_user_id": sender.to_user_id,
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
            "from_user_id": sender.from_user_id,
            "to_user_id": sender.to_user_id,
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
            "from_user_id": sender.from_user_id,
            "to_user_id": sender.to_user_id,
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
                "follower_id": instance.follower_id,
                "followee_id": instance.followee_id,
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
            "follower_id": instance.follower_id,
            "followee_id": instance.followee_id,
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
                "blocker_id": instance.blocker_id,
                "blocked_id": instance.blocked_id,
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
            "blocker_id": instance.blocker_id,
            "blocked_id": instance.blocked_id,
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
    ).get(pk=instance.pk) # lấy comment từ instance.pk của chính comment đó
    if instance.user != instance.post.user: # nếu ng comment vào post k phải chủ bài post thì mới thông báo
        Notification.objects.create(
            reciever=instance.post.user, #thông báo cho chủ post
            actor=instance.user,
            type='comment_on_post',
            object_id=instance.id, #comment id
            post_id=instance.post.post_id, #post id
            group_id=instance.post.group_id,
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
                group_id=instance.post.group_id,
                message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} replied to your comment on post "{instance.post.title}"'
            )

@receiver(m2m_changed,sender=Comment.tagged_users.through) #nếu trong comment field tagged user mà many to many field change thì chạy
def notify_tagged_users(sender,instance,action, pk_set,**kwargs):#pk_set lấy ra loạt id trong m2m field
    if action == 'post_add' and pk_set: # post_add giống post save và nếu có field mới đc thêm vào many to many field, pk_set là các khóa ngoại trả về
        instance = Comment.objects.select_related('user__profile', 'post').get(pk=instance.pk)
        tagged_users = User.objects.filter(pk__in=pk_set).select_related('profile').exclude(pk=instance.user.pk) # trừ user chủ động tag
        for user in tagged_users:
            Notification.objects.create(
                reciever=user,
                actor=instance.user,
                type='tagged_in_reply',
                object_id=instance.id,
                post_id=instance.post_id,
                group_id=instance.post.group_id,
                message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} tagged you on post "{instance.post.title}"'
            )

@receiver(post_save, sender=UserReaction)
def notify_reaction(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        instance = UserReaction.objects.select_related(
            'user__profile', 'reaction__content_type'
        ).get(pk=instance.pk)
        reaction = instance.reaction
        if reaction is None:
            return
        target = reaction.content_object
        if target is None:
            return
        if not hasattr(target, 'user') or target.user_id == instance.user_id:
            return  # không tự thông báo cho chính mình

        if isinstance(target, Comment):
            notif_type = 'reaction_on_comment'
            msg = f'{instance.user.profile.first_name} {instance.user.profile.last_name} đã thả cảm xúc bình luận của bạn "{target.content[:10]}"'
            post_id = target.post_id  # Comment.post_id là FK → int
        else:
            notif_type = 'reaction_on_post'
            msg = f'{instance.user.profile.first_name} {instance.user.profile.last_name} đã thả cảm xúc bài viết của bạn "{target.title}"'
            post_id = target.post_id  # Post.post_id là PK

        Notification.objects.create(
            reciever=target.user,
            actor=instance.user,
            type=notif_type,
            object_id=reaction.object_id,
            post_id=post_id,
            group_id=target.group_id if hasattr(target, 'group_id') else target.post.group_id,
            message=msg,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception('[notify_reaction] Error: %s', e)

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
@receiver(post_save,sender=PostShare)
def notify_post_share(sender,instance,created,**kwargs):
    if created:
        instance =PostShare.objects.select_related('post','user__profile','post__user').get(pk=instance.pk) #lấy ra cái id mà postshare vừa tạo để lấy ra object
        if instance.post.user == instance.user:
            return
        Notification.objects.create(
            reciever= instance.post.user,
            actor= instance.user,
            type='share_post',
            object_id=instance.pk,
            post_id=instance.post.post_id,
            group_id=None,
            message=f'{instance.user.profile.first_name} {instance.user.profile.last_name} share bài viết của bạn "{instance.post.title}"'
        )

from django.db import transaction
@receiver(post_save, sender=Notification)
def push_ws_notification(sender, instance, created, **kwargs):
    if not created:
        return
    transaction.on_commit(lambda: _push_ws(instance))

def _push_ws(instance):
    try:
        unread_count = Notification.objects.filter(
            reciever=instance.reciever, is_read=False
        ).count()
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'notification_{instance.reciever.id}',
            {
                'type': 'send_notification',
                'data': {
                    'unread_count': unread_count,
                    'id': instance.id,
                    'type': instance.type,
                    'message': instance.message,
                    'object_id': instance.object_id,
                    'post_id': instance.post_id,
                    'group_id': instance.group_id,
                    'event_id': instance.event_id,
                    'vote_id': instance.vote_id,
                    'actor_id': instance.actor_id,
                    'actor_name': f'{instance.actor.profile.first_name} {instance.actor.profile.last_name}',
                    'actor_avatar': instance.actor.profile.picture.url if instance.actor.profile.picture else None,
                    'created_at': instance.created_at.isoformat(),
                    'is_read': False,
                }
            }
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"WS notification error: {e}", exc_info=True)

#==============================================================================
@receiver(email_confirmed) # khi 1 email đã xác nhận, xóa các email trùng tên chưa xác nhận khỏi db 
def delete_unverified_email(sender, request, email_address, **kwargs):
    # xóa tất cả bản ghi unverified của email này thuộc user khác
    EmailAddress.objects.filter(
        email=email_address.email,  # email vừa verified
        verified=False,             # chưa verified
    ).exclude(user=email_address.user).delete()  # trừ user vừa verify


#===========================CHATBOT=======================================
from backend.env_config import env
@receiver(post_save,sender=Profile)
def create_bot_conversation(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        bot_name = env('BOT_USERNAME')
        bot_user, _ = User.objects.get_or_create(
            username=bot_name,
            defaults={
                'email': 'chatbot@system.com',
                'is_active': True,
            }
        )
        with transaction.atomic():
            conv = Conversation.objects.create(
                is_group=False,
                status='accept'
            )
            ConversationMember.objects.bulk_create([
                ConversationMember(conversation=conv, user=instance.user, role='member', is_active=True),
                ConversationMember(conversation=conv, user=bot_user, role='member', is_active=True),
            ])
            Message.objects.create(
                conversation=conv,
                sender=bot_user,
                content="Xin chào! Tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?",
                message_type='text'
            )
    except Exception as e:
        print("ERROR:", e)
        raise

#Thêm


@receiver(friendship_request_accepted)  # noti chấp nhận lời mời kết bạn
def noti_friend_request_accepted(sender, **kwargs):
    Notification.objects.create(
        reciever=sender.from_user,
        actor=sender.to_user,
        type='accepted_friend_request',
        message=f'{sender.to_user.profile.full_name} đã chấp nhận lời mời kết bạn'
    )


@receiver(post_save, sender=PostShare)
def log_post_share_created(sender, created, instance, **kwargs):  # đổi tên tránh trùng với hàm post_delete bên dưới
    verb = "shared post" if created else "updated share post"
    action.send(
        instance.user,
        verb=verb,
        action_object=instance,
        target=instance.post,
        data={
            "user_id": instance.user_id,
            "action_object_type": "PostShare",  # chủ thể hành động
            "action_object_id": instance.pk,
            "target_type": "Post", # Đối tượng nhắm đến
            "target_id": instance.post_id,
            "content": instance.content[:50] or '',
            "action": verb,
        }
    )


@receiver(post_delete, sender=PostShare)
def log_post_share_deleted(sender, instance, **kwargs):  # đổi tên tránh trùng tên hàm với bản post_save
    action.send(
        instance.user,
        verb="delete share post",
        action_object=instance,
        target=instance.post,
        data={
            "user_id": instance.user_id,
            "action_object_type": "PostShare",  # chủ thể hành động
            "action_object_id": instance.pk,
            "target_type": "Post",
            "target_id": instance.post_id,
            "content": instance.content[:50] or '',
            "action": "delete share post",
        }
    )

@receiver(post_save,sender=Setting)
def log_setting_updated(sender,instance,created,**kwargs):
    if not created:
        action.send(
            instance.user,
            verb = "updated setting",
            action_object=instance,
            target=None,
        data={
            "user_id": instance.user_id,
            "action_object_type": "Setting",  # chủ thể hành động
            "action_object_id": instance.pk,
            "action": "updated setting",
        }
    )

@receiver(post_save, sender=Report)
def log_report(sender, instance, created, **kwargs):
    if created:
        Log.objects.create(
            metadata_json=json.dumps({
                'action_object_type': 'reported',
                'actor_id': instance.user_id,
                'target_type': 'post' if instance.post_id else 'comment',
                'target_id': instance.post_id or instance.comment_id,
                'reason': instance.reason,
            }, ensure_ascii=False)
        )

@receiver(post_save, sender=SupportTicket)
def log_support_ticket(sender, instance, created, **kwargs):
    if created:
        Log.objects.create(
            metadata_json=json.dumps({
                'action_object_type': 'support ticket',
                'actor_id': instance.user_id,
                'content': instance.content,
            }, ensure_ascii=False)
        )

@receiver(post_save, sender=SearchHistory)
def log_search(sender, instance, created, **kwargs):
    if created:
        Log.objects.create(
            metadata_json=json.dumps({
                'action_object_type': 'search',
                'actor_id': instance.user_id,
                'content': instance.content,
            }, ensure_ascii=False)
        )

@receiver(post_save, sender= Task)
def log_task_created(sender,created,instance,**kwargs):
    verb = "task created" if created else "updated task"
    action.send(
        instance.created_by,
        verb=verb,
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Task",       # loại chủ thể hành động
            "action_object_id": getattr(instance, "pk", None), #
            "target_type": instance.content_type.model, # lấy ra tên model từ content_type gắn trong instance
            'target_id': instance.object_id,
            "action": verb,
        }
    )

@receiver(post_delete, sender=Task)
def log_task_deleted(sender, instance, **kwargs):
    action.send(
        instance.created_by,
        verb="deleted task",
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Task",
            "action_object_id": getattr(instance, "pk", None),
            "target_type": instance.content_type.model,
            'target_id': instance.object_id,
            "action": "deleted task",
        }
    )

@receiver(post_save, sender= Vote)
def log_vote_created(sender,created,instance,**kwargs):
    verb = "vote created" if created else "updated vote"
    action.send(
        instance.created_by,
        verb=verb,
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Vote",
            "action_object_id": getattr(instance, "pk", None),
            "target_type": instance.content_type.model,  # Vote cũng là generic FK
            'target_id': instance.object_id,
            "action": verb,
        }
    )

@receiver(post_delete, sender=Vote)
def log_vote_deleted(sender, instance, **kwargs):
    action.send(
        instance.created_by,
        verb="deleted vote",
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Vote",
            "action_object_id": getattr(instance, "pk", None),
            "target_type": instance.content_type.model,
            'target_id': instance.object_id,
            "action": "deleted vote",
        }
    )

@receiver(post_save, sender=VideoRoom)
def log_call(sender, instance, created, **kwargs):
    if not created:
        return
    action.send(
        instance.created_by,
        verb="created call",
        action_object=instance,
        target=instance.conversation,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Call",       # loại chủ thể hành động
            "action_object_id": getattr(instance, "pk", None), #
            "target_type": "Conversation",                      # loại đối tượng bị tác động
            'target_id': instance.conversation_id,
            "action": "created call",
        }
    )
@receiver(post_save, sender= Event)
def log_create_event(sender,created,instance,**kwargs):
    verb = "created event" if created else "updated event"
    action.send(
        instance.created_by,
        verb=verb,
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Event",  # chủ thể hành động
            "action_object_id": instance.pk,
            "target_type": instance.content_type.model,
            "target_id": instance.object_id,
            "title": instance.title,
            "action": verb,
        }
    )
@receiver(post_delete, sender= Event)
def log_delete_event(sender,instance,**kwargs):
    action.send(
        instance.created_by,
        verb="delete event",
        action_object=instance,
        target=instance.content_object,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": "Event",  # chủ thể hành động
            "action_object_id": instance.pk,
            "target_type": instance.content_type.model,
            "target_id": instance.object_id,
            "title": instance.title,
            "action": "delete event",
        }
    )
@receiver(post_save, sender=Conversation)
def log_create_conversation(sender, instance, created, **kwargs):
    if created:
        Log.objects.create(
            metadata_json=json.dumps({
                'action_object_type': 'Conversation',
                'action_object_id': instance.pk,
                'actor_id': instance.created_by_id,
                'is_group': instance.is_group,
                'created_at':instance.created_at.isoformat(),
            }, ensure_ascii=False)
        )

@receiver(post_save, sender=ConversationMember)
def log_add_conversationmember(sender, instance, created, **kwargs):
    verb = 'conversation member join' if created else 'conversation member left or join again'
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': 'Conversation Member',
            'action_object_id': instance.pk,
            'target':'Conversation',
            'target_id':instance.conversation_id,
            'add_user': instance.user_id,
            'verb': verb,
            'joined_at': instance.joined_at.isoformat(),
        }, ensure_ascii=False)
    )

#============GROUP===================
accept_join_request_group=Signal()
review_post_request_group=Signal()
add_admin_group=Signal()
owner_transfer_group=Signal()

@receiver(accept_join_request_group)
def notify_accept_join_request(sender, user, admin_user, group, **kwargs):
    Notification.objects.create(
        reciever=user,
        actor=admin_user,
        type='group_request_accepted',
        group_id=group.id,
        message=f'Bạn đã được duyệt vào group {group.name}'
    )
@receiver(review_post_request_group)
def notify_accept_post_request(sender,group,post,action,admin_user,**kwargs):
    Notification.objects.create(
        reciever=post.user,
        actor=admin_user,
        group_id=group.id,
        post_id=post.pk,
        type='group_post_accepted' if action == 'approved' else 'group_post_declined',
        message=f"Bài viết '{post.title}' {'đã được duyệt' if action == 'approved' else 'đã bị từ chối'} trong group '{group.name}'"
    )

@receiver(add_admin_group)
def notify_add_admin(sender,group,new_admin,owner,**kwargs): #lấy từ view ra mỗi khi có tín hiệu
    Notification.objects.create(
        reciever=new_admin,
        actor=owner,
        group_id=group.id,
        type='group_admin_added',
        message=f'Bạn đã được thêm làm admin trong group {group.name}'
    )

@receiver(owner_transfer_group) #log hủy kết bạn
def notify_owner_transfer(sender,group,next_owner,former_owner,**kwargs): #lấy từ view ra mỗi khi có tín hiệu
    Notification.objects.create(
        reciever=next_owner,
        actor=former_owner,
        group_id=group.id,
        type='group_owner_transfer',
        message=f'Bạn đã được chọn làm chủ group {group.name}'
    )

@receiver(post_save, sender= Group)
def log_create_group(sender,created,instance,**kwargs):
    verb = "created group" if created else "updated group"
    action.send(
        instance.created_by,
        verb=verb,
        target=instance,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": 'Group',
            "action_object_id": instance.pk,
            "group_name": instance.name,
            "action": verb,
        }
    )


@receiver(post_delete, sender=Group)
def log_delete_group(sender, instance, **kwargs):
    action.send(
        instance.created_by,
        verb='delete group',
        target=instance,
        data={
            "user_id": instance.created_by_id,
            "action_object_type": 'Group',
            "action_object_id": instance.pk,
            "group_name": instance.name,
            "action": 'delete group',
        }
    )

@receiver(post_save, sender= GroupDepartment)
def log_create_group_department(sender,created,instance,**kwargs):
    verb = "created department" if created else "updated department"
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': 'Group Department',
            'action_object_id': instance.pk,
            'target_type': 'Group',
            'target_id': instance.group_id,
            'verb': verb,
        }, ensure_ascii=False)
    )


@receiver(post_delete, sender=GroupDepartment)
def log_delete_group_department(sender, instance, **kwargs):
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': 'Group Department',
            'action_object_id': instance.pk,
            'target_type': 'Group',
            'target_id': instance.group_id,
            'verb': 'delete department',
        }, ensure_ascii=False)
    )

@receiver(post_save, sender= GroupRole)
def log_create_group_role(sender,created,instance,**kwargs):
    verb = "created role" if created else "updated role"
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': ' Group Role',
            'action_object_id': instance.pk,
            'target_type': 'Group',
            'target_id': instance.group_id,
            'verb': verb,
        }, ensure_ascii=False)
    )


@receiver(post_delete, sender=GroupRole)
def log_delete_group_role(sender, instance, **kwargs):
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': ' Group Role',
            'action_object_id': instance.pk,
            'target_type': 'Group',
            'target_id': instance.group_id,
            'verb': 'delete role',
        }, ensure_ascii=False)
    )

@receiver(post_save, sender= GroupMember)
def log_join_member_group(sender,created,instance,**kwargs):
    verb = "member join" if created else "member leave or join again"
    Log.objects.create(
        metadata_json=json.dumps({
            'action_object_type': ' Group Member',
            'action_object_id': instance.pk,
            'target_type': 'Group',
            'target_id': instance.group_id,
            'verb': verb,
            'joined_at': instance.joined_at.isoformat(),
        }, ensure_ascii=False)
    )


@receiver(post_save, sender= GroupJoinRequest)
def log_group_join_request_created(sender,created,instance,**kwargs):
    if not created:
        return
    action.send(
        instance.user,
        verb='group join request create',
        target=instance.group,
        data={
            "user_id": instance.user_id,
            "action_object_type": 'Group join request',
            "target_type": 'Group',
            "target_id": instance.group_id,
            "group_name": instance.group.name,
            "action": 'join request',
        }
    )
@receiver(post_delete, sender= GroupJoinRequest)
def log_group_join_request_cancelled(sender,instance,**kwargs):
    action.send(
        instance.user,
        verb='group join request cancel',
        target=instance.group,
        data={
            "user_id": instance.user_id,
            "action_object_type": 'Group join request',
            "target_type": 'Group',
            "target_id": instance.group_id,
            "group_name": instance.group.name,
            "action": 'join request cancel',
        }
    )

@receiver(post_save, sender= Event)
def notify_event_created(sender,created,instance,**kwargs):
    if not created:
        return
    target = instance.content_object # vì content_object tham chiếu thẳng tới object group(chỉ notify group)
    if not isinstance(target, Group):
        return
    member_ids = list(GroupMember.objects.filter(
        group=target, is_active=True
    ).exclude(user=instance.created_by).values_list('user_id', flat=True))
    if not member_ids:
        return

    Notification.objects.bulk_create([
        Notification(
            reciever_id=uid,
            actor=instance.created_by,
            type='group_event_create',
            group_id=target.id,
            event_id=instance.id,
            message=f"{instance.created_by.profile.full_name} đã tạo sự kiện '{instance.title}' trong group '{target.name}'"
        )
        for uid in member_ids
    ])

@receiver(post_save, sender=Vote)
def notify_vote_created(sender, instance, created, **kwargs):
    if not created:
        return
    target = instance.content_object
    if not isinstance(target, Group):  # chỉ notify cho group vote
        return

    member_ids = list(GroupMember.objects.filter(
        group=target, is_active=True
    ).exclude(user=instance.created_by).values_list('user_id', flat=True))

    if not member_ids:
        return

    Notification.objects.bulk_create([
        Notification(
            reciever_id=uid,
            actor=instance.created_by,
            type='group_notification',
            group_id=target.id,
            vote_id=instance.id,
            message=f"{instance.created_by.profile.full_name} đã tạo cuộc bình chọn '{instance.title}' trong group '{target.name}'"
        )
        for uid in member_ids
    ])
