from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.contenttypes.models import ContentType
from reaction.models import Reaction
from .models import Post, Comment
from reaction.models import Reaction, ReactionSettings, UserReaction
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count
#flow: nhấn like, kiểm tra reactiontype, ko có thì trả về lỗi, có thì check trong reaction setting có cái type đó k, nếu có thì tạo ra reactions sau đó check nếu nhấn 2 lần thì hủy, đổi cảm xúc thì cập nhât
#reaction là bảng ghi đếm like nên sẽ k bị xóa, còn user reaction mới là cái record từng user và sẽ bị xóa nếu unlike
# nên dùng viewset nếu url dạng /api/post/id/react, và gom nhiều hành động trong 1 resource( ví dụ sau này comment share like), vì viewset tích hợp đc nhiều vào 1 class thay vì viết nhiều apiview con
class PostViewSet(viewsets.ViewSet): #ViewSet khác modelViewSet là nó không cung cấp sẵn crud mà mình tự định nghĩa qua @action
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=['post']) #tạo ra url riêng biệt cho post, detail= True để cho phép truyền tham số vào url
    def react(self, request, pk=None): #tên react sẽ tạo ra url có tên nó vì dùng @action,pk null tránh lỗi khi k truyền, có thì sẽ có giá trị
        reaction_type = request.data.get("reaction_type")
        if not reaction_type:
            return Response({"detail": "reaction_type is required"}, status=400)
        try: # nếu k có type đó trong setting sẽ lỗi
            reaction_setting = ReactionSettings.objects.prefetch_related('react_emoji').get(name=reaction_type)
        except ReactionSettings.DoesNotExist:
            return Response({"detail": "Invalid reaction type."}, status=400)

        post = get_object_or_404(Post, pk=pk)
        post_ct = ContentType.objects.get_for_model(Post) #lấy ra contentype cho model post

        def get_reaction_count():
            return list(  #count
                Reaction.objects.filter(content_type=post_ct, object_id=post.pk)
                .values("settings__name")          # group by theo tên reaction
                .annotate(total=Count("reactions"))  # đếm số user reaction và hiển thị ra total:...
            )
        with transaction.atomic():
            # Lấy hoặc tạo Reaction object (liên kết Post + loại reaction_setting)
            reaction, _ = Reaction.objects.select_related('settings').get_or_create( # dấu _ là biến báo nếu có create thì k cần trả về True/False
                content_type=post_ct,
                object_id=post.pk,
                settings=reaction_setting,#lẩy ra kiểu cảm xúc
            )

            # Tìm UserReaction hiện tại của user trên post này dựa vào bảng reaction
            user_reaction = UserReaction.objects.select_related('reaction__settings').filter(
                user=request.user,
                reaction__content_type=post_ct, #reaction__contenttype là vì mối quan hệ foreignkey
                reaction__object_id=post.pk,
            ).first()
            react_emoji = reaction_setting.react_emoji.first()
            # Nếu chưa react → tạo mới
            if not user_reaction:
                user_reaction = UserReaction.objects.create(
                    user=request.user,
                    reaction=reaction,
                    react= react_emoji # tạo mới và gán cho like default
                )
                return Response({
                    'count': get_reaction_count(),
                    "status": "added",
                    "reaction_type": reaction.settings.name,
                })

            # Nếu react cùng loại emoji → gỡ bỏ
            if user_reaction.reaction.settings == reaction_setting:
                user_reaction.delete()
                return Response({
                    'count': get_reaction_count(),
                    "status": "removed",
                    "reaction_type": reaction.settings.name,
                })

            # Nếu react loại khác → đổi sang loại mới, vì nó k phải cùng loại và không phải tạo mới thì gán luôn
            user_reaction.reaction = reaction
            user_reaction.react = react_emoji
            user_reaction.save(update_fields=["reaction", "react"])

        return Response({
            'count': get_reaction_count(),
            "status": "changed",
            "reaction_type": reaction.settings.name,
        })

class CommentViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=True,methods=['post'])
    def react(self,request,pk=None):
        reaction_type= request.data.get('reaction_type')
        if not reaction_type:
            return Response({"detail": "reaction_type is required"}, status=400)
        try:
            reaction_setting= ReactionSettings.objects.prefetch_related('react_emoji').get(name=reaction_type)
        except ReactionSettings.DoesNotExist:
            return Response({'error': 'Invalid reaction type.'}, status=400)
        comment = get_object_or_404(Comment,pk=pk)
        comment_ct=ContentType.objects.get_for_model(Comment)
        def get_reaction_count():
            return list(  #count
                Reaction.objects.filter(content_type=comment_ct, object_id=comment.pk)
                .values("settings__name")          # group by theo tên reaction
                .annotate(total=Count("reactions"))  # đếm số user reaction và hiển thị ra total:...
            )
        with transaction.atomic():
            reaction,_ = Reaction.objects.select_related('settings').get_or_create(
                content_type=comment_ct,
                object_id=comment.pk,
                settings=reaction_setting
            )
            user_reaction=UserReaction.objects.select_related('reaction__settings').filter(
                user=request.user,
                reaction__content_type=comment_ct,
                reaction__object_id=comment.pk,
            ).first()
            react_emoji = reaction_setting.react_emoji.first()
            if not user_reaction:
                UserReaction.objects.create(
                    user=request.user,
                    reaction=reaction,
                    react=react_emoji
                )
                return Response({
                    'count': get_reaction_count(),
                    "status": "added",
                    "reaction_type": reaction_setting.name,
                })
            if user_reaction.reaction.settings == reaction_setting:
                user_reaction.delete()
                return Response({
                    'count': get_reaction_count(),
                    "status": "removed",
                    "reaction_type": reaction_setting.name,
                })
            user_reaction.reaction=reaction
            user_reaction.react=react_emoji
            user_reaction.save()
            return Response({
                'count': get_reaction_count(),
                "status": "changed",
                "reaction_type": reaction_setting.name,
            })