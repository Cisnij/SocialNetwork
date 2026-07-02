from django.apps import AppConfig
from django.db import models
#Phần khởi động đầu tiên khi chạy app

class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    
    def ready(self):
        #Chạy signals signals
        import api.signals

        #chạy activity stream 
        from django.contrib.auth import get_user_model
        from actstream import registry
        from .models import Profile, Post, PostArticle, Comment,Conversation,Message,Notification,SearchHistory,PostShare,Report,SupportTicket,Task,Vote,VideoRoom,Event,ConversationMember
        from reaction.models import UserReaction
        from friendship.models import Friend, FriendshipRequest,Follow,Block
        
        #registry để giúp đăng ký các model với activity stream ghi log
        registry.register(get_user_model()) #đăng ký model User
        registry.register(Profile, Post, PostArticle, Comment, UserReaction, Friend, FriendshipRequest, Follow, Block, Conversation,Message,Notification,SearchHistory,PostShare,Report,SupportTicket,Task,Vote,VideoRoom,Event,ConversationMember)
        
        #import firebase
        from api.firebase import init_firebase#file firebase.py đã tạo 
        init_firebase()
        #auditlog
        import api.auditlog
        #rules
        import api.rules
        
    



