from dj_rest_auth.registration.serializers import RegisterSerializer
from dj_rest_auth.serializers import LoginSerializer
from django.contrib.auth import authenticate
from rest_framework import serializers
from allauth.account.models import EmailAddress
from .models import PendingProfile, Profile


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
