from factory import fuzzy
from oauthlib.uri_validate import query

from .serializers import *
from rest_framework import generics,permissions
from rest_framework.permissions import *
from django.shortcuts import get_object_or_404
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound,PermissionDenied
from rest_framework import viewsets
from .pagination import *
from .signals import unfriended_log
from rest_framework.parsers import MultiPartParser, FormParser,JSONParser #upload file ảnh và dữ liệu dạng form và json parse(khi dùng api view để nhập vào ô body không cần dạng json)
from django.db.models import Q, Prefetch
from .permissions import IsConversationMember
from django.db import transaction # tạo đồng bộ db
from rest_framework import status
#filter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter,OrderingFilter
from django.contrib.auth.models import User
from .filters import UserReactionFilter
from rest_framework.response import Response
#friendship xay dựng hệ thống follow bạn bè
from friendship.models import Friend
#django-extension tối ưu, lưu cache
from rest_framework_extensions.cache.mixins import CacheResponseMixin
# broadcast channels 
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
# elastic
from .documents import PostDocument,ProfileDocument
from elasticsearch_dsl.query import MultiMatch
#===========================================================================================================================================================================================
class ProfileModify(generics.RetrieveUpdateDestroyAPIView): #Xem sửa xóa profile 
    permission_classes=[IsAuthenticated]
    serializer_class=ProfileSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='profile'
    #def perform_update(self, serializer): # dùng để resize và cắt ảnh avatar
    #     picture = self.request.FILES.get('picture')
        
    #     if picture:
    #         # lấy thông số crop/resize từ request
    #         crop_x = self.request.data.get('crop_x')
    #         crop_y = self.request.data.get('crop_y')
    #         crop_width = self.request.data.get('crop_width')
    #         crop_height = self.request.data.get('crop_height')
    #         out_width = self.request.data.get('width', 500)    # mặc định 500
    #         out_height = self.request.data.get('height', 500)  # mặc định 500

    #         picture = self._process_avatar(
    #             picture,
    #             crop_x, crop_y, crop_width, crop_height,
    #             int(out_width), int(out_height)
    #         )
    #         serializer.save(user=self.request.user, picture=picture)
    #     else:
    #         serializer.save(user=self.request.user)

    # def _process_avatar(self, image_file, crop_x, crop_y, crop_width, crop_height, out_width, out_height):
    #     from PIL import Image
    #     from io import BytesIO
    #     from django.core.files.uploadedfile import InMemoryUploadedFile
    #     import sys

    #     img = Image.open(image_file)

    #     if img.mode != 'RGB':
    #         img = img.convert('RGB')

    #     # crop nếu có truyền thông số
    #     if all([crop_x, crop_y, crop_width, crop_height]):
    #         crop_x = int(float(crop_x))
    #         crop_y = int(float(crop_y))
    #         crop_width = int(float(crop_width))
    #         crop_height = int(float(crop_height))

    #         # (left, upper, right, lower)
    #         img = img.crop((
    #             crop_x,
    #             crop_y,
    #             crop_x + crop_width,
    #             crop_y + crop_height
    #         ))

    #     # resize về kích thước output
    #     img = img.resize((out_width, out_height), Image.LANCZOS)

    #     output = BytesIO()
    #     img.save(output, format='JPEG', quality=85)
    #     output.seek(0)

    #     return InMemoryUploadedFile(
    #         output, 'ImageField',
    #         f"{image_file.name.split('.')[0]}.jpg",
    #         'image/jpeg',
    #         sys.getsizeof(output),
    #         None
    #     )
    def perform_update(self, serializer): # gán user khi update
        serializer.save(user=self.request.user)  # Lưu các thay đổi được thực hiện trên đối tượng Profile

    def get_object(self): #nên dùng get object thay vì get querry vì ở đây cần lấy chỉ 1 đối tượng, get querryset thường dùng trả nhiều đối tượng 
        user = self.request.user 
        profile_id= self.kwargs.get('pk') #cách lấy ra từ urlS

        if user.is_superuser or user.is_staff:
            if not profile_id:
                raise NotFound("Admin cần truyền ID profile để truy cập.")
            return get_object_or_404(Profile, id=profile_id)
            
        return get_object_or_404(Profile, user=user)

class ProfileList(generics.ListAPIView):#List tất cả profile
    permission_classes=[IsAuthenticated]
    serializer_class=ProfileSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['first_name','last_name','phone_number','date_of_birth'] # các trường để tìm kiếm theo trường đó 
    search_fields=['first_name','last_name','phone_number'] #tìm kiếm
    ordering_fields=['id','created_at'] #sắp xếp theo thứ tự tăng giảm dần 
    pagination_class = LargePagePagination

    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return Profile.objects.all().select_related('user').order_by('id')
        # return Profile.objects.filter(user=user)
        return Profile.objects.all().select_related('user').order_by('id')
    
