# yourapp/adapters.py
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress

User = get_user_model()

class MySocialAccountAdapter(DefaultSocialAccountAdapter): #chỉnh sủa login social để gộp tài khoản nếu đã có 
    def pre_social_login(self, request, sociallogin):
        # Nếu user đã đăng nhập thì không làm gì (đã connect rồi)
        if request.user.is_authenticated:
            return

        # nếu social account đã tồn tại rồi thì return luôn, ví dụ user có 2 mail a và b thì đều gắn vào user đó không tạo acc mới
        if sociallogin.is_existing: # chạy trước hàm này và tự động query, ví dụ gmail a đã connect và đc tạo trc đây thì return k cần phải connect lại
            return

        email = sociallogin.account.extra_data.get('email') # lấy ra email vừa login google
        if not email:
            return

        try:

            # Kiểm tra email đã xác minh chưa (được gửi từ allauth)
            email_obj = EmailAddress.objects.filter(email=email, verified=True).select_related("user").first()
            if email_obj:
                # Nếu đã xác minh, gắn social login vào user hiện có
                sociallogin.connect(request, email_obj.user)

        except User.DoesNotExist: #tạo account ggoogle mới
            pass

    # đồng bộ tên email là tên ng dùng khi đăng nhập google
    def populate_user(self, request, sociallogin, data): #user lần đầu đăng nhập 

        user = super().populate_user(request, sociallogin, data) # tạo thông tin user 

        email = data.get("email") #lấy ra email từ thông tin tạo 

        if email:
            user.username = email  #gán user thành email đó 

        return user
