import secrets
import string

from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.contrib.auth.models import User
from autoslug import AutoSlugField  # pip install django-autoslug
from django.utils.text import slugify
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator, RegexValidator  # validator ảnh để k cho gửi các file khác
import json
# Create your models here.
import uuid
from phonenumber_field.modelfields import PhoneNumberField
from unidecode import unidecode
# reactions
from reaction.models import Reaction
from django.contrib.contenttypes.fields import GenericRelation, GenericForeignKey
# Soft delete
from safedelete.models import SafeDeleteModel  # thay thế models.model để có thể kế thừa khi xóa mềm
from safedelete.models import SOFT_DELETE_CASCADE, \
    SOFT_DELETE  # delete cascade tức là khi xóa cha thì con cũng bị xóa mềm theo, còn soft delete là chỉ xóa mềm model đó thôi không ảnh hưởng đến các model liên quan
#django-fernet-encrypted-fields
from encrypted_fields.fields import EncryptedTextField

def vi_slugify(value):  # chuyển slug thành tiếng việt
    return slugify(unidecode(value))


def profile_upload_path(instance, filename):  # Ảnh profile → media/avatars/user_1/picture.png
    ext = filename.split('.')[
        -1].lower()  # lấy phần đuôi ví dụ.PNG làm chuyển viết thường lại tránh lỗi, vị trí -1 là phần cuối tên file ví dụ.exe
    return f'avatars/user_{instance.user.id}_{instance.user}/{uuid.uuid4()}.{ext}'


def post_photo_upload_path(instance, filename):  # Ảnh post → media/posts/user_1/post_1/picture.png
    ext = filename.split('.')[-1].lower()
    return f'posts/user_{instance.post.user.id}_{instance.post.user}/post_{instance.post.post_id}/{uuid.uuid4()}.{ext}'


def chat_upload_path(instance, filename):  # Ảnh chat → media/chat/conv_1/picture.png
    ext = filename.split('.')[-1].lower()
    return f'chat/conv_{instance.message.conversation.id}/{uuid.uuid4()}.{ext}'

def conversation_avatar_upload_path(instance, filename):
    ext = filename.split('.')[-1].lower()
    return f'chat/conv_{instance.id}/avatar/{uuid.uuid4()}.{ext}'

def generate_shared_code(): # hàm đổi sang base64
    return ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(10))

def validate_birth_date(value): # hàm validate ngày sinh
    from django.utils import timezone
    if value > timezone.now().date():
        raise ValidationError('Ngày sinh không thể là tương lai')
    if value.year < 1900:
        raise ValidationError('Ngày sinh không hợp lệ')


name_validator = RegexValidator(
    regex=r'^[a-zA-ZÀ-ỹ\s]+$',
    message='Tên chỉ được chứa chữ cái và khoảng trắng'
)
class Profile(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE  # khi xóa profile thì chỉ xóa mềm profile thôi k ảnh hưởng đến user
    id = models.BigAutoField(primary_key=True, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE)  # chỉ đc 1 profile-user k có 2
    first_name = models.CharField(max_length=50, null=True, validators=[name_validator])
    last_name = models.CharField(max_length=50, null=True, validators=[name_validator])
    picture = models.ImageField(upload_to=profile_upload_path, null=True, blank=True, validators=[
        FileExtensionValidator(['jpg', 'jpeg', 'png',
                                'webp'])])  # ví dụ post ảnh 123.png lên, nó sẽ chạy hàm sửa tên lấy ra chữ png và đổi tên file lại user_1_abc_9349832.png
    date_of_birth = models.DateField(null=True,validators=[validate_birth_date])
    phone_number = PhoneNumberField(null=True, blank=True)  # ,unique=True)
    bio = models.CharField(max_length=50, null=True, blank=True)
    # friends=models.ManyToManyField('self', blank=True,symmetrical=True)#symmetrical=True (mặc định): Nếu A là bạn B → B tự động là bạn A, di voi self, self là quan hệ đi với profile vì là manytomany
    is_completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    auth_provider = models.CharField(  # tạo ô chọn
        max_length=20,
        choices=(('local', 'Local'), ('google', 'Google')),
        default='local'
    )
    phone_number_public = models.BooleanField(default=False)
    date_of_birth_public = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=['user']),  # filter user
            models.Index(fields=['-created_at']),  # order by
        ]

    def __str__(self):
        return f"Profile {self.id} | user_id={self.user_id} | {self.first_name} {self.last_name}"
    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip() #strip bỏ khoảng trắng đầu cuối