class ProfileUser(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_object(self):
        user_id = self.kwargs.get("user")  # lấy từ URL
        return get_object_or_404(Profile, id=user_id) #lấy ra user id trong profile, user__id là vì onetoonefield với profile à user là object tức user chứ nhiều thứ bên trong nữa nên lấy ra id từ bên trong đó

class ProfileView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_object(self):
        user=self.request.user
        return get_object_or_404(Profile, user=user)

class PendingProfileList(generics.ListAPIView):#List profile chờ duyệt
    permission_classes=[IsAdminUser]
    serializer_class=PendingProfileSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['first_name','last_name','phone_number','date_of_birth']
    search_fields=['first_name','last_name','phone_number']
    ordering_fields=['id','created_at']


    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return PendingProfile.objects.all()
        raise PermissionDenied("Không có quyền truy cập")

        
class PostPhotoListCreate(generics.ListCreateAPIView):
    serializer_class = PostPhotoSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser] #dùng để lấy ảnh dạng formData
    #trình tự xử lý: api gọi, view xử lý theo chức năng crud trước, sau đó chạy serializer parse json và thực thi tới perform create.. mấy thứ ghi trong view sau đó thêm vào model
    def get_queryset(self):
        post_id = self.kwargs.get("post_id")
        return PostPhoto.objects.filter(post_id=post_id)

    def perform_create(self, serializer): #trước khi lưu ảnh vào postphoto thì gán post id vào cùng
        post_id = self.kwargs.get("post_id")
        serializer.save(post_id=post_id) # gán id vào
    
    def post(self, request, *args, **kwargs): #gọi hàm post để thêm nhiều ảnh vào 1 post
        post_id=self.kwargs.get('post_id')
        post=get_object_or_404(Post,pk=post_id) #pk ở đây là bí danh alias cho primary key ở tất cả bảng, vì v khi gọi pk thì dùng pk luôn k cần tên
        if post.user != request.user and not request.user.is_staff: # không phải là user chủ post kh được upload
            raise PermissionDenied()
        photos = request.FILES.getlist('photo') # lấy data dạng file từ form data gửi lên và dùng form parser để parse về json và lưu
        with transaction.atomic():
            for photo in photos:
                photo= PostPhoto.objects.create(post=post,photo=photo) 
        return Response({'message': 'success'})

class PostPhotoDelete(generics.DestroyAPIView): #xóa ảnh (chức năng của sửa post)
    permission_classes=[IsAuthenticated]
    serializer_class=PostPhotoSerializer

    def get_object(self):
        user= self.request.user
        photo_id = self.kwargs.get('pk')
        if not photo_id:
            raise NotFound("Cần truyền ID ảnh để xóa.")
        photo = get_object_or_404(PostPhoto, id=photo_id)
        if photo.post.user != user and not (user.is_superuser or user.is_staff):
            raise PermissionDenied("Bạn không có quyền xóa ảnh này.")
        return photo


class PostFriend(generics.ListAPIView):#List tất cả post của bạn bè
    permission_classes=[IsAuthenticated]
    serializer_class=PostSerializer
    pagination_class=LargePagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['title','created_at']
    search_fields=['title']
    ordering_fields=['post_id','created_at']

    def get_queryset(self):
        user = self.request.user

        friends_qs = Friend.objects.friends(user)
        following_qs = Follow.objects.following(user)
        blocked_qs = Block.objects.blocked(user)
        blocked_by_qs = Block.objects.blocking(user)

        return (
            Post.objects
            .filter(
                Q(user__in=friends_qs) | #user là friend hoặc đang follow hoặc là user thì lấy ra hết 
                Q(user__in=following_qs) |
                Q(user=user)
            )
            .exclude(
                Q(user__in=blocked_qs) | #trừ bị block và mình block 
                Q(user__in=blocked_by_qs)
            )
            .select_related("user", "user__profile") # lấy ra cùng user và profile 
            .prefetch_related('photos')
            .order_by("-created_at")
        )

        
class PostModify(generics.RetrieveUpdateDestroyAPIView):#Xem sửa xóa post
    permission_classes=[IsAuthenticated]
    serializer_class=PostSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='post'

    def get_object(self):
        user = self.request.user
        post_id= self.kwargs.get('pk')
        
        if user.is_superuser or user.is_staff:
            if not post_id:
                raise NotFound("Admin cần truyền ID post và slug chính xác để truy cập.")
            return get_object_or_404(Post, post_id=post_id)

        return get_object_or_404(Post, user=user, post_id=post_id)
    
class PostUser(generics.ListAPIView):#List tất cả post của user
    permission_classes=[IsAuthenticated]
    serializer_class=PostSerializer
    pagination_class=SmallPagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['title','created_at']
    search_fields=['title']
    ordering_fields=['post_id','created_at']

    def get_queryset(self):
        profile_id = self.kwargs.get("user")  
        return Post.objects.filter(user__profile__id=profile_id).select_related('user__profile').prefetch_related('photos').order_by('-created_at')

class PostCreate(generics.CreateAPIView):
    permission_classes=[IsAuthenticated]
    throttle_classes =[ScopedRateThrottle]
    throttle_scope='create_post'
    serializer_class=PostSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

