import uuid
from itertools import chain
from django.db.models.expressions import Window
from django.db.models.functions import RowNumber
from django.views.generic import DetailView
from urllib3 import request

from backend import settings_backend
from .serializers import *
from rest_framework import generics,permissions
from rest_framework.permissions import *
from django.shortcuts import get_object_or_404
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from .pagination import *
from .signals import unfriended_log
from rest_framework.parsers import MultiPartParser, FormParser,JSONParser #upload file ảnh và dữ liệu dạng form và json parse(khi dùng api view để nhập vào ô body không cần dạng json)
from django.db.models import Q, Prefetch, prefetch_related_objects, F
from .permissions import IsConversationMember, PostViewPermission
from django.db import transaction # tạo đồng bộ db
from rest_framework import status
from .utils import get_reactions_post_context,get_reactions_comment_context
#filter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter,OrderingFilter
from .filters import UserReactionFilter
from rest_framework.response import Response
#friendship xay dựng hệ thống follow bạn bè
from friendship.models import Friend
# broadcast channels 
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
# elastic
from .documents import PostDocument,ProfileDocument
from elasticsearch_dsl.query import MultiMatch
from elasticsearch_dsl import Q as ESQ         # Django Q — dùng cho ORM filter
#cacheops
from cacheops import invalidate_model
#cloudinary
import cloudinary.uploader
# magic-bin
import magic
# meta
from meta.views import MetadataMixin

def get_online_set(queryset):  # custome để gọi get user online 1 lần thay vì 20 lần get trong serializer, dùng chung
    ids = queryset.values_list('user_id',flat=True)  # lấy các user id trong queryset của serializer đưa vào list với 1 fields
    hits = cache.get_many([f"online_user:{uid}" for uid in ids])  # lấy 1 lúc hết các id onl trong query set trong redis thay vì gọi get 20 lần trong redis
    return {uid for uid in ids if f"online_user:{uid}" in hits}  # nếu các user online đang lưu trong redís nằm trong queryset thì trả ra các user đó

#===========================================================================================================================================================================================
class ProfileModify(generics.RetrieveUpdateDestroyAPIView): #Xem sửa xóa profile 
    permission_classes=[IsAuthenticated]
    serializer_class=ProfileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
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
    def perform_update(self, serializer):
        picture = self.request.FILES.get("picture")
        if picture:
            instance= serializer.save(user=self.request.user, picture=picture)
        else:
            instance= serializer.save(user=self.request.user)
        # check nếu đã có photo lần đầu thì update is_complete mãi mãi, còn chưa thì vẫn là false
        if not instance.is_completed and instance.picture: # nếu không is_completed và có picture truyền vào 
            Profile.objects.filter(pk=instance.pk).update(is_completed=True)

    def get_object(self): #nên dùng get object thay vì get querry vì ở đây cần lấy chỉ 1 đối tượng, get querryset thường dùng trả nhiều đối tượng 
        user = self.request.user 
        profile_id= self.kwargs.get('pk') #cách lấy ra từ urlS dược định nghĩa trong url

        if user.is_superuser or user.is_staff:
            if not profile_id:
                raise NotFound("Admin cần truyền ID profile để truy cập.")
            return get_object_or_404(Profile.objects.select_related('user','user__profile'), id=profile_id)
            
        return get_object_or_404(Profile.objects.select_related('user'), user=user)

class PrivateProfileModify(generics.RetrieveUpdateAPIView):
    permission_classes=[IsAuthenticated]
    serializer_class= PrivateProfileSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='profile'
    def get_object(self):
        user =self.request.user
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
        return Profile.objects.filter(user=user).select_related('user').order_by('id')

    def get_serializer_context(self): #gọi hàm custome ở trên
        context = super().get_serializer_context()
        #  Lấy dữ liệu queryset đã lọc  (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset() # gọi query set lại
        context['online_set'] = get_online_set(objs) # truyền tất cả profile vào và lấy ra tất cả status onl
        return context
    
class ProfileUser(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_object(self):
        user_id = self.kwargs.get("user")  # lấy từ URL
        user=self.request.user
        target_profile=get_object_or_404(Profile.objects.select_related("user"),id=user_id)#lấy ra user id trong profile, user__id là vì onetoonefield với profile và user là object tức user chứa nhiều thứ bên trong nữa nên lấy ra id từ bên trong đó
        target_user=target_profile.user
        if Block.objects.is_blocked(user, target_user): #check block
            raise PermissionDenied("Cannot see profile of this user")
        return target_profile

class ProfileView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer

    def get_object(self):
        try:
            return Profile.objects.select_related('user').get(user=self.request.user)
        except Profile.DoesNotExist:
            raise NotFound("Không tìm thấy Profile cho người dùng này.")

class PendingProfileList(generics.ListAPIView):#List profile chờ duyệt
    permission_classes=[IsAdminUser]
    serializer_class=PendingProfileSerializer
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields=['first_name','last_name','phone_number','date_of_birth']
    search_fields=['first_name','last_name','phone_number']
    ordering_fields=['id','created_at']
    pagination_class = LargePagePagination


    def get_queryset(self):
        user=self.request.user
        if user.is_superuser or user.is_staff:
            return PendingProfile.objects.all().select_related('user')
        raise PermissionDenied("Không có quyền truy cập")

#===============================POST=======================================================
class PostPhotoListCreate(generics.ListCreateAPIView):
    serializer_class = PostPhotoSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser] #dùng để lấy ảnh dạng formData
    #trình tự xử lý: api gọi, view xử lý theo chức năng crud trước, sau đó chạy serializer parse json và thực thi tới perform create.. mấy thứ ghi trong view sau đó thêm vào model
    def get_queryset(self):
        post_id = self.kwargs.get("post_id")
        return PostPhoto.objects.filter(post_id=post_id).select_related('post')

    def perform_create(self, serializer): #trước khi lưu ảnh vào postphoto thì gán post id vào cùng
        post_id = self.kwargs.get("post_id")
        serializer.save(post_id=post_id) # gán id vào
    
    def post(self, request, *args, **kwargs): #gọi hàm post để thêm nhiều ảnh vào 1 post
        post_id=self.kwargs.get('post_id')
        post=get_object_or_404(Post.objects.select_related("user"),pk=post_id) #pk ở đây là bí danh alias cho primary key ở tất cả bảng, vì v khi gọi pk thì dùng pk luôn k cần tên
        if post.user != request.user and not request.user.is_staff: # không phải là user chủ post kh được upload
            raise PermissionDenied()
        photos = request.FILES.getlist('photo') # lấy data dạng file từ form data gửi lên và dùng form parser để parse về json và lưu

        try:
            with transaction.atomic():
                for photo in photos:
                    photo= PostPhoto.objects.create(post=post,photo=photo)
                return Response({'message': 'success'})
        except Exception:
            return Response({'error': 'upload failed'},status=500)


class PostPhotoDelete(generics.DestroyAPIView):  # xóa ảnh (chức năng của sửa post)
    permission_classes = [IsAuthenticated]
    serializer_class = PostPhotoSerializer

    def get_object(self):
        user = self.request.user
        photo_id = self.kwargs.get('pk')
        if not photo_id:
            raise NotFound("Cần truyền ID ảnh để xóa.")
        photo = get_object_or_404(PostPhoto.objects.select_related('post__user'), id=photo_id)
        if photo.post.user != user and not (user.is_superuser or user.is_staff):
            raise PermissionDenied("Bạn không có quyền xóa ảnh này.")
        return photo


class PostFriend(generics.ListAPIView):  # List tất cả post của bạn bè
    permission_classes = [IsAuthenticated]
    serializer_class = PostSerializer
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ['title', 'created_at']
    search_fields = ['title']
    ordering_fields = ['post_id', 'created_at']

    def get_queryset(self):
        if not hasattr(self, '_qs'):  # vì get_serializer_context gọi lại get_queryset nên nó sẽ query lần nữa nên thêm, chạy lần đầu thì get, lần 2 nếu có r thì k filter mà dùng luôn
            #self dùng để cho các def khác có thể lấy được, và cũng private trong class này
            user = self.request.user
            # lấy ra tất cả id và chỉ id
            friend_ids   = Friend.objects.filter(to_user=user).values_list("from_user_id", flat=True)
            following_ids = Follow.objects.filter(follower=user).values_list("followee_id", flat=True)
            blocked_ids  = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
            blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
            self._qs = (
                Post.objects
                .filter( # câu lệnh Q..| là OR
                    Q(user_id=user.id) |  #lấy post của user
                    Q(user_id__in=friend_ids,privacy__in=['public','friends']) |
                    Q(user_id__in=following_ids, privacy='public') #lấy post của follow
                )
                .exclude(user_id__in=blocked_ids) #loại block
                .exclude(user_id__in=blocking_ids)
                .select_related("user", "user__profile")
                .prefetch_related("photos")
                .order_by("-created_at")
                .distinct()
            )
        return self._qs

    def get_serializer_context(self):  # gọi xử lý liệt kê reaction từng post và user reaction chỉ 1 lần thay vì nhiều trong serializer
        context = super().get_serializer_context() #kế thừa
        #  Lấy dữ liệu đã "nấu chín" (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset() # lấy query set là những thằng lọc để list ra của hàm trên
        context.update(get_reactions_post_context(objs, self.request.user))  # update context theo cái return utils
        return context #return về cho serializer xử lý