class PendingProfile(models.Model):
    id = models.BigAutoField(primary_key=True, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    first_name = models.CharField(max_length=50, null=True,validators=[name_validator])
    last_name = models.CharField(max_length=50, null=True,validators=[name_validator])
    date_of_birth = models.DateField(null=True, validators=[validate_birth_date])
    phone_number = PhoneNumberField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    def __str__(self):
        return f"{self.user.username}- Pending"


class Post(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE  # khi xóa post thì các comment, photo liên quan cũng bị xóa mềm theo
    PRIVACY_CHOICES=[
        ('public', 'Công khai'),
        ('friends', 'Bạn bè'),
        ('private', 'Chỉ mình tôi'),
    ]
    post_id = models.BigAutoField(primary_key=True, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=200, null=False)
    created_at = models.DateTimeField(auto_now_add=True)
    reactions = GenericRelation(
        Reaction)  # generic relation dùng để kết nối nhiều model thay vì chỉ 1 như FK cố định. Ví dụ Fk là cần phải có trường đó để tạo FK thì cái này có thể gắn bất kì model nào mà k cần trường chung
    share_code = models.CharField(max_length=10, unique=True, default=generate_shared_code, editable=False)
    share_count=models.PositiveIntegerField(default=0)
    privacy= models.CharField(max_length=15,choices=PRIVACY_CHOICES,default='public')
    is_pinned= models.BooleanField(default=False)
    # group=models.ForeignKey(Group,null=True,blank=True)
    def __str__(self):
        return f"Post {self.post_id} | user_id={self.user_id} | {self.title[:30]}"

    class Meta:
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['title']),
            models.Index(fields=['share_code']),
            models.Index(fields=['user','privacy','-is_pinned', '-created_at']),
            models.Index(fields=['privacy', '-created_at']),
        ]


class PostPhoto(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    post = models.ForeignKey(Post, on_delete=models.CASCADE,
                             related_name="photos")  # related name là mối quan hệ ngược do foreign key, dùng post.photos.all để querry thay vì post.postphoto_setall
    photo = models.ImageField(upload_to=post_photo_upload_path, null=True, blank=True, validators=[
        FileExtensionValidator(['jpg', 'jpeg', 'png', 'webp'])])  # sẽ dùng media_root để lưu

    def __str__(self):
        return f"Photo {self.id} | post_id={self.post_id}"

    class Meta:
        indexes = [
            models.Index(fields=['post']),
        ]


class PostArticle(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    postA_id = models.BigAutoField(primary_key=True, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=50, null=False)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    slug = AutoSlugField(populate_from='title', unique=False, slugify=vi_slugify)
    reactions = GenericRelation(Reaction)

    def __str__(self):
        return f"Article {self.postA_id} | user_id={self.user_id} | {self.title[:30]}"

    class Meta:
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['title']),
        ]
    # sau này tạo url /<slug:slug>-<id:id>/ làm url, view chỉ lấy id và tìm để tạo sharelink