class PostListAll(generics.ListAPIView):
    permission_classes=[IsAdminUser]
    # permissions_classes =[IsAuthenticated]
    serializer_class=PostSerializer
    filter_backends=[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filter_fields=['title','created_at']
    search_fields=['title','content']
    ordering_fields=['post_id','created_at']
    pagination_class=LargePagePagination
    
    def get_queryset(self):
        return Post.objects.all().select_related('user__profile').prefetch_related('photos').order_by('-created_at')

class PostArticleListCreate(generics.ListCreateAPIView):#List tất cả post
    permission_classes=[IsAuthenticated]
    serializer_class=PostArticalSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['title','created_at']
    search_fields=['title','content']
    ordering_fields=['postA_id','created_at']

    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return PostArticle.objects.all().select_related('user__profile')
        else:
            return PostArticle.objects.filter(user=user).select_related('user__profile')
        
    def perform_create(self, serializer): #gán user khi tạo post article
        serializer.save(user=self.request.user)
    
class PostArticleModify(generics.RetrieveUpdateDestroyAPIView):#Xem sửa xóa post
    permission_classes=[IsAuthenticated]
    serializer_class=PostArticalSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='post_article'

    def get_object(self):
        user = self.request.user
        postA_id= self.kwargs.get('pk')
        if user.is_superuser or user.is_staff:
            if not postA_id:
                raise NotFound("Admin cần truyền ID post và slug chính xác để truy cập.")
            return get_object_or_404(PostArticle, postA_id=postA_id)

        return get_object_or_404(PostArticle, user=user, postA_id=postA_id)
    
class CommentListCreate(generics.ListCreateAPIView): #thêm list comment
    permission_classes=[IsAuthenticated]
    serializer_class =CommentSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['post','content','user']
    search_fields=['content']
    ordering_fields=['created_at']

    def get_queryset(self):
        post_id=self.kwargs.get('post_id')
        user=self.request.user
        if not post_id:
            raise NotFound("Cần truyền ID post để truy cập.")
        # if user.is_superuser or user.is_staff:
        #     return Comment.objects.all()
        return Comment.objects.filter(post_id=post_id).select_related('user__profile')
    
    def perform_create(self, serializer): #gán user và post_id khi tạo comment
        post_id = self.kwargs.get('post_id')
        if not post_id:
            raise NotFound("Cần truyền ID post để tạo comment.")
        serializer.save(user=self.request.user, post_id=post_id)
    
class CommentModify(generics.RetrieveUpdateDestroyAPIView): #Xem sửa xóa comment
    permission_classes=[IsAuthenticated]
    serializer_class=CommentSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='comment'

    def get_object(self):
        user = self.request.user
        comment_id= self.kwargs.get('pk')
        if user.is_superuser or user.is_staff:
            if not comment_id:
                raise NotFound("Admin cần truyền ID comment để truy cập.")
            return get_object_or_404(Comment, id=comment_id)

        return get_object_or_404(Comment, user=user, id=comment_id)

class SettingModify(generics.RetrieveUpdateAPIView): #Xem sửa setting
    permission_classes=[IsAuthenticated]
    serializer_class=SettingSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='setting'

    def get_object(self):
        user= self.request.user
        id=self.kwargs.get('pk')
        if user.is_superuser or user.is_staff:
            if not id:
                raise NotFound("Admin cần truyền ID setting để truy cập.")
            return get_object_or_404(Setting, id=id)
        return get_object_or_404(Setting, user=user, id=id)
    
    
class UserReactionList(generics.ListAPIView): #Danh sách reaction của user trên post
    permission_classes=[IsAuthenticated]
    serializer_class=ReactionSerializer
    pagination_class=SmallPagePagination
    filter_backends=[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_class=UserReactionFilter #custome để lọc theo kiểu reaction ví dụ lọc ra like hay haha
    search_fields=['user__first_name','user__last_name']

    def get_queryset(self):
        post_id=self.kwargs.get('post_id')
        return UserReaction.objects.filter(reaction__object_id=post_id).select_related('user__profile')

class UserActivity(generics.ListAPIView): # lấy ra danh sách các hoạt động. Để tạo chức năng ví dụ hoạt động của user, hoạt động trên post 
    serializer_class=ActionSerializer
    permission_classes=[IsAuthenticated]
    pagination_class=SmallPagePagination
    
    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return Action.objects.all().order_by('-timestamp')
        return Action.objects.filter(data__user_id=user.id).order_by('-timestamp')

class LogList(generics.ListAPIView): #Danh sách log hoạt động
    serializer_class=LogSerializer
    permission_classes=[IsAdminUser]
    pagination_class=LargePagePagination

    def get_queryset(self):
        return Log.objects.all().order_by('-created_log_at')

#===================================================FriendShip========================================================================================

class SendFriendRequestView(generics.CreateAPIView): #tạo lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer

    def create(self, request, *args, **kwargs):
        to_user_id = self.kwargs.get("pk")      # Lấy từ URL
        
        # Lấy user từ Profile 
        profile = get_object_or_404(Profile, id=to_user_id)
        to_user = profile.user
        
        # Kiểm tra ID hợp lệ
        if request.user == profile.user:
            return Response({"error": "Cannot send friend request to yourself"}, status=400)


        # Kiểm tra xem đã là bạn bè chưa
        if Friend.objects.are_friends(request.user, to_user):
            return Response({"error": "Already friends"}, status=400)

        # Kiểm tra đã gửi trước đó chưa
        if FriendshipRequest.objects.filter(
            from_user=request.user, to_user=to_user, rejected__isnull=True # tên trường__isnull = True để kiểm tra có null k
        ).exists():
            return Response({"error": "Friend request already sent"}, status=400)

        # Kiểm tra xem có bị chặn không
        if Block.objects.is_blocked(request.user, to_user):
            return Response({"error": "Cannot send friend request due to blocking"}, status=400)
        
        # Tạo request
        with transaction.atomic():
            req = Friend.objects.add_friend(request.user, to_user, message="") #tạo lời mời kb

        serializer = self.get_serializer(req, context={"request": request}) # get_serializer của hàm và truyền vào object vừa tạo ở trên chuyển sang json
        return Response(serializer.data, status=201) #response dạng serialier đó 

    
class IncomingFriendRequestsView(generics.ListAPIView): #danh sách lời mời kết bạn đến
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer

    def get_queryset(self):
        return FriendshipRequest.objects.requests(user=self.request.user)
    
class OutgoingFriendRequestsView(generics.ListAPIView): #danh sách yêu cầu đã gửi kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer

    def get_queryset(self):
        return FriendshipRequest.objects.sent_requests(user=self.request.user)
    
class AcceptFriendRequestView(generics.UpdateAPIView): # đồng ý lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()

    def update(self, request, *args, **kwargs):
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "Friend request ID is required"}, status=400)

        friend_request = get_object_or_404(FriendshipRequest, pk=fr_id)

        # Chỉ người nhận mới có quyền accept ( người nhận là to_user và nguòi gửi là request user, phải khác nhau mới accept đc)
        if friend_request.to_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        # Accept lời mời
        friend_request.accept()

        return Response({"detail": "Friend request accepted"})
    