class PostModify(generics.RetrieveUpdateDestroyAPIView):  # Xem sửa xóa post
    permission_classes = [IsAuthenticated,PostViewPermission] #rules check can view và edit
    serializer_class = PostSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'post'

    def get_object(self):
        post_id = self.kwargs.get('pk')
        post = get_object_or_404(Post.objects.select_related('user__profile').prefetch_related('photos'),post_id=post_id)
        self.check_object_permissions(self.request, post)  #  rules chạy ở đây, nó sẽ check post public hay friends và có đc xem,edit
        return post

class PostUser(generics.ListAPIView):  # List tất cả post của user
    permission_classes = [IsAuthenticated]
    serializer_class = PostSerializer
    pagination_class = SmallPagePagination
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ['title', 'created_at']
    search_fields = ['title']
    ordering_fields = ['post_id', 'created_at']
    '''chạy check quyền trước tới check method, sau đó chạy def lọc ra query set và phân trang sau đó mới vào serializer render theo fields của từng data'''

    def get_queryset(self):
        if not hasattr(self, '_qs'):
            profile_id = self.kwargs.get("user")
            user = self.request.user
            profile = get_object_or_404(Profile.objects.select_related("user"), id=profile_id)
            target_user = profile.user
            if Block.objects.is_blocked(user, target_user):
                raise PermissionDenied("Cannot see posts of this user")
            #là chính mình thì lấy tất cả
            if user==target_user:
                self._qs= Post.objects.filter(user=target_user).select_related('user__profile').prefetch_related('photos').order_by('-is_pinned','-created_at')
            # là bạn thì lấy post public và friend
            elif Friend.objects.are_friends(user,target_user):
                self._qs= Post.objects.filter(user=target_user,privacy__in=['public','friends']).select_related('user__profile').prefetch_related('photos').order_by('-is_pinned','-created_at')
            # là người lạ thì chỉ lấy public
            else:
                self._qs = Post.objects.filter(user=target_user,privacy='public').select_related('user__profile').prefetch_related('photos').order_by('-is_pinned','-created_at')
        return self._qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        #  Lấy dữ liệu đã "nấu chín" (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset()
        context.update(get_reactions_post_context(objs, self.request.user))
        return context


