
from rest_framework import serializers
from .models import *
from django.core.cache import cache
# reaction
from django.db.models import Count # dùng để đếm số reaction
from django.contrib.contenttypes.models import ContentType
from reaction.models import UserReaction
# activity strean
from actstream.models import Action
#friendship
from friendship.models import Friend, FriendshipRequest, Follow, Block

from .models import Profile


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model=User
        fields=['id','username','first_name','last_name']

DEFAULT_PROFILE_PICTURE = (
    "https://res.cloudinary.com/dec8t19tm/image/upload/v1781533632/default-avatar_qprrlr.jpg"
)

'''Dùng ModelSerializer sẽ tự gọi validate bên Model và k cần phải validate lại bên đây như serializer.Serializer'''
class ProfileSerializer(serializers.ModelSerializer):
    is_online=serializers.SerializerMethodField()
    user = serializers.IntegerField(source='user_id', read_only=True)
    picture = serializers.ImageField(required=False, allow_null=True) # nhận vòoo dạng imagefield để nhận file ảnh và để validate ảnh và lưu vào db
    phone_number = serializers.SerializerMethodField()
    date_of_birth = serializers.SerializerMethodField()
    class Meta:
        model=Profile
        fields=['id', 'user', 'first_name', 'last_name', 'picture','bio','phone_number', 'date_of_birth','is_completed','created_at','auth_provider', 'is_online']
        extra_kwargs = {"user": {"read_only": True}} # loại trừ trường user là read only 
        
    def get_is_online(self,obj):
        online_set=self.context.get('online_set') # nhận context truyền thủ công từ view vào để custome cái list profile tránh gọi cache mỗi 1 user làm tràn ram, còn cái gọi 1 object thì bth dùng get
        if online_set is not None: 
            return obj.user_id in online_set # trả về user id trong ram, có thì trả về luôn
        return cache.get(f"online_user:{obj.user_id}") is not None # không có trong ram thì gọi get cache ram từng cái

    def to_representation(self, instance): # cách để chỉnh sửa các trường hiển thị ra response
        data = super().to_representation(instance) #lấy ra các response hiện tại và thay thế
        if not instance.picture:
            data["picture"] = DEFAULT_PROFILE_PICTURE
        return data

    def get_phone_number(self,obj): # logic là override 2 field phone và birth nếu 2 field đó đáp ứng thì hiển thị
        request= self.context.get('request')
        if request and (request.user == obj.user or obj.phone_number_public): #nếu là chủ profile hoặc profile có trường phone là public
            return str(obj.phone_number) if obj.phone_number else None #phải dùng str để lấy ra phone
        return None

    def get_date_of_birth(self,obj):
        request= self.context.get('request')
        if request and (request.user == obj.user or obj.date_of_birth_public):
            return obj.date_of_birth if obj.date_of_birth else None
        return None

class PrivateProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model =Profile
        fields = ['phone_number', 'date_of_birth', 'date_of_birth_public', 'phone_number_public']

class PendingProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model=PendingProfile
        fields='__all__'

class PostPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model=PostPhoto
        fields=['id','post','photo']
        extra_kwargs = {"post": {"read_only": True}} #để k bị lỗi khi post ảnh lên vì post là foreign key bắt buộc phải có giá trị nhưng khi post ảnh thì chưa có post_id nên để read only, read only là chỉ để đọc mà k cần nạp data từ fe gửi

class PostVideoSerializer(serializers.ModelSerializer):
    class Meta:
        model=PostVideo
        fields=['id','post','video']
        extra_kwargs = {"post": {"read_only": True}}