class RejectFriendRequestView(generics.UpdateAPIView): # từ chối lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()

    def update(self, request, *args, **kwargs):
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "Friend request ID is required"}, status=400)

        friend_request = get_object_or_404(FriendshipRequest, pk=fr_id)

        # Chỉ người nhận mới có quyền reject
        if friend_request.to_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        # Reject lời mời
        friend_request.reject()

        return Response({"detail": "Friend request rejected"})

class CancelFriendRequestView(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()  # dùng cho DRF generic

    def destroy(self, request, *args, **kwargs):
        # Lấy ID lời mời từ URL
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "ID is required"}, status=400)

        # Lấy FriendshipRequest theo ID
        fr_obj = get_object_or_404(FriendshipRequest, pk=fr_id)

        # Chỉ người gửi mới có quyền hủy
        if fr_obj.from_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        fr_obj.cancel()
        return Response({"detail": "Friend request canceled"})

    
class UnfriendView(generics.DestroyAPIView): #hủy kết bạn
    permission_classes = [IsAuthenticated]
    #chỉ cần trả về thành công thôi k cần serializer, chỉ cần serizer khi muốn json hóa dữ liệu theo fields bên serializer

    def destroy(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")

        profile = get_object_or_404(Profile, id=profile_id)
        friend_user = profile.user

        if not Friend.objects.are_friends(request.user, friend_user): #kiểm tra có phải là bạn trước khi xóa
            return Response({"error": "Not friends"}, status=400)
        # Xóa bạn bè
        with transaction.atomic():
            Friend.objects.remove_friend(request.user, friend_user)     
            unfriended_log.send( #hook thẳng signal vào view
                sender=self.__class__,  # gửi class hiện tại làm sender 
                user=request.user, 
                target=friend_user,
                verb="unfriended",)
        
        return Response({"detail": "Unfriended"})

class FriendListView(generics.ListAPIView): #danh sách bạn bè
    permission_classes = [IsAuthenticated]
    serializer_class = FriendSerializer 

    def get_queryset(self):
        return Friend.objects.filter(from_user=self.request.user).select_related('to_user__profile')
    
class FriendUser(generics.ListAPIView):
    permission_classes=[IsAuthenticated]
    serializer_class = FriendSerializer
    
    def get_queryset(self):
        user_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile,id=user_id)
        user= profile.user
        return Friend.objects.filter(from_user=user).select_related('to_user__profile')
    
    
class FollowView(generics.CreateAPIView): # theo dõi người dùng
    permission_classes = [IsAuthenticated]
    serializer_class = FollowSerializer

    def create(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile, id=profile_id)
        user_to_follow = profile.user

        # check không follow chính mình
        if request.user == user_to_follow:
            return Response({"error": "Cannot follow yourself"}, status=400)

        # check đã follow chưa
        if Follow.objects.follows(request.user, user_to_follow):
            return Response({"error": "Already following"}, status=400)
        
        #kiểm tra block 
        if Block.objects.is_blocked(request.user, user_to_follow):
            return Response({"error": "Cannot follow user due to blocking"}, status=400)
        
        Follow.objects.add_follower(request.user, user_to_follow)
        return Response({"detail": "Followed"}, status=201)


class UnfollowView(generics.DestroyAPIView): # hủy follow
    permission_classes = [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile, id=profile_id)
        user_to_unfollow = profile.user

        # check có đang follow không
        if not Follow.objects.follows(request.user, user_to_unfollow):
            return Response({"error": "Not following"}, status=400)

        Follow.objects.remove_follower(request.user, user_to_unfollow)
        return Response({"detail": "Unfollowed"})

    
class FollowersListView(generics.ListAPIView): #danh sách follower của user
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_queryset(self):
        return Follow.objects.followers(self.request.user)
    
class FollowingListView(generics.ListAPIView): #danh sách đang follow của user
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_queryset(self):
        return Follow.objects.following(self.request.user)

