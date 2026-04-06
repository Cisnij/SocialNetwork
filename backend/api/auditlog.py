#file ghi log security,lỗi hệ thống, những thay đổi từ old->new
from auditlog.registry import auditlog
from .models import Profile, Post, Comment, Message

auditlog.register(Profile)
auditlog.register(Post)
auditlog.register(Comment)
auditlog.register(Message)