class PostSerializer(serializers.ModelSerializer):
    # vì là one to one field với user nên phải để thế mới lấy ra profile đc, nếu k có source thì nó bị lấy ra user 2 lần vì profileserializer cũng có user, hiểu là 2 trường user 1 là của post 2 là profile thì lấy ra của profile
    user = ProfileSerializer(source="user.profile", read_only=True) 
    photos = PostPhotoSerializer(many=True, read_only=True) #tự động lấy ra tất cả ảnh liên quan đến post nhờ related name ở model PostPhoto
    videos = PostVideoSerializer(many=True, read_only=True)
    # reactions
    reactions= serializers.SerializerMethodField()
    user_is_reaction=serializers.SerializerMethodField()
    is_saved = serializers.SerializerMethodField()
    group_name = serializers.CharField(source='group.name', read_only=True)
    class Meta:
        model=Post
        fields='__all__'

    def get_reactions(self, obj): #logic là lấy ra tẩt cả reaction của n post và lưu id post đó là key, sau đó tới post nào thì truy cập lấy ra key id post đó kèm theo value (1: like:2,love:3...2:like:1,love:3)
        reactions_map = self.context.get('reactions_map') # cái context truyền vào bên utils.py
        if reactions_map is not None:
            return reactions_map.get(obj.post_id, [])  # đọc từ RAM nếu có
        # fallback — nếu k có thì chạy logic bth nhưng latency vì quert liên tục
        content_type = ContentType.objects.get_for_model(Post)
        return (
            Reaction.objects.filter(content_type=content_type, object_id=obj.pk)
            .values("settings__name")
            .annotate(total=Count("reactions"))
        )
    def get_user_is_reaction(self, obj): # lấy ra n post và reaction của user trong n post đó sau đó lưu vào key là post id,tới post nào thì lấy key đó, k có thì null ( 1: like)
        user_reactions_map = self.context.get('user_reactions_map')
        if user_reactions_map is not None:
            return user_reactions_map.get(obj.post_id)  # đọc từ RAM nếu có
        # fallback — nếu k có thì chạy logic bth nhưng latency vì quert liên tục
        user = self.context.get('request').user
        if not user.is_authenticated:
            return False
        qs = UserReaction.objects.filter(
            user=user,
            reaction__content_type=ContentType.objects.get_for_model(Post),
            reaction__object_id=obj.pk
        ).first()
        return qs.reaction.settings.name if qs else None

    #logic là phân trang lấy ra 5 post 1,2,3,4,5. Sau đó lấy tất cả bài post user save nằm trong 1-5, nếu có thì lưu vào mảng. Khi tới post nào thì cứ check nằm trong thì True
    def get_is_saved(self, obj):
        saved_set = self.context.get('saved_post_ids')
        if saved_set is not None:
            return obj.post_id in saved_set # tức là nếu có thì true else thì false
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        from .models import SavedPost
        return SavedPost.objects.filter(user=request.user, post=obj).exists()


class PostArticalSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source="user.profile", read_only=True)
    class Meta:
        model=PostArticle
        fields='__all__'

class CommentSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source="user.profile", read_only=True)
    reply_count = serializers.IntegerField(read_only=True)
    reactions= serializers.SerializerMethodField()
    user_is_reaction=serializers.SerializerMethodField()
    tagged_users_info = serializers.SerializerMethodField()
    tagged_users= serializers.PrimaryKeyRelatedField(many=True,queryset=User.objects.all(),write_only=True,required=False)# many=True để lấy nhiều giá trị (id) có liên quan object này ở đây tagged user trong model và override nó để lấy ra, sau đó queryset check các id trong User có id có k, chỉ input và k trả output và ko yêu cầu truyền
    #Khi người dùng gửi list id, DRF sẽ loop từng id, kiểm tra id đó có tồn tại trong queryset không, rồi convert thành object đối tượng là many=True
    class Meta:
        model=Comment
        fields='__all__'
        read_only_fields = ['post', 'user']
    def get_reactions(self, obj):
        reactions_map = self.context.get('reactions_map') # cái context truyền vào bên utils.py
        if reactions_map is not None:
            return reactions_map.get(obj.id, [])  # đọc từ RAM nếu có
        # fallback — nếu k có thì chạy logic bth nhưng latency vì quert liên tục
        content_type = ContentType.objects.get_for_model(Comment)
        return (
            Reaction.objects.filter(content_type=content_type, object_id=obj.pk)
            .values("settings__name")
            .annotate(total=Count("reactions"))
        )
    def get_user_is_reaction(self, obj):
        user_reactions_map = self.context.get('user_reactions_map')
        if user_reactions_map is not None:
            return user_reactions_map.get(obj.id)  # đọc từ RAM nếu có
        # fallback — nếu k có thì chạy logic bth nhưng latency vì quert liên tục
        user = self.context.get('request').user
        if not user.is_authenticated:
            return False
        qs = UserReaction.objects.filter(
            user=user,
            reaction__content_type=ContentType.objects.get_for_model(Comment),
            reaction__object_id=obj.pk
        ).first()
        return qs.reaction.settings.name if qs else None

    def get_tagged_users_info(self, obj): #khi list thì sẽ truyền từng object lọc ra từ filter và lấy ra profile, chỉ output từ list và readonly
        return [{
            'id': u.profile.id,
            'user': u.id,
            'full_name': f"{u.profile.full_name}",
            'picture': u.profile.picture.url if u.profile.picture else DEFAULT_PROFILE_PICTURE ,
        }
            for u in obj.tagged_users.all()
        ] #trả về list dict kiểu [{},{}]

class SettingSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source="user.profile", read_only=True)
    class Meta:
        model=Setting
        fields='__all__'

#===========================LOG=================================================================================

class LogSerializer(serializers.ModelSerializer):
    class Meta:
        model=Log
        fields='__all__'

#===========================Reaction=================================================================================
class UserReactionSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source='user.profile', read_only=True)
    emoji = serializers.CharField(source='react.emoji', read_only=True)
    reaction_type = serializers.CharField(source='reaction.settings.name', read_only=True)

    class Meta:
        model = UserReaction
        fields = ['user', 'emoji', 'reaction_type', 'created']

class ReactionSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source='user.profile', read_only=True)
    slug =serializers.CharField(source='react.slug',read_only=True)# Cách để thêm foreign key từ model có liên quan ở instance này,vì slug k có trong trường UserReactioon nên để slug để k thay đổi đc
    class Meta:
        model = UserReaction
        fields = ['user', 'slug']


#===========================ActivitySteam=================================================================================
class ActionSerializer(serializers.ModelSerializer):
    actor =serializers.StringRelatedField() #string related là lấy cái __str__ ví dụ str(actor) trong model, nó cũng sẽ lấy str của Fk có liên quan
    target=serializers.StringRelatedField()
    action_object=serializers.StringRelatedField()
    class Meta:
        model = Action
        fields = ['id', 'actor', 'verb', 'target', 'action_object', 'timestamp']

#===========================FRIENDSHIP=================================================================================
class FriendShipRequestSerializer(serializers.ModelSerializer):
    sender = ProfileSerializer(source='from_user.profile', read_only=True)
    receiver = ProfileSerializer(source='to_user.profile', read_only=True)

    class Meta:
        model = FriendshipRequest
        fields = ['id', 'sender', 'receiver', 'created']


class FriendSerializer(serializers.ModelSerializer): #danh sách bạn bè, vì friendship sẽ tạo bản ghi 2 chiều
    user = ProfileSerializer(source='to_user.profile', read_only=True)#profile và user 1-1 nên sẽ truy vấn được và lấy ra các field theo profile
    friend_since = serializers.DateTimeField(source='created', read_only=True)
    class Meta:
        model = Friend
        fields = ['user', 'friend_since']

class FollowSerializer(serializers.ModelSerializer):
    follower = ProfileSerializer(source='follower.profile', read_only=True)
    followee = ProfileSerializer(source='followee.profile', read_only=True)
    followed_at = serializers.DateTimeField(source='created', read_only=True)

    class Meta:
        model = Follow
        fields = ['follower', 'followee', 'followed_at']

class BlockSerializer(serializers.ModelSerializer):
    blocker = ProfileSerializer(source='blocker.profile', read_only=True)
    blocked = ProfileSerializer(source='blocked.profile', read_only=True)
    blocked_at = serializers.DateTimeField(source='created', read_only=True)

    class Meta:
        model = Block
        fields = ['blocker', 'blocked', 'blocked_at']

