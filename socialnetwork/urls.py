
from django.contrib import admin
from django.urls import path,include
from socialnetwork import views
from .views import *
urlpatterns = [
    path('',views.getBase,name="base"),
    path('login/', views.getLogin,name="login"),
    path('register/',views.getRegister,name="register"),
]

   