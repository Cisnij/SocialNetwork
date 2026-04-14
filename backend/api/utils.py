# utils.py
from django.db.models import Count
from api.models import Post, Comment
from django.contrib.contenttypes.models import ContentType
from reaction.models import Reaction, UserReaction
from collections import defaultdict
'''mục đích là để khi gọi view thì thực hiện query vài lần lấy luôn tất cả total reaction và user reaction thay vì
gọi n lần liên tục tương ứng với n post'''
def get_reactions_post_context(queryset, user):
    post_ids = queryset.values_list('post_id', flat=True)
    ct = ContentType.objects.get_for_model(Post) #lấy ra contenttype của post

    # Lấy tất cả reactions của tất cả posts trong 1 query
    reactions = (
        Reaction.objects.filter(content_type=ct, object_id__in=post_ids) # trong từng post thì lấy ra total
        .select_related('settings')
        .values('object_id', 'settings__name') # lấy ra 2 fields này dạng dict
        .annotate(total=Count('reactions')) #group by theo 2 field trên và đếm , annotate tính toán ở db nên nhanh hơn, trả ra field total (tính băng related name của user reaction là reactions)
    ) # trả dữ liệu kiểu like:1 love:2 ...của từng post

    # Group by post_id
    reactions_map = defaultdict(list) # tạo 1 dict có chứa list kiểu { 1: [] }

    for r in reactions: # thêm các post đã lọc reaction và map trên và trẻ về cho serializer
        reactions_map[r['object_id']].append({
            'settings__name': r['settings__name'],
            'total': r['total']
        }) #{ 1: [{'settings_name': like },{'total':2}] ... }

    # Lấy reaction của user hiện tại trong 1 query
    user_reactions = (
        UserReaction.objects.filter(
            user=user,
            reaction__content_type=ct,
            reaction__object_id__in=post_ids
        )
        .select_related('reaction__settings')
        .values('reaction__object_id', 'reaction__settings__name') # chỉ trả về 2 thằng này vào list  [{},{}] , [{},{}]
    )
    user_reactions_map = {
        r['reaction__object_id']: r['reaction__settings__name'] # sẽ thành 1: like
        for r in user_reactions
    }

    return {
        'reactions_map': dict(reactions_map),
        'user_reactions_map': user_reactions_map,
    }

def get_reactions_comment_context(queryset,user):
    comment_ids=queryset.values_list('id', flat=True)
    ct= ContentType.objects.get_for_model(Comment)
    reactions=(
        Reaction.objects.filter(content_type=ct, object_id__in=comment_ids)
            .select_related('settings')
            .values('object_id', 'settings__name')
            .annotate(total=Count('reactions'))
    )
    reactions_map=defaultdict(list)
    for r in reactions:  # thêm các post đã lọc reaction và map trên và trẻ về cho serializer
        reactions_map[r['object_id']].append({
            'settings__name': r['settings__name'],
            'total': r['total']
        })  # { 1: [{'settings_name': like },{'total':2}] ... }

    user_reaction=(
        UserReaction.objects.filter(
            user=user,
            reaction__content_type=ct,
            reaction__object_id__in=comment_ids
        )
        .select_related('reaction__settings')
        .values('reaction__object_id', 'reaction__settings__name') # chỉ trả về 2 thằng này vào list  [{},{}] , [{},{}]
    )
    user_reactions_map={
        r['reaction__object_id']: r['reaction__settings__name'] for r in user_reaction
    }
    return {
        'reactions_map': dict(reactions_map),
        'user_reactions_map': user_reactions_map,
    }