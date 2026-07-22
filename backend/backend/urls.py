"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path,include
from django.conf.urls.static import static
from django.conf import settings 
from api.google_login import *
from api.views import *
from api.view_v2 import *
from api.reactions import PostViewSet,CommentViewSet
from api.custome_authen import * 
# from realtime.views import views
#------------------------------------------
#spectacular
from django.contrib.auth import views as auth_views
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView,SpectacularRedocView
#--------------------------------------------
#api http_only
from api.http_only import *
from api.throttle import *
from rest_framework.routers import DefaultRouter
#api custome_authen
from api.custome_authen import CheckPassword,DeleteAccount
#url cho reactions
router=DefaultRouter()
router.register(r'api/posts',PostViewSet,basename='post-reactions') #thả react
router.register(r'api/comments',CommentViewSet,basename='comment-reactions')
urlpatterns = [
    path('i18n/', include('django.conf.urls.i18n')),  # dịch ngôn ngữ
    path('supremacy/admin/', admin.site.urls),
    path('',include('api.urls')), # muốn tạo v1,v2 thì nên đem cái urls này vào api.urls, sau đó tạo app mới và include vào đây là v2.Ví dụ path('v1',include('api.urls')), path('v2',include('api2.urls'))
    #url của dj-rest-auth và allauth và simplejwt  để authentication (allauth là cái logic, dj rest auth là cái dùng allauth tạo api để gọi)
    path('api/auth/registration/',CustomeRegisterView.as_view(), name='custom_register'),#có throttle
    path('api/auth/password/reset/',CustomePasswordResetView.as_view(), name='custom_password_reset'),#có throttle
    path('api/auth/',include('dj_rest_auth.urls')),
    path('api/auth/registration/',include('dj_rest_auth.registration.urls')), #đăng kí, mail verify
    path('api/auth/account/',include('allauth.socialaccount.urls')), #đăng nhập google/fb
    path('api/auth/google/login/', GoogleLogin.as_view(), name='google_login'),
    path('api/auth/google/connect/',GoogleConnect.as_view(), name='google_connect'),
    path("api/auth/google/disconnect/", GoogleDisconnect.as_view(), name="google_disconnect"),
    path("api/password/reset/confirm/<uidb64>/<token>/",auth_views.PasswordResetConfirmView.as_view(),name="password_reset_confirm",),
    path('api/auth/check-password/',CheckPassword.as_view(),name='check-password'), #check password có đúng
    path('api/auth/has-password/',HasPassword.as_view(),name='has-password'), #check có mật khẩu không(user google k có)
    path('api/auth/delete-account/',DeleteAccount.as_view(),name='delete-account'),
    path('api/email/cofirm-delete-account/', ConfirmDeleteAccount.as_view(), name='delete-account'),
    path('api/auth/google/login/', GoogleLogin.as_view(), name='google_login'),
    #url cho cookie http-only, dùng cho mobile thì dùng mặc định api/auth/login,logout,refresh 
    path('api/auth/web/login/', CookieLoginView.as_view(), name='cookie_login'), #login cho cookie
    path('api/auth/web/logout/', CookieLogoutView.as_view(), name='cookie_logout'), #logout cho cookie
    path('api/auth/web/token/refresh/', CookieTokenRefreshView.as_view(), name='cookie_refresh'),#refresh token cho cookie
    path('api/auth/web/google/login/', CookieGoogleLoginView.as_view(), name='cookie_google_login'),#gg login cho cookie
    #URL ACTIVITY STREAM ĐỂ GHI LOG
    path('api/activity/', include('actstream.urls')),
    #url cho xử lý người dùng
    path('api/user/profile/<int:pk>/',ProfileModify.as_view(),name='profile-modify'), #lấy ra infor ng dùng thêm sửa xóa
    path('api/user/private-profile/<int:pk>/', PrivateProfileModify.as_view(),name='private-profile-modify'), #sửa thông tin mật ng dùng
    path('api/user/profile/',ProfileList.as_view(), name='profile-list'), #lấy tất cả user
    path('api/auth/profile/userpage/<int:user>', ProfileUser.as_view(), name='user-info'), #lấy ra thông tin userpage
    path('api/user/',ProfileView.as_view(),name='profile-view'), #lẩy ra thông tin user hiện tại
    path('api/user/pending-profile/',PendingProfileList.as_view(), name='pending-profile-list'), #lấy ra tất cả pending profile
    #url liên qua post
    path('api/user/post-photo/<int:post_id>/',PostPhotoListCreate.as_view(),name='post-photo'), #thêm lấy ra ảnh của post cụ thể \
    path('api/user/post-photo/',PostPhotoUser.as_view(),name='photo-user'), #lấy ra tất cả ảnh user
    path('api/user/delete-photo/<int:pk>/',PostPhotoDelete.as_view(),name='post-photo-delete'), #xóa ảnh cụ thể phục vụ chức năng chỉnh sửa post 
    path('api/user/post/<int:pk>/',PostModify.as_view(), name='post-modify'), #sửa xóa post cụ thể
    path('api/user/post/show/', PostFriend.as_view(), name='post-friend'), #Láy ra post của bạn bè
    path('api/user/post/userpage/<int:user>/', PostUser.as_view(), name='post-user'),#lấy ra tất cả post của chính user đó
    path('api/user/post/create/',PostCreate.as_view(),name='post-create'), #tạo post để gán ảnh
    path('api/admin/post/',PostListAll.as_view(), name='post-list'), #láy ra tất cả post cho admin
    path('api/share/<str:share_code>/', PostShareView.as_view(),name='share-post'),# dạng share link
    path('api/share-detail/<str:share_code>/', PostShareDetailView.as_view(),name='share-post-detail'),# dạng share link
    path('api/post/<int:post_id>/privacy-change/',ChangePostPrivacy.as_view(),name='change-privacy'),#đổi chế độ xem post
    path('api/posts/<int:post_id>/share/', AllPostShareView.as_view(),name='all-share-post'), # list share post và create share post
    path('api/posts/share/<int:pk>/delete/', PostUserShareDelete.as_view(),name='uesr-delete-share-post'), # xóa share post
    path('api/posts/user/<int:user_id>/share/',PostUserShare.as_view(),name='user_share'),# lấy ra tất cả share của user
    path('api/posts/share/', PostFriendShare.as_view(), name='user_share'), # lấy ra tất cả share của bạn bè
    path('api/post/share/<int:share_id>/privacy-change/',ChangePostSharePrivacy.as_view(),name='change-share-privacy'),#đổi chế độ xem share post
    path('api/post/<int:pin_id>/pin/',PinPostView.as_view(),name='pin-post'),
    path('api/post/<int:post_id>/report/',PostReportView.as_view(),name='post-report'),
    # v2-test full chức năng tạo post va ảnh trong 1 api
    path('api/user/post/create/v2/', CreateFullPostView.as_view(), name='post-create-v2'),# v2 của tạo post
    #url post-article
    path('api/user/post-article/', PostArticleListCreate.as_view(), name='post-article-list'), #thêm láy tất cả post article
    path('api/user/post-article/<int:pk>/', PostArticleModify.as_view(), name='post-article-modify'), # lấy ra post article cụ thể
    #url comment
    path('api/user/comments/post/<int:post_id>/',CommentListCreate.as_view(),name='comment-list'), #lấy Thêm comments từ post cụ thể
    path('api/user/comments/<int:pk>/',CommentModify.as_view(),name='comment-modify'), #xoá sửa comment
    path('api/user/comment/<int:pk>/detail/',CommentDetail.as_view()),#lấy comment từ id
    path('api/user/comment/pin/<int:pin_id>/',PinCommentView.as_view(),name='pin-comment'), #pin comment
    path('api/user/nested-comments/<int:pk>/',NestedCommentList.as_view(),name='nested-comment'), # list các nested từ comment cha
    path('api/comment/<int:comment_id>/report/', CommentReportView.as_view(), name='comment-report'),
    #url setting
    path('api/user/setting/<int:pk>/',SettingModify.as_view(), name='setting-modify'),# setting của user
    path('api/user/setting/',UserSetting.as_view(),name='user-setting'),#setting user hiện tại
    #url xử lý bạn bè, follow
    path("api/friends/request/<int:pk>/", SendFriendRequestView.as_view(), name="send-friend-request"), #gửi lời mời kết bạn
    path("api/friends/requests/incoming/", IncomingFriendRequestsView.as_view(), name="incoming-requests"), #lấy ra lời mời kết bạn đã nhận
    path("api/friends/requests/outgoing/", OutgoingFriendRequestsView.as_view(), name="outgoing-requests"), #lấy ra lời mời đã gửi đi
    path("api/friends/request/<int:pk>/accept/", AcceptFriendRequestView.as_view(), name="accept-request"), # chấp nhận lời mời
    path("api/friends/request/<int:pk>/reject/", RejectFriendRequestView.as_view(), name="reject-request"), # từ chối lời mới
    path("api/friends/request/<int:pk>/cancel/", CancelFriendRequestView.as_view(), name="cancel-request"), # hủy lời mời
    path("api/friends/unfriend/<int:pk>/", UnfriendView.as_view(), name="unfriend"), #xóa kết bạn
    path("api/friends/", FriendListView.as_view(), name="friends-list"), #lấy ra danh sách bạn bè của mình
    path("api/friends/<int:pk>/", FriendUser.as_view(), name="friends-user"), #lấy ra danh sách bạn bè cụ thể
    path("api/follow/<int:pk>/", FollowView.as_view(), name="follow"), #theo dõi người dùng
    path("api/unfollow/<int:pk>/", UnfollowView.as_view(), name="unfollow"), #hủy theo dõi người dùng
    path("api/followers/", FollowersListView.as_view(), name="followers"), #lấy ra danh sách người theo dõi
    path("api/following/", FollowingListView.as_view(), name="following"), #lấy ra danh sách đang theo dõi
    path('api/block/<int:pk>/',BlockView.as_view(),name='block'), # block 1 người
    path('api/unblock/<int:pk>/',UnblockView.as_view(),name='unblock'), #unblock 1 người
    path('api/block/touser/',ListBlockedUser.as_view(),name='listblocktouser'), #danh sách người block user
    path('api/block/user/',ListBlockedFromUser.as_view(),name='listblockfromuser'), #danh sách block của user
    #url lấy ra user đã react và activity
    path('api/user/reaction/post/<int:post_id>/',UserReactionPostList.as_view(),name='user-reaction-post'), #lấy ra tất cả user đã thẻ react post
    path('api/user/reaction/comment/<int:comment_id>/',UserReactionCommentList.as_view(),name='user-reaction-comment'), #lấy ra tất cả user đã thẻ react commment
    path('api/user/activity/', UserActivity.as_view(), name='user-activity'), #lấy ra lịch sử hoạt động của user hoặc tất cả user
    path('api/admin/logs/', LogList.as_view(), name='log-list'), #lấy ra tất cả log cho admin
    # url cho chat
    path('api/chat/messages/unsend/<int:pk>/', UnsendMessageAPIView.as_view(), name='unsend-message'), # thu hồi tin nhắn
    path('api/chat/conversations/', ConversationListAPIView.as_view(), name='conversation-list'), #danh sách cuộc trò chuyện của user
    path('api/chat/search-conversations/', ConversationSearch.as_view(), name='conversation-search'), #search danh sách cuộc trò chuyện của user
    path('api/chat/start/<int:user_id>/', StartConversationAPIView.as_view(), name='conversation-start'), #bắt đầu cuộc trò chuyện mới
    path('api/chat/accept/conversation/<int:conv_id>/',AcceptMessageRequest.as_view(),name='accept-conversation'), #accept tin nhắn ng lạ
    path('api/chat/reject/conversation/<int:conv_id>/',RejectMessageRequest.as_view(),name='reject-conversation'), #reject tin nhắn người lạ
    path('api/chat/messages/list/<int:pk>/', ConversationMessage.as_view(), name='message-list'), #danh sách tin nhắn trong cuộc trò chuyện cụ thể
    path('api/chat/conversation/members/<int:pk>/', MemberOfConversation.as_view(), name='conversation-members'), #danh sách thành viên trong cuộc trò chuyện
    path('api/chat/messages/seen/<int:pk>/', SeenMessage.as_view(), name='mark-message-seen'), #đánh dấu tin nhắn đã xem
    path('api/chat/messages/update/<int:pk>/', UpdateMessage.as_view(), name='update-message'), #cập nhật tin nhắn đã gửi
    path('api/chat/conversation/<int:pk>/delete/',DeleteConversationOneSide.as_view(),name='delete-message-oneside'), # xóa chat 1 phía
    path('api/chat/conversation/<int:pk>/toogle-hidden/',ToogleHideConversation.as_view(),name='toogle-hidden'), # tắt/bật ần chat vĩnh viển
    path('api/chat/conversation/hidden-chat/',ListHideConversation.as_view(),name='hidden-chat'),# url hiện tất cả đoạn chat ẩn
    path('api/chat/conversation/<int:conv_id>/upload/',ChatAttachmentUpload.as_view(),name='upload-file'),
    path('api/chat/conversation/<int:conv_id>/file-list/', GetFileFromConversation.as_view()),
    #Chat group
    path('api/chat/conversation/group/create-group/',CreateGroupConversation.as_view(),name='create-group-chat'),
    path('api/chat/conversation/group/<int:conv_id>/transfer-admin/',TransferAdminGroupChat.as_view(),name='transfer-admin-chat'),
    path('api/chat/conversation/group/<int:conv_id>/add/',AddMemberGroupChat.as_view(),name='add-member-chat'),
    path('api/chat/conversation/group/<int:conv_id>/modify/',ModifyGroupChat.as_view(),name='modify-group-chat'),
    path('api/chat/conversation/group/<int:conv_id>/delete/',DeleteGroupChat.as_view()),
    path('api/chat/conversation/group/<int:conv_id>/kick/<int:kick_id>/',KickMemberGroupChat.as_view()),
    path('api/chat/conversation/<int:conv_id>/leave/',LeaveGroupChat.as_view()),
    #fire base notification
    path("api/fcm-token/", SaveFCMTokenView.as_view()), # token cho thiết bị
    #in-app notification
    path("api/notifications/", NotificationListView.as_view(), name="notification-list"), #thống báo user
    path("api/notifications/mark-read/",NotificationMarkReadView.as_view(),name="notification-mark-read"),
    path("api/notifications/count/",NotificationUnreadCountView.as_view(),name="notification-unread-count"),
    path("api/notification/<int:pk>/delete/", NotificationDelete.as_view(), name="notification-delete"),#delete notification bất kì
    #check mqh
    path('api/relationship/<int:profile_id>/',ProfileRelationship.as_view(),name='relationship'), # check mqh
    #thay đổi email 
    path('api/user/email/',UserEmail.as_view(),name='user-email'), #list các email
    path('api/email/add/',AddEmailView.as_view(),name='add-email'), #add email
    path('api/email/set/<int:pk>/',SetPrimaryEmailView.as_view(),name='add-email'), #set làm email mặc đinh
    path('api/email/delete/<int:pk>/',DeleteEmailView.as_view(),name='delete-email'), #xóa email
    path('api/email/confirm-change-primary/', ConfirmChangePrimaryEmail.as_view()), #otp khi đổi email
    #search
    path('api/search/', SearchAPIView.as_view(),name='search'),# search api/search/?q=
    path('api/user/search-history/',SearchHistoryView.as_view(),name='search-history'), #lịch sủ tìm kiếm
    path('api/search-history/delete/', SearchHistoryDeleteAllView.as_view(),name='search-history-delete-all'), #xóa tất cả search
    path('api/search-history/<int:pk>/delete/', SearchHistoryDeleteView.as_view(),name='search-history-delete'), #xóa search bất kì
    #friendsuggest
    path('api/user/friend-suggest/',FriendSuggestion.as_view(),name='friend-suggest'), # gợi ý bạn bè
    #support
    path('api/support/', SupportTicketView.as_view()), #user gửi lên ticket và nhân viên check reply qua mail sau đó
    #url cho task group chat
    path('api/chat/conversation/task/<int:conv_id>/create-task/',CreateTaskGroupChat.as_view()), #taọ task
    path('api/chat/conversation/task/<int:conv_id>/add-member/',AddMemberIntoTaskGroupChat.as_view()), # thêm member vào task
    path('api/chat/conversation/<int:conv_id>/task/<int:task_id>/member/',MemberofTaskGroupChat.as_view()), # lấy ra các member của task
    path('api/chat/conversation/<int:conv_id>/task/<int:task_id>/update/',UpdateTaskGroupChat.as_view()), #update task
    path('api/chat/conversation/<int:conv_id>/task/<int:task_id>/delete/',DeleteTaskGroupChat.as_view()), #xóa task
    path('api/chat/conversation/task/<int:conv_id>/list-task/',ListTaskGroupChat.as_view()), #list các task trong group
    #url cho vote groupchat
    path('api/chat/conversation/vote/<int:conv_id>/create-vote/',CreateVoteGroupChat.as_view()), # taọ vote
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/delete-vote/',DeleteVoteGroupChat.as_view()), #xóa vote
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/option/<int:vote_option_id>/vote/',UserVoteGroupChat.as_view()), # vote cho option
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/update-vote/',UpdateVoteGroupChat.as_view()), # update vote
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/add-option/',AddOptionVoteGroupChat.as_view()), # thêm option
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/option/<int:option_id>/update-option/',UpdateOptionVoteGroupChat.as_view()), #update option
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/option/<int:option_id>/delete-option/',DeleteOptionVoteGroupChat.as_view()), #xóa option
    path('api/chat/conversation/<int:conv_id>/vote/list-vote/',ListVoteGroupChat.as_view()), #list các vote trong group
    path('api/chat/conversation/<int:conv_id>/vote/<int:vote_id>/option/<int:option_id>/user/',ListUserVoteGroupChat.as_view()), # list các user vote đã vote option gì
    # call video
    path('api/chat/conversation/<int:conv_id>/call-video/create/', CreateVideoRoomView.as_view()),
    path('api/chat/conversation/<int:conv_id>/call-video/join/', JoinVideoRoomView.as_view()),
    path('api/chat/conversation/<int:conv_id>/call-video/decline/', DeclineCallView.as_view()),
    path('api/chat/conversation/<int:conv_id>/call-video/cancel/', CancelCallView.as_view()),
    path('api/livekit/webhook/', LiveKitWebhookView.as_view()),
    path('api/video/<int:conv_id>/status/', VideoRoomStatusView.as_view()),
    path('api/video/<int:conv_id>/leave/', LeaveCallView.as_view()),

    #SCHEDULE TASK
    path('api/chat/conversation/<int:conv_id>/create-event/', ListCreateEventChat.as_view()),
    path('api/chat/conversation/<int:conv_id>/event/<int:event_id>/', EventDetailChat.as_view()),# sửa, xóa, detail
    path('api/chat/conversation/<int:conv_id>/event/<int:event_id>/update-status/',EventResponseChat.as_view()),
    path('api/chat/conversation/<int:conv_id>/event/<int:event_id>/participants/', EventParticipantChat.as_view()), # thành viên tham gia event participant
    #GROUP
    path('api/group/create/',CreateGroup.as_view()), # tạo group
    path('api/group/<int:group_id>/detail/',GroupDetailView.as_view()),# view group page
    path('api/group/<int:group_id>/update/',UpdateGroup.as_view()),
    path('api/group/<int:group_id>/delete/',DeleteGroup.as_view()),
    path('api/group/user/group/',ListGroupUser.as_view()), #lấy tất cả group của user
    path('api/group/explore/',ListGroupSuggestion.as_view()), # lấy danh sách group chưa tham gia (khám phá)
    path('api/group/<int:group_id>/user-list/',ListUserGroup.as_view()),#list tất cả user của group
    path('api/group/<int:group_id>/department/<int:department_id>/add-role/',AddRoleGroup.as_view()),# add role vào department
    path('api/group/<int:group_id>/department-add/', AddDepartmentGroup.as_view()), # add department
    path('api/group/<int:group_id>/role/<int:role_id>/', UpdateRoleGroup.as_view()),# update/delete role
    path('api/group/<int:group_id>/department/<int:department_id>/',UpdateDepartmentGroup.as_view()), #update/delete department
    path('api/group/<int:group_id>/user/<int:user_id>/add-role/',AddMemberIntoJobRole.as_view()), # thêm thành viên vào role
    path('api/group/<int:group_id>/department-list/',ListDepartmentGroup.as_view()), #list tất cả department
    path('api/group/<int:group_id>/department/<int:department_id>/role/',ListRoleGroup.as_view()), #list tất cả role trong department
    path('api/group/<int:group_id>/department/<int:department_id>/user-list/',ListUserDepartmentGroup.as_view()), #list các user trong department
    path('api/group/<int:group_id>/department/<int:department_id>/role/<int:role_id>/user-list/',ListUserRoleGroup.as_view()), #list các user trong role
    path('api/group/<int:group_id>/send-request/',SendJoinRequestGroup.as_view()), # gửi lời mời tham gia
    path('api/group/<int:group_id>/cancel-request/',CancelJoinRequestGroup.as_view()), #cancel request
    path('api/group/my-requests/',MyJoinRequestList.as_view()), # yêu cầu tham gia của tôi
    path('api/group/<int:group_id>/all-request/',AllJoinRequest.as_view()), #tất cả request
    path('api/group/<int:group_id>/request/<int:request_id>/accept/',AcceptJoinRequest.as_view()), #accept requyest
    path('api/group/<int:group_id>/request/<int:request_id>/reject/',RejectJoinRequest.as_view()), #reject request
    path('api/group/<int:group_id>/user/<int:user_id>/kick/',KickMemberGroup.as_view()), #kick user
    path('api/group/<int:group_id>/user/<int:user_id>/delete-all-posts/',DeleteALlPostMemberGroup.as_view()), # delete all posts of member
    path('api/group/<int:group_id>/user/<int:user_id>/add-admin/',AddAdminGroup.as_view()), # thêm admin
    path('api/group/<int:group_id>/user/<int:user_id>/remove-admin/',RemoveAdminGroup.as_view()), # xóa admin
    path('api/group/<int:group_id>/leave/',LeaveGroup.as_view()), # leave group
    path('api/group/<int:group_id>/create-post/',CreatePostGroup.as_view()), # tạo post group
    path('api/group/<int:group_id>/post/<int:post_id>/delete/',DeletePostGroup.as_view()), # xóa post group
    path('api/group/<int:group_id>/post/<int:post_id>/update/',UpdatePostGroup.as_view()), # update post group
    path('api/group/<int:group_id>/post/list/',PostListGroup.as_view()), # list post group
    path('api/group/<int:group_id>/post/<int:post_id>/pin/',PinPostGroup.as_view()), # pin post
    path('api/group/<int:group_id>/post-user/',PostUserGroup.as_view()), # tất cả post user đã đăng trong group
    path('api/group/<int:group_id>/review-post/list/',PostReviewGroupList.as_view()), # list các post cần duyệt
    path('api/group/<int:group_id>/post/<int:post_id>/review/',ReviewPostGroup.as_view()), # duyệt group
    path('api/group/<int:group_id>/post/<int:post_id>/highlight/',MakeNotification.as_view()), # thông báo nổi bật của admin
    path('api/group/<int:group_id>/admin-list/',AdminGroup.as_view()), # list admin
    path('api/group/<int:group_id>/post/<int:post_id>/detail/',PostGroupDetail.as_view()), # lấy ra post từ notification nếu user đã tham gia group
    path('api/group/<int:group_id>/search/',SearchInGroup.as_view()), # search trong group
    path('api/group/<int:group_id>/photos/',PhotoInGroup.as_view()), # ảnh trong group

    path('api/group/<int:group_id>/create-vote/',CreateVoteGroup.as_view()), # tạo vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/delete/',DeleteVoteGroup.as_view()), # xóa vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/option/<int:vote_option_id>/vote/',UserVoteGroup.as_view()), #user thực hiện vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/update/',UpdateVoteGroup.as_view()), # update vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/add-options/',AddOptionVoteGroup.as_view()), # thêm option vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/option/<int:option_id>/update/',UpdateOptionVoteGroup.as_view()), #update option
    path('api/group/<int:group_id>/vote/<int:vote_id>/option/<int:option_id>/delete/',DeleteOptionVoteGroup.as_view()), #xóa option
    path('api/group/<int:group_id>/list-vote/', ListVoteGroup.as_view()),  # lấy all vote
    path('api/group/<int:group_id>/vote/<int:vote_id>/option/<int:option_id>/user-list/',ListUserVoteGroup.as_view()), #tất cả user đã list của option
    path('api/group/<int:group_id>/vote/<int:vote_id>/detail/', DetailVoteGroup.as_view()),  # detail vote

    path('api/group/<int:group_id>/event/', ListCreateEventGroup.as_view()), #list, tạo event
    path('api/group/<int:group_id>/event/<int:event_id>/', EventDetailGroup.as_view()),# sửa, xóa, detail
    path('api/group/<int:group_id>/event/<int:event_id>/update-status/',EventResponseGroup.as_view()), #phản hồi sự kiện
    path('api/group/<int:group_id>/event/<int:event_id>/participants/',EventParticipantGroup.as_view()),

    path('api/group/<int:group_id>/create-suggestion/', CreateSuggestionGroup.as_view()), #list, tạo event
    path('api/group/<int:group_id>/list-suggestion/', ListSuggestionGroup.as_view()), #list, tạo event
] + router.urls


#debug toolbar và silk 
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += [path('silk/', include('silk.urls', namespace='silk'))] #silk , Nhớ migrate
    from django.contrib.staticfiles.urls import staticfiles_urlpatterns
    urlpatterns += staticfiles_urlpatterns() #static file để gom các js, css của các thư viện vào 1 chỗ, dùng cho nginx và daphne để production 
    #url spectacular
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path(
            "api/docs/",
            SpectacularSwaggerView.as_view(url_name="schema"),
            name="swagger-ui",
        ),
        path(
            "api/redoc/",
            SpectacularRedocView.as_view(url_name="schema"),
            name="redoc",
        ),
    ]