from django.utils import timezone

from dj_rest_auth.registration.serializers import RegisterSerializer
from dj_rest_auth.serializers import LoginSerializer
from django.contrib.auth import authenticate
from django.core.mail import send_mail
from django.core.validators import RegexValidator
from django.db import transaction
from django.core.cache import cache
from rest_framework import serializers
from allauth.account.models import EmailAddress
from .models import PendingProfile, Profile
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from .serializers import EmailSerializer
from allauth.socialaccount.models import SocialAccount
from phonenumber_field.serializerfields import PhoneNumberField
from .tasks import send_email_task

'''khi người dùng nhập, gọi api nó sẽ lấy giá trị và validate sau đó mới lưu vào csdl là flow của serializer đúng k'''

name_validator = RegexValidator(
    regex=r'^[a-zA-ZÀ-ỹ\s]+$', # check các kí tự này chỉ đc từ a-Z và dấu
    message='Tên chỉ được chứa chữ cái và khoảng trắng' # báo lỗi
)
class CustomRegisterSerializer(RegisterSerializer): # Sửa chức năng register nên RegisterSerializer
    username=None #Bỏ username đi
    firstname=serializers.CharField(required=True, allow_blank=False,validators=[name_validator]) #thêm first name
    lastname=serializers.CharField(required=True, allow_blank=False, validators=[name_validator]) #thêm last name
   
    _has_phone_field = True #thêm số điện thoại
    phone_number = PhoneNumberField(required=True)
    birthday=serializers.DateField(required=True) #thêm ngày sinh

    def validate_birthday(self, value):  # validate riêng cho birthday
        if value > timezone.now().date():
            raise serializers.ValidationError('Ngày sinh không thể là tương lai')
        if value.year < 1900:
            raise serializers.ValidationError('Ngày sinh không hợp lệ')
        return value


    def get_cleaned_data(self): #sau khi xác thực thì lấy cái giá trị mới xác thực gán cho giá trị chính và lưu , cái này là chỉ gán các field có sẵn trong user, muốn thêm field tự custome thì overide save()
        clean_data=super().get_cleaned_data() #clean data là dữ liệu chính và được gán vào dữ liệu vừa validate
        clean_data['first_name'] = self.validated_data.get('firstname', '')
        clean_data['last_name'] = self.validated_data.get('lastname', '')
        clean_data['phone_number']=self.validated_data.get('phone_number', '')
        clean_data['birthday']=self.validated_data.get('birthday', '')
        clean_data['username'] = self.validated_data.get('email', '') #gán email vào username
        return clean_data
    
    def save(self,request): #custome thêm các field muốn thêm
        user=super().save(request) #lưu user
        pending_profile, created = PendingProfile.objects.get_or_create(user=user)
        pending_profile.first_name=self.validated_data.get('firstname','')
        pending_profile.last_name=self.validated_data.get('lastname','')
        phone = self.validated_data.get('phone_number', '')
        pending_profile.phone_number = phone
        pending_profile.date_of_birth = self.validated_data.get('birthday')
        pending_profile.save() 
        return user

class CustomeLoginSerializer(LoginSerializer): #Sửa chức năng login nên LoginSerializer
    username=None #bỏ username đi
    def validate(self, attrs):
        email = attrs.get('email')
        password = attrs.get('password')
        if not email or not password:
            raise serializers.ValidationError("Email and password are required")
        user = authenticate(request=self.context.get('request'),username=email,password=password)

        if not user:
            raise serializers.ValidationError("Invalid login credentials")
        if not user.is_active:
            raise serializers.ValidationError("User account is disabled.")
        
        email_verified=EmailAddress.objects.filter(user=user, email=email).first()
        if email_verified and not email_verified.verified:
            raise serializers.ValidationError("Email is not verified.")
        
        attrs['user'] = user
        return attrs

#====================================== Thêm tính năng chỉnh sửa email====================================
class AddEmailView(APIView): #Thêm 1 email khác vào tài khoản
    permission_classes=[IsAuthenticated]
    def post(self,request):
        user= request.user
        new_email= request.data.get("new_email")
        if not new_email:
            return Response({'Vui lòng nhập email'}, status=400)
        if EmailAddress.objects.filter(email=new_email,verified=True).exists(): # check để tránh khi 1 người nhập đại mà sau này có ng tạo mail y hệt 
            return Response({"error: Email already exist"},status=400)
        email_address, created = EmailAddress.objects.get_or_create( # nếu get thì trả false, nếu created thì trả true vì khai báo created trước đó
            user=user,
            email=new_email,
            defaults={
                "primary": False,
                "verified": False,
            }
        )
        if not created:
            return Response({'error': 'Email already added before'},status=400)

        email_address.send_confirmation(request) #signup false để bảo đây là thêm chứ k phải đăng kí tài khoản mới
        return Response({'Email added successfully, please check your email'},status =200)

