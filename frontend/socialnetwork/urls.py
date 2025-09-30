from django.contrib import admin
from django.urls import path,include
from socialnetwork import views
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
    path('create-post/',views.getAddPost),
]

   