class PostCreate(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'create_post'
    serializer_class = PostSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class PostListAll(generics.ListAPIView):
    permission_classes = [IsAdminUser]
    # permissions_classes =[IsAuthenticated]
    serializer_class = PostSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filter_fields = ['title', 'created_at']
    search_fields = ['title', 'content']
    ordering_fields = ['post_id', 'created_at']
    pagination_class = LargePagePagination

    def get_queryset(self):
        if not hasattr(self, '_qs'):
            self._qs = Post.objects.all().select_related('user__profile').prefetch_related('photos').order_by(
                '-created_at')
        return self._qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        #  Lấy dữ liệu đã "nấu chín" (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset()
        context.update(get_reactions_post_context(objs, self.request.user))
        return context

class PinPostView(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PostSerializer

    def get_object(self):
        post = get_object_or_404(Post, pk=self.kwargs.get('pin_id'))
        if post.user != self.request.user:
            raise PermissionDenied('You are not the post owner')
        return post

    def update(self, request, *args, **kwargs):
        post = self.get_object()
        with transaction.atomic():
            if post.is_pinned:
                post.is_pinned = False
            else:
                # Unpin post cũ của user này trước
                Post.objects.filter(user=request.user, is_pinned=True).update(is_pinned=False)
                post.is_pinned = True
            post.save(update_fields=['is_pinned'])
        return Response({'is_pinned': post.is_pinned}, status=status.HTTP_200_OK)

class PostShareView(MetadataMixin, DetailView): #  có preview card cho các third-party application
    #tạo preview card
    model=Post # làm việc với model
    template_name ='share/post.html' # render file này khi user vào api
    slug_field= 'share_code' #lookup với field này trong model
    slug_url_kwarg='share_code' # lấy ra từ url
    context_object_name='post'

    def get_object(self):
        share_code=self.kwargs.get('share_code')
        post = get_object_or_404(Post.objects.select_related('user__profile').prefetch_related('photos'), share_code=share_code)
         #check thủ công xem post đc share thì user có đc xem
        if not PostViewPermission().has_object_permission(self.request,self,post):
            raise PermissionDenied() # 403 fe sẽ tự load không thể xem, 404 là lỗi thật
        # Bot của FB để get ra html và render preview khi paste trên FB, chỉ tăng khi user thật, không phải bot
        user_agent = self.request.META.get('HTTP_USER_AGENT', '').lower()
        is_bot = any(bot in user_agent for bot in [
            'facebookexternalhit', 'twitterbot', 'telegrambot',
            'whatsapp', 'linkedinbot', 'zalo'
        ])
        if not is_bot: # nếu người thật
            post.share_count += 1
            post.save(update_fields=['share_count']) # update_fields để patch update 1 phần thay vì toàn bộ
        return post

    def get_context_data(self, **kwargs): # truyền context qua file html fe, context lưu vô ram và chỉ sống 1 request, tức là render ra html xong là hết và nếu f5 render lại
        context = super().get_context_data(**kwargs)
        context['frontend_url'] = f'{settings_backend.FRONTEND_URL}/post/share/{self.object.share_code}/'
        photo = self.object.photos.first()
        context['og_image'] = (
            self.request.build_absolute_uri(photo.image.url)
            if photo else None
        )
        context['og_description'] = (getattr(self.object, 'title', '') or '')[:150]
        return context

    #preview card
    def get_meta_title(self,context=None): # hiện ra trên card là title
        return f'{self.object.user.profile.full_name} on SocialNetwork app'
    def get_meta_description(self, context=None): # hiện ra phần nội dung dưới title
        content = self.object.title or ''
        return content[:100]
    def get_meta_image(self, context=None): # hiện ảnh preview
        first_photo = self.object.photos.first() 
        if first_photo:
            return self.request.build_absolute_uri(first_photo.image.url)
        return None
    def get_meta_url(self, context=None):
        return f'{settings_backend.FRONTEND_URL}/post/share/{self.object.share_code}/'
    def get_meta_type(self, context=None):
        return 'article'

class PostShareDetailView(generics.RetrieveAPIView): # khi fe redirect thì load ra json
    permission_classes = [IsAuthenticated,PostViewPermission]
    serializer_class = PostSerializer

    def get_object(self):
        share_code=self.kwargs.get('share_code')
        post = get_object_or_404(Post.objects.select_related('user__profile').prefetch_related('photos'), share_code=share_code)
        self.check_object_permissions(self.request, post) #check xem post đc share thì user có đc xem
        return post

class ChangePostPrivacy(APIView):
    permission_classes = [IsAuthenticated,PostViewPermission]
    def patch(self,request,post_id):
        post= get_object_or_404(Post,post_id=post_id)
        self.check_object_permissions(request, post)
        privacy_type=request.data.get("privacy_type")
        if privacy_type not in ['public', 'friends', 'private']:
            return Response(
                {'error': 'privacy_type phải là public, friends hoặc private'},
                status=status.HTTP_400_BAD_REQUEST
            )
        post.privacy=privacy_type
        post.save(update_fields=['privacy'])
        return Response({'post_id': post.post_id, 'privacy': post.privacy})

class AllPostShareView(generics.ListCreateAPIView): # tất cả share của 1 bài viết
    permission_classes = [IsAuthenticated,PostViewPermission]
    serializer_class = PostShareSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        post_id = self.kwargs.get('post_id')
        user = self.request.user
        # Lấy post gốc, check quyền xem trước, có là public hoặc user hiện có là bạn với post gốc privacy là friends
        post = get_object_or_404(Post.objects.select_related('user'), post_id=post_id)
        if not user.has_perm('api.view_post', post): # dùng rules trực tiếp check post gốc vì nhận vào id post gốc
            raise PermissionDenied()

        # Lọc block: loại share của người đã block / bị block
        blocked_ids = Block.objects.filter(blocked=user).values_list('blocker_id', flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list('blocked_id', flat=True)

        # Lấy share của chính mình + bạn bè (public/friends) + người lạ (chỉ public)
        friend_ids = Friend.objects.filter(to_user=user).values_list('from_user_id', flat=True)

        return (
            PostShare.objects
            .filter(post_id=post_id)
            .filter(
                Q(user=user) |                                      # share của chính mình
                Q(user_id__in=friend_ids, privacy__in=['public', 'friends']) |  # người share là bạn mình thì hiện theo privacy
                Q(privacy='public')                                 # người lạ chỉ thấy public
            )
            .exclude(Q(user_id__in=blocked_ids) | Q(user_id__in=blocking_ids))
            .select_related('user__profile', 'post__user__profile')
            .prefetch_related('post__photos')
            .order_by('-created_at')
        )
    def create(self, request, *args, **kwargs):
        post_id = self.kwargs.get('post_id')
        content =self.request.data.get('content')
        privacy = self.request.data.get('privacy', 'public') #key nhận là privacy và default là public
        if privacy not in ['public', 'friends', 'private']:
            return Response({'error': 'privacy không hợp lệ'}, status=400)
        post=get_object_or_404(Post.objects.select_related('user__profile'),post_id=post_id)
        self.check_object_permissions(self.request, post)
        PostShare.objects.create(post=post,user=self.request.user,content=content,privacy=privacy)
        post.share_count += 1
        post.save(update_fields=['share_count'])  # update_fields để patch update 1 phần thay vì toàn bộ
        return Response({'message': 'Share thành công'}, status=status.HTTP_201_CREATED)


class PostUserShareDelete(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]
    # xóa nên k cần truyền serializer
    def get_object(self): # dùng get_objecct cho destroy để k cần phải xử lý dài như .delete() và response
        return get_object_or_404(PostShare, id=self.kwargs.get('pk'), user=self.request.user)

class PostUserShare(generics.ListAPIView): #tất cả share của 1 user
    permission_classes = [IsAuthenticated]
    serializer_class = PostShareSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        target_id = self.kwargs.get('user_id')
        profile = get_object_or_404(Profile.objects.select_related('user'), id=target_id)
        target_user = profile.user
        user = self.request.user

        if Block.objects.is_blocked(user, target_user):
            raise PermissionDenied("Cannot see posts of this user")

        friend_ids = Friend.objects.filter(to_user=user).values_list('from_user_id', flat=True)
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)

        if target_user == user:
            privacy_filter = {}
        elif Friend.objects.are_friends(user, target_user):
            privacy_filter = {'privacy__in': ['public', 'friends']}
        else:
            privacy_filter = {'privacy': 'public'}
        '''đầu tiên là khi truyền vào 1 id để xem share của 1 người thì phải lấy ra những bài share mà user hiện tại đc xem thôi
         -> Check theo thứ tự gốc tới share, 
         gốc: post là public, post.user là bạn của user hiện tại, post của user
         share: người share là target_user và privacy là public hoặc friend nếu là friend
         '''
        return (
            PostShare.objects
            .filter(
                Q(post__privacy='public') | # lọc ra post share mà post gốc là public
                Q(post__user_id__in=friend_ids, post__privacy='friends') |#lọc ra post share mà user post gốc là bạn và privacy là bạn
                Q(post__user=user)   # lọc ra post share mà post có user là user hiện tại
            )
            .exclude(Q(post__user_id__in=blocked_ids) | Q(post__user_id__in=blocking_ids)) #check block post gốc, xóa nếu nó share bài của ng mình block
            .filter(user=target_user, **privacy_filter)
            .select_related('user__profile', 'post__user__profile')
            .prefetch_related('post__photos')
            .order_by('-created_at')
        )

class PostFriendShare(generics.ListAPIView): # tất cả share của bạn bè
    permission_classes = [IsAuthenticated]
    serializer_class = PostShareSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        user = self.request.user
        friend_ids = Friend.objects.filter(to_user=user).values_list("from_user_id", flat=True)
        following_ids = Follow.objects.filter(follower=user).values_list("followee_id", flat=True)
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
        return (PostShare.objects.filter(
            # share của mình
            Q(user=user) |
            #post share của bạn và following
            Q(user_id__in=friend_ids, privacy='public') |
            Q(user_id__in=friend_ids, privacy='friends')
        )
        .filter(
            #check post gốc
            Q(post__privacy='public') | # lọc ra post gốc là public
            Q(post__user_id__in=friend_ids, post__privacy='friends') | # lọc ra post gốc là của friends và privacy là friends
            Q(post__user_id__in=following_ids, post__privacy='public') # lọc ra post gốc là của following và public
        )
        .exclude(
            #loại trừ block từ user post gốc
            Q(post__user_id__in=blocked_ids) | #check block post gốc
            Q(post__user_id__in=blocking_ids)|
            Q(user_id__in=blocked_ids) | #check block người share
            Q(user_id__in=blocking_ids)
        )
        .filter(privacy__in=['public', 'friends']) #lọc share public và friends
        .select_related('user__profile', 'post__user__profile')
        .prefetch_related('post__photos')
        .order_by('-created_at'))

class ChangePostSharePrivacy(APIView):
    permission_classes = [IsAuthenticated,PostViewPermission]
    def patch(self,request,share_id):
        post_share= get_object_or_404(PostShare,id=share_id,user=request.user)
        privacy_type=request.data.get("privacy_type")
        if privacy_type not in ['public', 'friends', 'private']:
            return Response(
                {'error': 'privacy_type phải là public, friends hoặc private'},
                status=status.HTTP_400_BAD_REQUEST
            )
        post_share.privacy=privacy_type
        post_share.save(update_fields=['privacy'])
        return Response({'post_share_id': post_share.id, 'privacy': post_share.privacy})

class PostReportView(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PostReportSerializer
    def perform_create(self, serializer):
        post_id= self.kwargs.get('post_id')
        post = get_object_or_404(Post,post_id=post_id)
        if post.user == self.request.user:
            raise ValidationError('Cannot report your own post') # perform create chỉ dùng đc ValidationError
        serializer.save(post=post,user=self.request.user)


#===================POSTARTICLE===============================
class PostArticleListCreate(generics.ListCreateAPIView):  # List tất cả post
    permission_classes = [IsAuthenticated]
    serializer_class = PostArticalSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ['title', 'created_at']
    search_fields = ['title', 'content']
    ordering_fields = ['postA_id', 'created_at']
    pagination_class = LargePagePagination
    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or user.is_staff:
            return PostArticle.objects.all().select_related('user__profile')
        else:
            return PostArticle.objects.filter(user=user).select_related('user__profile')

    def perform_create(self, serializer):  # gán user khi tạo post article
        serializer.save(user=self.request.user)


class PostArticleModify(generics.RetrieveUpdateDestroyAPIView):  # Xem sửa xóa post
    permission_classes = [IsAuthenticated]
    serializer_class = PostArticalSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'post_article'

    def get_object(self):
        user = self.request.user
        postA_id = self.kwargs.get('pk')
        if user.is_superuser or user.is_staff:
            if not postA_id:
                raise NotFound("Admin cần truyền ID post và slug chính xác để truy cập.")
            return get_object_or_404(PostArticle, postA_id=postA_id)

        return get_object_or_404(PostArticle, user=user, postA_id=postA_id)

#==================COMMENT===============================================
class CommentListCreate(generics.ListCreateAPIView):  # thêm list comment
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_fields = ['post', 'content', 'user']
    search_fields = ['content']
    ordering_fields = ['created_at']
    pagination_class = LargePagePagination
    def get_queryset(self):
        if not hasattr(self, '_qs'):
            post_id = self.kwargs.get('post_id')
            user = self.request.user
            if not post_id:
                raise NotFound("Cần truyền ID post để truy cập.")
            blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
            blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
            # if user.is_superuser or user.is_staff:
            #     return Comment.objects.all()
            #lọc ra và count các replies con bên trong cmt cha parent is null=True
            self._qs = Comment.objects.filter(post_id=post_id, parent__isnull=True).exclude(Q(user_id__in=blocked_ids)| Q(user_id__in=blocking_ids)).select_related('user__profile','post').prefetch_related('tagged_users__profile').annotate(reply_count=Count('replies')).order_by('-is_pinned','-created_at')#count related fields của parent là replies
            # ví dụ lấy ra comment c, join với comment r ON r.parent_id=c.id và count cái r.id
        return self._qs

    '''quy trình là get_queryset lấy full data, sau đó filter , sau đó mới chạy phân trang chia ra n bản ghi trong n trang sau đó mới get_serializer_context'''
    def get_serializer_context(self):
        context=super().get_serializer_context()
        #  Lấy dữ liệu đã "nấu chín" (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset()
        context.update(get_reactions_comment_context(objs, self.request.user))
        return context

    def perform_create(self, serializer):  # gán user và post_id khi tạo comment, validate gán comment nested đúng post đúng parent
        post_id = self.kwargs.get('post_id')
        if not post_id:
            raise NotFound("Cần truyền ID post để tạo comment.")
        parent_id = self.request.data.get('parent_id')
        parent=None
        if parent_id:
            parent = Comment.objects.filter(id=parent_id, post_id=post_id).only('id', 'parent_id').first()
            if parent is None:  # không tìm thấy hoặc đã bị xóa
                raise ValidationError("Comment cha không khả dụng.")
            # Chỉ 1 cấp reply: nếu client gửi id reply con thì gắn về comment gốc
            if parent.parent_id is not None: # check chỉ được reply 1 cấp , nếu parent đã có parent thì k cho và gán comment gốc đó luôn
                parent = Comment.objects.filter(
                    id=parent.parent_id, post_id=post_id
                ).only('id', 'parent_id').first()
                if parent is None:
                    raise ValidationError("Comment cha không khả dụng.")
        serializer.save(user=self.request.user, post_id=post_id, parent=parent)


class CommentModify(generics.RetrieveUpdateDestroyAPIView):  # Xem sửa xóa comment
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'comment'

    def get_object(self):
        user = self.request.user
        comment_id = self.kwargs.get('pk')
        if user.is_superuser or user.is_staff:
            if not comment_id:
                raise NotFound("Admin cần truyền ID comment để truy cập.")
            return get_object_or_404(Comment.objects.prefetch_related('tagged_users'), id=comment_id)

        return get_object_or_404(Comment.objects.prefetch_related('tagged_users'), user=user, id=comment_id)

    def destroy(self, request, *args, **kwargs):
        comment_id = self.kwargs.get('pk')
        user = request.user
        if not comment_id:
            raise NotFound('Enter id')
        comment = Comment.objects.select_related('user', 'post__user').filter(id=comment_id).first()
        if not comment:
            raise NotFound('Comment not found')
        post_owner = comment.post.user
        if post_owner == user or comment.user == user: # user và chủ post có thể xóa
            comment.delete()
            return Response({'Success'}, status=200)
        return Response({'Cannot delete'}, status=404)

class NestedCommentList(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ['content']
    ordering_fields = ['created_at']
    pagination_class = SmallPagePagination

    def get_queryset(self):
        if not hasattr(self, '_qs'):
            user = self.request.user
            comment_id = self.kwargs.get('pk')
            comment = get_object_or_404(Comment, id=comment_id)
            # lấy danh sách user bị block
            blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
            blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
            self._qs= Comment.objects.filter(
                parent=comment,
            ).exclude(
                Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)
            ).select_related('user__profile').prefetch_related('tagged_users')
        return self._qs

    def get_serializer_context(self):
        context=super().get_serializer_context()
        #  Lấy dữ liệu đã "nấu chín" (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset()
        context.update(get_reactions_comment_context(objs, self.request.user))
        return context

class PinCommentView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer

    def get_object(self):
        comment = get_object_or_404(
            Comment.objects.select_related('post'),
            pk=self.kwargs.get('pin_id')
        )
        if comment.post.user_id != self.request.user.id:
            raise PermissionDenied('You are not the post owner')
        return comment

    def update(self, request, *args, **kwargs):
        comment = self.get_object() #gọi lại tất cả logic hàm get_object
        if comment.is_pinned:
            comment.is_pinned = False
        else:
            # Unpin comment cũ trước
            Comment.objects.filter(post_id=comment.post_id, is_pinned=True).update(is_pinned=False)
            comment.is_pinned = True
        comment.save(update_fields=['is_pinned'])
        return Response({'is_pinned': comment.is_pinned}, status=status.HTTP_200_OK)




class SettingModify(generics.RetrieveUpdateAPIView):  # Xem sửa setting
    permission_classes = [IsAuthenticated]
    serializer_class = SettingSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'setting'

    def get_object(self):
        user = self.request.user
        id = self.kwargs.get('pk')
        if not id:
            raise NotFound("Admin cần truyền ID setting để truy cập.")
        if user.is_superuser or user.is_staff:
            return get_object_or_404(Setting, id=id)
        return get_object_or_404(Setting, user=user, id=id)

class UserSetting(generics.RetrieveAPIView):  # Xem setting
    permission_classes = [IsAuthenticated]
    serializer_class = SettingSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'setting'

    def get_object(self):
        setting, _ = Setting.objects.get_or_create(
            user=self.request.user,
            defaults={"darkmode": False},
        )
        return setting

#======================REACTION===================
class UserReactionPostList(generics.ListAPIView):  # Danh sách reaction của user trên post
    permission_classes = [IsAuthenticated]
    serializer_class = ReactionSerializer
    pagination_class = SmallPagePagination
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filterset_class = UserReactionFilter  # custome để lọc theo kiểu reaction ví dụ lọc ra like hay haha
    search_fields = ['user__profile__first_name', 'user__profile__last_name']

    def get_queryset(self):
        post_id = self.kwargs.get('post_id')
        post_ct= ContentType.objects.get_for_model(Post)
        user = self.request.user
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True) #lazy tức là chưa query ngay mà db xử lý trực tiếp
        return UserReaction.objects.filter(reaction__object_id=post_id,reaction__content_type=post_ct).exclude(Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)).select_related('user__profile','reaction__settings', 'react')

class UserReactionCommentList(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ReactionSerializer
    pagination_class = SmallPagePagination
    filterset_class = UserReactionFilter
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ['user__profile__first_name', 'user__profile__last_name']

    def get_queryset(self):
        comment_id = self.kwargs.get('comment_id')
        comment_ct=ContentType.objects.get_for_model(Comment)
        user = self.request.user
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
        return UserReaction.objects.filter(reaction__object_id=comment_id,reaction__content_type=comment_ct).exclude(Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)).select_related('user__profile','reaction__settings', 'react')


#===============ACTIVITY==========================
class UserActivity(generics.ListAPIView):  # lấy ra danh sách các hoạt động. Để tạo chức năng ví dụ hoạt động của user, hoạt động trên post
    serializer_class = ActionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = SmallPagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    search_fields=['verb', 'actor_object_id'] #tìm kiếm
    ordering_fields=['id','timestamp'] #sắp xếp theo thứ tự tăng giảm dần

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or user.is_staff:
            return (
                Action.objects.all()
                .prefetch_related(
                    'actor',
                    'target',
                    'action_object',
                )
                .order_by('-timestamp')
            )

        return (
            Action.objects.filter(
                actor_content_type=ContentType.objects.get_for_model(user),
                actor_object_id=str(user.id)
            )
            .prefetch_related(
                'actor',
                'target',
                'action_object',
            )
            .order_by('-timestamp')
        )

#===================LOG==================
class LogList(generics.ListAPIView):  # Danh sách log hoạt động
    serializer_class = LogSerializer
    permission_classes = [IsAdminUser]
    pagination_class = LargePagePagination

    def get_queryset(self):
        return Log.objects.all().order_by('-created_log_at')

# ===================================================FriendShip========================================================================================

class SendFriendRequestView(generics.CreateAPIView):  # tạo lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer

    def create(self, request, *args, **kwargs):
        to_user_id = self.kwargs.get("pk")  # Lấy từ URL

        # Lấy user từ Profile 
        profile = get_object_or_404(Profile.objects.select_related("user"), id=to_user_id)
        to_user = profile.user

        # Kiểm tra ID hợp lệ
        if request.user == profile.user:
            return Response({"error": "Cannot send friend request to yourself"}, status=400)

        # Kiểm tra xem đã là bạn bè chưa
        if Friend.objects.are_friends(request.user, to_user):
            return Response({"error": "Already friends"}, status=400)

        # Kiểm tra đã gửi trước đó chưa
        if FriendshipRequest.objects.filter(
                from_user=request.user, to_user=to_user, rejected__isnull=True
                # tên trường__isnull = True để kiểm tra có null k
        ).exists():
            return Response({"error": "Friend request already sent"}, status=400)

        # Kiểm tra xem có bị chặn không
        if Block.objects.is_blocked(request.user, to_user):
            return Response({"error": "Cannot send friend request due to blocking"}, status=400)

        # kiểm tra trên 1k bạn thì k đc thêm
        if Friend.objects.filter(from_user=request.user).count() >1000 or Friend.objects.filter(from_user=to_user).count() >1000:
            return Response(
                {'error': 'Đã đạt giới hạn bạn bè'},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Tạo request
        with transaction.atomic():
            req = Friend.objects.add_friend(request.user, to_user, message="")  # tạo lời mời kb

        serializer = self.get_serializer(req, context={
            "request": request})  # get_serializer của hàm và truyền vào object vừa tạo ở trên chuyển sang json
        return Response(serializer.data, status=201)  # response dạng serialier đó


class IncomingFriendRequestsView(generics.ListAPIView):  # danh sách lời mời kết bạn đến
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        return Friend.objects.requests(user=self.request.user)


class OutgoingFriendRequestsView(generics.ListAPIView):  # danh sách yêu cầu đã gửi kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        return Friend.objects.sent_requests(user=self.request.user)


class AcceptFriendRequestView(generics.UpdateAPIView):  # đồng ý lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()

    def update(self, request, *args, **kwargs):
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "Friend request ID is required"}, status=400)

        friend_request = get_object_or_404(FriendshipRequest.objects.select_related("to_user"), pk=fr_id)

        # Chỉ người nhận mới có quyền accept ( người nhận là to_user và nguòi gửi là request user, phải khác nhau mới accept đc)
        if friend_request.to_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        # Accept lời mời
        friend_request.accept()

        return Response({"detail": "Friend request accepted"})