#===========================REALTIME CHAT SERIALIZERS=================================================================================

class ConversationMemberSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source="user.profile", read_only=True)
    class Meta:
        model = ConversationMember
        fields = [
            "user",
            "role",
            "joined_at",
            "last_read_message",
            'is_active',
            'left_at',
        ]

class ConversationSerializer(serializers.ModelSerializer):
    members = ConversationMemberSerializer( # vì là serializer này lấy ra model conversation,mà conversationmember là FK, nên đoạn conversation sẽ là obj khi được gọi, gọi ra member thì chỉ cần set
        source="conversationmember_set", #lấy từ ram
        many=True,
        read_only=True
    )
    last_message = serializers.SerializerMethodField()
    unread_count=serializers.SerializerMethodField()
    is_chatbot = serializers.SerializerMethodField()
    class Meta:
        model = Conversation
        fields = [
            "id",
            "is_group",
            "name",
            "avatar",
            "created_by",
            "status",
            "created_at",
            "members",
            "last_message",
            'updated_at',
            'unread_count',
            'is_chatbot'
        ]
    def get_is_chatbot(self, obj):
        try:
            from backend.env_config import env
            bot_name = env('BOT_USERNAME')
            return any(m.user.username == bot_name for m in obj.conversationmember_set.all())
        except Exception:
            return False
    def get_last_message(self, obj):
        # đọc từ prefetched_messages trong RAM, không query DB
        # getattr để tránh crash nếu chưa prefetch (trả về None thay vì lỗi)
        msgs = getattr(obj, 'prefetched_messages', None) 
        if msgs:
            return MessageSerializer(msgs[0]).data  # msgs[0] = tin mới nhất vì đã order_by('-created_at')
        return None

    def get_unread_count(self, obj):
        user = self.context['request'].user # lấy user trong request
        #  conversationmember_set đã prefetch sẵn → không query DB mà lấy trong ram khi gọi api có liên quan đến conv
        member = next(
            (m for m in obj.conversationmember_set.all() if m.user_id == user.id), #lọc ra trong conv member có mình không, có thì trả ra object thì default là None, next là láy phần tử đầu tiên
            None
        )

        if not member: # mình ko phải là thành viên thì trả 0
            return 0
        #  đếm từ prefetched_messages trong RAM gắn với request, không query DB
        msgs = getattr(obj, 'prefetched_messages', [])

        if member.last_read_message is None:# chưa đọc lần nào , đếm tất cả tin nhắn từ đầu trừ tin nhắn mình
            return sum(1 for m in msgs if m.sender_id != user.id)
        # đếm tin của người khác sau lần đọc cuối
        count =  sum(
            1 for m in msgs
            if m.id > member.last_read_message  # đếm tin nhắn last read của mình có thời gian nhỏ hơn n tin nhắn mới
            and m.sender_id != user.id                             #  không đếm tin của mình
        )
        return min(count,10) # trả về nhỏ nhất, count hoặc mặc định là 10

class MessageAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = ProfileSerializer(source="uploaded_by.profile", read_only=True)
    class Meta:
        model = MessageAttachment
        fields = [
            'id',
            'file_url',
            'file_type',
            'file_name',
            'file_size',
            'created_at',
            'uploaded_by',
        ]

