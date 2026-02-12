from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Post, PostPhoto

class CreateFullPostView(APIView): #model gộp chung api tạo title và post
    def post(self, request):
        title = request.data.get('title')
        photos = request.FILES.getlist('photo')

        if not title or not photos:
            return Response({"error": "Thiếu title hoặc photo"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic(): # dùng đồng bộ csdl để khi một cái k tạo đc thì cả 2 k tạo đc 
                new_post = Post.objects.create(
                    title=title, 
                    user=request.user
                )
            for photo in photos:
                photo= PostPhoto.objects.create(post=new_post,photo=photo) 
                
            return Response({ #nếu true 
                "message": "Đã tạo post và ảnh thành công!",
                "post_id": new_post.id
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            # Nếu có lỗi (Ví dụ: DB lỗi, mất kết nối giữa chừng...)
            # Post sẽ không bị tạo "mồ côi"
            return Response({
                "error": "Có lỗi xảy ra, không có dữ liệu nào được tạo.",
                "details": str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)