class RejectFriendRequestView(generics.UpdateAPIView):  # từ chối lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()

    def update(self, request, *args, **kwargs):
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "Friend request ID is required"}, status=400)

        friend_request = get_object_or_404(FriendshipRequest.objects.select_related("to_user"), pk=fr_id)

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
        fr_obj = get_object_or_404(FriendshipRequest.objects.select_related("from_user"), pk=fr_id)

        # Chỉ người gửi mới có quyền hủy
        if fr_obj.from_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        fr_obj.cancel()
        return Response({"detail": "Friend request canceled"})


class UnfriendView(generics.DestroyAPIView):  # hủy kết bạn
    permission_classes = [IsAuthenticated]

    # chỉ cần trả về thành công thôi k cần serializer, chỉ cần serizer khi muốn json hóa dữ liệu theo fields bên serializer

    def destroy(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")

        profile = get_object_or_404(Profile.objects.select_related("user"), id=profile_id)
        friend_user = profile.user

        if not Friend.objects.are_friends(request.user, friend_user):  # kiểm tra có phải là bạn trước khi xóa
            return Response({"error": "Not friends"}, status=400)
        # Xóa bạn bè
        with transaction.atomic():
            Friend.objects.remove_friend(request.user, friend_user)
            unfriended_log.send(  # hook thẳng signal vào view
                sender=self.__class__,  # gửi class hiện tại làm sender 
                user=request.user,
                target=friend_user,
                verb="unfriended", )

        return Response({"detail": "Unfriended"})


class FriendListView(generics.ListAPIView):  # danh sách bạn bè của mình
    permission_classes = [IsAuthenticated]
    serializer_class = FriendSerializer
    pagination_class = LargePagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    search_fields=['to_user__profile__first_name','to_user__profile__last_name'] #tìm kiếm
    ordering_fields=['id','created'] #sắp xếp theo thứ tự tăng giảm dần
    def get_queryset(self):
        return Friend.objects.filter(from_user=self.request.user).select_related('to_user__profile')


class FriendUser(generics.ListAPIView): #ds bạn bè cụ thể
    permission_classes = [IsAuthenticated]
    serializer_class = FriendSerializer
    pagination_class = LargePagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    search_fields=['to_user__profile__first_name','to_user__profile__last_name'] #tìm kiếm
    ordering_fields=['id','created'] #sắp xếp theo thứ tự tăng giảm dần
    def get_queryset(self):
        user_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile.objects.select_related("user"), id=user_id)
        target_user = profile.user
        user=self.request.user
        if Block.objects.is_blocked(user, target_user): #check block
            raise PermissionDenied("Cannot see friend of this user")
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
        return Friend.objects.filter(from_user=target_user).select_related('to_user__profile').exclude(Q(to_user_id__in=blocked_ids) | Q(to_user_id__in =blocking_ids)).order_by("-created")