class MessageSerializer(serializers.ModelSerializer):
    #khi người dùng post sẽ tạo content cho message, validate data rồi lấy ra cái attatchment có liên quan từ messageattachment đã validate rồi lưu vào message
    sender = ProfileSerializer(source="sender.profile", read_only=True)
    attachments = MessageAttachmentSerializer(many=True, read_only=True) # tự tham chiếu qua, với mỗi object message thì gọi select messageattachment có message_id= object_id ( đầu tiên gọi lấy ra all id message của user, sau đó gọi lấy messageattachment có message_id in message ở query 1, rồi tự ghép vào lại đúng id), nested chỉ dùng đc khi lấy hết các object liên quan,  lọc ra nữa thì k đc
    conversation = serializers.PrimaryKeyRelatedField(read_only=True) #láy ra/trả ra id có liên quan đến object ở đây là override cái conversation r , Ví dụ gửi message thì message đó thuộc về conversation nào thì lấy ra id của conversation đó
    reply_to = serializers.SerializerMethodField()
    class Meta:
        model = Message
        fields = [
            "id",
            "conversation",
            "sender",
            "content",
            "message_type",
            "attachments",
            "created_at",
            "reply_to",
            "reply_to_id"
        ]
        read_only_fields = [ # định nghĩa các trường chỉ đọc
            "id",
            "conversation",
            "sender",
            "attachments",
            "created_at",
        ]
    def get_conversation(self, obj):
        return obj.conversation.id
    def get_reply_to(self,obj):
        if not obj.reply_to:
            return None
        return {
            "id": obj.reply_to.id,
            'content': obj.reply_to.content,
            "sender_id": obj.reply_to.sender_id,
        }
#==========================in-app noti ===============================

#     def get_actor(self, obj): ví dụ 
#         if isinstance(obj, Comment): #isinstance là kiểm tra đối tượng có phải là của 1 lớp nào
#             return f'{obj.user.first_name} {obj.user.last_name}' #lấy ra email của user thực hiện hành động, cả comment và react sau lọc đều có trường user
#         if isinstance(obj, UserReaction):
#             return f'{obj.user.first_name} {obj.user.last_name}'
#         if isinstance(obj, FriendshipRequest):
#             return f'{obj.from_user.first_name} {obj.from_user.last_name}'
#         if isinstance(obj, Follow):
#             return f'{obj.follower.first_name} {obj.follower.last_name}' 
        
class NotificationSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    actor_avatar=serializers.SerializerMethodField()
    actor_id = serializers.IntegerField(source='actor.profile.id')
    class Meta:
        model = Notification
        fields = ['id', 'type', 'object_id', 'post_id', 'message', 'is_read', 'created_at','actor_id' ,'actor', 'actor_avatar','vote_id','event_id', 'group_id']

    def get_actor(self, obj):
        return f"{obj.actor.profile.first_name} {obj.actor.profile.last_name}"
    def get_actor_avatar(self, obj):
        return obj.actor.profile.picture.url if obj.actor.profile.picture else None

#class NotificationSerializer(serializers.ModelSerializer):

#     def get_target(self, obj):
#         target = obj.content_object

#         if isinstance(target, Comment):
#             return {
#                 "type": "comment",
#                 "id": target.id,
#                 "content": target.content,
#                 "post_id": target.post_id
#             }

 #====================================Email serializer=========================
from allauth.account.models import EmailAddress
class EmailSerializer(serializers.ModelSerializer):
    class Meta:
        model=EmailAddress
        fields= ["id", "email", "primary", "verified"]
        
#======================================Search serializer=========================

class SearchSerializer(serializers.ModelSerializer):
    class Meta:
        model=SearchHistory
        fields=['id','content','created_at']

#=================================Friend suggest===============================
class FriendSuggestionSerializer(serializers.ModelSerializer):
    mutual_count = serializers.IntegerField(read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = ['id', 'full_name', 'picture', 'mutual_count']

    def get_full_name(self, obj):
        return f"{obj.first_name or ''} {obj.last_name or ''}".strip()

#================================POST SHARE============================================
class PostShareSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source='user.profile', read_only=True)
    post=PostSerializer(read_only=True)
    class Meta:
        model =PostShare
        fields = '__all__'
#================================================================================
class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ['id', 'reason', 'created_at', 'post', 'comment']
        read_only_fields = ['id', 'created_at', 'post', 'comment']

class SupportTicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportTicket
        fields = ['id', 'content', 'created_at']
