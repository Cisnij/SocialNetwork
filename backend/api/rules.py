import rules
from friendship.models import Friend

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
#==========================================================KẾT HỢP===================================================
# @rules.predicate
# def is_community_admin(user,community):
#     return CommunityMember.objects.filter(user=user,community=community,is_admin=True).exists()

#RULE được xem
can_view_post= is_post_author | is_public_post | (is_friend & is_friends_post) # phải thoả là bạn và post có chế độ là friends
can_edit_post= is_post_author | rules.is_staff
# #RULE dùng cho community
# can_accept_community_post= rules.is_staff | is_community_admin
#===============================================================ĐĂNG KÍ==============================================

rules.add_perm('api.view_post',can_view_post) # posts.view_post là name tự đặt
rules.add_perm('api.edit_post',can_edit_post)
# rules.add_perm('api.accept_community_posts',can_accept_community_post)