class FollowView(generics.CreateAPIView):  # theo dõi người dùng
    permission_classes = [IsAuthenticated]
    serializer_class = FollowSerializer

    def create(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile.objects.select_related("user"), id=profile_id)
        user_to_follow = profile.user

        # check không follow chính mình
        if request.user == user_to_follow:
            return Response({"error": "Cannot follow yourself"}, status=400)

        # check đã follow chưa
        if Follow.objects.follows(request.user, user_to_follow):
            return Response({"error": "Already following"}, status=400)

        # kiểm tra block
        if Block.objects.is_blocked(request.user, user_to_follow):
            return Response({"error": "Cannot follow user due to blocking"}, status=400)

        Follow.objects.add_follower(request.user, user_to_follow)
        return Response({"detail": "Followed"}, status=201)


class UnfollowView(generics.DestroyAPIView):  # hủy follow
    permission_classes = [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        profile_id = self.kwargs.get("pk")
        profile = get_object_or_404(Profile.objects.select_related("user"), id=profile_id)
        user_to_unfollow = profile.user

        # check có đang follow không
        if not Follow.objects.follows(request.user, user_to_unfollow):
            return Response({"error": "Not following"}, status=400)

        Follow.objects.remove_follower(request.user, user_to_unfollow)
        return Response({"detail": "Unfollowed"})


class FollowersListView(generics.ListAPIView):  # người theo dõi mình (mình là followee)
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        follower_ids = Follow.objects.filter(
            followee=self.request.user
        ).values_list("follower_id", flat=True)
        return Profile.objects.filter(user_id__in=follower_ids).select_related("user")


class FollowingListView(generics.ListAPIView):  # người mình đang theo dõi (mình là follower)
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        followee_ids = Follow.objects.filter(
            follower=self.request.user
        ).values_list("followee_id", flat=True)
        return Profile.objects.filter(user_id__in=followee_ids).select_related("user")


class BlockView(generics.CreateAPIView):  # chặn người dùng
    permission_classes = [IsAuthenticated]
    serializer_class = BlockSerializer

    def create(self, request, *args, **kwargs):
        id = self.kwargs.get('pk')
        profile = get_object_or_404(Profile.objects.select_related("user"), id=id)
        user = profile.user

        if request.user == user:
            return Response({"detail": "You cannot block yourself"}, status=400)

        if Block.objects.is_blocked(request.user, user):
            return Response({"detail": "You have already blocked this user."}, status=400)

        with transaction.atomic():
            # Xóa follow nếu có, delete() khi không có bản ghi ở trên querryset cũng sẽ k báo lỗi
            Follow.objects.filter(follower=request.user, followee=user).delete()
            Follow.objects.filter(follower=user, followee=request.user).delete()
            # Xóa bạn nếu có
            Friend.objects.filter(from_user=request.user, to_user=user).delete()
            Friend.objects.filter(from_user=user, to_user=request.user).delete()
            # Xóa lời mời kb
            FriendshipRequest.objects.filter(from_user=request.user, to_user=user).delete()
            FriendshipRequest.objects.filter(from_user=user, to_user=request.user).delete()
            Block.objects.add_block(request.user, profile.user)

        return Response({'detail': 'Blocked'}, status=201)


class UnblockView(generics.DestroyAPIView):  # bỏ chặn người dùng
    permission_classes = [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        id = self.kwargs.get('pk')
        profile = get_object_or_404(Profile.objects.select_related("user"), id=id)
        user = profile.user

        if not Block.objects.is_blocked(request.user, user):
            return Response({"detail": "You have not blocked this user."}, status=400)
        if request.user == user:
            return Response({"detail": "You cannot unblock yourself"}, status=400)

        Block.objects.filter(
            blocker=request.user,
            blocked=user
        ).delete()
        return Response({'detail': 'Unblocked'}, status=200)


class ListBlockedUser(generics.ListAPIView):  # ai đó đã chặn mình (api/block/touser/)
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        blocker_ids = Block.objects.filter(
            blocked=self.request.user
        ).values_list("blocker_id", flat=True)
        return Profile.objects.filter(user_id__in=blocker_ids).select_related("user")


class ListBlockedFromUser(generics.ListAPIView):  # danh sách user đã bị chặn bởi user (profile)
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        blocked_user_ids = Block.objects.filter(
            blocker=self.request.user
        ).values_list("blocked_id", flat=True)
        return Profile.objects.filter(user_id__in=blocked_user_ids).select_related("user")


# ===========================Chat=====================================================================

class UnsendMessageAPIView(APIView):  # action xóa message
    permission_classes = [IsAuthenticated, IsConversationMember]

    def delete(self, request, pk):
        message = get_object_or_404(Message.objects.select_related("conversation"), pk=pk)
        if message.sender != request.user:
            raise PermissionDenied("You can only unsend your own message")
        self.check_object_permissions(request, message.conversation)
        # xóa file trên Cloudinary trước
        for attachment in message.attachments.all():
            try:
                public_id = attachment.file_url.split('/upload/')[1]  # lấy public_id từ URL
                public_id = '/'.join(public_id.split('/')[1:]).split('.')[0]  # bỏ version
                cloudinary.uploader.destroy(public_id)
            except Exception:
                pass
        # lưu lại trước khi xóa
        conversation_id = message.conversation_id
        message_id = message.id
        message.delete()
        # Broadcast realtime tin nhắn bị xóa
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conversation_id}',
                {
                    'type': 'chat_message_deleted',
                    'id': message_id,
                }

            )
        except Exception:
            pass
        return Response({"detail": "Message unsent"})


