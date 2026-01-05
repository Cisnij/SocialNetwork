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
from api.reactions import PostViewSet
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

#url cho reactions
router=DefaultRouter()
router.register(r'posts',PostViewSet,basename='reactions')

urlpatterns = [
    path('supremacy/admin/', admin.site.urls),
    path('i18n/', include('django.conf.urls.i18n')),
    path('',include('api.urls')), # muốn tạo v1,v2 thì nên đem cái urls này vào api.urls, sau đó tạo app mới và include vào đây là v2.Ví dụ path('v1',include('api.urls')), path('v2',include('api2.urls'))
    #url của dj-rest-auth và allauth và simplejwt  để authentication 
    path('api/auth/registration/',CustomeRegisterView.as_view(), name='custom_register'),#có throttle
    path('api/auth/password/reset/',CustomePasswordResetView.as_view(), name='custom_password_reset'),#có throttle
    path('api/auth/',include('dj_rest_auth.urls')),
    path('api/auth/registration/',include('dj_rest_auth.registration.urls')), #đăng kí, mail verify
    path('api/auth/account/',include('allauth.socialaccount.urls')), #đăng nhập google/fb
    path('api/auth/google/login/', GoogleLogin.as_view(), name='google_login'),
    path('api/auth/google/connect/',GoogleConnect.as_view(), name='google_connect'),
    path("api/auth/google/disconnect/", GoogleDisconnect.as_view(), name="google_disconnect"),
    path("password/reset/confirm/<uidb64>/<token>/",auth_views.PasswordResetConfirmView.as_view(),name="password_reset_confirm",),
    path('api/auth/google/login/', GoogleLogin.as_view(), name='google_login'),
    #url spectacular
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    #url cho cookie http-only, dùng cho mobile thì dùng mặc định api/auth/login,logout,refresh 
    path('api/auth/web/login/', CookieLoginView.as_view(), name='cookie_login'), #login cho cookie
    path('api/auth/web/logout/', CookieLogoutView.as_view(), name='cookie_logout'), #logout cho cookie
    path('api/auth/web/token/refresh/', CookieTokenRefreshView.as_view(), name='cookie_refresh'),#refresh token cho cookie
    path('api/auth/web/google/login/', CookieGoogleLoginView.as_view(), name='cookie_google_login'),#gg login cho cookie
    #URL ACTIVITY STREAM ĐỂ GHI LOG
    path('api/activity/', include('actstream.urls')),

    #url cho xử lý người dùng
    path('api/user/profile/<int:pk>/',ProfileModify.as_view(),name='profile-modify'), #lấy ra infor ng dùng thêm sửa xóa
    path('api/user/profile/',ProfileList.as_view(), name='profile-list'), #lấy tất cả user
    path('api/auth/profile/userpage/<int:user>', ProfileUser.as_view(), name='user-info'), #lấy ra thông tin chính mình
    path('api/user/',ProfileView.as_view(),name='profile-view'), #lẩy ra thông tin user hiện tại
    path('api/user/pending-profile/',PendingProfileList.as_view(), name='pending-profile-list'), #lấy ra tất cả pending profile
    path('api/user/post-photo/<int:post_id>/',PostPhotoListCreate.as_view(),name='post-photo'), #thêm lấy ra ảnh của post cụ thể \
    path('api/user/delete-photo/<int:pk>/',PostPhotoDelete.as_view(),name='post-photo-delete'), #xóa ảnh cụ thể phục vụ chức năng chỉnh sửa post 
    path('api/user/post/<int:pk>/',PostModify.as_view(), name='post-modify'), #thêm sửa xóa post cụ thể
    path('api/user/post/show', PostFriend.as_view(), name='post-friend'), #Láy ra post của bạn bè
    path('api/user/post/userpage/<int:user>', PostUser.as_view(), name='post-user'),#lấy ra tất cả post của chính user đó
    path('api/user/post/create/',PostCreate.as_view(),name='post-create'), #tạo post để gán ảnh
    path('api/admin/post/',PostListAll.as_view(), name='post-list'), #láy ra tất cả post cho admin
    path('api/user/post-article/', PostArticleListCreate.as_view(), name='post-article-list'), #thêm láy tất cả post article
    path('api/user/post-article/<int:pk>/', PostArticleModify.as_view(), name='post-article-modify'), # lấy ra post article cụ thể
    path('api/user/comments/post/<int:post_id>',CommentListCreate.as_view(),name='comment-list'), #lấy Thêm comments từ post cụ thể
    path('api/user/comments/<int:pk>/',CommentModify.as_view(),name='comment-modify'), #lấy ra comment từ id
    path('api/user/setting/<int:pk>/',SettingModify.as_view(), name='setting-modify'),

    #url xử lý bạn bè, follow
    path("api/friends/request/<int:pk>/", SendFriendRequestView.as_view(), name="send-friend-request"), #gửi lời mời kết bạn
    path("api/friends/requests/incoming/", IncomingFriendRequestsView.as_view(), name="incoming-requests"), #lấy ra lời mời kết bạn đã nhận
    path("api/friends/requests/outgoing/", OutgoingFriendRequestsView.as_view(), name="outgoing-requests"), #lấy ra lời mời đã gửi đi
    path("api/friends/request/<int:pk>/accept/", AcceptFriendRequestView.as_view(), name="accept-request"), # chấp nhận lời mời
    path("api/friends/request/<int:pk>/reject/", RejectFriendRequestView.as_view(), name="reject-request"), # từ chối lời mới
    path("api/friends/request/<int:pk>/cancel/", CancelFriendRequestView.as_view(), name="cancel-request"), # hủy lời mời
    path("api/friends/unfriend/<int:pk>/", UnfriendView.as_view(), name="unfriend"), #xóa kết bạn
    path("api/friends/", FriendListView.as_view(), name="friends-list"), #lấy ra danh sách bạn bè
    path("api/follow/<int:pk>/", FollowView.as_view(), name="follow"), #theo dõi người dùng
    path("api/unfollow/<int:pk>/", UnfollowView.as_view(), name="unfollow"), #hủy theo dõi người dùng
    path("api/followers/", FollowersListView.as_view(), name="followers"), #lấy ra danh sách người theo dõi
    path("api/following/", FollowingListView.as_view(), name="following"), #lấy ra danh sách đang theo dõi
    path('api/block/<int:pk>',BlockView.as_view(),name='block'), # block 1 người
    path('api/unblock/<int:pk>',UnblockView.as_view(),name='unblock'), #unblock 1 người
    path('api/block/touser',ListBlockedUser.as_view(),name='listblocktouser'), #danh sách người block user
    path('api/block/user',ListBlockedFromUser.as_view(),name='listblockfromuser'), #danh sách block của user
    #url lấy ra user đã react và activity
    path('api/user/reaction/<int:post_id>',UserReactionList.as_view(),name='user-reaction'), #lấy ra tất cả user đã thẻ react post 
    path('api/user/activity/', UserActivity.as_view(), name='user-activity'), #lấy ra lịch sử hoạt động của user hoặc tất cả user
    path('api/admin/logs/', LogList.as_view(), name='log-list'), #lấy ra tất cả log cho admin
    # url cho chat
    path('api/chat/messages/send/<int:pk>/', SendMessageAPIView.as_view(), name='send-message'), #gửi tin nhắn trong cuộc trò chuyện cụ thể
    path('api/chat/messages/unsend/<int:pk>/', UnsendMessageAPIView.as_view(), name='unsend-message'), # thu hồi tin nhắn
    path('api/chat/conversations/', ConversationListAPIView.as_view(), name='conversation-list'), #danh sách cuộc trò chuyện của user
    path('api/chat/start/<int:user_id>/', StartConversationAPIView.as_view(), name='conversation-start'), #bắt đầu cuộc trò chuyện mới
    path('api/chat/messages/list/<int:pk>/', ConversationMessage.as_view(), name='message-list'), #danh sách tin nhắn trong cuộc trò chuyện cụ thể
    path('api/chat/messages/request/',MessageRequestList.as_view(),name='message-request-list'), #danh sách lời mời nhắn tin
    path('api/chat/conversation/members/<int:pk>/', MemberOfConversation.as_view(), name='conversation-members'), #danh sách thành viên trong cuộc trò chuyện
    path('api/chat/messages/seen/<int:pk>/', SeenMessage.as_view(), name='mark-message-seen'), #đánh dấu tin nhắn đã xem
    path('api/chat/messages/update/<int:pk>/', UpdateMessage.as_view(), name='update-message'), #cập nhật tin nhắn đã gửi
] + router.urls


#debug toolbar và silk 
if settings.DEBUG:
    import debug_toolbar
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += [path('__debug__/', include(debug_toolbar.urls))] #toolbars
    urlpatterns += [path('silk/', include('silk.urls', namespace='silk'))] #silk , Nhớ migrate