#=========== TASK=================================================
class TaskSerializer(serializers.ModelSerializer):
    created_by = ProfileSerializer(source='created_by.profile', read_only=True)
    assigned_to = serializers.SerializerMethodField() #ManyToManyField nên k thể dùng ProfileSerializer, dùng hiện thị ra
    assigned_to_ids = serializers.PrimaryKeyRelatedField( # primary field dùng validate và chuyển id vào thành object, dùng chuyển vào
        source='assigned_to',
        many=True,
        queryset=User.objects.all(),# validate id truyền vào
        write_only=True, # chỉ nhận
        required=False
    )
    class Meta:
        model = Task
        fields = [
            'id',
            'title',
            'description',
            'created_by',
            'assigned_to',
            'assigned_to_ids',
            'status',
            'priority',
            'deadline',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
    def get_assigned_to(self, obj):
        return [
            {
                'id': u.profile.id,
                'full_name': u.profile.full_name,
                'picture': u.profile.picture.url if u.profile.picture else DEFAULT_PROFILE_PICTURE ,
            }
            for u in obj.assigned_to.select_related('profile').all()
        ]
    def get_fields(self):  #hàm override của modelSerializer để tùy chỉnh trường trả về
        fields = super().get_fields() #kế thừa
        request = self.context.get('request')
        task = self.instance #instance truyền từ API sang

        if task and request and hasattr(task, 'created_by'): # truyền hasatrr để quertset không bị lỗi vì cái này k có instance của 1 task cụ thể mà là 1 querryset
            if task.created_by != request.user: #không phải người tạo thì k dc sửa những field sau
                for field in ['title', 'description', 'priority', 'deadline', 'assigned_to_ids']:
                    fields[field].read_only = True
        return fields # nếu ng đó tạo task thì return hết để update

#================VOTE==================================================
class VoteOptionSerializer(serializers.ModelSerializer):
    is_voted = serializers.BooleanField(read_only=True, default=False)
    class Meta:
        model = VoteOption
        fields = ['id', 'text', 'count','is_voted']
        read_only_fields = ['count','is_voted']

class VoteSerializer(serializers.ModelSerializer):
    options = VoteOptionSerializer(many=True, read_only=True) #1-n
    created_by = ProfileSerializer(source='created_by.profile', read_only=True)

    class Meta:
        model = Vote
        fields = ['id', 'created_by', 'title', 'created_at', 'is_closed', 'options']
        read_only_fields = ['created_at','created_by']

class UserVoteSerializer(serializers.ModelSerializer):
    option = VoteOptionSerializer(read_only=True)
    created_by = ProfileSerializer(source='created_by.profile', read_only=True)
    class Meta:
        model = UserVote
        fields = ['option','created_by']
        read_only_fields = ['created_by']

#=============== Event ====================
class EventParticipantSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='user.profile.full_name', read_only=True)
    avatar = serializers.SerializerMethodField()
    class Meta:
        model=EventParticipant
        fields=[
            'id',
            'full_name',
            'avatar',
            'status',
        ]
    def get_avatar(self, obj):
        pic = getattr(obj.user.profile, 'picture', None)
        return pic.url if pic else DEFAULT_PROFILE_PICTURE

class EventSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.profile.full_name', read_only=True)
    participants = EventParticipantSerializer(many=True, read_only=True)
    is_accepted = serializers.SerializerMethodField()
    is_expired = serializers.SerializerMethodField()
    class Meta:
        model = Event
        fields = [
            'id',
            'created_by',
            'created_by_name',
            'title',
            'description',
            'start_time',
            'end_time',
            'created_at',
            'participants',
            'is_accepted',
            'is_expired',
        ]
        read_only_fields = ['id', 'created_at', 'created_by', 'created_by_name', 'participants']

    def validate_start_time(self, start_time): # validate đầu vào, validate_{field_name}
        if start_time < timezone.now():
            raise serializers.ValidationError('Thời gian bắt đầu phải ở tương lai.')
        return start_time

    def validate(self, attrs): # cái này validate nhiều field cùng lúc
        start = attrs.get('start_time')
        end   = attrs.get('end_time')
        if start and end and end <= start:
            raise serializers.ValidationError({'end_time': 'Thời gian kết thúc phải sau thời gian bắt đầu.'})
        return attrs

    def get_is_accepted(self,obj):
        request =self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        participant = next( # nếu có user id = với user của user gửi request thì trả về không thì None
            (p for p in obj.participants.all() if p.user_id == request.user.id),
            None
        )
        return participant.status if participant else None #lấy ra status user gửi request

    def get_is_expired(self, obj):
        now = timezone.now()
        if obj.end_time:
            return obj.end_time < now
        return obj.start_time < now if obj.start_time else False