class StartConversationAPIView(
    generics.GenericAPIView):  # bấm chat với ai đó sẽ get_or_create cuộc trò chuyện với ng đó, truyền vào id user đó,GenericAPIView có các tiện ích như query, paginate và tự custome, APIView k có tiện ích, generics thì tích hợp sẵn crud
    permission_classes = [IsAuthenticated]
    serializer_class = ConversationSerializer

    def post(self, request, user_id):  # hàm post sẽ tự lấy tham số truyền vào từ url là post_id
        target_profile = get_object_or_404(Profile.objects.select_related("user"), id=user_id)  # láy ra profile từ id
        target_user = target_profile.user  # lấy ra user từ profile
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
            Conversation.objects.filter(
                # lọc ra đoạn chat có mình trước, sau đó từ những đoạn chat có mình thì có target user k
                is_group=False,
                conversationmember__user=current_user
            )  # lọc ra đoạn chat 1-1 đã có giữa cả 2, và lọc ra xem member trong đó có mình và ng đó k, nếu có thì true, không thì chưa tạo. Chỉ áp dụng cho đoạn chat 1-1, vì group thì cần thêm member chứ k ấn chat được như 1-1
            .filter(conversationmember__user=target_user)
            .distinct()
            .first()
        )

        is_friend = Friend.objects.are_friends(current_user, target_user)
        status_value = 'accept' if is_friend else 'pending'

        if not convo:  # nếu chưa có thì tạo mới
            with transaction.atomic():  # đồng bộ database, 1 là thành công hết 2 là 1 cái fail sẽ rollback
                convo = Conversation.objects.create(
                    is_group=False,
                    status=status_value
                )
                ConversationMember.objects.bulk_create([  # bulk create là tạo nhiều bảng cùng 1 lúc thay vì 2 lênh riêng biệt gây nhiều truy vấn
                        ConversationMember(conversation=convo, user=current_user),
                        ConversationMember(conversation=convo, user=target_user),
                ])
        return Response(
            self.get_serializer(convo).data,
            # get_serializer là hàm của GenericAPIView để lấy serializer đã khai báo ở trên
            status=status.HTTP_200_OK
        )


