# yourapp/adapters.py
from django.db import transaction

from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
from allauth.exceptions import ImmediateHttpResponse
from django.http import HttpResponseBadRequest
import json
User = get_user_model()

class MySocialAccountAdapter(DefaultSocialAccountAdapter): #chỉnh sủa login social để gộp tài khoản nếu đã có
    def pre_social_login(self, request, sociallogin):
        # Nếu user đã đăng nhập thì không làm gì (đã connect rồi)
        if request.user.is_authenticated:
            return
        email = sociallogin.account.extra_data.get('email', '').strip().lower()  # lấy ra email vừa login google
        if not email:
            raise ImmediateHttpResponse(
                HttpResponseBadRequest(
                    json.dumps({
                        "error": "Không lấy được email từ Google, vui lòng thử lại"
                    }),
                    content_type='application/json'
                )
            )
        #========ĐÃ TỪNG LOGIN================
        if sociallogin.is_existing:# chạy trước hàm này và tự động query, ví dụ gmail a đã connect và đc tạo trc đây thì return k cần phải connect lại, nếu acc phụ thì check
            '''flow là khi user acc phụ login vào ,check uid thấy đã login với gg trước đó(sociallogin.is_existing), lấy ra email chính user và so email vừa login 
                ,không trùng thì lỗi login'''
            existing_user = sociallogin.user #lấy ra user gắn với acc đã connect
            if existing_user.email.lower() != email:  # email phụ → chặn
                raise ImmediateHttpResponse(
                    HttpResponseBadRequest(
                        json.dumps({
                            "error": "Email này là email phụ, vui lòng đăng nhập bằng email chính"
                        }),
                        content_type='application/json'
                    )
                )
            return  # email chính → cho qua return

        #============LẦN ĐẦU LOGIN==============

        # Kiểm tra email đã xác minh chưa (được gửi từ allauth), có xác minh từ trước thì email chính có phải là email đang login, có thì connect
        email_obj = EmailAddress.objects.filter(email__iexact=email, verified=True).select_related("user").first()

        if not email_obj: # nếu email chưa đc xác minh thì kiểm tra email rác xem có không, nếu có thì delete để tránh tạo duplicate user và lỗi khi trùng username(sửa lỗi khi regis mà k verified thì sẽ k login gg đc)
            unverified_users = list(
                EmailAddress.objects.filter(email__iexact=email, verified=False)
                .select_related("user")
                .values_list("user_id", flat=True)
                .distinct()
            )
            if unverified_users:
                User.objects.filter(id__in=unverified_users).delete()
            return  # tạo account mới bình thường qua Google

        if email_obj.user.email == email: # kiểm tra nếu email của user = email truyền vào(tức là email chính)
            # Nếu đã xác minh, gắn social login vào user hiện có
            sociallogin.connect(request, email_obj.user)
            return
        # email phụ
        raise ImmediateHttpResponse(
            HttpResponseBadRequest(
                json.dumps({
                    "error": "Email này là email phụ, vui lòng đăng nhập bằng email chính"
                }),
                content_type='application/json'
            )
        )

    # đồng bộ tên email là tên ng dùng khi đăng nhập google
    def populate_user(self, request, sociallogin, data): #user lần đầu đăng nhập

        user = super().populate_user(request, sociallogin, data) # tạo thông tin user

        email = data.get("email") #lấy ra email từ thông tin tạo

        if email:
            user.username = email  #gán user thành email đó

        return user