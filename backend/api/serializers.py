from rest_framework import serializers
from .models import *
# reaction
from django.db.models import Count # dùng để đếm số reaction
from django.contrib.contenttypes.models import ContentType
from reaction.models import UserReaction
# activity strean
from actstream.models import Action
#friendship
from friendship.models import Friend, FriendshipRequest, Follow, Block

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model=User
        fields=['id','username','first_name','last_name']

class ProfileSerializer(serializers.ModelSerializer):
    #friends = serializers.PrimaryKeyRelatedField(many=True, read_only=True) #cách tạo serializer của many to many field
    class Meta:
        model=Profile
        fields='__all__'
    
class PendingProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model=PendingProfile
        fields='__all__'

class PostPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model=PostPhoto
        fields='__all__'
        extra_kwargs = {"post": {"read_only": True}} #để k bị lỗi khi post ảnh lên vì post là foreign key bắt buộc phải có giá trị nhưng khi post ảnh thì chưa có post_id nên để read only

class PostSerializer(serializers.ModelSerializer):
    url =serializers.SerializerMethodField() #thêm field vào json trả về 

    # vì là one to one field với user nên phải để thế mới lấy ra profile đc, nếu k có source thì nó bị lấy ra user 2 lần vì profileserializer cũng có user, hiểu là 2 trường user 1 là của post 2 là profile thì lấy ra của profile
    user = ProfileSerializer(source="user.profile", read_only=True) 
    photos = PostPhotoSerializer(many=True, read_only=True) #tự động lấy ra tất cả ảnh liên quan đến post nhờ related name ở model PostPhoto
    # reactions
    reactions= serializers.SerializerMethodField()
    user_is_reaction=serializers.SerializerMethodField()
    class Meta:
        model=Post
        fields='__all__'

    def to_representation(self, instance): #cách custome để loại bỏ các trường trả về json theo ý(ở đây xóa deleted hiện trong json)
        data = super().to_representation(instance)
        # Xóa các key bạn không muốn xuất hiện
        data.pop('deleted', None) # cần truyền vào giá trị pop, muốn pop hết thì để None
        data.pop('deleted_by_cascade', None)
        # Nếu muốn xóa trong nested object (user) tức là các trường liên quan
        if 'user' in data:
            data['user'].pop('deleted', None)
            data['user'].pop('deleted_by_cascade', None)
        return data
    
    def get_url(self,obj):
        return f"http://localhost:8000/api/user/post/{obj.post_id}/"   
    
    def get_reactions(self, obj): #phải trùng tên với cái ở trên khai báo reactions
        content_type = ContentType.objects.get_for_model(obj) #lấy ra contenttype của post 
        reactions = (
            Reaction.objects.filter(content_type=content_type, object_id=obj.pk)
            .values("settings__name")          # group by theo tên reaction like, wow...
            .annotate(total=Count("reactions"))  # đếm số user reaction
        )
        return reactions
    
    def get_user_is_reaction(self,obj):
        user=self.context.get('request').user #lấy ra user đã react, self.context.get(request) là lấy request truyền vào và sau đó lấy ra .user
        if not user.is_authenticated:
            return False
        qs = UserReaction.objects.filter(
            user=user,
            reaction__content_type=ContentType.objects.get_for_model(obj),
            reaction__object_id=obj.pk
        ).first()
        if qs: 
            return qs.reaction.settings.name #lấy ra cái cảm xúc ng dùng đã thả
        return None
    
class PostArticalSerializer(serializers.ModelSerializer):
    user = ProfileSerializer(source="user.profile", read_only=True)
    class Meta:
        model=PostArticle
        fields='__all__'

class CommentSerializer(serializers.ModelSerializer):
    post = PostSerializer(read_only=True) # để show ra post có tên gì... trong response
    class Meta:
        model=Comment
        fields='__all__'

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
    slug =serializers.CharField(source='react.slug',read_only=True)# Cách để thêm foreign key từ model có liên quan ,vì slug k có trong trường UserReactioon nên để slug để k thay đổi đc
    class Meta:
        model = UserReaction
        fields = ['user', 'slug']


#===========================ActivitySteam=================================================================================
class ActionSerializer(serializers.ModelSerializer): 
    #actor = ProfileSerializer(source='actor.profile', read_only=True)
    actor =serializers.StringRelatedField()
    target=serializers.StringRelatedField()
    action_object=serializers.StringRelatedField()
    class Meta:
        model = Action
        fields = ['id', 'actor', 'verb', 'target', 'action_object', 'timestamp']

#===========================FRIENDSHIP=================================================================================
class FriendShipRequestSerializer(serializers.ModelSerializer):
    sender = ProfileSerializer(source='from_user.profile', read_only=True)
    receiver = ProfileSerializer(source='to_user.profile', read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = FriendshipRequest
        fields = ['id', 'sender', 'receiver', 'created', 'status']

    def get_status(self, obj): #object tức là lấy cái bản ghi FriendRequest trong db
        user = self.context['request'].user

        if obj.rejected: #nếu có bản ghi rejected tức là đã bị từ chối return 'rejected'
            return 'rejected'
        elif Friend.objects.are_friends(obj.from_user, obj.to_user): #nếu đã là bạn bè thì return accept
            return 'accepted'
        elif obj.from_user == user: #nếu ng gửi là user thì return đang chờ gửi
            return 'pending_sent'
        elif obj.to_user == user: #nếu ng nhận là user thì return đang chờ nhận
            return 'pending_received'
        else:
            return 'pending'

class FriendSerializer(serializers.ModelSerializer): #danh sách bạn bè, vì friendship sẽ tạo bản ghi 2 chiều
    user = ProfileSerializer(source='to_user.profile', read_only=True)
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