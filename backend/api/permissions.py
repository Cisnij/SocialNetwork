from rest_framework.permissions import BasePermission
from .models import ConversationMember
class IsConversationMember(BasePermission):
    def has_permission(self, request, view):
        convo_id = view.kwargs.get("pk")
        if not convo_id:
            return False

        return ConversationMember.objects.filter(
            conversation_id=convo_id,
            user=request.user
        ).exists()
