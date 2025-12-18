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

        email = sociallogin.account.extra_data.get('email') # lấy ra email vừa login google
        if not email:
            return

        try:
            # Tìm user theo email login google
            user = User.objects.get(email=email)

            # Kiểm tra email đã xác minh chưa (được gửi từ allauth)
            email_obj = EmailAddress.objects.filter(user=user, email=email, verified=True).first()
            if email_obj:
                # Nếu đã xác minh, gắn social login vào user hiện có
                sociallogin.connect(request, user)

        except User.DoesNotExist:
            pass
