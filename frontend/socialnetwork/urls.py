from django.contrib import admin
from django.urls import path,include
from . import views
from .views import *
urlpatterns = [
    path('',views.getBase,name="base"),
    path('login/', views.getLogin,name="login"),
    path('register/',views.getRegister,name="register"),
    path('about/',views.getAbout,name='about'),
    path('register/success-regis/', views.getSuccessRegis, name='success-regis'),
    path('email-verified/',views.getEmailVerified,name='email-verified'),
    path('locked/', views.getLocked),
    path('google/callback/',views.getGoogleCallback),
    path('forgot-password/',views.getForgotPasswd),
    path('reset-password/',views.getPasswordReset),
    path('reset-password-done/',views.getPasswordResetDone),
    path('change-password/', views.getChangePassword),
    path('email-reset-password/', views.getEmailResetPassword),
    path('email-verified-send/', views.getEmailVerifiedSend),
    path('profile/<int:pk>/', views.getMyProfile),
    path('create-article/',views.getAddArticle),
    path('friends/', views.getFriends, name='friends'),
    path('chat/', views.getChat, name='chat'),
    path('notifications/', views.getNotifications, name='notifications'),
    path('settings/', views.getSettings, name='settings'),
    path('search/', views.getSearch, name='search'),
    path('shares/', views.getShares, name='shares'),
    path('post/share/<str:share_code>/', views.getShareView, name='share-view'),
    path('post/<int:post_id>/', views.getPostDetail, name='post-detail'),
    path('blocked/', views.getBlocked, name='blocked'),
    path('activity/', views.getActivity, name='activity'),
    path('friend-suggest/', views.getFriendSuggest, name='friend-suggest'),
    path('search-history/', views.getSearchHistory, name='search-history'),

]
