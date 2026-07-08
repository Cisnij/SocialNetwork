import rules
from api.models import GroupMember, Group
from friendship.models import Friend
from rules import is_active

'''
flow là đầu tiên định nghĩa predicate ở rules
đăng kí rule vào permission
view dùng lại cái permission
toàn bộ cái này chỉ dùng cho get_object tức là check khi xem 1 post cụ thể, còn list feed thì chỉ cần check có public,friends,only trong model
'''

@rules.predicate
def is_post_author(user,post):
    return post.user == user #return true nếu chủ post= chính user đó

@rules.predicate
def is_friend(user,post):
    if user.is_anonymous or not post:
        return False
    return Friend.objects.are_friends(user,post.user) #return True nếu là bạn

@rules.predicate
def is_public_post(user,post):
    return post.privacy == 'public' # return True nếu là public

@rules.predicate
def is_friends_post(user,post):
    return post.privacy == 'friends' #return True nếu là friends

#GROUP
@rules.predicate
def is_group_admin(user,obj):
    group_id = obj.id if isinstance(obj, Group) else getattr(obj, 'group_id', None) # nếu truyền vào object thì sẽ check obj có là is instance của group, kh thì lấy id từ obj đó ví dụ group_id từ group_member
    if user.is_anonymous or not group_id:
        return False
    return GroupMember.objects.filter(group_id=group_id,user=user,is_active=True,role='admin').exists()
@rules.predicate
def is_group_owner(user,obj):
    group_id = obj.id if isinstance(obj, Group) else getattr(obj, 'group_id', None)
    if user.is_anonymous or not group_id:
        return False
    return GroupMember.objects.filter(group_id=group_id,user=user,is_active=True,role='owner').exists()
@rules.predicate
def is_group_member(user,obj):
    group_id = obj.id if isinstance(obj, Group) else getattr(obj, 'group_id', None)
    if user.is_anonymous or not group_id:
        return False
    return GroupMember.objects.filter(group_id=group_id,user=user,is_active=True,role='member').exists()
@rules.predicate
def is_group_post_author(user,obj):
    return obj.user_id == user.id
#==========================================================KẾT HỢP===================================================
#RULE được xem
can_view_post= is_post_author | is_public_post | (is_friend & is_friends_post) # phải thoả là bạn và post có chế độ là friends
can_edit_post= is_post_author | rules.is_staff
#GROUP
have_all_rights = is_group_owner | is_group_admin
#===============================================================ĐĂNG KÍ==============================================

rules.add_perm('api.view_post',can_view_post) # posts.view_post là name tự đặt
rules.add_perm('api.edit_post',can_edit_post)
#GROUP
rules.add_perm('group.is_member',        is_group_member)
rules.add_perm('group.is_admin',         have_all_rights)
rules.add_perm('group.is_owner',         is_group_owner)
rules.add_perm('group.delete_post',      is_group_post_author | have_all_rights)
rules.add_perm('group.edit_post',        is_group_post_author)   # chỉ user tạo mới sửa