class Comment(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE  # để khôi phục khi post khôi phục
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies')
    is_pinned = models.BooleanField(default=False)
    tagged_users = models.ManyToManyField(User, blank=True,
                                          related_name='tagged_in_comments')  # thay vì FK chỉ có thể tag 1 user trong comment thì MnM Field cho tag 2 3 usser trong 1 comment
    content = models.CharField(max_length=1000, null=False)
    created_at = models.DateTimeField(auto_now_add=True)
    reactions = GenericRelation(Reaction)

    def __str__(self):
        return f"Comment {self.id} | user_id={self.user_id} | post_id={self.post_id} | {self.content[:30]}"

    class Meta:
        indexes = [
            models.Index(fields=['post', 'parent', '-is_pinned', '-created_at']),
            models.Index(fields=['post', '-created_at']),
            models.Index(fields=['user']),
            models.Index(fields=['parent']),
        ]


class Setting(models.Model):
    darkmode = models.BooleanField(default=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    #sau này thêm default post privacy để lưu giá trị privacy user set mỗi khi đăng bài, khi perform create thì lấy ra và gán luôn nếu có gán thủ công thì lấy thủ công
    def __str__(self):
        return f"Setting of {self.user.username}"


class Log(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE
    metadata_json = models.TextField(
        help_text="Lưu trữ metadata (dictionary) từ activity stream dưới dạng chuỗi JSON đã serialize.",
        blank=True, null=True
    )
    created_log_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        # Cố gắng parse JSON để có một chuỗi mô tả dễ đọc hơn, dùng các hàm để xử lý json để tìm kiếm thuận tiện hơn
        if not self.metadata_json:
            return f"[{self.created_log_at:%Y-%m-%d %H:%M}] Empty metadata"
        try:
            data = json.loads(self.metadata_json)  # chuyển chuỗi json của trường trên thành dict
            if not isinstance(data, dict):
                return f"[{self.created_log_at:%Y-%m-%d %H:%M}] Invalid metadata"
            action = data.get('action', 'N/A')
            target = data.get('target_type', 'N/A')
            pk = data.get('target_id', 'N/A')
            return f"[{self.created_log_at.strftime('%Y-%m-%d %H:%M')}] Action: {action} on {target} ({pk})"
        except json.JSONDecodeError:
            # Xử lý nếu dữ liệu không phải là JSON (có thể do lỗi cũ)
            return f"Log ID {self.pk} - INVALID JSON"


# ==========================================REALTIME CHAT MODELS==========================================================
class Conversation(models.Model):
    id = models.BigAutoField(primary_key=True, editable=False)
    is_group = models.BooleanField(default=False)
    name = models.CharField(max_length=50, null=True, blank= True)
    avatar = models.ImageField(upload_to=conversation_avatar_upload_path,null=True, blank=True,validators=[FileExtensionValidator(['jpg', 'jpeg', 'png', 'webp'])])
    created_by = models.ForeignKey(User, on_delete=models.CASCADE,null=True,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=(('pending', 'Pending'), ('accept', 'Accept')), default='pending')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Conversation {self.id} | group={self.is_group} | {self.status}"

    class Meta:
        indexes = [
            models.Index(fields=['-updated_at']),  # order by updated_at
            models.Index(fields=['status']),  # filter status
            models.Index(fields=['is_group'])
        ]


class ConversationMember(models.Model):
    ROLE_CHOICES = [
        ('admin','Admin'),
        ('member','Member'),
    ]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='member')
    last_read_message = models.PositiveBigIntegerField(null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    deleted_at_message_id = models.PositiveBigIntegerField(null=True, blank=True)
    is_hidden=models.BooleanField(default=False)
    is_permanently_hidden = models.BooleanField(default=False)
    is_active=models.BooleanField(default=True)
    left_at = models.DateTimeField(null=True, blank=True)
    def __str__(self):
        return f"Member user_id={self.user_id} | conv_id={self.conversation_id}"

    class Meta:
        unique_together = ('conversation',
                           'user')  # đảm bảo mỗi user chỉ tham gia 1 lần trong 1 conversation, tự tạo index cho 2 cái
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['conversation', 'is_hidden']),
            models.Index(fields=['user', 'is_permanently_hidden']),
            models.Index(fields=['conversation', 'user','role']),
        ]


class Message(SafeDeleteModel):
    MESSAGE_TYPE_CHOICES=[
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
        # thêm system message types
        ('system_task_created', 'Tạo task'),
        ('system_task_updated', 'Cập nhật task'),
        ('system_task_assigned', 'Assign task'),
        ('system_task_deleted', 'Xóa task'),
        ('system_member_added', 'Thêm thành viên'),
        ('system_member_left', 'Rời nhóm'),
        ('system_member_kicked', 'Bị kick'),
        ('system_admin_transferred', 'Chuyển admin'),
        ('system_name_changed', 'Đổi tên nhóm'),
        ('system_avatar_changed', 'Đổi avatar nhóm'),

        ('system_vote_created',"Tạo vote nhóm"),
        ('system_vote_deleted','Xóa vote nhóm'),
        ('system_vote_updated', 'Cập nhật vote nhóm'),
        ('system_vote_option_added', 'Thêm option vote nhóm'),
        ('system_vote_option_deleted', 'Xóa option vote nhóm'),
        ('system_vote_added', 'Người dùng thêm vote nhóm'),
    ]
    _safedelete_policy = SOFT_DELETE_CASCADE
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    content = EncryptedTextField(null=True, blank=True)
    message_type = models.CharField(  # ô chọn
        max_length=50,
        choices=MESSAGE_TYPE_CHOICES,
        default='text'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reply_to=models.ForeignKey('self',on_delete=models.SET_NULL,related_name='replies',null=True,blank=True)

    def __str__(self):
        return f"Message {self.id} | sender_id={self.sender_id} | conv_id={self.conversation_id} | {(self.content or '') [:30]}"

    class Meta:
        indexes = [models.Index(fields=['conversation', '-created_at']),
                   models.Index(fields=['sender']),
                   models.Index(fields=['reply_to']),
        ]


class MessageAttachment(models.Model):
    FILE_TYPE_CHOICES = [
        ('image', 'Image'),
        ('file', 'File'),
        ('video', 'Video'),
    ]
    message = models.ForeignKey(Message,on_delete=models.CASCADE,related_name='attachments',null=True,blank=True)#related name phải khớp với bên MessageSerializer để khi nó ghép attachments vào message cho đúng
    conversation = models.ForeignKey(Conversation,on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    file_url = models.URLField(max_length=500)
    file_type = models.CharField(max_length=20, choices=FILE_TYPE_CHOICES)
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(null=True)  # bytes
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['message']),
            models.Index(fields=['conversation']),
        ]





# ===================================Firebase Token==================================

class FCMToken(models.Model):  # đại diện cho 1 app, 1 thiết bị, 1 lần cài
    user = models.ForeignKey(User, on_delete=models.CASCADE)  # user là ai
    token = models.CharField(max_length=255, unique=True)  # token nào
    device = models.CharField(max_length=20, default="android")  # thiết bị nào
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"FCMToken user_id={self.user_id} | {self.device}"

    class Meta:
        indexes = [models.Index(fields=['user'])]


# ==========================Notification=============================
class Notification(models.Model):
    TYPE_CHOICES = [
        ('comment_on_post', 'Comment on Post'),
        ('reply_on_comment', 'Reply on Comment'),
        ('tagged_in_reply', 'Tagged in Reply'),
        ('reaction_on_post', 'Reaction on Post'),
        ('reaction_on_comment', 'Reaction on Comment'),
        ('friend_request', 'Friend Request'),
        ('follow', 'Follow'),
    ]
    reciever = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    actor = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_notifications')
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    object_id = models.PositiveIntegerField(null=True, blank=True)
    post_id = models.PositiveIntegerField(null=True, blank=True)
    message = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Notif {self.id} | {self.type} | receiver_id={self.reciever_id} | actor_id={self.actor_id}"

    class Meta:  # Meta là cách thiết lập model hoạt động , kiểu setting mặc định
        ordering = ['-created_at']  # auto sắp xếp giảm dần

        indexes = [
            # giống mục lục sách, thay vì tìm từng dòng thì nhảy thẳng đến, giúp truy vấn mấy cái hay tìm dễ hơn ví dụ theo ngày..., dùng tăng tốc filter, order_by , tăng bộ nhớ ram nhưng nhanh
            models.Index(fields=['reciever', '-created_at']),
            models.Index(fields=['is_read']),
            models.Index(fields=['actor']),
            models.Index(fields=['reciever', 'is_read','-created_at'])
        ]  # ví dụ nó sẽ lưu vào user là 5 trong db index và mốt nó truy vấn chỉ cần vào đó tìm user 5 sẽ ra row 1000



# # ======================================================================
class SearchHistory(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.CharField(max_length=250)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'])
        ]

    def __str__(self):
        return f"Search user_id={self.user_id} | {self.content[:30]}"

#==============================================================================
class PostShare(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE
    PRIVACY_CHOICES=[
        ('public', 'Công khai'),
        ('friends', 'Bạn bè'),
        ('private', 'Chỉ mình tôi'),
    ]
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='shares')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shared_posts')
    created_at = models.DateTimeField(auto_now_add=True)
    content = models.CharField(max_length=500, null=True, blank=True)  # không bắt buộc phải viết
    privacy = models.CharField(max_length=15, choices=PRIVACY_CHOICES, default='public')
    class Meta:
        # unique_together = ('post', 'user') # nếu chỉ cho share 1 lần
        indexes = [
            models.Index(fields=['user', 'privacy']),
            models.Index(fields=['post', '-created_at']),  # nên thêm
            models.Index(fields=['privacy', '-created_at']),
        ]

    def __str__(self):
        return f"{self.user} shared {self.post}"

#=============================================================================================================

class Report(models.Model):
    post=models.ForeignKey(Post, on_delete=models.CASCADE,null=True,blank=True)
    comment=models.ForeignKey(Comment, on_delete=models.CASCADE,null=True,blank=True)
    user=models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    reason= models.CharField(max_length=250)
    def __str__(self):
        return f"{self.post} |{self.comment} | {self.reason}"
    class Meta:
        unique_together = (
            ('post','user'),
            ('comment', 'user'),
        )

class SupportTicket(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    content = models.TextField()
    status = models.CharField(max_length=20, choices=[
        ('pending', 'Pending'),
        ('resolved', 'Resolved'),
    ], default='pending')

    def __str__(self):
        return f"{self.user} | {self.status}"

#=================TASK=================================
class Task(models.Model):
    STATUS=[
        ('todo','Cần làm'),
        ('in_progress','Đang làm'),
        ('done','Hoàn Thành')
    ]
    PRIORITY=[
        ('low','Thấp'),
        ('medium','Trung bình'),
        ('high','Cao')
    ]
    #dùng để gắn vào nhiều model khác linh động mà k bị trói buộc foreign key khi gắn
    content_type= models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')

    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=250)
    description = models.TextField(null=True,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    status= models.CharField(choices=STATUS,max_length=20,default='todo')
    priority = models.CharField(choices=PRIORITY,max_length=20,default='medium')
    assigned_to=models.ManyToManyField(User,blank=True, related_name='assigned_tasks')
    deadline = models.DateTimeField(null=True,blank=True)
    updated_at= models.DateTimeField(auto_now=True)
    class Meta:
        indexes= [
            models.Index(fields=['content_type','object_id','status','priority']),
        ]

#=====================VOTE==========================================================
class Vote(models.Model):
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=250)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE) #group chat hoặc group
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    created_at = models.DateTimeField(auto_now_add=True)
    is_closed = models.BooleanField(default=False)
    class Meta:
        indexes=[
            models.Index(fields=['content_type','object_id','is_closed','created_at']),
        ]

class VoteOption(models.Model):
    vote = models.ForeignKey(Vote, on_delete=models.CASCADE, related_name='options')
    text = models.CharField(max_length=255)
    count = models.PositiveIntegerField(default=0)
    class Meta:
        unique_together = (('vote', 'text'),) # Không cho phép tạo 2 option trùng tên trong 1 vote
        indexes = [models.Index(fields=['vote','count'])]

class UserVote(models.Model):
    option = models.ForeignKey(VoteOption, on_delete=models.CASCADE,related_name='votes')
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    class Meta:
        unique_together = (('option', 'created_by'),) # Mỗi user chỉ được vote 1 option 1 lần
        indexes = [models.Index(fields=['option','created_by'])]

