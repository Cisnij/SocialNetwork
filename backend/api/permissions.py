
from rest_framework.permissions import BasePermission
from .models import ConversationMember
from rest_framework import permissions

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
            user=request.user,
            is_active=True
        ).exists()

class PostViewPermission(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if not request.user or request.user.is_anonymous: # user thường chỉ xem được post public
            return obj.privacy == 'public' # true nếu post là public không thì false
        if request.method == 'POST' or request.method in permissions.SAFE_METHODS: # các method xem an toàn như get,head,options
            return request.user.has_perm('api.view_post',obj)# kết nối với file rules xem có đc xem post và sharepost, truyền user ở request.user, truyền post ở obj
        return request.user.has_perm('api.edit_post',obj) # các method put patch delete thì check xem có đc edit, có thì true

#======================================GROUP===================================================
class IsMemberGroup(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.user.has_perm('group.is_member', obj)

class IsAdminOrOwnerGroup(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.user.has_perm('group.is_admin', obj)

class IsOwnerOnlyGroup(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.user.has_perm('group.is_owner', obj)
class CanDeletePost(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        group = obj.group
        return request.user.has_perm('group.delete_post', obj)
class CanEditPost(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return request.user.has_perm('group.edit_post', obj)