from django.db import models
from django.contrib.auth.models import User
from autoslug import AutoSlugField  #pip install django-autoslug
# Create your models here.
import uuid
from phonenumber_field.modelfields import PhoneNumberField

class Profile(models.Model):
    id=models.BigAutoField(primary_key=True, editable=False)
    user=models.OneToOneField(User,on_delete=models.CASCADE)
    name=models.CharField(max_length=50,null=True)
    email=models.CharField(max_length=50,null=True)
    picture=models.ImageField(null=True, default="default.jpg")
    date_of_birth=models.DateField(null=True)
    phone_number=PhoneNumberField(null=True,blank=True)
    bio=models.CharField(max_length=50,null=True,blank=True)
    friends=models.ManyToManyField('self', blank=True,symmetrical=True)#symmetrical=True (mặc định): Nếu A là bạn B → B tự động là bạn A, di voi self
    def __str__(self):
        return self.user.username

class Post(models.Model):
    post_id= models.BigAutoField(primary_key=True, editable=False)
    user=models.ForeignKey(User,on_delete=models.CASCADE)
    title=models.CharField(max_length=200, null=False)
    created_at=models.DateTimeField(auto_now_add=True)
    slug= AutoSlugField(populate_from='title',unique_with='created_at')# unique_with xử lý unique nếu cùng time
    def __str__(self):
        return f"{self.user}-{self.title}"

class Like(models.Model):
    user=models.ForeignKey(User, on_delete=models.CASCADE)
    post=models.ForeignKey(Post,on_delete=models.CASCADE)    
    def __str__(self):
        return f"{self.user} liked {self.post.title}"
    #Mối quan hệ unique dùng unique_together
    class Meta:
        unique_together=('user','post') 
    

class Comment(models.Model):
    user= models.ForeignKey(User, on_delete=models.CASCADE)
    post=models.ForeignKey(Post,on_delete=models.CASCADE)
    content=models.CharField(max_length=200, null=False)
    created_at=models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"{self.user.username} commented on {self.post.title}"

class Setting(models.Model):
    darkmode=models.BooleanField(default=False)
    user=models.OneToOneField(User, on_delete=models.CASCADE)
    def __str__(self):
        return f"Setting of {self.user.username}"

class AddFriendRequest(models.Model):
    sender=models.ForeignKey(User,on_delete=models.CASCADE,related_name="sender")
    receiver=models.ForeignKey(User, on_delete=models.CASCADE, related_name="receiver")
    created_at=models.DateTimeField(auto_now_add=True)
    status=models.BooleanField(default=False)
    def __str__(self):
        return f"{self.sender} send request to {self.receiver}"
    

class Log(models.Model): #sau này dùng django-activity-stream 
    user=models.ForeignKey(User, on_delete=models.CASCADE)
    logtext=models.CharField(max_length=200, null=False)
    created_log_at=models.DateTimeField(auto_now_add=True)
    def __str__(self):
        return f"Log of {self.user.username}"