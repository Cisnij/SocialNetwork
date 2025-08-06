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
    path('reset-passwd/',views.getResetPasswd),
    path('locked/', views.getLocked),
    path('google/callback/',views.getGoogleCallback),
    path('forgot-password',views.getForgotPasswd),
    path('reset-password',views.getPasswordReset),
]

   