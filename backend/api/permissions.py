from rest_framework.permissions import BasePermission
from .models import ConversationMember

class IsConversationMember(BasePermission):

    def has_permission(self, request, view):
        # ccheck đăng nhập trước, có thể bỏ vì view đã có isauthenticated rồi 
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj): #check quyền sau
        # obj có thể là Conversation hoặc Message tùy view truyền vào
        if hasattr(obj, 'conversation'):
            # obj là Message → lấy conversation từ đó
            conversation = obj.conversation
        else:
            # obj là Conversation
            conversation = obj

        return ConversationMember.objects.filter(
            conversation=conversation,
            user=request.user
        ).exists()