class SetPrimaryEmailView(APIView): # đặt 1 email làm mặc đinh
    permission_classes = [IsAuthenticated]
    def post(self, request, pk):
        user = request.user
        email_obj = EmailAddress.objects.filter(
            id=pk,
            user=user,
            verified=True
        ).first()
        if not email_obj:
            return Response(
                {"error": "Email not found or not verified"},
                status=status.HTTP_400_BAD_REQUEST
            )
        if email_obj.primary: # nếu là primary
            return Response({"detail": "Already primary"},status=400)


        import random
        otp = str(random.randint(100000, 999999))
        cache.set(f"otp_change_primary:{user.id}", { #tạo otp lưu trong cache với user id. 1 là tên lưu và 2 là cặp key value lưu
            'otp': otp,
            'new_email_id': pk,
        }, timeout=300)  # 5 phút

        send_email_task.delay(
            subject="Mã OTP đổi email chính",
            message=f"Mã OTP của bạn là: {otp}. Có hiệu lực trong 5 phút. Nếu bạn không thay đổi email chính, vui lòng bỏ qua",
            recipient_list=[user.email],
        )
        return Response({"detail": "OTP đã gửi về email cũ"}, status=200)

class ConfirmChangePrimaryEmail(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp_input = request.data.get('otp')

        data = cache.get(f"otp_change_primary:{user.id}")
        if not data or data['otp'] != otp_input:
            return Response({"error": "OTP không hợp lệ hoặc đã hết hạn"}, status=400)

        email_obj = EmailAddress.objects.filter(
            id=data['new_email_id'], user=user, verified=True
        ).first()
        if not email_obj:
            return Response({"error": "Email not found"}, status=400)

        with transaction.atomic():
            email_obj.set_as_primary()
            user.email = email_obj.email
            user.username = email_obj.email #đổi luôn tên user
            user.save(update_fields=["email", "username"])

        cache.delete(f"otp_change_primary:{user.id}")
        return Response({"detail": "Đổi email chính thành công"}, status=200)

class DeleteEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        user = request.user

        if user.has_usable_password(): # Nếu user có password vì register, dùng google login không có password nên bỏ qua
            password = request.data.get("password")
            if not password:
                return Response({'error': "Please enter password"}, status=400)
            if not authenticate(request=request,username=user.username, password=password):
                return Response({'error': 'Wrong password'}, status=400)

        email_obj = EmailAddress.objects.filter(id=pk, user=user).first()
        if not email_obj:
            return Response({"error": "Email not found"}, status=400)
        if email_obj.primary: #là email primary
            return Response({"error": "Cannot delete primary email"}, status=400)
        if EmailAddress.objects.filter(user=user).count() <= 1: # nếu email chỉ có 1
            return Response({"error": "Cannot delete the only email"}, status=400)

        with transaction.atomic():
            email_obj.delete() #xóa email
            SocialAccount.objects.filter( #xóa acc google đã connect
                user=user,
                extra_data__email=email_obj.email
            ).delete()

        return Response({"detail": "Email deleted successfully"}, status=200)
    
class UserEmail(generics.ListAPIView):
    permission_classes=[IsAuthenticated]
    serializer_class=EmailSerializer
    def get_queryset(self): 
        user= self.request.user
        return EmailAddress.objects.filter(user=user,verified=True)
    

class CheckPassword(APIView): #kiểm tra password khi thay đổi email mặc định
    permission_classes=[IsAuthenticated]
    def post(self,request):
        password=request.data.get("password")
        user= authenticate(request=request,username=request.user.username,password=password)
        if user:
            return Response({'valid':True},status=200)
        return Response({'valid':False},status =400)

class HasPassword(APIView):
    permission_classes = [IsAuthenticated]
    def get(self,request):
        return Response({'has_password': request.user.has_usable_password()})

class DeleteAccount(APIView):
    permission_classes=[IsAuthenticated]

    def delete(self, request):
        user = request.user

        # xóa auditlog trước
        from auditlog.models import LogEntry
        LogEntry.objects.filter(actor=user).update(actor=None)  # set null thay vì xóa

        user.delete()
        return Response({"detail": "success"}, status=200)