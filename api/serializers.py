from dj_rest_auth.registration.serializers import RegisterSerializer
from rest_framework import serializers
class CustomRegisterSerializer(RegisterSerializer): # Sửa chức năng register nên RegisterSerializer
    
    _has_phone_field = True # Chính cái dòng này giúp `dj-rest-auth` hiểu rằng bạn đang thêm số điện thoại
    phone_number=serializers.CharField(required=True,allow_blank=False)

    def validate(self,data): #bước xác thực lại 
        data=super().validate(data)
        return data 
    
    def get_cleaned_data(self): #sau khi xác thực thì lấy cái giá trị mới xác thực gán cho giá trị chính và lưu 
        clean_data=super().get_cleaned_data() #clean data là dữ liệu chính và được gán vào dữ liệu vừa validate
        clean_data['phone_number']=self.validated_data.get('phone_number', '')
        return clean_data