class BlockView(generics.CreateAPIView): # chặn người dùng
    permission_classes = [IsAuthenticated]
    serializer_class = BlockSerializer

    def create(self,request,*args,**kwargs):
        id= self.kwargs.get('pk')
        profile= get_object_or_404(Profile,id=id)
        user = profile.user

        if request.user == user:
            return Response({"detail": "You cannot block yourself"}, status=400)

        if Block.objects.is_blocked(request.user, user):
            return Response({"detail": "You have already blocked this user."}, status=400)
        
        with transaction.atomic():
            #Xóa follow nếu có, delete() khi không có bản ghi ở trên querryset cũng sẽ k báo lỗi    
            Follow.objects.filter(follower=request.user, followee=user).delete()
            Follow.objects.filter(follower=user, followee=request.user).delete()
            #Xóa bạn nếu có
            Friend.objects.filter(from_user=request.user, to_user=user).delete()
            Friend.objects.filter(from_user=user, to_user=request.user).delete()
            #Xóa lời mời kb 
            FriendshipRequest.objects.filter(from_user=request.user, to_user=user).delete()
            FriendshipRequest.objects.filter(from_user=user, to_user=request.user).delete()
            Block.objects.add_block(request.user,profile.user)

        return Response({'detail':'Blocked'},status=201)

class UnblockView(generics.DestroyAPIView): # bỏ chặn người dùng
    permission_classes = [IsAuthenticated]

    def destroy(self,request,*args,**kwargs):
        id= self.kwargs.get('pk')
        profile= get_object_or_404(Profile,id=id)
        user = profile.user

        if not Block.objects.is_blocked(request.user, user):
            return Response({"detail": "You have not blocked this user."}, status=400)\
        
        if request.user == user:
            return Response({"detail": "You cannot unblock yourself"}, status=400)
        
        Block.objects.remove_block(request.user,user)
        return Response({'detail':'Unblocked'},status=200)
    
class ListBlockedUser(generics.ListAPIView): #danh sách người dùng đã chặn user
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_queryset(self):
        return Block.objects.blocked(user = self.request.user)
    
class ListBlockedFromUser(generics.ListAPIView): #danh sách user đã bị chặn bởi user
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_queryset(self):
        return Block.objects.blocking(user=self.request.user)
    
#===========================Chat=====================================================================
class SendMessageAPIView(APIView): #gửi tin nhắn tới cuộc trò chuyện, nên dùng APIView vì có nhiều logic hơn là chỉ tạo và đặc biệt là k cho gửi body mà phải gán người gửi sender vào luôn
    permission_classes=[IsAuthenticated,IsConversationMember]
    
    def post(self,request,pk):
        conv=get_object_or_404(Conversation, id=pk)
        self.check_object_permissions(request, conv) #kiểm tra permission custom vì dùng APIView nên k tự kiểm tra được khác với generics là tự động kiểm tra permission object, phải truyền vào conv để biết làm việc với obj nào 

        if conv.status == 'pending': # dành cho message request khi chưa là bạn thì phải check, nếu là người nhận đc request thì phải accept mới được gửi tin nhắn
            first_message = Message.objects.filter(conversation=conv).order_by('created_at').first()
            if first_message and request.user != first_message.sender:
                raise PermissionDenied("You must accept the request before replying")
            
        serializer=MessageSerializer(data=request.data) # tạo serializer từ data gửi lên
        serializer.is_valid(raise_exception=True) #check valid
        serializer.save(
            sender=request.user,
            conversation=conv)
        return Response(serializer.data,status=201)
    

class UnsendMessageAPIView(APIView): #action xóa message
    permission_classes = [IsAuthenticated, IsConversationMember]

    def delete(self, request, pk):
        message = get_object_or_404(Message, pk=pk)
        if message.sender != request.user:
            raise PermissionDenied("You can only unsend your own message")
        self.check_object_permissions(request, message.conversation)
        # lưu lại trước khi xóa
        conversation_id = message.conversation_id
        message_id = message.id
        message.delete()
        #Broadcast realtime tin nhắn bị xóa
        
        channel_layer=get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{conversation_id}',
            {
                'type':'chat_message_deleted',
                'id':message_id,
            }
            
        )
        return Response({"detail": "Message unsent"}) 