class AcceptMessageRequest(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, conv_id):
        conv = get_object_or_404(Conversation, pk=conv_id)

        if conv.is_group:  # chỉ áp dụng cho chat 1-1 và bỏ qua nếu là group
            return Response(
                {"detail": "Invalid conversation"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if conv.status != 'pending':  # chỉ accept khi đang pending
            return Response({"detail": "Conversation is not pending"}, status=status.HTTP_400_BAD_REQUEST)

        if not ConversationMember.objects.filter(conversation=conv, user=request.user).exists():  # user phải là member
            return Response(
                {"detail": "You are not a member of this conversation"},
                status=status.HTTP_403_FORBIDDEN
            )

        first_message = (  # lấy message đầu tiên
            Message.objects.filter(conversation=conv).select_related("sender").order_by('created_at').first()
        )
        # nếu chưa có message thì không cho accept
        if not first_message:
            return Response(
                {"detail": "No message request to accept"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if Block.objects.is_blocked(request.user,
                                    first_message.sender):  # kiểm tra người gửi request có bị mình block trước đó k
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
    permission_classes = [IsAuthenticated]

    def post(self, request, conv_id):
        conv = get_object_or_404(Conversation, pk=conv_id)
        if conv.is_group:
            return Response({'error': 'invalid'}, status=400)
        if not ConversationMember.objects.filter(conversation=conv, user=request.user).exists():
            return Response({'error': 'You are not member of this conversation'}, status=400)
        if conv.status == 'accept':
            return Response({'This conversation has already accepted'}, status=400)
        first_message = Message.objects.filter(conversation=conv).order_by('created_at').first()
        if not first_message:
            return Response(
                {"detail": "No message request to reject"},
                status=status.HTTP_400_BAD_REQUEST
            )
        if request.user == first_message.sender:  # ng gửi message đầu tiên không được reject
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


class ConversationListAPIView(generics.ListAPIView):  # mở app chat lên sẽ load tất cả đoạn chat
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    pagination_class = LargePagePagination
    def get_queryset(self):
        return Conversation.objects.filter(
            conversationmember__user=self.request.user, # lấy ra đoạn chat có user
            conversationmember__is_hidden=False,
            conversationmember__is_permanently_hidden=False
        ).distinct().prefetch_related(
            # load members + user + profile  trong 2 query thay vì 20 đoạn chat và 40 lần query trong serializer
            # (1 query join conv với message có trong conv, 1 query join user trong conv
            Prefetch( #lấy ra đoạn chat có user và prefetch lấy ra các user trong đó đoạn chat đó luôn (select convmember in conv)
                'conversationmember_set',  # conversationmember có FK với conversation nên phải lấy tham chiếu là set
                queryset=ConversationMember.objects.select_related(  # tùy chỉnh thêm field muốn lấy
                    'user__profile',  # JOIN user và profile (1-1)
                )
            ),
            # load messages mới nhất trong 1 query IN riêng
            # kèm JOIN sender+profile để get_last_message không query thêm
            Prefetch(  # lấy ra đoạn chat có user kèm 11 message mới nhất (select message in conv)
                'message_set',  # relation 1-nhiều: 1 conv có nhiều messages
                queryset=Message.objects.annotate(
                    row_num=Window(  # đánh số thứ tự từng tin trong conv
                        expression=RowNumber(),
                        partition_by=[F('conversation_id')],  # reset số thứ tự theo từng conv
                        order_by=F('created_at').desc()  # tin mới nhất = row_num 1
                    )
                ).filter(row_num__lte=11)  # chỉ lấy 11 tin gần nhất, đủ để FE hiển thị 9+ nếu count >= 10
                .select_related(
                    'sender__profile'  # JOIN sender và profile luôn (1-1)
                )
                .prefetch_related('attachments')
                .order_by('-created_at'),  # sắp xếp mới nhất trước
                to_attr='prefetched_messages'  # lưu vào obj.prefetched_messages trong RAM
            ),
        ).order_by('-updated_at')

class ConversationMessage(generics.ListAPIView):  # xem tin nhắn cuộc trò chuyện
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated, IsConversationMember]
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    search_fields = ['content']  # tìm kiếm trong nội dung tin nhắn
    ordering_fields = ['created_at']
    filterset_fields = ['sender']  # lọc theo người gửi

    def get_queryset(self):
        convo_id = self.kwargs.get("pk")
        conv = get_object_or_404(Conversation, id=convo_id)
        self.check_object_permissions(self.request,conv)  # phải dùng cho get querryset, chỉ có get object mới k cần dùng còn lại dùng hết
        qs=(
            Message.objects
            .filter(conversation_id=convo_id)  # lọc theo cuộc trò chuyên
            .select_related("sender__profile")  # lấy ra profile của sender để hiển thị thông tin người gửi đồng thời với message(1-1 với sender)
            .prefetch_related("attachments")  # lấy ra tất cả file đính kèm trong message đồng thời với message(Foreign key tới Message Attachments n-n)
            .order_by("-created_at")
        )
        member= ConversationMember.objects.filter(conversation=conv,user=self.request.user).only('deleted_at_message_id').first() # chỉ lấy deleted
        if member and member.deleted_at_message_id is not None: # nếu là thành viên và đã xóa
            qs= qs.filter(id__gt=member.deleted_at_message_id) # lấy tin nhắn có thơi gian lớn hơn delete
        return qs


class MemberOfConversation(generics.ListAPIView):  # danh sách thành viên trong cuộc trò chuyện
    permission_classes = [IsAuthenticated, IsConversationMember]
    serializer_class = ConversationMemberSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    filter_fields = ['user__profile__first_name', 'user__profile__last_name']
    pagination_class = LargePagePagination
    def get_queryset(self):
        convo_id = self.kwargs["pk"]
        conv =get_object_or_404(Conversation,id=convo_id)
        self.check_object_permissions(self.request,conv)
        return (
            ConversationMember.objects
            .filter(conversation=conv)
            .select_related( "user","user__profile")
        )


class SeenMessage(APIView):  # đánh dấu đã xem tin nhắn, logic là khi mở trò chuyện sẽ post về server be, be sẽ lấy ra tin nhắn mới nhất và đánh dấu last_read là tin nhắn đó
    permission_classes = [IsAuthenticated, IsConversationMember]

    def post(self, request, *args, **kwargs):
        convo_id = self.kwargs.get("pk")

        conversation = get_object_or_404(Conversation, id=convo_id)
        self.check_object_permissions(request, conversation)
        last_message = (Message.objects.filter(conversation=conversation).order_by(
            "-created_at").first())  # lấy ra tin nhắn mới nhất trong cuộc trò chuyện
        if not last_message:
            return Response({"detail": "No messages"}, status=200)

        ConversationMember.objects.filter(
            conversation=conversation,
            user=request.user
        ).update(last_read_message=last_message.id)

        # Gửi seen event qua WebSocket để đồng bộ các thiết bị khác, cách custome
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{convo_id}',
                {
                    'type': 'seen_message',
                    'user_id': request.user.id,
                    'last_message_id': last_message.id,
                }
            )
        except Exception:
            pass

        return Response({
            "detail": "Conversation marked as seen",
            "last_read_message_id": last_message.id
        })


class UpdateMessage(APIView):
    permission_classes = [IsAuthenticated, IsConversationMember]

    def patch(self, request, pk):  # patch vì partial là true
        message = get_object_or_404(Message, pk=pk)
        self.check_object_permissions(request, message.conversation)
        if message.message_type != 'text':
            return Response({'error': 'You can only edit text'}, status=400)
        if message.sender != request.user:
            raise PermissionDenied("You can only edit your own message")
        new_content = request.data.get('new_content')
        if not new_content or not new_content.strip():  # check k truyền thì k lưu vào db
            return Response({"detail": "new_content is required"}, status=400)
        serializer = MessageSerializer(message, data={'content': new_content},
                                       partial=True)  # vì là update nên phải truyền instance là message đầu tiên, còn create thì k cần truyền instance, partial true để chỉ cập nhật 1 số trường, nếu k có nó sẽ yêu cầu truyền đủ field để cập nhật
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

class DeleteConversationOneSide(APIView): # nếu xóa conv thì sẽ lấy thời gian tại mốc tin nhắn cuối, chỉ load ra từ sau đó
    permission_classes = [IsAuthenticated]
    def patch(self,request,pk):
        conv=get_object_or_404(Conversation,pk=pk)
        member= ConversationMember.objects.filter(conversation=conv,user=request.user).first()
        if not member: # check quyền
            raise PermissionDenied("You are not member of this conversation")
        last_msg=Message.objects.filter(conversation=conv).order_by('-created_at').first() #lấy ra tin nhắn mới nhất
        if not last_msg:
            return Response({"detail": "No messages to delete"}, status=200)
        member.deleted_at_message_id = last_msg.id # đặt id deleted at khi gọi api băng với id tin nhắn cuối, chỉ lấy tin nhắn sau tin nhắn cuối chưa xóa
        member.last_read_message=None # đặt lại last_read_mesage
        member.is_hidden = True # ẩn khỏi coversation
        member.save(update_fields=['deleted_at_message_id','last_read_message','is_hidden'])
        return Response({"detail": "Conversation deleted"}, status=200)

class ToogleHideConversation(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        member = get_object_or_404(
            ConversationMember,
            conversation_id=pk,
            user=request.user
        )
        member.is_permanently_hidden = not member.is_permanently_hidden# nếu là true thì gán not true là false và ngược lại
        member.save(update_fields=['is_permanently_hidden'])

        return Response({"detail": "success", "is_hidden": member.is_permanently_hidden}, status=200)


class ListHideConversation(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = SmallPagePagination
    serializer_class = ConversationSerializer
    def get_queryset(self):
        return (Conversation.objects.filter(conversationmember__is_permanently_hidden=True, conversationmember__user=self.request.user)
        .distinct()
        .prefetch_related(
            # load members + user + profile  trong 2 query thay vì 20 đoạn chat và 40 lần query trong serializer
            # (1 query join conv với message có trong conv, 1 query join user trong conv
            Prefetch(
                # lấy ra đoạn chat có user và prefetch lấy ra các user trong đó đoạn chat đó luôn (select convmember in conv)
                'conversationmember_set',  # conversationmember có FK với conversation nên phải lấy tham chiếu là set
                queryset=ConversationMember.objects.select_related(  # tùy chỉnh thêm field muốn lấy
                    'user__profile',  # JOIN user và profile (1-1)
                )
            ),
            # load messages mới nhất trong 1 query IN riêng
            # kèm JOIN sender+profile để get_last_message không query thêm
            Prefetch(  # lấy ra đoạn chat có user kèm 11 message mới nhất (select message in conv)
                'message_set',  # relation 1-nhiều: 1 conv có nhiều messages
                queryset=Message.objects.annotate(
                    row_num=Window(  # đánh số thứ tự từng tin trong conv
                        expression=RowNumber(),
                        partition_by=[F('conversation_id')],  # reset số thứ tự theo từng conv
                        order_by=F('created_at').desc()  # tin mới nhất = row_num 1
                    )
                ).filter(row_num__lte=11)  # chỉ lấy 11 tin gần nhất, đủ để FE hiển thị 9+ nếu count >= 10
                .select_related(
                    'sender__profile'  # JOIN sender và profile luôn (1-1)
                )
                .prefetch_related("attachments")
                .order_by('-created_at'),  # sắp xếp mới nhất trước
                to_attr='prefetched_messages'  # lưu vào obj.prefetched_messages trong RAM
            ),
        ).order_by('-updated_at'))

'''
    (fe) flow là khi gửi ảnh và message gọi api ->
    (be) api post lên cloudinary, cloudinary trả về backend url mã hóa, lưu trước file và url vào db messageattachment tránh mất khi mất connect ws và trả ra data vừa lưu->
    (fe) client nhận về tên file và url và id file lưu, gọi ws truyền cả message và id của file ->
    (be) tạo,lưu message và update lại messageattachment gắn message vào
    *không có message thì chỉ thực thi save file và message là none
    *không có file thì k thực thi lệnh if của file
'''
BLOCKED_MIMES = { # những file có đuôi bị block nhằm bảo mật cho app
    'text/html',
    'application/javascript',
    'application/x-javascript',
    'application/xhtml+xml',
    'image/svg+xml',
}
class ChatAttachmentUpload(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser,FormParser]
    def post(self,request,conv_id):
        if not ConversationMember.objects.filter(user=request.user,conversation_id=conv_id).exists():
            return Response({'error': 'Không có quyền'}, status=403)
        files=request.FILES.getlist('files')
        if not files: #check file hợp lệ
            return Response({'error': 'Thiếu file'}, status=400)
        results = []
        for file in files: # lặp từng file trong file tải lên
            if file.size > 50*1024*1024: # check chỉ đc 50 mb
                return Response({'error': f'{file.name} vượt quá 50MB'}, status=400)

            # detect mime kiểu image/png hay video/mp4, phát hiện file giả mạo đuôi
            mime = magic.from_buffer(
                file.read(4096),
                mime=True
            )
            file.seek(0)
            if mime in BLOCKED_MIMES: # nếu đuôi gốc nằm trong đuôi bị cấm
                return Response({'error': f'{file.name} không được hỗ trợ'}, status=400)
            # phân loại file
            if mime.startswith('image/'):
                file_type = 'image'
                resource_type = 'image'
            elif mime.startswith('video/'):
                file_type = 'video'
                resource_type = 'video'
            else:
                file_type = 'file'
                resource_type = 'raw'
            result = cloudinary.uploader.upload( #up lên cloudinary, cloudinary trả secure url
                file,
                folder=f'chat/conv_{conv_id}',
                resource_type=resource_type,
                public_id = str(uuid.uuid4())
            )
            attachment = MessageAttachment.objects.create(
                conversation_id=conv_id,
                uploaded_by=request.user,
                file_url=result['secure_url'], # file url nhận về sau khi upload lên cloudinary
                file_type=file_type,
                file_name=file.name,
                file_size=file.size,
                message=None
            )
            results.append(MessageAttachmentSerializer(attachment).data | {'attachment_id': attachment.id, 'mime': mime,}) # để trả ra nhiều serializer tương ứng với n file,mime để trả về đuôi gốc ví dụ ảnh1.png -> image/png
        return Response({'attachments': results}, status=200)

# =============================================================================
class ProfileRelationship(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request,
            profile_id):  # get khác post là chỉ dùng khi lấy dữ liệu. Còn post thì dùng khi thay đổi csdl như tạo update
        profile = get_object_or_404(Profile.objects.select_related("user"), pk=profile_id)

        target_user = profile.user
        current_user = request.user

        if target_user == current_user:
            return Response({"status": "myself"})
        if Block.objects.is_blocked(current_user, target_user):
            return Response({"status": "blocked"})
        if Friend.objects.are_friends(current_user, target_user):
            return Response({"status": "friend"})
        if FriendshipRequest.objects.filter(from_user=current_user, to_user=target_user).exists():
            return Response({"status": "request_sent"})
        if FriendshipRequest.objects.filter(from_user=target_user, to_user=current_user).exists():
            return Response({"status": "request_received"})
        if Follow.objects.follows(current_user, target_user):
            return Response({"status": "following"})
        return Response({"status": "none"})


# ===============================Thông báo in-app==========================================
class NotificationListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer
    pagination_class = LargePagePagination
    filter_backends =[DjangoFilterBackend,OrderingFilter,SearchFilter]
    # search_fields=[] #tìm kiếm
    ordering_fields=['id','created_at']

    def get_queryset(self):
        return Notification.objects.filter(
            reciever=self.request.user
        ).select_related('actor__profile').order_by("-created_at")
    
    # def list(self,request,*args,**kwargs): # chạy sau khi list ra, có tác dụng thêm logic trước/sau khi trả response, bên trong nó tự gọi get_queryset
    #     response = super().list(request, *args, **kwargs) #kế thừa gọi get queryset, filter,pagination...
    #     return response

class NotificationMarkReadView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        updated = Notification.objects.filter(
            reciever=request.user,
            is_read=False
        ).update(is_read=True)
        invalidate_model(Notification) # dùng cái này vì update k kích hoạt xóa cacheops khi thay đổi dữ liệu như th khác nên thủ công xóa cache(bulk_create,bulk_update,update,filter().delete() sẽ k chạy phát hiẹn thay đổi nên phải thủ công)
        
        try: # khi gọi api mark read tức là đang ở trang notification sẽ đánh read count = 0, k kết nối ws sẽ pass
            channel_layer=get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'notification_{request.user.id}',
                {
                    'type': 'send_notification',
                    'data': {'unread_count':0}
                }
            )
        except Exception:
            pass
        
        return Response({'detail': f'{updated} marked as read'})


class NotificationUnreadCountView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = Notification.objects.filter(
            reciever=request.user,
            is_read=False
        ).count()
        return Response({'count': count})

class NotificationDelete(generics.DestroyAPIView):
     permission_classes = [IsAuthenticated]
     serializer_class = NotificationSerializer
     def destroy(self, request, pk, *args, **kwargs):
         deleted, _ =  Notification.objects.filter(id=pk, reciever=request.user).delete()
         if not deleted:
             return Response({'detail': 'Not found'}, status=404)
         return Response(status=204)
# ===========================Firebase=======================================
class SaveFCMTokenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = request.data.get("token")  # nhận token từ client gửi lên
        if not token:
            return Response({"error": "missing token"}, status=400)

        FCMToken.objects.update_or_create(  # nếu có thì update còn không thì cập nhật
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


# ======================Search history=====================

class SearchHistoryView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = SmallPagePagination
    serializer_class = SearchSerializer
    filter_backends = [SearchFilter]
    search_fields = ['content']

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def get_queryset(self):
        return SearchHistory.objects.filter(user=self.request.user)

class SearchHistoryDeleteAllView(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, *args, **kwargs):
        SearchHistory.objects.filter(user=request.user).delete()
        return Response(status=204)

class SearchHistoryDeleteView(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, *args, **kwargs):
        deleted, _ = SearchHistory.objects.filter(
            user=request.user, id=pk
        ).delete()
        if not deleted:
            return Response({'detail': 'Not found'}, status=404)
        return Response(status=204)

class SearchAPIView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = LargePagePagination

    def get(self, request):
        keyword = request.query_params.get('q', '').strip()  # láy từ url sau dấu ? mà k cần khai báo trong url
        search_type = request.query_params.get('type',
                                               'all')  # tìm kiếm theo mọi người/ post/all type ?q=nghi&type=all, all ở đây là giá trị mặc định khi k truyền
        if not keyword:
            return Response({'posts': [], 'profiles': []})  # tra về rỗng nếu k có

        user = request.user
        posts = []
        profiles = []
        profiles_qs = Profile.objects.none()
        # Lấy danh sách user bị block và block mình và bạn mình
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
        friend_ids = Friend.objects.filter(from_user=user).values_list('to_user_id', flat=True)

        if search_type in ('all', 'posts'):  # chỉ search post khi cần
            try:
                post_search = PostDocument.search().query( # chạy lấy ra các post tìm kiếm
                    "bool",
                    should=[
                        # Gõ đúng cụm từ liền nhau — rank cao nhất
                        ESQ("bool", must=[ESQ("match_phrase", title=keyword)], boost=4.0),
                        # Match thường + sửa lỗi chính tả
                        ESQ("match", title={
                            "query": keyword,
                            "boost": 2.0,
                            "fuzziness": "AUTO",#sửa lỗi chính tả và cho ra kết quả
                            "prefix_length": 1, # b ký tự đầu phải đúng ví dụ trần nghị thì t phải đúng
                            "max_expansions": 50 #giới hạn biến thể mà tự sửa lỗi chính tả cho ra ví dụ trn :tran,trần...
                        }),
                    ],
                    minimum_should_match=1  # bắt buộc match ít nhất 1 điều kiện, tránh trả về kết quả rác
                )[:50]  # lấy tối đa 50 kết quả thay vì mặc định 10

                # giữ thứ tự relevance từ Elasticsearch (score cao nhất lên đầu)
                post_hits = list(post_search)
                post_ids = [hit.meta.id for hit in post_hits]  # lấy id của các bài post sau lọc
                posts_qs = (Post.objects.filter(  # tìm id trong post và loại bỏ block
                    post_id__in=post_ids,
                    deleted__isnull=True
                ).exclude(
                    Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)  # loại bài post của người bị block
                )
                .filter(
                    Q(privacy='public') | #public post thì hiện trên tìm kiếm
                    Q(privacy='friends', user_id__in=friend_ids) | # privacy friend nếu chủ post là bạn mình thì hiện
                    Q(privacy='friends', user=user) | # privacy friend và bài mình
                    Q(privacy='private', user=user) # bài mình nếu private
                )
                .select_related('user__profile').prefetch_related('photos'))
                # sắp xếp lại theo thứ tự relevance của ES vì Django filter không giữ thứ tự
                posts_dict = {str(p.post_id): p for p in posts_qs}
                posts = [posts_dict[pid] for pid in post_ids if pid in posts_dict]
            except Exception:
                posts = []
        if search_type in ('all', 'profiles'):  # chỉ search profile khi cần
            try:
                profile_search = ProfileDocument.search().query(
                    "bool",
                    should=[
                        # 1. Gõ đúng cụm — boost cao nhất: "tran nghi" → "Trần Nghị"
                        ESQ("bool", must=[ESQ("match_phrase", full_name=keyword)], boost=5.0),
                        # 2. Match full_name — gõ 1 phần cũng ra: "tran" → "Trần Nghị"
                        ESQ("match", full_name={
                            "query": keyword,
                            "boost": 3.0,
                            "fuzziness": "AUTO",  # sửa lỗi chính tả: "trna" → "tran"
                            "prefix_length": 1,  # ký tự đầu phải đúng tránh a mà thành c ở đầu
                            "max_expansions": 50  # giới hạn số biến thể fuzziness tạo ra
                        }),
                        # 3. Fallback họ hoặc tên riêng lẻ
                        ESQ("match",first_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                        ESQ("match", last_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                    ],
                    minimum_should_match=1  # bắt buộc match ít nhất 1 điều kiện
                )[:50]

                # giữ thứ tự relevance từ Elasticsearch (score cao nhất lên đầu)
                profile_hits = list(profile_search)
                profile_ids = [hit.meta.id for hit in profile_hits]  # lấy các id từ kết quả lọc
                profiles_qs = Profile.objects.filter(
                    id__in=profile_ids,
                    deleted__isnull=True
                ).exclude(
                    Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)  # loại profile của người bị block
                ).select_related('user')
                # sắp xếp lại theo thứ tự relevance của ES vì Django filter không giữ thứ tự
                profiles_dict = {str(p.id): p for p in profiles_qs}
                profiles = [profiles_dict[pid] for pid in profile_ids if pid in profiles_dict]
            except Exception as e:
                profiles = []
        # Paginate trước khi trả về
        paginator = self.pagination_class()
        posts_page = paginator.paginate_queryset(posts, request)
        profile_paginator = self.pagination_class()
        profiles_page = profile_paginator.paginate_queryset(profiles, request)
        return Response({  # trả về serializer của 1 trong 2
            'posts': PostSerializer(posts_page, many=True, context={'request': request}).data,
            # vì serializer cần lấy request để lấy user ở trường get user is reaction nên cần truyền
            'profiles': ProfileSerializer(profiles_page, many=True, context={'request': request,
                                                                        'online_set': get_online_set(
                                                                            profiles_qs) if profiles else set()}).data,
        })


# =========================Friend Suggest===========================================
class FriendSuggestion(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = FriendSuggestionSerializer
    pagination_class = SmallPagePagination

    def get_queryset(self):
        user = self.request.user
        # lọc ra bạn của mình
        friend_ids = Friend.objects.filter(from_user=user).values_list('to_user_id', flat=True)
        #bạn của bạn mình
        friends_of_friends_ids = Friend.objects.filter(from_user_id__in=friend_ids).values('to_user_id')
        # loại trừ
        sent_ids = FriendshipRequest.objects.filter(from_user=user).values_list("to_user_id", flat=True)
        received_ids = FriendshipRequest.objects.filter(to_user=user).values_list("from_user_id", flat=True)
        blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
        blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)

        # lọc các profile có id trong id danh sách bạn bè của bạn mình
        return (
            Profile.objects.filter(
                user__id__in=friends_of_friends_ids
            )
            .exclude(Q(user_id__in=friend_ids) | Q(user_id=user.id)| Q(user_id__in=sent_ids) | Q(user_id__in=received_ids) | Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids))  # loại trừ những ng này
            .annotate(
                mutual_count=Count(
                    'user__friends', #user là 1-1 Profile và friends là related name của to_user
                    filter=Q(user__friends__from_user_id__in=friend_ids), # dếm người user nào nằm trong danh sách bạn bè của mình nhiều nhất
                    distinct=True
                )
            )  # đếm số bạn chung
            .select_related('user')  # join với user
            .order_by('-mutual_count')  # lọc ra số bạn chung nhiều nhất
        )


class SupportTicketView(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = SupportTicketSerializer

    def perform_create(self, serializer):
        instance = serializer.save(user=self.request.user)