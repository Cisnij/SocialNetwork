from dj_rest_auth.registration.serializers import RegisterSerializer
from dj_rest_auth.serializers import LoginSerializer
from django.contrib.auth import authenticate
from rest_framework import serializers
from allauth.account.models import EmailAddress
from .models import PendingProfile, Profile
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from .serializers import EmailSerializer
class CustomRegisterSerializer(RegisterSerializer): # Sửa chức năng register nên RegisterSerializer
    username=None #Bỏ username đi
    firstname=serializers.CharField(required=True, allow_blank=False) #thêm first name
    lastname=serializers.CharField(required=True, allow_blank=False) #thêm last name
   
    _has_phone_field = True #thêm số điện thoại
    phone_number=serializers.CharField(required=True,allow_blank=False)
    birthday=serializers.DateField(required=True) #thêm ngày sinh
    
    def get_cleaned_data(self): #sau khi xác thực thì lấy cái giá trị mới xác thực gán cho giá trị chính và lưu 
        clean_data=super().get_cleaned_data() #clean data là dữ liệu chính và được gán vào dữ liệu vừa validate
        clean_data['first_name'] = self.validated_data.get('firstname', '')
        clean_data['last_name'] = self.validated_data.get('lastname', '')
        clean_data['phone_number']=self.validated_data.get('phone_number', '')
        clean_data['birthday']=self.validated_data.get('birthday', '')
        clean_data['username'] = self.validated_data.get('email', '') #gán email vào username
        return clean_data
    
    def save(self,request):
        user=super().save(request) #lưu user
        pending_profile, created = PendingProfile.objects.get_or_create(user=user)
        pending_profile.first_name=self.validated_data.get('firstname','')
        pending_profile.last_name=self.validated_data.get('lastname','')
        pending_profile.phone_number = self.validated_data.get('phone_number', '')
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

# Thêm tính năng chỉnh sửa email
class AddEmailView(APIView): #Thêm 1 email khác vào tài khoản
    permission_classes=[IsAuthenticated]
    def post(self,request):
        user= request.user
        new_email= request.data.get("new_email")
        if not new_email:
            return Response({'Vui lòng nhập email'}, status=400)
        if EmailAddress.objects.filter(email=new_email,verified=True).exists(): # check để tránh khi 1 người nhập đại mà sau này có ng tạo mail y hệt 
            return Response({"error: Email already exist"},status=400)
        email_address, created = EmailAddress.objects.get_or_create(
            user=user,
            email=new_email,
            defaults={
                "primary": False,
                "verified": False,
            }
        )
        # nếu get thì trả false, nếu true thì trả true vì khai báo created trước đó
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
        if email_obj.primary:
            return Response({"detail": "Already primary"})
        email_obj.set_as_primary()
        return Response({"detail": "Primary email updated"})

class DeleteEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        user = request.user

        email_obj = EmailAddress.objects.filter(
            id=pk,
            user=user
        ).first()

        if not email_obj:
            return Response(
                {"error": "Email not found"},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Không cho xóa primary
        if email_obj.primary:
            return Response(
                {"error": "Cannot delete primary email"},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Không cho xóa nếu là email duy nhất
        if EmailAddress.objects.filter(user=user).count() <= 1:
            return Response(
                {"error": "Cannot delete the only email"},
                status=status.HTTP_400_BAD_REQUEST
            )

        email_obj.delete()
        return Response({"detail": "Email deleted successfully"})
class UserEmail(generics.ListAPIView):
    permission_classes=[IsAuthenticated]
    serializer_class=EmailSerializer
    def get_queryset(self): 
        user= self.request.user
        return EmailAddress.objects.filter(user=user,verified=True)