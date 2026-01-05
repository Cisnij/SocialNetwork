from django.db import models
from django.contrib.auth.models import User
from autoslug import AutoSlugField  #pip install django-autoslug
from django.utils.text import slugify
from django.utils import timezone
import json
# Create your models here.
import uuid
from phonenumber_field.modelfields import PhoneNumberField
from unidecode  import unidecode 
#reactions
from reaction.models import Reaction
from django.contrib.contenttypes.fields import GenericRelation
#Soft delete
from safedelete.models import SafeDeleteModel # thay thế models.model để có thể kế thừa khi xóa mềm
from safedelete.models import SOFT_DELETE_CASCADE, SOFT_DELETE # delete cascade tức là khi xóa cha thì con cũng bị xóa mềm theo, còn soft delete là chỉ xóa mềm model đó thôi không ảnh hưởng đến các model liên quan


def vi_slugify(value): #chuyển slug thành tiếng việt 
    return slugify(unidecode(value))

class Profile(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE #khi xóa profile thì chỉ xóa mềm profile thôi k ảnh hưởng đến user
    id=models.BigAutoField(primary_key=True, editable=False)
    user=models.OneToOneField(User,on_delete=models.CASCADE)
    first_name=models.CharField(max_length=50,null=True)
    last_name=models.CharField(max_length=50,null=True)
    picture=models.ImageField(null=True, default="default.jpg")
    date_of_birth=models.DateField(null=True)
    phone_number=PhoneNumberField(null=True,blank=True) #,unique=True)
    bio=models.CharField(max_length=50,null=True,blank=True)
    # friends=models.ManyToManyField('self', blank=True,symmetrical=True)#symmetrical=True (mặc định): Nếu A là bạn B → B tự động là bạn A, di voi self, self là quan hệ đi với profile vì là manytomany
    is_completed=models.BooleanField(default=False)
    created_at=models.DateTimeField(auto_now_add=True, null=True)
    auth_provider = models.CharField( # tạo ô chọn
        max_length=20,
        choices=(('local', 'Local'), ('google', 'Google')),
        default='local'
    )
    def __str__(self):
        return f"{self.user.username} - {self.is_completed}"

class PendingProfile(models.Model):
    id=models.BigAutoField(primary_key=True, editable=False)
    user=models.OneToOneField(User,on_delete=models.CASCADE)
    first_name=models.CharField(max_length=50,null=True)
    last_name=models.CharField(max_length=50,null=True)
    date_of_birth=models.DateField(null=True)
    phone_number=PhoneNumberField(null=True,blank=True)
    created_at=models.DateTimeField(auto_now_add=True,null=True)
    def __str__(self):
        return f"{self.user.username}- Pending"

class Post(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE #khi xóa post thì các comment, photo liên quan cũng bị xóa mềm theo
    post_id= models.BigAutoField(primary_key=True, editable=False)
    user=models.ForeignKey(User,on_delete=models.CASCADE)
    title=models.CharField(max_length=200, null=False)
    created_at=models.DateTimeField(auto_now_add=True)
    reactions=GenericRelation(Reaction)
    def __str__(self):
        return f"{self.user}-{self.title[:10]}"

class PostPhoto(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    post=models.ForeignKey(Post, on_delete=models.CASCADE, related_name="photos") # related name là mối quan hệ ngược do foreign key, dùng post.photos.all để querry thay vì post.postphoto_setall
    photo=models.ImageField(null=True, blank=True) # sẽ dùng media_root để lưu
    def __str__(self):
        return f"{self.post.title[:10]}"
    
class PostArticle(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    postA_id=models.BigAutoField(primary_key=True, editable=False)
    user=models.ForeignKey(User, on_delete=models.CASCADE)
    title=models.CharField(max_length=5000, null=False)
    content=models.CharField(max_length=5000, null=False, default="No content")
    created_at=models.DateTimeField(auto_now_add=True)
    slug= AutoSlugField(populate_from='title', unique=True,slugify=vi_slugify)
    reactions=GenericRelation(Reaction) # generic relation dùng để kết nối nhiều model thay vì chỉ 1 
    def __str__(self):
        return f"{self.user}-{self.title[:10]}"

    
class Comment(SafeDeleteModel): 
    _safedelete_policy = SOFT_DELETE_CASCADE # để khôi phục khi post khôi phục
    user= models.ForeignKey(User, on_delete=models.CASCADE)
    post=models.ForeignKey(Post,on_delete=models.CASCADE)
    content=models.CharField(max_length=200, null=False)
    created_at=models.DateTimeField(auto_now_add=True)
    reactions=GenericRelation(Reaction)
    def __str__(self):
        return f"{self.user.username} commented on {self.post.title}"

class Setting(models.Model):
    darkmode=models.BooleanField(default=False)
    user=models.OneToOneField(User, on_delete=models.CASCADE)
    def __str__(self):
        return f"Setting of {self.user.username}"

# class AddFriendRequest(models.Model):
#     sender=models.ForeignKey(User,on_delete=models.CASCADE,related_name="sender")
#     receiver=models.ForeignKey(User, on_delete=models.CASCADE, related_name="receiver")
#     created_at=models.DateTimeField(auto_now_add=True)
#     status=models.BooleanField(default=False)
#     def __str__(self):
#         return f"{self.sender} send request to {self.receiver}"
    

class Log(SafeDeleteModel): #sau này dùng django-activity-stream 
    _safedelete_policy = SOFT_DELETE
    metadata_json = models.TextField(
        help_text="Lưu trữ metadata (dictionary) từ activity stream dưới dạng chuỗi JSON đã serialize.",
        blank=True,null=True
    )
    created_log_at = models.DateTimeField(auto_now_add=True)
    def __str__(self):
        # Cố gắng parse JSON để có một chuỗi mô tả dễ đọc hơn, dùng các hàm để xử lý json để tìm kiếm thuận tiện hơn
        try:
            data = json.loads(self.metadata_json) # chuyển chuỗi json của trường trên thành dict
            action = data.get('action', 'N/A')
            target = data.get('target_type', 'N/A')
            pk = data.get('target_id', 'N/A')
            return f"[{self.created_log_at.strftime('%Y-%m-%d %H:%M')}] Action: {action} on {target} ({pk})"
        except json.JSONDecodeError:
            # Xử lý nếu dữ liệu không phải là JSON (có thể do lỗi cũ)
            return f"Log ID {self.pk} - INVALID JSON"


#==========================================REALTIME CHAT MODELS==========================================================
class Conversation(models.Model):
    id=models.BigAutoField(primary_key=True, editable=False)
    is_group=models.BooleanField(default=False) 
    created_at=models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"Conversation {self.id}"
    
class ConversationMember(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    user=models.ForeignKey(User, on_delete=models.CASCADE)
    last_read_message = models.ForeignKey("Message",null=True,blank=True,on_delete=models.SET_NULL) #ondelete set null để khi message bị xóa thì trường này sẽ null
    joined_at=models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"{self.user.username} in Conversation {self.conversation.id}"
    class Meta:
        unique_together = ('conversation', 'user') # đảm bảo mỗi user chỉ tham gia 1 lần trong 1 conversation

class Message(SafeDeleteModel):
    _safedelete_policy = SOFT_DELETE_CASCADE
    conversation=models.ForeignKey(Conversation, on_delete=models.CASCADE)
    sender=models.ForeignKey(User, on_delete=models.CASCADE)
    content=models.TextField()
    message_type = models.CharField( #ô chọn
        max_length=20,
        choices=(('text', 'Text'), ('image', 'Image'), ('file', 'File')),
        default='text'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"Message {self.content} in Conversation {self.conversation.id} by {self.sender.username}"

class MessageAttachment(models.Model): #phục vụ gửi file, hình ảnh trong chat
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='chat/')
    file_type = models.CharField(max_length=20) 


class MessageRequest(models.Model): #model để lưu lời mời nhắn tin vào hộp thư phụ
    from_user = models.ForeignKey(User, related_name='sent_requests', on_delete=models.CASCADE)
    to_user = models.ForeignKey(User, related_name='received_requests', on_delete=models.CASCADE)
    content=models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"Message Request from {self.from_user.username} to {self.to_user.username}"