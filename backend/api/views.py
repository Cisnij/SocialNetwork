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
from rest_framework.parsers import MultiPartParser, FormParser #upload file ảnh
from django.db.models import Q
#filter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter,OrderingFilter
from django.contrib.auth.models import User
from .filters import UserReactionFilter
from rest_framework.response import Response
#friendship xay dựng hệ thống follow bạn bè



#===========================================================================================================================================================================================
class ProfileModify(generics.RetrieveUpdateDestroyAPIView): #Xem sửa xóa profile 
    permission_classes=[IsAuthenticated]
    serializer_class=ProfileSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='profile'

    def get_object(self): #nên dùng get object thay vì get querry vì ở đây cần lấy chỉ 1 đối tượng, get querryset thường dùng trả nhiều đối tượng 
        user = self.request.user 
        profile_id= self.kwargs.get('pk') #cách lấy ra từ url

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

    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return Profile.objects.all()
        else:
            return Profile.objects.filter(user=user)

class ProfileUser(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_object(self):
        user_id = self.kwargs.get("user")  # lấy từ URL
        return get_object_or_404(Profile, id=user_id) #lấy ra user id trong profile, user__id là vì onetoonefield với profile à user là object tức user chứ nhiều thứ bên trong nữa nên lấy ra id từ bên trong đó

class ProfileView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_queryset(self):
        user=self.request.user
        return Profile.objects.filter(user=user)

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

    def perform_create(self, serializer):
        post_id = self.kwargs.get("post_id")
        serializer.save(post_id=post_id)
    
    def post(self, request, *args, **kwargs): #gọi hàm post để thêm nhiều ảnh vào 1 post
        post_id=self.kwargs.get('post_id')
        post=get_object_or_404(Post,pk=post_id) #pk ở đây là bí danh alias cho primary key ở tất cả bảng, vì v khi gọi pk thì dùng pk luôn k cần tên
        photos = request.FILES.getlist('photo')
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

        # bạn bè (list User)
        friends = Friend.objects.friends(user)
        friends_ids = [u.id for u in friends] #lấy ra tất cả id friend để bỏ vào lọc lấy ra post có user_id=friend

        # người mình follow (list User)
        following = Follow.objects.following(user)
        following_ids = [u.id for u in following] # 

        # người mình block (list User)
        blocked = Block.objects.blocked(user)
        blocked_ids = [u.id for u in blocked]

        # người block mình (list User)
        blocked_by = Block.objects.blocking(user)
        blocked_by_ids = [u.id for u in blocked_by]

        allowed_user_ids = set(friends_ids + following_ids + [user.id])# đưa các id vào set để lấy ra post có id = id đó và lấy ra

        excluded_ids = set(blocked_ids + blocked_by_ids) # đưa các id bị block để loại bỏ nó ra khỏi các post bị lấy

        return (
            Post.objects
            .filter(user__id__in=allowed_user_ids) #lấy ra post của id được cho phép
            .exclude(user__id__in=excluded_ids) #loại trừ post ng block
            .order_by('-created_at')
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
        profile = get_object_or_404(Profile, id=profile_id)
        return Post.objects.filter(user=profile.user).order_by('-created_at')

class PostCreate(generics.CreateAPIView):
    permission_classes=[IsAuthenticated]
    throttle_classes =[ScopedRateThrottle]
    throttle_scope='create_post'
    serializer_class=PostSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

class PostListAll(generics.ListAPIView):
    permission_classes=[IsAdminUser]
    serializer_class=PostSerializer
    filter_backends=[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filter_fields=['title','created_at']
    search_fields=['title','content']
    ordering_fields=['post_id','created_at']
    
    def get_queryset(self):
        return Post.objects.all()

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
            return PostArticle.objects.all()
        else:
            return PostArticle.objects.filter(user=user)
        
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
        if user.is_superuser or user.is_staff:
            return Comment.objects.all()
        return Comment.objects.filter(post_id=post_id)
    
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
        return UserReaction.objects.filter(reaction__object_id=post_id)

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
        to_user_id = self.kwargs.get("pk")      # 🔥 Lấy từ URL

        # Kiểm tra ID hợp lệ
        if request.user.id == int(to_user_id):
            return Response({"error": "Cannot send friend request to yourself"}, status=400)

        # Lấy user từ Profile 
        profile = get_object_or_404(Profile, id=to_user_id)
        to_user = profile.user

        # Kiểm tra xem đã là bạn bè chưa
        if Friend.objects.are_friends(request.user, to_user):
            return Response({"error": "Already friends"}, status=400)

        # Kiểm tra đã gửi trước đó chưa
        if FriendshipRequest.objects.filter(
            from_user=request.user, to_user=to_user, rejected__isnull=True # tên trường__isnull = True để kiểm tra có null k
        ).exists():
            return Response({"error": "Friend request already sent"}, status=400)

        # Kiểm tra xem có bị chặn không
        if Block.objects.is_blocked(request.user, to_user) or Block.objects.is_blocked(to_user, request.user):
            return Response({"error": "Cannot send friend request due to blocking"}, status=400)
        
        # Tạo request
        req = Friend.objects.add_friend(request.user, to_user, message="")

        serializer = self.get_serializer(req, context={"request": request})
        return Response(serializer.data, status=201)

    
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

        # Xóa bạn bè
        Friend.objects.remove_friend(request.user, friend_user)
        
        unfriended_log.send( #hook thẳng signal vào view
            sender=self.__class__, 
            user=request.user, 
            target=friend_user,
            verb="unfriended",)
        
        return Response({"detail": "Unfriended"})

class FriendListView(generics.ListAPIView): #danh sách bạn bè
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer # vì trong model friendship lấy user làm khóa ngoại nên phải dùng user serializer để parse ra json

    def get_queryset(self):
        return Friend.objects.friends(self.request.user)
    
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
        if Block.objects.is_blocked(request.user, user_to_follow) or Block.objects.is_blocked(user_to_follow, request.user):
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