import firebase_admin
from firebase_admin import credentials
import environ
from pathlib import Path
from django.conf import settings
from firebase_admin import messaging
from .models import FCMToken

env=environ.Env(DEBUG=(bool,False))

def init_firebase(): # HÀM KHỞI TRẠO 
    if not firebase_admin._apps:
        cred = credentials.Certificate(Path(settings.BASE_DIR) / env("FIREBASE_CREDENTIAL"))
        firebase_admin.initialize_app(cred) # hàm intit khởi tạo 


#============PUSH==============

def push_to_user(user, title, body): #logic push, hàm để gọi khi muốn push
    tokens = list( # lấy ra token của user và đưa vào list 
        FCMToken.objects
        .filter(user=user)
        .values_list("token", flat=True)
    )

    if not tokens: # k có token k thể push
        return

    message = messaging.MulticastMessage( #push với token hàng loạt
        notification=messaging.Notification(
            title=title,
            body=body,
        ),
        tokens=tokens,
    )

    response = messaging.send_each_for_multicast(message) # gửi tin nhắn hàng loạt

    for i, r in enumerate(response.responses): # nếu token trong list k hợp lệ thì xóa token đó đi
        if not r.success:
            FCMToken.objects.filter(token=tokens[i]).delete()