#==============================GROUP===========================================================================================

class GroupSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)
    created_by = ProfileSerializer(source = 'created_by.profile', read_only=True)
    role = serializers.SerializerMethodField()
    belong_to_department = serializers.SerializerMethodField()
    department_role = serializers.SerializerMethodField()
    join_status = serializers.SerializerMethodField()
    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['created_by','created_at']

    def get_member_count(self, obj):
        return getattr(obj, 'member_count', 0)

    def get_join_status(self,obj):
        if getattr(obj, 'is_member', False): # lấy ra cột từ obj, mặc đinh false
            return 'member'
        if getattr(obj, 'is_pending', False):
            return 'pending'
        return 'none'

    def get_role(self,obj):
        memberships = getattr(obj, 'my_membership', []) #lấy ra atr lưu trong ram
        return memberships[0].role if memberships else None

    def get_belong_to_department(self, obj):
        memberships = getattr(obj, 'my_membership', [])
        if memberships and memberships[0].job_role and memberships[0].job_role.department: # có job role và có department mới lấy
            return memberships[0].job_role.department.name
        return None

    def get_department_role(self, obj):
        memberships = getattr(obj, 'my_membership', [])
        if memberships and memberships[0].job_role:
            return memberships[0].job_role.name
        return None


class GroupRoleSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    class Meta:
        model = GroupRole
        fields = ['id', 'group', 'name', 'member_count']
        read_only_fields = ['group']

    def get_member_count(self,obj):
        if hasattr(obj, 'member_count'):
            return obj.member_count # dùng cho get_object
        counts = self.context.get("role_member_counts", {})
        return counts.get(obj.id, 0)

class GroupDepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    roles = GroupRoleSerializer(
        source='department_roles',
        many=True,
        read_only=True
    )
    class Meta:
        model = GroupDepartment
        fields = ['id', 'group', 'name', 'member_count','roles']
        read_only_fields = ['group']
    def get_member_count(self,obj):
        if hasattr(obj, 'member_count'):
            return obj.member_count # dùng cho get_object, nếu có truyền vào member_count trong annotate viết ở get_object thì lấy
        counts = self.context.get("department_member_counts", {}) # lấy ở context truyền từ queryset, lưu trong ram
        return counts.get(obj.id, 0) #dùng cho get_queryset (tức là truyền vào department 1 thì lấy tất cả member department 1, k có thì 0)

class GroupMemberSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source='user.profile',read_only=True)
    department = serializers.CharField(source= 'job_role.department.name',read_only=True)
    job_role = serializers.CharField(source= 'job_role.name',read_only=True)
    class Meta:
        model = GroupMember
        fields = '__all__'
        read_only_fields = ['group']

class GroupJoinRequestSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source='user.profile', read_only=True)
    reviewed_by = ProfileSerializer(source='reviewed_by.profile', read_only=True)
    group = GroupSerializer(read_only=True)
    class Meta:
        model = GroupJoinRequest
        fields = '__all__'
        read_only_fields = ['group']

class GroupPostSerializer(serializers.ModelSerializer):
    user =ProfileSerializer(source='user.profile', read_only=True)
    photos = PostPhotoSerializer(many=True, read_only=True)
    videos = PostVideoSerializer(many=True, read_only=True)
    class Meta:
        model = Post
        fields = ['post_id', 'title', 'user', 'photos', 'videos', 'created_at', 'post_status', 'group','is_pinned']
        read_only_fields = ['post_id','user','created_at','group','post_status']

class GroupSuggestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = GroupSuggestion
        fields = '__all__'
        read_only_fields = ['group']