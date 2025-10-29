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
    path('',include('api.urls')),
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

    path('api/user/addfriend/', AddFriendListCreate.as_view(), name='friend-list'),
    path('api/user/addfriend/<int:pk>/', AddFriendModify.as_view(), name='friend-modify'),
    
    path('api/user/friends/<int:user>',FriendList.as_view(),name='user-friend'),

    path('api/user/reaction/<int:post_id>',UserReactionList.as_view(),name='user-reaction') #lấy ra tất cả user đã thẻ react post 

] + router.urls


#debug toolbar và silk 
if settings.DEBUG:
    import debug_toolbar
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += [path('__debug__/', include(debug_toolbar.urls))] #toolbars
    urlpatterns += [path('silk/', include('silk.urls', namespace='silk'))] #silk , Nhớ migrate