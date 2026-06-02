from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Post, PostPhoto
from .serializers import *
class CreateFullPostView(APIView):
    def post(self, request):
        title = request.data.get('title')
        photos = request.FILES.getlist('photos')
        privacy = request.dât.get('privacy','public')
        if not title:
            return Response({"error": "Thiếu title"}, status=status.HTTP_400_BAD_REQUEST)
        valid_privacy =['public','friends','private']
        if privacy not in valid_privacy:
            return Response({'error':'Privacy không hợp lệ'})
        try:
            with transaction.atomic():
                new_post = Post.objects.create(
                    title=title,
                    user=request.user,
                    privacy=privacy
                )
                for photo in photos:
                    PostPhoto.objects.create(post=new_post, photo=photo)

            serializer = PostSerializer(new_post, context={'request': request}) #new post vừa tạo xong thì đem vào serializer để đọc nó ra, request vào để lấy ra url gán vô  link ảnh
            return Response(serializer.data, status=status.HTTP_201_CREATED) # trả ra data của serializer trên 

        except Exception as e:
            return Response({
                "error": "Có lỗi xảy ra",
                "details": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
            
'''
request là gì : là toàn bộ HTTP request object 
request.user          # người đang đăng nhập (lấy từ token JWT)
request.data          # body của request (JSON, form data)
request.FILES         # file upload (ảnh, video...)
request.method        # GET, POST, PUT, DELETE
request.headers       # Authorization, Content-Type...
request.META          # thông tin server, IP client...
'''

# actor: người thực hiện
# verb: hành động 
# target object là đối tượng bị tác động đến ví dụ post
# action object là hành động hiện tại hướng đến đối tượng đó ví dụ like của post

# cái Isauthenticated sẽ check cookie/token nên đùng đc kể cả mobile hay web, và sau đó request.user cũng sẽ lấy ra đc vì biết token, nếu là anonymus thì k có vẫn có user nhma là anno