class StartConversationAPIView(generics.GenericAPIView): #bấm chat với ai đó sẽ get_or_create cuộc trò chuyện với ng đó, truyền vào id user đó
    permission_classes = [IsAuthenticated]
    serializer_class = ConversationSerializer

    def post(self, request, user_id): # hàm post sẽ tự lấy tham số truyền vào từ url là post_id
        target_profile = get_object_or_404(Profile, id=user_id) #láy ra profile từ id
        target_user = target_profile.user #lấy ra user từ profile
        current_user = request.user

        if target_user == current_user:
            return Response(
                {"detail": "Cannot chat with yourself"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if Block.objects.is_blocked(current_user, target_user):
            return Response(
                {"detail": "You cannot start a conversation with this user"},
                status=status.HTTP_403_FORBIDDEN
            )

        convo = (
            Conversation.objects.filter( #lọc ra đoạn chat có mình trước, sau đó từ những đoạn chat có mình thì có target user k 
                is_group=False,
                conversationmember__user=current_user
            ) #lọc ra đoạn chat 1-1 đã có giữa cả 2, và lọc ra xem member trong đó có mình và ng đó k, nếu có thì true, không thì chưa tạo. Chỉ áp dụng cho đoạn chat 1-1, vì group thì cần thêm member chứ k ấn chat được như 1-1
            .filter(conversationmember__user=target_user)
            .distinct()
            .first()
        )

        is_friend = Friend.objects.are_friends(current_user, target_user)
        status_value = 'accept' if is_friend else 'pending'

        if not convo: #nếu chưa có thì tạo mới
            with transaction.atomic(): # đồng bộ database, 1 là thành công hết 2 là 1 cái fail sẽ rollback
                convo = Conversation.objects.create(
                    is_group=False,
                    status=status_value
                )
                ConversationMember.objects.bulk_create([ #bulk create là tạo nhiều bảng cùng 1 lúc thay vì 2 lênh riêng biệt gây nhiều truy vấn
                    ConversationMember(conversation=convo, user=current_user),
                    ConversationMember(conversation=convo, user=target_user),
                ])
        return Response(
            self.get_serializer(convo).data, #get_serializer là hàm của GenericAPIView để lấy serializer đã khai báo ở trên
            status=status.HTTP_200_OK
        )

class AcceptMessageRequest(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, conv_id):
        conv = get_object_or_404(Conversation, pk=conv_id)

        if conv.is_group:# chỉ áp dụng cho chat 1-1 và bỏ qua nếu là group
            return Response(
                {"detail": "Invalid conversation"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if conv.status != 'pending':# chỉ accept khi đang pending
            return Response({"detail": "Conversation is not pending"},status=status.HTTP_400_BAD_REQUEST)
        
        if not ConversationMember.objects.filter(conversation=conv,user=request.user).exists():# user phải là member
            return Response(
                {"detail": "You are not a member of this conversation"},
                status=status.HTTP_403_FORBIDDEN
            ) 
        
        first_message = (# lấy message đầu tiên
            Message.objects.filter(conversation=conv).order_by('created_at').first()
        ) 
        # nếu chưa có message thì không cho accept
        if not first_message:
            return Response(
                {"detail": "No message request to accept"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if Block.objects.is_blocked(request.user, first_message.sender): #kiểm tra người gửi request có bị mình block trước đó k
            return Response({"error": "Cannot accept request due to blocking"}, status=400)
        
        # người gửi message đầu tiên KHÔNG được accept
        if request.user == first_message.sender:
            return Response(
                {"detail": "You cannot accept your own message request"},
                status=status.HTTP_403_FORBIDDEN
            )
        conv.status = 'accept'
        conv.save()
        return Response(
            {"detail": "Message request accepted"},
            status=status.HTTP_200_OK
        )

class RejectMessageRequest(APIView):
    permission_classes=[IsAuthenticated]
    def post(self,request,conv_id):
        conv=get_object_or_404(Conversation,pk=conv_id)
        if conv.is_group:
            return Response({'invalid'},status=400)
        if not ConversationMember.objects.filter(conversation=conv,user=request.user).exists():
            return Response({'You are not member of this Conversation'},status=400)
        if conv.status=='accept':
            return Response({'This conversation has already accepted'},status=400)
        first_message= Message.objects.filter(conversation=conv).order_by('created_at').first()
        if not first_message:
            return Response(
                {"detail": "No message request to reject"},
                status=status.HTTP_400_BAD_REQUEST
            )
        if request.user == first_message.sender: # ng gửi message đầu tiên không được reject
            return Response(
                {"detail": "You cannot reject your own message request"},
                status=status.HTTP_403_FORBIDDEN
            )
        with transaction.atomic():
            conv.delete()
        return Response(
            {"detail": "Message delete"},
            status=status.HTTP_200_OK
        )
        

class ConversationListAPIView(generics.ListAPIView): #mở app chat lên sẽ load tất cả đoạn chat
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    
    def get_queryset(self):
        return Conversation.objects.filter(
            conversationmember__user=self.request.user
        ).distinct().prefetch_related(
            # load members + user + profile + last_read_message trong 2 query
            # (1 query IN lấy members, JOIN thêm user/profile/last_read_message)
            Prefetch(
                'conversationmember_set',  # conversationmember có FK với conversation nên phải lấy tham chiếu là set
                queryset=ConversationMember.objects.select_related( #tùy chỉnh thêm field muốn lấy 
                    'user__profile',       # JOIN user và profile (1-1)
                    'last_read_message'    # JOIN last_read_message (1-1)
                )
            ),
            # load messages mới nhất trong 1 query IN riêng
            # kèm JOIN sender+profile để get_last_message không query thêm
            Prefetch(
                'message_set',             # relation 1-nhiều: 1 conv có nhiều messages
                queryset=Message.objects.select_related(
                    'sender__profile'      # JOIN sender và profile luôn (1-1)
                ).order_by('-created_at'), # sắp xếp mới nhất trước, prefetch related thì k thêm đc
                to_attr='prefetched_messages'  # lưu vào obj.prefetched_messages( vào ram )
            ),
        ).order_by('-updated_at')

class ConversationMessage(generics.ListAPIView): #xem tin nhắn cuộc trò chuyện
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated,IsConversationMember]
    pagination_class = LargePagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    search_fields=['content'] #tìm kiếm trong nội dung tin nhắn
    ordering_fields=['created_at']
    filterset_fields = ['sender'] #lọc theo người gửi

    def get_queryset(self):
        convo_id = self.kwargs.get("pk")
        conv = get_object_or_404(Conversation, id=convo_id)
        self.check_object_permissions(self.request, conv) # phải dùng cho get querryset, chỉ có get object mới k cần dùng còn lại dùng hết
        if self.request.user.is_superuser or self.request.user.is_staff:
            return Message.objects.filter(conversation_id=convo_id).select_related("sender__profile").prefetch_related("attachments").order_by("-created_at")
            
        if not ConversationMember.objects.filter(
            conversation_id=convo_id,
            user=self.request.user
        ).exists():
            raise PermissionDenied("You are not a member of this conversation.")

        return (
            Message.objects
            .filter(conversation_id=convo_id) # lọc theo cuộc trò chuyên 
            .select_related("sender__profile") #lấy ra profile của sender để hiển thị thông tin người gửi đồng thời với message(1-1 với sender)
            .prefetch_related("attachments") #lấy ra tất cả file đính kèm trong message đồng thời với message(Foreign key tới Message Attachments n-n)
            .order_by("-created_at")
        )

class MemberOfConversation(generics.ListAPIView): #danh sách thành viên trong cuộc trò chuyện
    permission_classes = [IsAuthenticated, IsConversationMember]
    serializer_class = ConversationMemberSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filter_fields=['user__profile__first_name','user__profile__last_name']

    def get_queryset(self):
        convo_id = self.kwargs["pk"]

        # 404 trước
        if not Conversation.objects.filter(id=convo_id).exists():
            raise NotFound("Conversation not found.")

        return (
            ConversationMember.objects
            .filter(conversation_id=convo_id)
            .select_related("user", "user__profile")
        )

class SeenMessage(APIView): #đánh dấu đã xem tin nhắn, logic là khi mở trò chuyện sẽ post về server be, be sẽ lấy ra tin nhắn mới nhất và đánh dấu last_read là tin nhắn đó 
    permission_classes = [IsAuthenticated, IsConversationMember]

    def post(self, request, *args, **kwargs):
        convo_id = self.kwargs.get("pk")

        conversation = get_object_or_404(Conversation, id=convo_id)
        self.check_object_permissions(request, conversation)
        last_message = (Message.objects.filter(conversation=conversation).select_related('sender').order_by("-created_at").first()) #lấy ra tin nhắn mới nhất trong cuộc trò chuyện
        if not last_message:
            return Response({"detail": "No messages"}, status=200)

        ConversationMember.objects.filter(
            conversation=conversation,
            user=request.user
        ).update(last_read_message=last_message)

        # Gửi seen event qua WebSocket để đồng bộ các thiết bị khác, cách custome
        
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{convo_id}',
            {
                'type': 'seen_message',
                'user_id': request.user.id,
                'last_message_id': last_message.id,
            }
        )


        return Response({
            "detail": "Conversation marked as seen",
            "last_read_message_id": last_message.id
        })
    
class UpdateMessage(APIView):
    permission_classes = [IsAuthenticated,IsConversationMember]
    def patch(self, request, pk): #patch vì partial là true 
        message = get_object_or_404(Message, pk=pk)
        self.check_object_permissions(request, message.conversation)
        if message.sender != request.user:
            raise PermissionDenied("You can only edit your own message")
        new_content= request.data.get('new_content')
        if not new_content or not new_content.strip():  # check k truyền thì k lưu vào db
            return Response({"detail": "new_content is required"}, status=400)
        serializer= MessageSerializer(message, data={'content':new_content}, partial=True)# vì là update nên phải truyền instance là message đầu tiên, còn create thì k cần truyền instance, partial true để chỉ cập nhật 1 số trường, nếu k có nó sẽ yêu cầu truyền đủ field để cập nhật
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        # broadcast update qua WebSocket

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{message.conversation_id}',
            {
                'type': 'chat_message_updated',  # maps tới hàm trong consumer
                'id': message.id,
                'content': new_content,
                'edited': True,
            }
        )
        return Response(serializer.data)

#=============================================================================
class ProfileRelationship(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, profile_id):#get khác post là chỉ dùng khi lấy dữ liệu. Còn post thì dùng khi thay đổi csdl như tạo update
        profile = get_object_or_404(Profile, pk=profile_id)

        target_user = profile.user
        current_user = request.user

        if target_user == current_user:
            return Response({"status": "myself"})
        if Block.objects.is_blocked(current_user, target_user):
            return Response({"status": "blocked"})
        if Friend.objects.are_friends(current_user, target_user):
            return Response({"status": "friend"})
        if FriendshipRequest.objects.filter(from_user=current_user,to_user=target_user).exists():
            return Response({"status": "request_sent"})
        if FriendshipRequest.objects.filter(from_user=target_user,to_user=current_user).exists():
            return Response({"status": "request_received"})
        if Follow.objects.follows(current_user, target_user):
            return Response({"status": "following"})
        return Response({"status": "none"})
#===============================Thông báo in-app==========================================

class NotificationListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        return Notification.objects.filter(
            reciever =self.request.user
        ).select_related('actor__profile')
        

#===========================Firebase=======================================
class SaveFCMTokenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = request.data.get("token")# nhận token từ client gửi lên
        if not token:
            return Response({"error": "missing token"}, status=400)

        FCMToken.objects.update_or_create( # nếu có thì update còn không thì cập nhật 
            token=token,
            defaults={"user": request.user}
        )
        return Response({"ok": True})

'''
1-1	select_related
N-1 (FK)	select_related
1-N (reverse)	prefetch_related
N-N	prefetch_related
select related là join nhiều bảng 1-1 hoặc n-1
prefetch related là In, truy vấn nhiều query ví dụ lấy ra conv, từ conv lấy ra mem IN con, từ mem lấy profile IN mem
prefetch khác prefetch related là nó vẫn lấy ra nhiều querry cùng 1 truy vấn nhưng có thể sắp xếp, lấy thêm thtin 
Ví dụ khi dùng prefetch_related thì chỉ lấy đc cùng lúc là conv và conv member profile, thì prefetch giúp lấy conv và conv member có thể oderby và filter và tất cả lưu vào ram
'''

#======================Search history=====================

class SearchHistoryView(generics.ListCreateAPIView):
    permission_classes=[IsAuthenticated]
    pagination_class=SmallPagePagination
    serializer_class=SearchSerializer
    filter_backends=[SearchFilter]
    search_fields=['content']
    
    def perform_create(self,serializer):
        serializer.save(user=self.request.user)
    def get_queryset(self):
        return SearchHistory.objects.filter(user=self.request.user)

class SearchAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        keyword = request.query_params.get('q', '').strip() # láy từ url
        if not keyword:
            return Response({'posts': [], 'profiles': []}) # tra về rỗng nếu k có

        user = request.user

        # Lấy danh sách user bị block và block mình
        blocked_ids = [u.id for u in Block.objects.blocked(user)]
        blocking_ids = [u.id for u in Block.objects.blocking(user)]
        excluded_user_ids = set(blocked_ids) | set(blocking_ids)

        # Search Post
        # post_search = PostDocument.search().query( #lọc ra những bài post có title trùng với keyword lấy gần đúng và đúng
        #     MultiMatch(query=keyword, fields=['title'], fuzziness='AUTO') #fuzziness là tự sửa lỗi chính tả
        # )
        post_search = PostDocument.search().query(
            "bool",
            should=[
                MultiMatch(query=keyword, fields=['title'], fuzziness='AUTO'),
                {"match_phrase_prefix": {"title": keyword}}
            ]
        )
        post_ids = [hit.meta.id for hit in post_search]  #lấy id của các bài post sau lọc
        posts = Post.objects.filter( # tìm id trong post mà chưa delete
            post_id__in=post_ids,
            deleted__isnull=True
        ).exclude(
            user_id__in=excluded_user_ids  # loại bài post của người bị block
        ).select_related('user__profile').prefetch_related('photos')

        # Search Profile
        # profile_search = ProfileDocument.search().query( # lọc ra profile trùng với firstname và last name
        #     MultiMatch(query=keyword, fields=['first_name', 'last_name'], fuzziness='AUTO')
        # )
        profile_search = ProfileDocument.search().query(
            "bool",
            should=[
                MultiMatch(query=keyword, fields=['first_name', 'last_name'], fuzziness='AUTO'),
                {"match_phrase_prefix": {"first_name": keyword}}
            ]
        )
        profile_ids = [hit.meta.id for hit in profile_search] #lấy các id từ kết quả lọc
        profiles = Profile.objects.filter(
            id__in=profile_ids,
            deleted__isnull=True
        ).exclude(
            user_id__in=excluded_user_ids  # loại profile của người bị block
        ).select_related('user')

        return Response({ # trả về serializer của 1 trong 2
            'posts': PostSerializer(posts, many=True, context={'request': request}).data,# vì serializer cần lấy request để lấy user ở trường get user is reaction nên cần truyền
            'profiles': ProfileSerializer(profiles, many=True).data,
        })

#=========================Friend Suggest===========================================   
class FriendSuggestion(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = FriendSuggestionSerializer
    pagination_class = SmallPagePagination
    
    def get_queryset(self):
        user = self.request.user

        # lọc ra bạn
        friend_ids = Friend.objects.filter(from_user=user).values_list('to_user_id', flat=True)


        # loại trừ
        sent_ids = [r.to_user_id for r in Friend.objects.sent_requests(user)]
        received_ids = [r.from_user_id for r in Friend.objects.unread_requests(user=user)]
        blocked_ids = [u.id for u in Block.objects.blocked(user)]
        blocking_ids = [u.id for u in Block.objects.blocking(user)]
        
        excluded_user_ids = (
            set(friend_ids) | set(sent_ids) | set(received_ids) |
            set(blocked_ids) | set(blocking_ids) | {user.id}
        ) #gộp các set lại, set để k trùng 

        # lọc các profile có id trong id danh sách bạn bè của bạn mình
        return (
            Profile.objects.filter( 
                user__id__in=Friend.objects.filter( #profile có id trong friend_ids
                    from_user_id__in=friend_ids
                ).values_list('to_user_id', flat=True)
            )
            .exclude(user__id__in=excluded_user_ids) #loại trừ những ng này
            .annotate(
                mutual_count=Count(
                    'user__friends',
                    filter=Q(user__friends__from_user_id__in=friend_ids)
                )
            ) # đếm số bạn chung
            .select_related('user') #join với user
            .order_by('-mutual_count') #lọc ra số bạn chung nhiều nhất
        )




