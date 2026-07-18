import hashlib
import logging
import uuid
from datetime import timedelta

from _pytest import raises
from django.utils.timezone import localtime
from itertools import chain
from adrf.views import APIView as AsyncAPIView

from django.db.models import Count, Case, When, BooleanField
from celery import app
from channels.db import database_sync_to_async
from django.contrib.auth import authenticate
from django.db.models.expressions import Window
from django.db.models.functions import RowNumber
import asyncio
from django.views.generic import DetailView
from livekit import api
from backend.env_config import env
from backend import settings_backend
from rules import is_active
from rules.templatetags.rules import has_perm
from .models import Profile, Event
from .serializers import *
from rest_framework import generics,permissions
from rest_framework.permissions import *
from django.shortcuts import get_object_or_404
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from .pagination import *
from .signals import unfriended_log, accept_join_request_group, notify_accept_post_request, notify_add_admin, \
    owner_transfer_group, add_admin_group, review_post_request_group
from rest_framework.parsers import MultiPartParser, FormParser,JSONParser #upload file ảnh và dữ liệu dạng form và json parse(khi dùng api view để nhập vào ô body không cần dạng json)
from django.db.models import Q, Prefetch, prefetch_related_objects, F, Exists, OuterRef
from .permissions import IsConversationMember, PostViewPermission, IsAdminOrOwnerGroup, IsMemberGroup, IsOwnerOnlyGroup, \
    CanEditPost
from django.db import transaction # tạo đồng bộ db
from rest_framework import status
from .utils import get_reactions_post_context,get_reactions_comment_context,get_reactions_share_context
from .tasks import push_notification_task, send_event_reminder, make_notification_group
#filter
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter,OrderingFilter
from .filters import UserReactionFilter
from rest_framework.response import Response
#friendship xay dựng hệ thống follow bạn bè
from friendship.models import Friend
# broadcast channels
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync,sync_to_async
# elastic
from .documents import PostDocument, ProfileDocument, GroupDocument
from elasticsearch_dsl.query import MultiMatch
from elasticsearch_dsl import Q as ESQ, MultiSearch  # Django Q — dùng cho ORM filter
#cacheops
from cacheops import invalidate_model
#cloudinary
import cloudinary.uploader
# magic-bin
from meta.views import MetadataMixin
logger = logging.getLogger(__name__)
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

class PostPhotoUser(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PostPhotoSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        return PostPhoto.objects.filter(
            post__user=self.request.user
        )

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
            group_ids = Group.objects.filter(members__user=user, members__is_active=True).values_list("id", flat=True)
            self._qs = (
                Post.objects
                .filter( # câu lệnh Q..| là OR
                    Q(user_id=user.id, group__isnull=True) |  #lấy post của user
                    Q(user_id__in=friend_ids,privacy__in=['public','friends'], group__isnull=True) | #lấy post của bạn bè và chỉ lấy privacy là public hoặc bạn bè, bỏ qua private
                    Q(user_id__in=following_ids, privacy='public', group__isnull=True) |#lấy post của follow
                    Q(group_id__in=group_ids, post_status='approved') # lấy ra tất cả post có group_id trong group của user,status =approve
                )
                .exclude(user_id__in=blocked_ids) #loại block
                .exclude(user_id__in=blocking_ids)
                .select_related("user", "user__profile",'group')
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
        post = get_object_or_404(Post.objects.select_related('user','user__profile','group').prefetch_related('photos'),post_id=post_id,group__isnull=True)
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
                self._qs= Post.objects.filter(user=target_user,group__isnull=True,).select_related('user','user__profile','group').prefetch_related('photos').order_by('-is_pinned','-created_at')
            # là bạn thì lấy post public và friend
            elif Friend.objects.are_friends(user,target_user):
                self._qs= Post.objects.filter(user=target_user,privacy__in=['public','friends'],group__isnull=True).select_related('user','user__profile','group').prefetch_related('photos').order_by('-is_pinned','-created_at')
            # là người lạ thì chỉ lấy public
            else:
                self._qs = Post.objects.filter(user=target_user,privacy='public',group__isnull=True,).select_related('user','user__profile','group').prefetch_related('photos').order_by('-is_pinned','-created_at')
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
            self._qs = Post.objects.all().select_related('user','user__profile','group').prefetch_related('photos').order_by(
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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'pin_post'
    def get_object(self): #get_object để update dùng
        post = get_object_or_404(Post.objects.select_for_update(), pk=self.kwargs.get('pin_id'),group__isnull=True)
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
                Post.objects.filter(user=request.user, is_pinned=True,group__isnull=True).update(is_pinned=False)
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
        post = get_object_or_404(Post.objects.select_related('user','user__profile').prefetch_related('photos'), share_code=share_code, group__isnull=True)
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
        post = get_object_or_404(Post.objects.select_related('user','user__profile','group').prefetch_related('photos'), share_code=share_code, group__isnull=True)
        self.check_object_permissions(self.request, post) #check xem post đc share thì user có đc xem
        return post

class ChangePostPrivacy(APIView):
    permission_classes = [IsAuthenticated,PostViewPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'change_post_privacy'
    def patch(self,request,post_id):
        post= get_object_or_404(Post,post_id=post_id,group__isnull=True)
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
    permission_classes = [IsAuthenticated]
    serializer_class = PostShareSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        post_id = self.kwargs.get('post_id')
        user = self.request.user
        # Lấy post gốc, check quyền xem trước, có là public hoặc user hiện có là bạn với post gốc privacy là friends
        post = get_object_or_404(Post.objects.select_related('user'), post_id=post_id, group__isnull=True)
        if not user.has_perm('api.view_post', post): # dùng rules trực tiếp check post gốc vì nhận vào id post gốc, khác là tự viết raise nhưng logic như nhau
            raise PermissionDenied("Bạn không thể xem bài viết này")

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
            .select_related('user','user__profile','post','post__user', 'post__user__profile')
            .prefetch_related('post__photos')
            .order_by('-created_at')
        )
    def create(self, request, *args, **kwargs):
        post_id = self.kwargs.get('post_id')
        content =self.request.data.get('content')
        privacy = self.request.data.get('privacy', 'public') #key nhận là privacy và default là public
        if privacy not in ['public', 'friends', 'private']:
            return Response({'error': 'privacy không hợp lệ'}, status=400)
        post=get_object_or_404(Post.objects.select_related('user','user__profile'),post_id=post_id, group__isnull=True)
        if not request.user.has_perm('api.view_post', post):
            raise PermissionDenied("Bạn không thể share bài viết này")
        PostShare.objects.create(post=post,user=self.request.user,content=content,privacy=privacy)
        post.share_count += 1
        post.save(update_fields=['share_count'])  # update_fields để patch update 1 phần thay vì toàn bộ
        return Response({'message': 'Share thành công'}, status=status.HTTP_201_CREATED)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Lấy danh sách PostShare đã được phân trang ("nấu chín")
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs = self.get_queryset()

        # Nạp map reaction của các bài viết gốc vào context chung
        context.update(get_reactions_share_context(objs, self.request.user))
        return context

class PostUserShareDelete(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'post_user_share_delete'
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

        if target_user == user: # nếu target là chính user thì k có giới hạn
            privacy_filter = {}
        elif Friend.objects.are_friends(user, target_user): # nếu target user là bạn mình thì láy public và friends
            privacy_filter = {'privacy__in': ['public', 'friends']}
        else: # người lạ thì lấy public 
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
            .select_related('user','user__profile','post__user','post', 'post__user__profile')
            .prefetch_related('post__photos')
            .order_by('-created_at')
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Lấy danh sách PostShare đã được phân trang ("nấu chín")
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs = self.get_queryset()

        # Nạp map reaction của các bài viết gốc vào context chung
        context.update(get_reactions_share_context(objs, self.request.user))
        return context
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
        return (PostShare.objects.filter( # thỏa 1 trong những điều kiện ở filter 1 AND 1 trong điều kiện filter 2
            # share của mình
            Q(user=user) |
            #post share của bạn bè cả public và friends
            Q(user_id__in=friend_ids, privacy='public') |
            Q(user_id__in=friend_ids, privacy='friends') |
            #post share của following
            Q(user_id__in=following_ids, privacy='public')
        )
        .filter(
            #check post gốc
            Q(post__user=user) |
            Q(post__privacy='public') | # lọc ra post gốc là public
            Q(post__user_id__in=friend_ids, post__privacy='friends') | # lọc ra post gốc là của friends và privacy là friends
            Q(post__user_id__in=following_ids, post__privacy='public')  # lọc ra post gốc là của following và public
        )
        .exclude(
            #loại trừ block từ user post gốc
            Q(post__user_id__in=blocked_ids) | #check block post gốc
            Q(post__user_id__in=blocking_ids)|
            Q(user_id__in=blocked_ids) | #check block người share
            Q(user_id__in=blocking_ids)
        )
        .select_related('user','user__profile','post__user','post', 'post__user__profile')
        .prefetch_related('post__photos')
        .order_by('-created_at'))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        # Lấy danh sách PostShare đã được phân trang ("nấu chín")
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs = self.get_queryset()

        # Nạp map reaction của các bài viết gốc vào context chung
        context.update(get_reactions_share_context(objs, self.request.user))
        return context
class ChangePostSharePrivacy(APIView):
    permission_classes = [IsAuthenticated,PostViewPermission]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='change_post_share_privacy'
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
    serializer_class = ReportSerializer

    def perform_create(self, serializer):
        post_id= self.kwargs.get('post_id')
        post = get_object_or_404(Post,post_id=post_id)
        if post.user == self.request.user:
            raise ValidationError('Cannot report your own post') # perform create chỉ dùng đc ValidationError
        if Report.objects.filter(post=post, user=self.request.user).exists():
            raise ValidationError({"error": "Bạn đã gửi báo cáo cho bài viết này rồi"})
        serializer.save(post=post,user=self.request.user)

class CommentReportView(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ReportSerializer

    def perform_create(self, serializer):
        comment_id= self.kwargs.get('comment_id')
        comment = get_object_or_404(Comment,id=comment_id)
        if comment.user == self.request.user:
            raise ValidationError('Cannot report your own post') # perform create chỉ dùng đc ValidationError
        if Report.objects.filter(comment=comment, user=self.request.user).exists():
            raise ValidationError({"error": "Bạn đã gửi báo cáo cho bài viết này rồi"})
        serializer.save(comment=comment,user=self.request.user)
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
            return PostArticle.objects.all().select_related('user','user__profile')
        else:
            return PostArticle.objects.filter(user=user).select_related('user','user__profile')

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
            post = Post.objects.filter(post_id=post_id).select_related('group').first()
            if not post:
                raise NotFound("Post không tồn tại.")
            if post.group_id and not user.has_perm('group.is_member', post.group):
                raise PermissionDenied("Bạn không phải thành viên của group này.")
            blocked_ids = Block.objects.filter(blocked=user).values_list("blocker_id", flat=True)
            blocking_ids = Block.objects.filter(blocker=user).values_list("blocked_id", flat=True)
            # if user.is_superuser or user.is_staff:
            #     return Comment.objects.all()
            #lọc ra và count các replies con bên trong cmt cha parent is null=True
            self._qs = Comment.objects.filter(post_id=post_id, parent__isnull=True).exclude(Q(user_id__in=blocked_ids)| Q(user_id__in=blocking_ids)).select_related('user','user__profile','post').prefetch_related('tagged_users__profile').annotate(reply_count=Count('replies')).order_by('-is_pinned','-created_at')#count related fields của parent là replies
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

class CommentDetail(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CommentSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'comment'

    def get_object(self):
        user = self.request.user
        comment_id = self.kwargs.get('pk')
        if not comment_id:
            raise NotFound("Cần truyền ID comment để truy cập.")

        comment = get_object_or_404(
            Comment.objects.prefetch_related('tagged_users').select_related('post','post__group'), id=comment_id
        )

        if comment.post.group_id:
            if not user.has_perm('group.is_member', comment.post.group):
                raise PermissionDenied("Bạn không phải thành viên của group này.")
        return comment

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
            ).select_related('user','user__profile').prefetch_related('tagged_users__profile')  # thêm __profile tránh N+1 khi serialize tagged_users_info
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='pin_comment'
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
        return UserReaction.objects.filter(reaction__object_id=post_id,reaction__content_type=post_ct).exclude(Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)).select_related('user','user__profile','reaction__settings', 'react')

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
        return UserReaction.objects.filter(reaction__object_id=comment_id,reaction__content_type=comment_ct).exclude(Q(user_id__in=blocked_ids) | Q(user_id__in =blocking_ids)).select_related('user','user__profile','reaction__settings', 'react')


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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='send_friend_request'
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
        return FriendshipRequest.objects.filter(
            to_user=self.request.user
        ).select_related('from_user__profile')


class OutgoingFriendRequestsView(generics.ListAPIView):  # danh sách yêu cầu đã gửi kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        return FriendshipRequest.objects.filter(
            from_user=self.request.user
        ).select_related('to_user__profile')


class AcceptFriendRequestView(generics.UpdateAPIView):  # đồng ý lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='accept_friend_request'
    def update(self, request, *args, **kwargs):
        fr_id = self.kwargs.get('pk')
        if not fr_id:
            return Response({"error": "Friend request ID is required"}, status=400)

        friend_request = get_object_or_404(FriendshipRequest.objects.select_related("to_user"), pk=fr_id)

        # Chỉ người nhận mới có quyền accept ( người nhận là to_user và nguòi gửi là request user, phải khác nhau mới accept đc)
        if friend_request.to_user != request.user:
            return Response({"error": "Not allowed"}, status=403)

        # Accept lời mời
        from_user = friend_request.from_user
        to_user = friend_request.to_user
        friend_request.accept()

        # Nếu 2 người đã có conversation 1-1 đang pending → tự động accept luôn
        Conversation.objects.filter(
            is_group=False,
            status='pending',
            conversationmember__user=from_user
        ).filter(
            conversationmember__user=to_user
        ).distinct().update(status='accept')

        return Response({"detail": "Friend request accepted"})


class RejectFriendRequestView(generics.UpdateAPIView):  # từ chối lời mời kết bạn
    permission_classes = [IsAuthenticated]
    serializer_class = FriendShipRequestSerializer
    queryset = FriendshipRequest.objects.all()
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='reject_friend_request'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='cancel_friend_request'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='unfriend'
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
        exclude_group_id = self.request.query_params.get('exclude_group_id') #chức năng lấy ra các thành viên chưa thêm vào group nếu có truyền
        queryset = Friend.objects.filter(from_user=self.request.user).select_related('to_user__profile')
        if exclude_group_id:
            existing_user=ConversationMember.objects.filter(conversation_id=exclude_group_id, is_active=True).values_list("user_id", flat=True)
            queryset = queryset.exclude(to_user_id__in=existing_user)
        return queryset

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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='follow'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='unfollow'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='block'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='unblock'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='start_conv'
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
        # prefetch members + profile để ConversationSerializer.get_is_chatbot không bị N+1
        from django.db.models import Prefetch as _Prefetch
        convo = (
            Conversation.objects
            .prefetch_related(
                _Prefetch(
                    'conversationmember_set',
                    queryset=ConversationMember.objects.select_related('user', 'user__profile')
                )
            )
            .get(pk=convo.pk)
        )
        return Response(
            self.get_serializer(convo).data,
            status=status.HTTP_200_OK
        )

class AcceptMessageRequest(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='accept_msg_request'
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='reject_msg_request'
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
    pagination_class = LargePagePagination
    def get_queryset(self):
        has_message = Exists(Message.objects.filter(conversation=OuterRef('pk'))) #nếu bảng message mà có dữ liệu conversation_id tham chiếu tới conversation thì là true không thì false.
        return (Conversation.objects.filter(
            conversationmember__user=self.request.user, # lấy ra đoạn chat có user
            conversationmember__is_hidden=False,
            conversationmember__is_permanently_hidden=False
        ).filter(#lấy ra conv nếu is group = true hoặc lấy is_group =false, active và có message , không có message hooặc chat 1-1 mà không active thì không lấy
            Q(is_group=True) | #vẫn lấy ra is group dù thoát
            Q(is_group=False, conversationmember__is_active=True) & has_message
        )
        .distinct()
        .prefetch_related(
            # load members + user + profile  trong 2 query thay vì 20 đoạn chat và 40 lần query trong serializer
            # (1 query join conv với message có trong conv, 1 query join user trong conv
            Prefetch( #lấy ra đoạn chat có user và prefetch lấy ra các user trong đó đoạn chat đó luôn (select convmember in conv)
                'conversationmember_set',  # conversationmember có FK với conversation nên phải lấy tham chiếu là set
                queryset=ConversationMember.objects.select_related(  # tùy chỉnh thêm field muốn lấy
                    'user','user__profile',  # JOIN user và profile (1-1)
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
        ).order_by('-updated_at'))

class ConversationSearch(generics.ListAPIView):
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = LargePagePagination
    def get_queryset(self):
        search = self.request.query_params.get("search", "").strip()
        queryset = Conversation.objects.filter(
            conversationmember__user=self.request.user,
            conversationmember__is_hidden=False,
            conversationmember__is_permanently_hidden=False
        ).prefetch_related(
            # load members + user + profile  trong 2 query thay vì 20 đoạn chat và 40 lần query trong serializer
            # (1 query join conv với message có trong conv, 1 query join user trong conv
            Prefetch( #lấy ra đoạn chat có user và prefetch lấy ra các user trong đó đoạn chat đó luôn (select convmember in conv)
                'conversationmember_set',  # conversationmember có FK với conversation nên phải lấy tham chiếu là set
                queryset=ConversationMember.objects.select_related(  # tùy chỉnh thêm field muốn lấy
                    'user','user__profile',  # JOIN user và profile (1-1)
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
        if search:
            queryset = queryset.filter(
                Q(conversationmember__user__profile__first_name__icontains=search) |
                Q(conversationmember__user__profile__last_name__icontains=search) |
                Q(name__icontains=search)
            ).distinct()
        return queryset



class ConversationMessage(generics.ListAPIView):  # xem tin nhắn cuộc trò chuyện
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend, OrderingFilter, SearchFilter]
    ordering_fields = ['created_at']
    filterset_fields = ['sender']  # lọc theo người gửi

    def get_queryset(self):
        convo_id = self.kwargs.get("pk")
        conv = get_object_or_404(Conversation, id=convo_id)
        search = self.request.query_params.get("search", "").strip().lower()
        member= ConversationMember.objects.filter(conversation=conv,user=self.request.user).only('deleted_at_message_id','is_active','left_at').first() # chỉ lấy deleted
        if not member:  # thêm check này
            raise PermissionDenied("Bạn không trong nhóm")
        qs=(
            Message.objects
            .filter(conversation_id=convo_id)  # lọc theo cuộc trò chuyên
            .select_related("sender__profile","reply_to")  # lấy ra profile của sender để hiển thị thông tin người gửi đồng thời với message(1-1 với sender)
            .prefetch_related("attachments")  # lấy ra tất cả file đính kèm trong message đồng thời với message(Foreign key tới Message Attachments n-n)
            .order_by("-created_at")
        )
        if not member.is_active and member.left_at: # user đã rời/bị kick , chỉ hiện tin nhắn trước lúc rời
            qs = qs.filter(created_at__lt=member.left_at)
        if member and member.deleted_at_message_id is not None: # nếu là thành viên và đã xóa
            qs= qs.filter(id__gt=member.deleted_at_message_id) # lấy tin nhắn có thơi gian lớn hơn delete
        if search:
            ids = [
                msg.id
                for msg in qs
                if msg.content and search in msg.content.lower()
            ]
            qs = qs.filter(id__in=ids)
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
            .filter(conversation=conv, is_active=True)
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
            user=request.user,
            is_active=True,
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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='delete_conv'
    def patch(self,request,pk):
        conv=get_object_or_404(Conversation,pk=pk)
        member= ConversationMember.objects.filter(conversation=conv,user=request.user).first()
        if not member: # check quyền
            raise PermissionDenied("You are not member of this conversation")
        last_msg=Message.objects.filter(conversation=conv).order_by('-created_at').first() #lấy ra tin nhắn mới nhất
        if not last_msg:
            member.is_hidden = True
            member.save(update_fields=['is_hidden'])
            return Response({"detail": "No messages to delete"}, status=200)
        member.deleted_at_message_id = last_msg.id # đặt id deleted at khi gọi api băng với id tin nhắn cuối, chỉ lấy tin nhắn sau tin nhắn cuối chưa xóa
        member.last_read_message=None # đặt lại last_read_mesage, khi xóa thì bên serializer sẽ count từ đầu hoặc count theo msg.id > last_read.id
        member.is_hidden = True # ẩn khỏi coversation
        member.save(update_fields=['deleted_at_message_id','last_read_message','is_hidden'])
        return Response({"detail": "Conversation deleted"}, status=200)

class ToogleHideConversation(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='hide_chat'
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
                    'user','user__profile',  # JOIN user và profile (1-1)
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
class ChatAttachmentUpload(AsyncAPIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    async def post(self, request, conv_id):
        """
        Flow:
        1. Upload file lên Cloudinary
        2. Tạo MessageAttachment
        3. Trả attachment_id
        4. Client gọi WS gửi message chứa attachment_id
        5. WS tạo Message rồi update MessageAttachment.message
        """

        is_member = await ConversationMember.objects.filter( #check quyền
            user=request.user,
            conversation_id=conv_id,
            is_active=True
        ).aexists()

        if not is_member:
            return Response(
                {"error": "Không có quyền"},
                status=403
            )

        files = request.FILES.getlist("files")

        if not files:
            return Response(
                {"error": "Thiếu file"},
                status=400
            )

        results = []

        for file in files:

            # giới hạn 50MB
            if file.size > 50 * 1024 * 1024:
                return Response(
                    {"error": f"{file.name} vượt quá 50MB"},
                    status=400
                )

            # detect mime thật, mime là loại file
            mime = await sync_to_async(
                lambda: magic.from_buffer(
                    file.read(4096),
                    mime=True
                ),
                thread_sensitive=False
            )()

            file.seek(0)

            if mime in BLOCKED_MIMES: #loại mime bị block
                return Response(
                    {"error": f"{file.name} không được hỗ trợ"},
                    status=400
                )

            # xác định loại file
            if mime.startswith("image/"):
                file_type = "image"
                resource_type = "image"

            elif mime.startswith("video/"):
                file_type = "video"
                resource_type = "video"

            else:
                file_type = "file"
                resource_type = "raw"

            # upload cloudinary
            result = await sync_to_async(
                cloudinary.uploader.upload,
                thread_sensitive=False
            )(
                file,
                folder=f"chat/conv_{conv_id}",
                resource_type=resource_type,
                public_id=str(uuid.uuid4())
            )

            # tạo attachment
            attachment = await MessageAttachment.objects.acreate(
                conversation_id=conv_id,
                uploaded_by=request.user,
                file_url=result["secure_url"],
                file_type=file_type,
                file_name=file.name,
                file_size=file.size,
                message=None
            )

            data = MessageAttachmentSerializer(
                attachment
            ).data

            data.update({
                "attachment_id": attachment.id,
                "mime": mime
            })

            results.append(data)

        return Response(
            {"attachments": results},
            status=200
        )

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
        ).select_related('actor__profile','actor').order_by("-created_at")

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
     throttle_classes = [ScopedRateThrottle]
     throttle_scope = 'delete_notification'
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
    permission_classes = [IsAuthenticated]  # phải đăng nhập mới search được
    throttle_classes = [ScopedRateThrottle]  # giới hạn số request
    throttle_scope = 'search'  # dùng scope 'search' trong settings THROTTLE_RATES

    def get(self, request):
        keyword = request.query_params.get('q', '').strip()  # lấy từ khóa từ ?q=... và xóa khoảng trắng thừa
        search_type = request.query_params.get('type', 'all')  # ?type=all/posts/profiles/groups, mặc định all

        try:
            page = max(int(request.query_params.get('page', 1)), 1)  # ép về int, tối thiểu 1 tránh page=0 hoặc âm
        except (ValueError, TypeError):
            page = 1  # nếu truyền ?page=abc thì fallback về trang 1 thay vì crash 500

        size = 20  # số kết quả mỗi trang
        offset = (page - 1) * size  # page=1 → offset=0 và 0->20, page=2 → offset=20 và 20->40, dùng để slice ES

        if not keyword:
            return Response({'posts': [], 'profiles': [], 'groups': [], 'pagination': {}})

        # cache key theo user_id + keyword + type + page
        # per-user vì block/friend list khác nhau → cùng keyword nhưng kết quả khác nhau
        cache_key = hashlib.md5(
            f"search:{request.user.id}:{keyword}:{search_type}:{page}".encode()
        ).hexdigest()  # md5 để key ngắn gọn
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)  # có cache → trả về ngay, không query ES hay DB

        user = request.user

        # convert sang list để evaluate 1 lần, tránh subquery lồng nhau khi dùng trong Q()
        blocked_ids  = list(Block.objects.filter(blocked=user).values_list("blocker_id", flat=True))   # người đã block mình
        blocking_ids = list(Block.objects.filter(blocker=user).values_list("blocked_id", flat=True))   # người mình đã block
        friend_ids   = list(Friend.objects.filter(from_user=user).values_list('to_user_id', flat=True))  # danh sách bạn bè

        # Bước 1 lấy các data đã phân tách trong db của elastic và lấy các id
        # ── POST QUERY ────────────────────────────────────────────────────────
        post_search = PostDocument.search().query(
            "bool",
            should=[
                # should = OR: match 1 trong các điều kiện là được
                ESQ("bool", must=[ESQ("match_phrase", title=keyword)], boost=4.0),
                # match_phrase: gõ đúng cụm liền nhau → rank cao nhất
                ESQ("match", title={
                    "query": keyword,
                    "boost": 2.0,          # rank thấp hơn match_phrase
                    "fuzziness": "AUTO",   # tự sửa lỗi chính tả: "tran" → "trần"
                    "prefix_length": 1,    # ký tự đầu phải đúng tránh kết quả rác
                    "max_expansions": 50   # giới hạn số biến thể fuzziness sinh ra
                }),
            ],
            minimum_should_match=1  # bắt buộc match ít nhất 1 điều kiện
        )

        # ── PROFILE QUERY ─────────────────────────────────────────────────────
        profile_search = ProfileDocument.search().query(
            "bool",
            should=[
                ESQ("bool", must=[ESQ("match_phrase", full_name=keyword)], boost=5.0),
                # gõ đúng họ tên đầy đủ → rank cao nhất
                ESQ("match", full_name={"query": keyword, "boost": 3.0, "fuzziness": "AUTO", "prefix_length": 1, "max_expansions": 50}),
                # match full_name: gõ 1 phần cũng ra "tran" → "Trần Nghị"
                ESQ("match", first_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                # fallback: tìm theo tên riêng lẻ
                ESQ("match", last_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                # fallback: tìm theo họ riêng lẻ
            ],
            minimum_should_match=1
        )

        # ── GROUP QUERY ───────────────────────────────────────────────────────
        group_search = GroupDocument.search().query(
            "bool",
            should=[
                ESQ("bool", must=[ESQ("match_phrase", name=keyword)], boost=5.0),
                # gõ đúng tên group → rank cao nhất
                ESQ("match", name={
                    "query": keyword,
                    "boost": 3.0,
                    "fuzziness": "AUTO",
                    "prefix_length": 1,
                    "max_expansions": 50
                }),
                # match tên + sửa lỗi chính tả
            ],
            minimum_should_match=1
        ).sort(
            "_score",                            # ưu tiên relevance trước
            {"member_count": {"order": "desc"}}  # cùng score → nhiều member lên trước
        )

        # khởi tạo mặc định tránh lỗi nếu 1 trong các search fail
        posts        = []
        profiles     = []
        groups       = []
        posts_qs     = Post.objects.none()   # dùng cho get_reactions_post_context bên dưới
        profiles_qs  = Profile.objects.none()  # dùng cho get_online_set bên dưới
        total_posts  = total_profiles = total_groups = 0

        try:
            # ad vào để phân trang
            ms = MultiSearch()
            if search_type in ('all', 'posts'):
                ms = ms.add(post_search[offset:offset + size])
            if search_type in ('all', 'profiles'):
                ms = ms.add(profile_search[offset:offset + size])
            if search_type in ('all', 'groups'):
                ms = ms.add(group_search[offset:offset + size])

            responses = ms.execute()
            # execute() gửi 1 request đến ES, trả list response theo thứ tự add
            # total và hits từ cùng 1 response → không bị lệch data
            idx = 0  # index để lấy đúng response theo thứ tự add vào MultiSearch

            # Bước 2, từ cái id lấy trong db elastic đã filter search, lọc ra từ model
            # ── XỬ LÝ POST ───────────────────────────────────────────────────
            if search_type in ('all', 'posts'):
                try:
                    post_response = responses[idx]; idx += 1         # lấy response post, tăng idx
                    total_posts   = post_response.hits.total.value   # tổng kết quả ES tìm được (ước tính, trước khi filter Django)
                    post_ids      = [hit.meta.id for hit in post_response]  # lấy id từ ES hits
                    # elastic trả id post chỉ cần lọc lấy ra trong post model
                    posts_qs = (
                        Post.objects
                        .filter(
                            post_id__in=post_ids,    # chỉ lấy post ES đã tìm được
                            deleted__isnull=True,    # loại soft delete
                            group__isnull=True       # group post không xuất hiện ở search ngoài
                        )
                        .exclude(Q(user_id__in=blocked_ids) | Q(user_id__in=blocking_ids))  # loại block 2 chiều
                        .filter(
                            Q(privacy='public') |                              # public → ai cũng thấy
                            Q(privacy='friends', user_id__in=friend_ids) |    # friends → phải là bạn
                            Q(privacy='friends', user=user) |                  # bài mình privacy friends
                            Q(privacy='private', user=user)                    # bài mình privacy private
                        )
                        .select_related('user', 'user__profile')  # tránh N+1 khi serialize
                        .prefetch_related('photos')               # tránh N+1 cho photos
                    )
                    posts_dict = {str(p.post_id): p for p in posts_qs}       # dict để lookup O(1)
                    posts = [posts_dict[pid] for pid in post_ids if pid in posts_dict]
                    # giữ thứ tự relevance từ ES, bỏ id bị filter bởi Django (block/privacy)
                except Exception as e:
                    logger.error(f"Post search error | user={user.id} keyword={keyword} | {e}")
                    posts = []  # post fail không ảnh hưởng profiles và groups

            # ── XỬ LÝ PROFILE ────────────────────────────────────────────────
            if search_type in ('all', 'profiles'):
                try:
                    profile_response = responses[idx]; idx += 1
                    total_profiles   = profile_response.hits.total.value
                    profile_ids      = [hit.meta.id for hit in profile_response]

                    profiles_qs = (
                        Profile.objects
                        .filter(id__in=profile_ids, deleted__isnull=True)
                        .exclude(Q(user_id__in=blocked_ids) | Q(user_id__in=blocking_ids))  # loại block 2 chiều
                        .select_related('user')  # tránh N+1
                    )
                    profiles_dict = {str(p.id): p for p in profiles_qs}
                    profiles = [profiles_dict[pid] for pid in profile_ids if pid in profiles_dict]
                    # giữ thứ tự relevance từ ES
                except Exception as e:
                    logger.error(f"Profile search error | user={user.id} keyword={keyword} | {e}")
                    profiles = []

            # ── XỬ LÝ GROUP ──────────────────────────────────────────────────
            if search_type in ('all', 'groups'):
                try:
                    group_response = responses[idx]  # không tăng idx vì đây là cái cuối
                    total_groups   = group_response.hits.total.value
                    group_ids      = [hit.meta.id for hit in group_response]

                    # convert sang list để tránh subquery lồng nhau trong Case/When
                    user_group_ids = list(GroupMember.objects.filter(
                        user=user, is_active=True
                    ).values_list('group_id', flat=True))  # group user đang là member

                    user_pending_ids = list(GroupJoinRequest.objects.filter(
                        user=user, status='pending'
                    ).values_list('group_id', flat=True))  # group user đang chờ duyệt

                    groups_qs = (
                        Group.objects
                        .filter(id__in=group_ids, deleted__isnull=True)
                        .annotate(
                            member_count=Count('members', filter=Q(members__is_active=True)),
                            # đếm member active để hiện lên UI, khác member_count trong ES (dùng để sort)
                            is_member=Case(
                                When(id__in=user_group_ids, then=True),
                                default=False,
                                output_field=BooleanField()
                            ),  # True nếu user đang là member → join_status = 'member'
                            is_pending=Case(
                                When(id__in=user_pending_ids, then=True),
                                default=False,
                                output_field=BooleanField()
                            )   # True nếu user đang chờ duyệt → join_status = 'pending'
                        )
                        .select_related('created_by', 'created_by__profile')  # tránh N+1\
                        .prefetch_related(
                            Prefetch(
                                'members',
                                queryset=GroupMember.objects.filter(user=user, is_active=True).select_related(
                                    'job_role__department', 'job_role'),
                                to_attr='my_membership'
                            )
                        )
                    )
                    groups_dict = {str(g.id): g for g in groups_qs}
                    groups = [groups_dict[gid] for gid in group_ids if gid in groups_dict]
                    # giữ thứ tự relevance từ ES
                except Exception as e:
                    logger.error(f"Group search error | user={user.id} keyword={keyword} | {e}")
                    groups = []

        except Exception as e:
            # MultiSearch fail hoàn toàn (ES down, network...) → trả rỗng, không crash server
            logger.error(f"MultiSearch failed | user={user.id} keyword={keyword} | {e}")

        # Build reaction context một lần thay vì N lần trong serializer
        post_reaction_ctx = get_reactions_post_context(posts_qs, user) if posts else {'reactions_map': {}, 'user_reactions_map': {}}

        result = {
            'posts': PostSerializer(posts, many=True, context={
                'request': request,
                **post_reaction_ctx,  # reactions_map + user_reactions_map
            }).data,
            # context request để serializer lấy user hiện tại (dùng cho is_reaction...)
            'profiles': ProfileSerializer(profiles, many=True, context={
                'request': request,
                'online_set': get_online_set(profiles_qs) if profiles else set()
                # online_set: batch check online status, tránh N+1 query Redis
            }).data,
            'groups': GroupSerializer(groups, many=True, context={'request': request}).data,
            'pagination': {
                'page': page,
                'size': size,
                'total_posts':       total_posts,
                'total_profiles':    total_profiles,
                'total_groups':      total_groups,
                'has_next_posts':    offset + size < total_posts,    # còn trang tiếp không
                'has_next_profiles': offset + size < total_profiles,
                'has_next_groups':   offset + size < total_groups,
            }
        }

        # chỉ cache khi có kết quả, tránh cache rỗng khi ES down
        if any([posts, profiles, groups]):
            cache.set(cache_key, result, timeout=30)  # cache 30s: đủ tránh spam, không quá cũ

        return Response(result)

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
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='suport_ticket_create'
    def perform_create(self, serializer):
        instance = serializer.save(user=self.request.user)

#===================================GROUP===========================================
class CreateGroupConversation(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='create_group_chat'
    def post(self,request):
        name = request.data.get('name')
        member_ids= request.data.get('members',[]) # mặc định list rỗng
        if not name:
            return Response({'error':'Tên nhóm không được rỗng'},status=400)
        if len(member_ids) <2:
            return Response({'error':'Nhóm cần ít nhất 2 thành viên'},status=400)
        with transaction.atomic():
            conversation = Conversation.objects.create(
                is_group=True,
                name=name,
                created_by=request.user,
                status='accept'
            )
            ConversationMember.objects.create(
                conversation=conversation,
                user=request.user,
                role='admin'
            )
            members= User.objects.filter(id__in=member_ids)
            ConversationMember.objects.bulk_create([
                ConversationMember(conversation=conversation, user=u, role='member')
                for u in members
            ])
        serializer = ConversationSerializer(conversation, context={'request': request})
        return Response(serializer.data,status=200)

class TransferAdminGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='transfer_admin_chat'
    def post(self,request,conv_id):
        new_admin_id = request.data.get('new_admin_id')
        profile = request.user.profile
        try: #check user hiện tại có phải admin
            membership= ConversationMember.objects.get(conversation_id=conv_id, conversation__is_group=True, user=request.user, role='admin',is_active=True)
        except ConversationMember.DoesNotExist:
            return Response({"error": "Bạn không có quyền"}, status=403)
        # check người được trao admin có trong nhóm
        new_admin = ConversationMember.objects.filter(conversation_id=conv_id, user_id=new_admin_id,is_active=True).first()
        if not new_admin:
            return Response({"error": "Người dùng không trong nhóm"}, status=404)

        with transaction.atomic():
            membership.role='member'
            membership.save(update_fields=['role'])
            new_admin.role='admin'
            new_admin.save(update_fields=['role'])

        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=request.user,
            content=f"{profile.full_name} đã chuyển quyền admin",
            message_type='system_admin_transferred'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send) (
                f'chat_{conv_id}', # gửi đến device connect với tên này trong redis
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response({"new_admin": new_admin_id}, status=200)

class AddMemberGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='add_member_group_chat'
    def post(self,request,conv_id):
        new_member_ids= request.data.get('new_members',[])
        profile = request.user.profile
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=request.user, is_active=True).exists(): #check user có trong nhóm k
            return Response({"error": "Bạn không trong nhóm"}, status=403)

        if not new_member_ids:
            return Response({"error": "Danh sách thành viên không được để trống"}, status=400)

        new_member_ids= list(set(new_member_ids)) # thêm vào set tránh bị lặp thành viên
        new_members= ConversationMember.objects.filter(conversation_id=conv_id, user_id__in=new_member_ids, is_active=True).values_list('user_id',flat=True) #láy ra các thành viên đã ở sẵn trong group rồi
        validate_new_member = [u_id for u_id in new_member_ids if u_id not in new_members] # lấy ra thành viên chưa có trong group

        if not validate_new_member: # nếu trừ đi mà 0 còn thành viên nào thì chứng tỏ dã có trong gr sẵn r
            return Response({"detail": "Tất cả các thành viên đã có trong nhóm."}, status=200)

        users = User.objects.filter(id__in=validate_new_member) #check có user k
        for u in users:
            ConversationMember.objects.update_or_create( #update thì sẽ update ở defaults còn create thì defaults sẽ là cái dó
                conversation_id=conv_id,
                user=u,
                defaults={
                    'role': 'member',
                    'is_active': True,
                    'left_at': None
                }
            )
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=request.user,
            content=f"{profile.full_name} đã thêm {len(users)} thành viên vào nhóm",
            message_type='system_member_added'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send) (
                f'chat_{conv_id}', # gửi đến device connect với tên này trong redis
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response({"detail": "Thêm thành công"}, status=200)

class ModifyGroupChat(APIView):
    permission_classes = [IsAuthenticated,IsConversationMember]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, conv_id):
        conv= get_object_or_404(Conversation, id=conv_id, is_group=True)
        self.check_object_permissions(request,conv)
        update_fields = []
        profile = request.user.profile
        picture = request.FILES.get('group_avatar')
        name = request.data.get('name')
        if picture:
            conv.avatar = picture
            update_fields.append('avatar')
        if name:
            conv.name = name
            update_fields.append('name')
        if not update_fields:
            return Response({"error": "Không có gì để cập nhật"}, status=400)
        conv.save(update_fields=update_fields)
        serializer = ConversationSerializer(conv, context={'request': request})
        messages_to_send = []
        if 'name' in update_fields:
            messages_to_send.append(Message.objects.create(
                conversation_id=conv_id,
                sender=request.user,
                content=f"{profile.full_name} đã đổi tên nhóm thành {name}",
                message_type='system_name_changed'
            ))
        if 'avatar' in update_fields:
            messages_to_send.append(Message.objects.create(
                conversation_id=conv_id,
                sender=request.user,
                content=f"{profile.full_name} đã đổi ảnh nhóm",
                message_type='system_avatar_changed'
            ))
        try:
            channel_layer = get_channel_layer()
            for msg in messages_to_send:
                async_to_sync(channel_layer.group_send)(
                    f'chat_{conv_id}',
                    {
                        'type': 'system_message',
                        'message': msg.content if msg else None,
                        'message_type': msg.message_type if msg else None,
                    }
                )
        except Exception:
            pass
        return Response(serializer.data, status=200)

class DeleteGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    def delete(self,request,conv_id):
        try:
            user_member = ConversationMember.objects.get(conversation_id=conv_id, conversation__is_group=True, user=request.user, role='admin', is_active=True)
        except ConversationMember.DoesNotExist:
            return Response({"error": "Bạn không có quyền"}, status=403)
        if request.user.has_usable_password():  # Nếu user có password vì register, dùng google login không có password nên bỏ qua
            password = request.data.get("password")
            if not password:
                return Response({'error': "Please enter password"}, status=400)
            if not authenticate(request=request, username=request.user.username, password=password):
                return Response({'error': 'Wrong password'}, status=400)
        deleted, _ = Conversation.objects.filter(id=conv_id,is_group=True).delete()
        if not deleted:
            return Response({"error": "Không có group này"}, status=400)
        return Response({"conv_id": conv_id,}, status=200)

class KickMemberGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='delete_member_group_chat'
    def post(self, request, *args, **kwargs):
        conv_id = self.kwargs.get("conv_id")
        user_kick_id = self.kwargs.get('kick_id')
        profile = request.user.profile
        if not user_kick_id:
            return Response({"error":"không có user kick"},status=400)
        if user_kick_id == request.user.id:
            return Response({"error":"không thể kick chính mình"},status=400)
        try: #check valid conv_id truyền vào và cả check admin
            ConversationMember.objects.get(conversation_id=conv_id, conversation__is_group=True, user=request.user, role='admin', is_active=True) #conversation is group sẽ được JOIN vào
        except ConversationMember.DoesNotExist:
            return Response({"error": "Bạn không có quyền"}, status=403)
        #lọc ra có member k và xóa
        member = ConversationMember.objects.filter(conversation_id=conv_id,user_id=user_kick_id,role='member',is_active=True).select_related('user__profile').first()
        if not member:
            return Response({"error": "Không có thành viên này"}, status=400)
        member.is_active = False
        member.left_at = timezone.now()
        member.save(update_fields=['is_active', 'left_at'])
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=request.user,
            content=f"{profile.full_name} đã xóa {member.user.profile.full_name} thành viên",
            message_type='system_member_kicked'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send) (
                f'chat_{conv_id}', # gửi đến device connect với tên này trong redis
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response({"success": user_kick_id}, status=200)

class LeaveGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request, *args, **kwargs):
        conv_id =self.kwargs.get("conv_id")
        profile = request.user.profile
        try:
            user_member = ConversationMember.objects.get(conversation_id=conv_id,conversation__is_group=True, user=request.user,is_active=True)
        except ConversationMember.DoesNotExist:
            return Response({"error": "Bạn không có trong group"}, status=403)
        if user_member.role == 'admin':
            next_admin_user_id = request.data.get('next_admin_user_id')
            if not next_admin_user_id:
                return Response({"error": "chọn user kế thừa admin"}, status=400)
            with transaction.atomic():
                updated = ConversationMember.objects.filter(conversation_id=conv_id, user_id=next_admin_user_id, is_active=True).update(role='admin')
                if not updated:
                    return Response({"error": "Thành viên không hợp lệ"}, status=400)
                user_member.is_active = False
                user_member.left_at = timezone.now()
                user_member.save(update_fields=['is_active', 'left_at'])
            return  Response({"success": True}, status=200)
        user_member.is_active = False
        user_member.left_at = timezone.now()
        user_member.save(update_fields=['is_active', 'left_at'])
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=request.user,
            content=f"{profile.full_name} đã rời nhóm",
            message_type='system_member_left'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',  # gửi đến device connect với tên này trong redis
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response({"success": True}, status=200)

#========================TASK===========================================================

class CreateTaskGroupChat(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='add_tasks'
    serializer_class = TaskSerializer
    def perform_create(self, serializer): #perform_create tự trả về object vừa create
        user= self.request.user
        conv_id= self.kwargs.get('conv_id')
        profile = user.profile
        if not conv_id:
            raise NotFound("Vui lòng truyền conversation id")
        if not ConversationMember.objects.filter(
                conversation_id=conv_id,
                user=self.request.user,
                is_active=True
        ).exists():
            raise PermissionDenied("Bạn không trong nhóm")
        content_type = ContentType.objects.get_for_model(Conversation)
        serializer.save(content_type=content_type, object_id=conv_id, created_by=user)
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=self.request.user,
            content=f"{profile.full_name} đã tạo task",
            message_type='system_task_created'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass


class AddMemberIntoTaskGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='add_member_tasks'
    def post(self,request,conv_id):
        add_member_ids= request.data.get('add_member_ids')
        tasks_id = request.data.get('tasks_id')
        profile = request.user.profile
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không trong nhóm")
        task = get_object_or_404(Task.objects.select_related("created_by__profile"), id=tasks_id)
        if task.created_by != request.user:
            raise PermissionDenied("Bạn phải là người tạo mới được thêm thành viên")
        user_ids= User.objects.filter(id__in=add_member_ids) #validate id truyền vào có real
        task.assigned_to.add(*user_ids)  # ManyToMany dùng add, dấu * dùng để add từng id chứ k truyền 1 set vào, bị trùng thì tự loại
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=self.request.user,
            content=f"{profile.full_name} đã thêm thành viên trong task {task.title}",
            message_type='system_task_assigned'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response({"success": True}, status=200)

class MemberofTaskGroupChat(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    pagination_class = SmallPagePagination
    serializer_class = ProfileSerializer
    def get_queryset(self):
        conv_id = self.kwargs.get('conv_id')
        task_id = self.kwargs.get('task_id')
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không trong nhóm")
        contenttype = ContentType.objects.get_for_model(Conversation)
        task = get_object_or_404(Task, content_type=contenttype, object_id=conv_id, id=task_id)
        return Profile.objects.filter(
            user__in=task.assigned_to.all(), # lấy ra user trong user được giao trong task
            user__conversationmember__conversation_id= conv_id, # user có trong conversationmember có conv_id = conv_id
            user__conversationmember__is_active=True #user trong conversationmember mà is_active =True, rời group thì k hiện
        ).select_related('user')

class UpdateTaskGroupChat(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = TaskSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope='update_tasks'
    def get_object(self):
        conv_id = self.kwargs.get('conv_id')
        task_id = self.kwargs.get('task_id')
        task= get_object_or_404(Task.objects.select_related("created_by__profile"), id=task_id)
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        #không phải là người tạo và không phải là người đc giao thì không được lấy và sửa
        if task.created_by != self.request.user and not task.assigned_to.filter(id=self.request.user.id).exists():
            raise PermissionDenied("Bạn không có quyền")
        return task

    def patch(self, request, *args, **kwargs):
        task = self.get_object() #kế thừa
        profile = request.user.profile
        serializer = self.get_serializer(task, data=request.data, partial=True) # gọi serializer để validate get_fields,truyền vào task để chạy get_fields
        serializer.is_valid(raise_exception=True)
        serializer.save()
        message_system = Message.objects.create(
            conversation_id=self.kwargs.get('conv_id'),
            sender=self.request.user,
            content=f"{profile.full_name} đã cập nhật trong task {task.title}",
            message_type='system_task_updated'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{self.kwargs.get('conv_id')}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response(serializer.data, status=200)

class DeleteTaskGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='delete_tasks'
    def delete(self, request, task_id, conv_id):
        profile = request.user.profile
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        content_type= ContentType.objects.get_for_model(Conversation)
        task= get_object_or_404(Task.objects.select_related("created_by__profile"), id=task_id, content_type=content_type, object_id=conv_id)
        if task.created_by != request.user:
            raise PermissionDenied("Chỉ có người tạo task mới có thể xóa")
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=self.request.user,
            content=f"{profile.full_name} đã xóa task {task.title}",
            message_type='system_task_deleted'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        task.delete()
        return Response({"deleted_task_id": task_id}, status=200)

class ListTaskGroupChat(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend,OrderingFilter,SearchFilter]
    filterset_fields = ['status','assigned_to'] #filter đúng ra ví dụ task.status= todo
    ordering_fields = ['created_at','deadline','priority'] # sắp xếp tăng giảm dần
    search_fields = ['title']
    serializer_class = TaskSerializer
    pagination_class = SmallPagePagination
    def get_queryset(self):
        conv_id = self.kwargs.get('conv_id')
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong nhóm")
        contenttype= ContentType.objects.get_for_model(Conversation)
        return Task.objects.filter(content_type=contenttype,object_id=conv_id,).order_by('-created_at').select_related('created_by__profile').prefetch_related(Prefetch('assigned_to', queryset=User.objects.select_related('profile')))

class GetFileFromConversation(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend,OrderingFilter]
    serializer_class = MessageAttachmentSerializer
    pagination_class = LargePagePagination
    filterset_fields = ['file_type']
    def get_queryset(self):
        conv_id= self.kwargs.get('conv_id')
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        return MessageAttachment.objects.filter(
            conversation_id=conv_id,
        ).select_related("uploaded_by__profile").order_by('-created_at')

#==================VOTE==========================================================

class CreateVoteGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='create_vote'
    def post(self, request, *args, **kwargs):
        conv_id = self.kwargs.get("conv_id")
        title = self.request.data.get("title")
        profile = request.user.profile
        options = self.request.data.get("options",[]) #mảng text option user truyền vào
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype= ContentType.objects.get_for_model(Conversation)
        if not title:
            return Response({"error": "Vui lòng nhập tiêu đề"}, status=400)
        if len(options) < 2:
            return Response({"error": "Vui lòng chọn ít nhất 2 option"}, status=400)
        
        with transaction.atomic():
            vote = Vote.objects.create(
                created_by=request.user,
                title=title,
                content_type=contenttype,
                object_id=conv_id
            )
            VoteOption.objects.bulk_create([
                VoteOption(vote=vote, text=opt) for opt in options
            ])
        vote = Vote.objects.prefetch_related('options').select_related('created_by__profile').get(id=vote.id) #lấy get để đem vào serializer có prefetch tránh n+1
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=self.request.user,
            content=f"{profile.full_name} đã thêm vote {vote.title}",
            message_type='system_vote_created'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        serializer = VoteSerializer(vote, context={'request': request})
        return Response(serializer.data, status=201)


class DeleteVoteGroupChat(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='delete_vote'
    def get_object(self):
        conv_id = self.kwargs.get('conv_id')
        vote_id = self.kwargs.get("vote_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype= ContentType.objects.get_for_model(Conversation)
        vote =  get_object_or_404(Vote.objects.select_related('created_by__profile'),id=vote_id,object_id=conv_id,content_type=contenttype)
        if vote.created_by != self.request.user:
            raise PermissionDenied("Phải là người tạo mới được xóa vote")
        return vote

    def perform_destroy(self, instance):
        conv_id = self.kwargs.get('conv_id')
        user = self.request.user
        instance.delete()
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=user,
            content=f"{instance.created_by.profile.full_name} đã xóa cuộc bình chọn",
            message_type='system_vote_deleted'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass

class UserVoteGroupChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='user_vote'
    def post(self, request, conv_id, vote_id, vote_option_id):
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user, is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        profile = request.user.profile
        contenttype = ContentType.objects.get_for_model(Conversation)
        vote_option = get_object_or_404( #lấy ra option user chọn
            VoteOption,
            id=vote_option_id,
            vote__object_id=conv_id,
            vote__content_type=contenttype,
            vote__is_closed=False
        )

        with transaction.atomic():
            existing_vote = ( #lẩy ra xem user đã vote chưa
                UserVote.objects
                .select_for_update()
                .select_related('option')
                .filter(option__vote_id=vote_id, created_by=request.user)
                .first()
            )

            if not existing_vote:
                # Chưa vote thì tạo mới
                user_vote = UserVote.objects.create(option=vote_option, created_by=request.user)
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') + 1)

            elif existing_vote.option.id == vote_option_id:
                # Đã vote option thì hủy
                existing_vote.delete()
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') - 1)
                return Response({"message": "Đã hủy vote"}, status=200)

            else:
                # Đã vote option khác → đổi sang option mới
                old_option_id = existing_vote.option.id
                existing_vote.option = vote_option
                existing_vote.save(update_fields=['option'])
                VoteOption.objects.filter(id=old_option_id).update(count=F('count') - 1)
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') + 1)
                user_vote = existing_vote
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=self.request.user,
            content=f"{profile.full_name} đã cập nhật vote vào option",
            message_type='system_vote_added'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        serializer = UserVoteSerializer(user_vote, context={"request": request})
        return Response(serializer.data, status=201)

class UpdateVoteGroupChat(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = VoteSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='update_vote'
    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        conv_id = self.kwargs.get("conv_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype= ContentType.objects.get_for_model(Conversation)
        vote = get_object_or_404(Vote.objects.prefetch_related('options').select_related('created_by__profile'),id=vote_id,content_type=contenttype,object_id=conv_id)
        if vote.created_by != self.request.user:
            raise PermissionDenied("Phải là người tạo mới được sửa")
        return vote

    def patch(self, request, *args, **kwargs):
        vote = self.get_object()  # kế thừa
        profile = vote.created_by.profile
        serializer = self.get_serializer(vote, data=request.data, partial=True) #để update
        serializer.is_valid(raise_exception=True)
        serializer.save()
        message_system = Message.objects.create(
            conversation_id=self.kwargs.get('conv_id'),
            sender=self.request.user,
            content=f"{profile.full_name} đã cập nhật cuộc bình chọn {vote.title}",
            message_type='system_vote_updated'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"chat_{self.kwargs.get('conv_id')}",
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        return Response(serializer.data, status=200)

class AddOptionVoteGroupChat(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = VoteOptionSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='add_option_vote'
    def create(self, request, *args, **kwargs):
        vote_id = self.kwargs.get("vote_id")
        conv_id = self.kwargs.get("conv_id")
        profile = request.user.profile
        options = request.data.get("options",[])
        if not options:
            return Response({"error": "Vui lòng truyền option"}, status=400)
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype= ContentType.objects.get_for_model(Conversation)
        vote = get_object_or_404(Vote,id=vote_id,content_type=contenttype,object_id=conv_id,is_closed=False)
        created = VoteOption.objects.bulk_create([
            VoteOption(vote=vote, text=opt)
            for opt in options
        ])
        message_system = Message.objects.create(
            conversation_id=self.kwargs.get('conv_id'),
            sender=self.request.user,
            content=f"{profile.full_name} đã thêm  {len(options)} option cho cuộc bình chọn {vote.title}",
            message_type='system_vote_option_added'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"chat_{self.kwargs.get('conv_id')}",
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
        serializer = self.get_serializer(created, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class UpdateOptionVoteGroupChat(generics.UpdateAPIView): #tất cả đều update title đc
    permission_classes = [IsAuthenticated]
    serializer_class = VoteOptionSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='update_option_vote'
    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        option_id = self.kwargs.get("option_id")
        conv_id = self.kwargs.get("conv_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype = ContentType.objects.get_for_model(Conversation)
        vote = get_object_or_404(Vote, id=vote_id, content_type=contenttype, object_id=conv_id, is_closed=False)
        return get_object_or_404(VoteOption, id=option_id,vote=vote)

class DeleteOptionVoteGroupChat(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='delete_option_vote'
    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        option_id = self.kwargs.get("option_id")
        conv_id = self.kwargs.get("conv_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype= ContentType.objects.get_for_model(Conversation)
        vote = get_object_or_404(Vote,id=vote_id,content_type=contenttype,object_id=conv_id,is_closed=False)
        if vote.created_by != self.request.user:
            raise PermissionDenied("Phải là người tạo mới được xóa option")
        option = get_object_or_404(VoteOption, id=option_id, vote=vote)
        return option

    def perform_destroy(self, instance):
        conv_id = self.kwargs.get('conv_id')
        user = self.request.user
        instance.delete()
        message_system = Message.objects.create(
            conversation_id=conv_id,
            sender=user,
            content=f"{user.profile.full_name} đã xóa cuộc bình chọn",
            message_type='system_vote_option_deleted'
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': message_system.content,
                    'message_type': message_system.message_type,
                }
            )
        except Exception:
            pass
class ListVoteGroupChat(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = VoteSerializer
    pagination_class = LargePagePagination
    filter_backends = (DjangoFilterBackend,SearchFilter)
    search_fields = ['title']
    def get_queryset(self):
        conv_id = self.kwargs.get("conv_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype = ContentType.objects.get_for_model(Conversation)
        options_prefetch = Prefetch(
            'options', #related name của vote option
            queryset=VoteOption.objects.annotate( # annotate thêm tạm 1 cột trong db và xử lý ở db
                is_voted=Exists( # trả true false nếu vote option có bảng tham chiếu tới uservote có user
                    UserVote.objects.filter(
                        option=OuterRef('pk'), #OuterRef('pk') = id của VoteOption đang được duyệt qua có liên kết tới user vote có user trong đó
                        created_by=self.request.user
                    )
                )
            )
        )

        return (
            Vote.objects
            .filter(content_type=contenttype, object_id=conv_id)
            .select_related('created_by__profile')
            .prefetch_related(options_prefetch) # từ vote , lấy vote option in vote, và với mỗi vote option thì có tồn tại uservote của user
            .order_by('is_closed', '-created_at')  # vote đang mở lên trước, mới nhất trên cùng
        )

class ListUserVoteGroupChat(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserVoteSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        conv_id = self.kwargs.get("conv_id")
        vote_id = self.kwargs.get("vote_id")
        option_id= self.kwargs.get("option_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id, user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        contenttype = ContentType.objects.get_for_model(Conversation)
        return UserVote.objects.filter(option_id=option_id,option__vote_id=vote_id,option__vote__content_type=contenttype,option__vote__object_id=conv_id).select_related('created_by__profile','option','option__vote')


#==============VIDEO CALL ROOM========================================================================
"""1 user a bấm gọi, sẽ gọi api tạo phòng trả về token cho fe
    2 fe gọi livekit kiểm tra token có cho kết nối vào room, có cho kết nối thì video và mic user a đó trên cloud
     3 hiển thị broadcast lên phòng qua ws noti, user b thấy bấm vào và join cuộc gọi
        4. user b gọi api join phòng kiểm tra có phòng đang active thì kết nối vào và lấy token cho fe và fe gọi livekit,token có quyền thì vô phòng
"""
class CreateVideoRoomView(AsyncAPIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='create_call'
    async def post(self, request, conv_id):
        is_member = await ConversationMember.objects.filter(
            conversation_id=conv_id, user=request.user, is_active=True
        ).aexists()
        if not is_member:
            raise PermissionDenied("Bạn không có trong cuộc trò chuyện")

        # Không cho tạo nếu đã có phòng active
        existing = await VideoRoom.objects.filter(
            conversation_id=conv_id, is_active=True
        ).aexists()
        if existing:
            raise ValidationError("Đang có cuộc gọi trong cuộc trò chuyện này")

        room = await VideoRoom.objects.acreate( #tạo phòng khi không active, mỗi lần gọi sẽ tạo mới phòng
            conversation_id=conv_id,
            room_name=f"conv-{conv_id}-{uuid.uuid4().hex[:8]}",
            created_by=request.user,
            is_active=True,
        )

        # Lấy tất cả member ids 1 lần
        member_ids = []
        async for uid in ConversationMember.objects.filter(
            conversation_id=conv_id, is_active=True
        ).values_list('user_id', flat=True):
            member_ids.append(uid)

        await CallParticipant.objects.abulk_create([ # tạo thành viên
            CallParticipant(room=room, user_id=uid)
            for uid in member_ids
        ], ignore_conflicts=True)

        # Người gọi sẽ luôn là accept vì chủ động gọi
        await CallParticipant.objects.filter(
            room=room, user=request.user
        ).aupdate(status='accepted', joined_at=timezone.now())
        
        profile = request.user.profile
        full_name = profile.full_name
        avatar = getattr(profile.picture, "url", None) if profile else None
        channel_layer = get_channel_layer()
        tasks = [
            channel_layer.group_send(
                f'notification_{uid}',          # gửi tới callee, không phải caller
                {
                    'type':          'incoming_call',
                    'conv_id':       conv_id,
                    'room_name':     room.room_name,
                    'caller_id':     request.user.id,
                    'caller_name':   full_name,
                    'caller_avatar': avatar,
                }
            )
            for uid in member_ids
            if uid != request.user.id          # bỏ qua caller
        ]
        await asyncio.gather(*tasks)

        token = await self._create_token(room.room_name, request.user)
        return Response({
            'token':       token,
            'room_name':   room.room_name,
            'livekit_url': env("LIVEKIT_URL"),
        })

    async def _create_token(self, room_name, user):
        display_name = user.profile.full_name if hasattr(user, 'profile') else user.username
        token = api.AccessToken(
            env("LIVEKIT_API_KEY"),
            env("LIVEKIT_API_SECRET")
        ).with_identity(str(user.id)) \
         .with_name(display_name) \
         .with_grants(api.VideoGrants(
             room_join=True,
             room=room_name,
         )).to_jwt()
        return token

class JoinVideoRoomView(AsyncAPIView):
    permission_classes = [IsAuthenticated]

    async def post(self, request, conv_id):

        room = await VideoRoom.objects.filter( # kiểm tra xem cuộc gọi còn không
            conversation_id=conv_id, is_active=True
        ).afirst()
        if not room:
            raise NotFound("Cuộc gọi đã kết thúc")

        participant = await CallParticipant.objects.filter( #check quyền
            room=room, user=request.user
        ).afirst()
        if not participant:
            raise PermissionDenied("Bạn không được mời vào cuộc gọi này")


        now = timezone.now()
        await CallParticipant.objects.filter(id=participant.id).aupdate( # cập nhật vào phòng
            status='accepted', joined_at=now
        )

        # Lần đầu tiên có người thứ 2 join thì set started_at
        if not room.started_at:
            await VideoRoom.objects.filter(id=room.id).aupdate(started_at=now)

        token = await self._create_token(room.room_name, request.user)
        return Response({
            'token':       token,
            'room_name':   room.room_name,
            'livekit_url': env("LIVEKIT_URL"),
        })
    async def _create_token(self, room_name,user):
        lkapi = api.LiveKitAPI(
            env("LIVEKIT_URL"),
            env("LIVEKIT_API_KEY"),
            env("LIVEKIT_API_SECRET")
        )
        display_name = user.profile.full_name if hasattr(user, 'profile') else user.username
        token = api.AccessToken(
            env("LIVEKIT_API_KEY"),
            env("LIVEKIT_API_SECRET")
        ).with_identity(str(user.id)) \
         .with_name(display_name) \
         .with_grants(api.VideoGrants(
             room_join=True,
             room=room_name,
         )).to_jwt()
        return token

class DeclineCallView(AsyncAPIView):
    permission_classes = [IsAuthenticated]
    async def post(self, request, conv_id):
        room = await VideoRoom.objects.select_related(
            'conversation', 'created_by'
        ).filter(conversation_id=conv_id, is_active=True).afirst()
        if not room:
            raise NotFound("Cuộc gọi không còn tồn tại")

        participant = await CallParticipant.objects.filter(
            room=room, user=request.user
        ).afirst()
        if not participant:
            raise PermissionDenied("Bạn không có trong cuộc gọi này")

        await CallParticipant.objects.filter(id=participant.id).aupdate(status='declined') # user nào gọi api thì update decline luôn

        is_group = room.conversation.is_group
        channel_layer = get_channel_layer()

        if not is_group: #nếu là 1-1 thì đóng phòng luông
            await VideoRoom.objects.filter(id=room.id).aupdate(
                is_active=False,
                ended_at=timezone.now(),
                end_reason='declined',
            )
            await CallParticipant.objects.filter( # cập nhật cả 2 user thành decline vì k thể có 1 ng accept(ở createroom) 1 người decline dc
                room=room, status='pending'
            ).aupdate(status='declined')
            await self._create_system_message(room, 'system_call_declined')
            # Broadcast qua consumer
            await channel_layer.group_send(
                f'call_{conv_id}',
                {
                    'type':       'call_ended',
                    'end_reason': 'declined',
                    'conv_id':    conv_id,
                }
            )
        else: # nếu là group chat thì kiểm tra tất cả từ chối mới broadcast
            all_rejected = await self._check_all_rejected(room)
            if all_rejected:
                await self._create_system_message(room, 'system_call_missed')
                await channel_layer.group_send(
                    f'call_{conv_id}',
                    {
                        'type':       'call_ended',
                        'end_reason': 'missed',
                        'conv_id':    conv_id,
                    }
                )
        return Response({'detail': 'Đã từ chối'})
    @database_sync_to_async
    def _check_all_rejected(self, room):
        others   = CallParticipant.objects.filter(room=room).exclude(user=room.created_by) #lấy ra tất cả thành viên và count
        total    = others.count()
        rejected = others.filter(status__in=['declined', 'missed']).count() # count thành viên nào mà status là decline hoặc miss
        if total > 0 and total == rejected: # nếu mà tất cả thành viên đều bỏ qua thì đóng phòng
            VideoRoom.objects.filter(id=room.id).update(
                is_active=False,
                ended_at=timezone.now(),
                end_reason='missed',
            )
            return True
        return False

    @database_sync_to_async
    def _create_system_message(self, room, msg_type):
        room.refresh_from_db(fields=['started_at', 'ended_at'])
        secs = room.duration_call
        content_map = {
            'system_call_completed': f'Cuộc gọi video · {secs // 60}:{secs % 60:02d}',
            'system_call_missed':    'Cuộc gọi video nhỡ',
            'system_call_declined':  'Cuộc gọi video bị từ chối',
            'system_call_cancelled': 'Cuộc gọi video bị huỷ',
        }
        msg = Message.objects.create(
            conversation_id=room.conversation_id,
            sender=room.created_by,
            content=content_map[msg_type],
            message_type=msg_type,
        )
        Conversation.objects.filter(id=room.conversation_id).update(updated_at=timezone.now())
        return msg

#===============================EVENT===========================================
class ListCreateEventChat(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class   = EventSerializer
    pagination_class   = LargePagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['title']
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='create_event'

    def get_throttles(self): #override throttle cho post trong api có listcreate
        if self.request.method == 'POST':
            return [ScopedRateThrottle()]
        return []  # GET không throttle

    def _check_member(self, conv_id, user):
        if not ConversationMember.objects.filter(
            conversation_id=conv_id, user=user, is_active=True
        ).exists():
            raise PermissionDenied("Bạn không có trong group")

    def _get_content_type(self):
        return ContentType.objects.get_for_model(Conversation)

    def get_queryset(self):
        conv_id = self.kwargs.get('conv_id')
        self._check_member(conv_id, self.request.user)
        content_type = self._get_content_type()
        return (
            Event.objects
            .filter(content_type=content_type, object_id=conv_id)
            .select_related('created_by', 'created_by__profile')
            .prefetch_related('participants__user__profile')
            .order_by('start_time')
        )

    def perform_create(self, serializer):
        conv_id      = self.kwargs.get('conv_id')
        user         = self.request.user
        self._check_member(conv_id, user)
        content_type = self._get_content_type()

        # Save event vào DB
        event = serializer.save(
            content_type=content_type,
            object_id=conv_id,
            created_by=user,
        )

        EventParticipant.objects.create(
            event = event,
            user= user,
            status = 'accept'
        )

        # Đặt reminder trước 15p
        # Ví dụ: event 3h thứ 2 → nhắc lúc 2h45 thứ 2
        start_time = event.start_time
        remind_at  = start_time - timedelta(minutes=15) #lấy 15p trước khi bắt đầu
        delta = int((remind_at - timezone.now()).total_seconds()) # tính số giây đếm ngược
        if delta > 0:
            task = send_event_reminder.apply_async(args=[event.id, content_type.id], countdown=delta) # apply async để đặt lịch chạy
        else:
            task = send_event_reminder.apply_async(args=[event.id, content_type.id]) # nếu set thời gian đã cũ thì chạy ngay
        event.celery_task_id = task.id
        event.save(update_fields=['celery_task_id'])

        # Tạo system message thông báo vào chat
        profile = user.profile
        local_start = localtime(start_time)
        msg = Message.objects.create(
            conversation_id=conv_id,
            sender=user,
            content=f"{profile.full_name} đã tạo sự kiện: {event.title} lúc {local_start.strftime('%H:%M %d/%m/%Y')}",
            message_type='system_event_created',
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(  # sync vì đang trong sync context
                f'chat_{conv_id}',
                {
                    'type':         'system_message',
                    'message':      msg.content,
                    'message_type': msg.message_type,
                }
            )
        except Exception:
            pass

class EventDetailChat(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = EventSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='modify_event'
    def get_object(self):
        conv_id = self.kwargs.get("conv_id")
        event_id = self.kwargs.get("event_id")
        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        content_type = ContentType.objects.get_for_model(Conversation)
        return get_object_or_404(
            Event.objects
            .select_related('created_by', 'created_by__profile')
            .prefetch_related('participants__user__profile'),
            id=event_id,
            content_type=content_type,
            object_id=conv_id,
        )
    def perform_update(self, serializer):
        event = serializer.instance # lấy event trước save
        if event.created_by != self.request.user:
            raise PermissionDenied("Phải là người tạo mới có quyền update")
        old_task_id = event.celery_task_id # lấy ra task_id celery cũ
        serializer.save() # save cái update mới(thời gian mới)
        if 'start_time' in serializer.validated_data:  # chỉ reschedule khi start_time đổi
            if old_task_id: # nếu đưa vào start time mới thì xóa celery cái cũ
                from backend.celery import app
                app.control.revoke(old_task_id, terminate=True)

            remind_at = event.start_time - timedelta(minutes=15)
            content_type = ContentType.objects.get_for_model(Conversation)
            delta = int((remind_at - timezone.now()).total_seconds())
            if delta > 0:
                task = send_event_reminder.apply_async(args=[event.id, content_type.id], countdown=delta)
            else:
                task = send_event_reminder.apply_async(args=[event.id, content_type.id])
            Event.objects.filter(id=event.id).update(celery_task_id=task.id)

        # Gửi system message thông báo cập nhật
        local_start = localtime(event.start_time)
        msg = Message.objects.create(
            conversation_id=self.kwargs.get("conv_id"),
            sender=self.request.user,
            content=f"{self.request.user.profile.full_name} đã cập nhật sự kiện: {event.title} (bắt đầu lúc {local_start.strftime('%H:%M %d/%m/%Y')})",
            message_type='system_event_updated',
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{self.kwargs.get("conv_id")}',
                {
                    'type': 'system_message',
                    'message': msg.content,
                    'message_type': msg.message_type,
                }
            )
        except Exception:
            pass

    def perform_destroy(self, instance):
        if instance.created_by != self.request.user:
            raise PermissionDenied("Chỉ người tạo mới được xóa sự kiện")
        # Hủy celery task trước khi xóa
        if instance.celery_task_id:
            from backend.celery import app
            app.control.revoke(instance.celery_task_id, terminate=True)
        # System message thông báo xóa
        conv_id = instance.object_id
        title = instance.title
        user = self.request.user
        instance.delete()
        msg = Message.objects.create(
            conversation_id=conv_id,
            sender=user,
            content=f"{user.profile.full_name} đã hủy sự kiện: {title}",
            message_type='system_event_cancelled',
        )
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'chat_{conv_id}',
                {
                    'type': 'system_message',
                    'message': msg.content,
                    'message_type': msg.message_type,
                }
            )
        except Exception:
            pass


class EventResponseChat(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='response_event'
    def patch(self, request, *args, **kwargs):
        user = request.user
        conv_id = self.kwargs.get('conv_id')
        event_id = self.kwargs.get('event_id')

        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")

        new_status = request.data.get('status')
        if new_status not in ('accept', 'decline'):
            raise ValidationError({'status': 'Chỉ chấp nhận "accept" hoặc "decline".'})

        content_type = ContentType.objects.get_for_model(Conversation)
        event = get_object_or_404(Event, id=event_id, content_type=content_type, object_id=conv_id)

        if event.created_by == request.user:
            raise PermissionDenied("Người tạo sự kiện không cần phản hồi")

        if event.end_time and event.end_time < timezone.now():  # hết hạn
            raise ValidationError("Sự kiện đã kết thúc, không thể phản hồi")

        participant, created = EventParticipant.objects.update_or_create( # nếu chưa tham gia thì tạo, nếu đã tham gia rồi thì chỉ update status
            event=event,
            user=request.user,
            defaults={'status': new_status} # khi update chỉ update default còn create sẽ gán event,user và default
        )
        if new_status == 'accept':
            profile = user.profile
            message_system = Message.objects.create(
                conversation_id=conv_id,
                sender=request.user,
                content=f"{profile.full_name} sẽ tham gia sự kiện {event.title}",
                message_type='system_event_attended'
            )
            try:
                channel_layer = get_channel_layer()
                async_to_sync(channel_layer.group_send)(
                    f'chat_{conv_id}',
                    {
                        'type': 'system_message',
                        'message': message_system.content,
                        'message_type': message_system.message_type,
                    }
                )
            except Exception:
                pass
        return Response(
            {'detail': f'Bạn đã {new_status} sự kiện "{event.title}".'},
            status=status.HTTP_200_OK,
        )

class EventParticipantChat(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = EventParticipantSerializer
    pagination_class   = SmallPagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['user__profile__first_name', 'user__profile__last_name']
    def get_queryset(self):
        conv_id = self.kwargs.get('conv_id')
        event_id = self.kwargs.get('event_id')

        if not ConversationMember.objects.filter(conversation_id=conv_id,user=self.request.user,is_active=True).exists():
            raise PermissionDenied("Bạn không có trong group")
        content_type = ContentType.objects.get_for_model(Conversation)
        return EventParticipant.objects.filter(
           event__content_type = content_type,
            event__object_id = conv_id,
            event_id =event_id,
            status = 'accept'
        ).select_related('user__profile')

#============================GROUP==========================================================================
class CreateGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'create_group'
    def perform_create(self, serializer):
        with transaction.atomic():
            instance = serializer.save(created_by=self.request.user)
            GroupMember.objects.create(
                group= instance,
                user= self.request.user,
                role='owner'
            )

class GroupDetailView(generics.RetrieveAPIView): #view public để hiển thị group từ url
    permission_classes = [IsAuthenticated]
    serializer_class = GroupSerializer
    def get_object(self):
        user = self.request.user
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(
            Group.objects.annotate(
                member_count=Count('members', filter=Q(members__is_active=True)),
                is_member=Exists(
                    GroupMember.objects.filter(group=OuterRef('pk'), user=self.request.user, is_active=True)
                ),
                is_pending=Exists(
                    GroupJoinRequest.objects.filter(group=OuterRef('pk'), user=self.request.user, status='pending')
                )
            ).select_related('created_by__profile')\
            .prefetch_related(
                Prefetch(
                    'members', # lấy ra tất cả thành viên và lọc ra chính mình
                    queryset = GroupMember.objects.filter(user=user,is_active=True).select_related('job_role__department','job_role'),
                    to_attr = 'my_membership' #  lưu vào attribute riêng
                )
            ),
            pk=group_id
        )
        return group

class UpdateGroup(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = GroupSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_group'
    def get_object(self):
        group_id = self.kwargs.get('group_id')
        group= get_object_or_404(Group, id=group_id)
        self.check_object_permissions(self.request,group)
        return group

    def perform_update(self, serializer): # quy trình permissions > get_object > serializer > serializer.validated_data > perform_update > serializer.save()
        with transaction.atomic():
            old_is_company = serializer.instance.is_company # lấy ra true hay false của giá trị cũ truóc khi update
            instance = serializer.save() # save gía trị update lại
            if old_is_company and not instance.is_company: # nếu company là is group, is_company vừa update là false thì xóa hết (update là false tức là not false là true ->chạy)
                GroupRole.objects.filter(group=instance).delete()
                GroupDepartment.objects.filter(group=instance).delete()



class ListGroupUser(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupSerializer
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['name']
    def get_queryset(self):
        user =self.request.user
        return Group.objects.filter(
            members__user=user, #dùng related_name lấy vì group k thể truy cập tới groupmember
            members__is_active = True,
        ).annotate(
            member_count= Count('members',filter= Q(members__is_active=True)),
            is_member = Exists(
                GroupMember.objects.filter(group=OuterRef('pk') ,user=user,is_active=True) # lấy ra xem có user ở group hiện tại is_active
            ),
            is_pending = Exists(
                GroupJoinRequest.objects.filter(group=OuterRef('pk'),user=user,status='pending')
            )
        ).select_related('created_by__profile')\
        .prefetch_related(
            Prefetch(
                'members', # lấy ra tất cả thành viên và lọc ra chính mình
                queryset = GroupMember.objects.filter(user=user,is_active=True).select_related('job_role__department','job_role'),
                to_attr = 'my_membership' #  lưu vào attribute riêng
            )
        )

class ListGroupSuggestion(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupSerializer
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['name']
    def get_queryset(self):
        user = self.request.user
        active_membership = GroupMember.objects.filter(
            group=OuterRef('pk'),
            user=user,
            is_active=True
        )
        # cơ bản là nó sẽ lấy ra all group xong lặp từng group, nó sẽ lấy group member có group pk là x và user=user,is_ative=True thì cột is_member là True không thì false,sau đó có đủ cột is member thì chỉ cần lấy ra các cột false
        return Group.objects.annotate(
            member_count=Count('members', filter=Q(members__is_active=True)),
            is_member=Exists(active_membership),
            is_pending=Exists(
                GroupJoinRequest.objects.filter(group=OuterRef('pk'), user=user, status='pending')
            )
        ).select_related('created_by__profile').prefetch_related(
            Prefetch(
                'members', 
                queryset=GroupMember.objects.filter(user=user, is_active=True).select_related('job_role__department', 'job_role'),
                to_attr='my_membership' 
            )
        ).filter(is_member=False)

class DeleteGroup(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated,IsOwnerOnlyGroup]
    def get_object(self):
        group_id = self.kwargs.get('group_id')
        group= get_object_or_404(Group, id=group_id)
        self.check_object_permissions(self.request,group)
        return group

class ListUserGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupMemberSerializer
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['user__profile__first_name', 'user__profile__last_name']
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group,pk=group_id)
        if not self.request.user.has_perm('group.is_member',group):
            raise PermissionDenied("Bạn không phải thành viên group")
        qs=  GroupMember.objects.filter(group=group,is_active=True).select_related('user__profile','job_role','job_role__department')

        exclude_role = self.request.query_params.get('exclude_role')
        if exclude_role:
            qs = qs.exclude(job_role_id=exclude_role)
        return qs

class AddRoleGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = GroupRoleSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'add_role_group'
    def perform_create(self, serializer):
        group_id = self.kwargs.get("group_id")
        department_id = self.request.data.get('department_id')
        group = get_object_or_404(Group, id=group_id)
        if not group.is_company:
            raise ValidationError("Chỉ group công ty mới có thể thêm chức vụ")
        if not GroupDepartment.objects.filter(id=department_id, group=group).exists():
            raise ValidationError("Phòng ban không thuộc group này")
        self.check_object_permissions(self.request,group)
        serializer.save(group=group,department_id = department_id)

class AddDepartmentGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = GroupDepartmentSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'add_department_group'
    def perform_create(self, serializer):
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, id=group_id)
        self.check_object_permissions(self.request, group)
        if not group.is_company:
            raise ValidationError("Chỉ group công ty mới có phòng ban")
        serializer.save(group=group)

class UpdateRoleGroup(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupRoleSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_role_group'
    def get_object(self):
        group_id = self.kwargs.get("group_id")
        role_id = self.kwargs.get("role_id")
        if not GroupMember.objects.filter(group_id=group_id,user=self.request.user,is_active=True, role__in=['owner', 'admin']).exists():
            raise PermissionDenied("Bạn phải là admin mới có thể thực hiện hành vi")
        return get_object_or_404(
            GroupRole.objects.annotate( #lấy tất cả member có role = ... và tất cả member đó phải is_active
                member_count=Count(
                    'job_role_members',
                    filter=Q(job_role_members__is_active=True)
                )
            ),
            id=role_id,
            group_id=group_id,
        )

class UpdateDepartmentGroup(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupDepartmentSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_department_group'
    def get_object(self):
        group_id = self.kwargs.get("group_id")
        department_id = self.kwargs.get("department_id")
        if not GroupMember.objects.filter(group_id=group_id,user=self.request.user,is_active=True, role__in=['owner', 'admin']).exists():
            raise PermissionDenied("Bạn phải là admin mới có thể thực hiện hành vi")
        return get_object_or_404(
            GroupDepartment.objects.prefetch_related('department_roles').annotate( #lấy tất cả member có role = ... và tất cả member đó phải is_active, chỉ lấy 1 cột duy nhất
                member_count=Count(# ví dụ department có 10 role, mà 1 role có 10 user thì là 100 count
                    'department_roles__job_role_members', # có nghĩa lấy tất cả role trong department này join với member có role_id = role này (select * from role where department_id = x join groupmember on groupmember.role_id= role_id where is_Active=True)
                    filter=Q(department_roles__job_role_members__is_active=True)
                )
            ),
            id=department_id,
            group_id=group_id,
        )

class AddMemberIntoJobRole(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'add_member_job_role'
    def post(self,request,group_id,user_id):
        role_id = request.data.get("role_id")
        group = get_object_or_404(Group,pk=group_id)
        if not group.is_company: #check company
            raise PermissionDenied("Group phải là công ty mới có chức năng này")
        if not GroupRole.objects.filter(id=role_id, group=group).exists():
            raise ValidationError("Chức vụ không thuộc group này")
        #check admin mới cho thêm
        if not IsAdminOrOwnerGroup().has_object_permission(self.request, self, group): #có thể dùng if not request.user.has_perm('group.is_admin', group):
            raise PermissionDenied("Chỉ admin hoặc owner mới được thực hiện")
        #check đã có trong group chưa
        member =GroupMember.objects.filter(
            group=group,
            user_id = user_id,
            is_active= True
        )
        if not member.exists():
            raise PermissionDenied("User này không có trong group")
        #Add member vào role và department đó
        member.update(job_role_id= role_id)
        return Response({"detail":"success"},status=200)

class ListDepartmentGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupDepartmentSerializer
    pagination_class = SmallPagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['name']
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        if not GroupMember.objects.filter(
            group_id=group_id, user=self.request.user, is_active=True
        ).exists():
            raise PermissionDenied("Bạn không có trong group")
        return GroupDepartment.objects.filter(
            group_id=group_id
        ).prefetch_related('department_roles')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        group_id = self.kwargs.get('group_id')
        counts = (
            GroupMember.objects # lấy tất cả thành viên group,group by theo department_id và count department_id, chỉ trả về id depart và count
            .filter(group_id=group_id, is_active=True, job_role__isnull=False)
            .values('job_role__department_id') # count theo department_id( department id đó có bao nhiêu member)
            .annotate(count=Count('id')) # tên lưu tạm là count trong db
        )
        context['department_member_counts'] = {
            item['job_role__department_id']: item['count'] # department tương ứng count ví dụ 1:10, 2:12
            for item in counts
        }
        counts_role = (
            GroupMember.objects
            .filter(group_id=group_id, is_active=True, job_role__isnull=False)
            .values('job_role_id') # count theo job_role_id( role đó có bao member)
            .annotate(count=Count('id'))
        )
        context['role_member_counts'] = {
            item['job_role_id']: item['count']
            for item in counts_role
        }
        return context


class ListRoleGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupRoleSerializer
    pagination_class = SmallPagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['name']

    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        department_id = self.kwargs.get('department_id')
        if not GroupMember.objects.filter(
            group_id=group_id, user=self.request.user, is_active=True
        ).exists():
            raise PermissionDenied("Bạn không có trong group")

        qs = GroupRole.objects.filter(group_id=group_id)
        if department_id:
            qs = qs.filter(department_id=department_id)
        return qs

    def get_serializer_context(self): # vì create/get_queryset chỉ trả về objects cho serializer làm việc nên muốn truyền thêm dùng context
        context = super().get_serializer_context()
        group_id = self.kwargs.get('group_id')
        counts = (
            GroupMember.objects
            .filter(group_id=group_id, is_active=True, job_role__isnull=False)
            .values('job_role_id') # count theo job_role_id( role đó có bao member)
            .annotate(count=Count('id'))
        )
        context['role_member_counts'] = {
            item['job_role_id']: item['count']
            for item in counts
        }
        return context

class ListUserDepartmentGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['first_name', 'last_name']
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        department_id = self.kwargs.get('department_id')
        group = get_object_or_404(Group,pk=group_id)
        if not self.request.user.has_perm('group.is_member',group):
            raise PermissionDenied("Bạn không phải thành viên group")
        member_ids = GroupMember.objects.filter(group=group,job_role__department_id=department_id,is_active=True).values_list('user_id',flat=True)
        if not member_ids:
            return Profile.objects.none()
        return Profile.objects.filter(user_id__in= member_ids)

    def get_serializer_context(self): #gọi hàm custome ở trên
        context = super().get_serializer_context()
        #  Lấy dữ liệu queryset đã lọc  (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset() # gọi query set lại
        context['online_set'] = get_online_set(objs) # truyền tất cả profile vào và lấy ra tất cả status onl
        return context

class ListUserRoleGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ProfileSerializer
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['first_name', 'last_name']
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        department_id = self.kwargs.get('department_id')
        role_id = self.kwargs.get('role_id')
        group = get_object_or_404(Group,pk=group_id)
        if not self.request.user.has_perm('group.is_member',group):
            raise PermissionDenied("Bạn không phải thành viên group")
        member_ids = GroupMember.objects.filter(group=group,job_role__department_id=department_id,job_role_id=role_id,is_active=True).values_list('user_id',flat=True)
        if not member_ids:
            return Profile.objects.none()
        return Profile.objects.filter(
            user_id__in= member_ids
        )
    def get_serializer_context(self): #gọi hàm custome ở trên
        context = super().get_serializer_context()
        #  Lấy dữ liệu queryset đã lọc  (đã filter, đã phân trang)
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset() # gọi query set lại
        context['online_set'] = get_online_set(objs) # truyền tất cả profile vào và lấy ra tất cả status onl
        return context

class SendJoinRequestGroup(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'join_request_group'
    def post(self,request,group_id):
        group = get_object_or_404(Group,pk=group_id)
        if self.request.user.has_perm('group.is_member',group):
            raise ValidationError("Bạn đã là thành viên group")
        existing = GroupJoinRequest.objects.filter(group=group, user=request.user, status='pending').exists()
        if existing:
            raise ValidationError("Bạn đã gửi yêu cầu tham gia rồi")

        # tạo hoặc update lời mời nếu đã xin vào trước đó rồi
        obj, created = GroupJoinRequest.objects.update_or_create(
            group=group,
            user= self.request.user,
            defaults={
                'status' : 'pending',
                'reviewed_by': None
            }
        )
        return Response({'detail': 'Đã gửi yêu cầu tham gia'},status=201 if created else 200)


from django.db import transaction
from rest_framework.exceptions import ValidationError

class CancelJoinRequestGroup(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "cancel_join_request_group"
    @transaction.atomic
    def post(self, request, group_id):
        deleted, _ = GroupJoinRequest.objects.filter(
            group_id=group_id,
            user=request.user,
            status="pending",
        ).delete()

        if deleted == 0:
            raise ValidationError("Không tìm thấy yêu cầu tham gia hoặc yêu cầu đã được xử lý.")

        return Response(
            {"detail": "Bạn đã hủy yêu cầu tham gia"},
            status=status.HTTP_200_OK,
        )

class MyJoinRequestList(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = GroupJoinRequestSerializer
    pagination_class = LargePagePagination
    filter_backends = [DjangoFilterBackend, SearchFilter]
    search_fields = ['group__name']
    def get_queryset(self):
        return GroupJoinRequest.objects.filter(user=self.request.user,status='pending').select_related('group', 'reviewed_by__profile')

class AllJoinRequest(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = GroupJoinRequestSerializer
    filter_backends = [DjangoFilterBackend,SearchFilter]
    pagination_class = LargePagePagination
    search_fields = ['user__profile__first_name', 'user__profile__last_name']
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group= get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request,group)
        return GroupJoinRequest.objects.filter(group=group).select_related('user__profile','reviewed_by__profile')

class AcceptJoinRequest(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'accept_join_request_group'

    def post(self, request, group_id, request_id):
        user = request.user
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        # update bảng JoinRequest
        with transaction.atomic():
            join_request = get_object_or_404(
                GroupJoinRequest.objects.select_for_update(), #dùng select for update trong atomic để lock row chỉ cho sửa lần luọt tránh race condition
                id=request_id, group=group, status='pending'
            )
            join_request.status = 'accepted'
            join_request.reviewed_by_id = user.id
            join_request.reviewed_at = timezone.now()
            join_request.save(update_fields=['status', 'reviewed_by_id', 'reviewed_at'])
            # Thêm hoặc update(nếu đã rời) user vào group
            GroupMember.objects.update_or_create(
                group=group,
                user_id=join_request.user_id,  # dùng FK integer trực tiếp, không cần load User object
                defaults={
                    'role': 'member',
                    'is_active': True,
                    'job_role': None,
                }
            )
        accept_join_request_group.send(  # hook thẳng signal vào view
            sender=self.__class__,  # khi gọi api này thì nó gọi signal truyền sender là api này vào
            user=join_request.user,
            admin_user=request.user,
            group=group
        )
        return Response({"detail": "success"}, status=200)

class RejectJoinRequest(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'reject_join_request_group'
    def post(self, request, group_id, request_id):
        group = get_object_or_404(Group,pk=group_id)
        user = request.user
        self.check_object_permissions(self.request,group)
        join_request = get_object_or_404(
            GroupJoinRequest,
            id=request_id,
            group=group,
            status='pending'
        )
        join_request.status = 'rejected'
        join_request.reviewed_by_id = user.id
        join_request.reviewed_at = timezone.now()
        join_request.save(update_fields=['status', 'reviewed_by_id', 'reviewed_at'])
        return Response({"detail": "success"}, status=200)

class KickMemberGroup(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'kick_member_group'
    def post(self, request, group_id, user_id):
        group = get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request,group)
        member = get_object_or_404(
            GroupMember,
            group=group,
            user_id = user_id,
            is_active=True
        )
        if member.role == 'owner':
            raise PermissionDenied("Không thể kick owner")
        member.is_active=False
        member.save(update_fields=['is_active'])
        return Response({"detail": "success"}, status=200)

class DeleteALlPostMemberGroup(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'kick_member_group'
    def post(self, request, group_id, user_id):
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        Post.objects.filter(group=group, user_id=user_id).delete() # xoá tất cả post user đó trong group
        Comment.objects.filter(post__group=group, user_id=user_id).delete() # xóa tất cả comment trên post người khác
        return Response({"detail": "success"}, status=200)

class RemoveAdminGroup(APIView):
    permission_classes = [IsAuthenticated, IsOwnerOnlyGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'remove_admin_group'
    def post(self, request, group_id, user_id):
        group = get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request,group)
        member = get_object_or_404(
            GroupMember,
            group=group,
            user_id=user_id,
            is_active=True
        )
        if member.role != 'admin':
            raise ValidationError("User này không phải là admin")
        if member.role == 'owner':
            raise PermissionDenied("Không thể hạ cấp owner")
        member.role = 'member'
        member.save(update_fields=['role'])
        return Response({"detail": "success"}, status=200)

class AddAdminGroup(APIView):
    permission_classes = [IsAuthenticated, IsOwnerOnlyGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'add_admin_group'
    def post(self, request, group_id, user_id):
        group = get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request,group)
        member = get_object_or_404(
            GroupMember,
            group=group,
            user_id=user_id,
            is_active=True
        )
        if member.role == 'admin':
            raise ValidationError("Đã là admin")
        if member.role == 'owner':
            raise ValidationError("Không thể hạ cấp owner")
        member.role = 'admin'
        member.save(update_fields=['role'])
        add_admin_group.send(  # ← thêm
            sender=self.__class__,
            group=group,
            new_admin=member.user,
            owner=request.user,
        )
        return Response({"detail": "success"}, status=200)

class LeaveGroup(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'leave_group'
    def post(self, request, group_id):
        group = get_object_or_404(Group,pk=group_id)
        user = request.user
        self.check_object_permissions(self.request,group)
        member = get_object_or_404(
            GroupMember,
            group=group,
            user_id = user.id,
            is_active=True
        )
        with transaction.atomic():
            if member.role == 'owner':
                next_owner_id = request.data.get('next_owner_id')
                if not next_owner_id:
                    raise ValidationError("Bạn cần chuyển nhượng chức vụ owner trước khi rời")
                next_owner = get_object_or_404(
                    GroupMember,
                    group=group,
                    user_id=next_owner_id,
                    is_active=True
                )
                if next_owner.role == 'owner':
                    raise ValidationError("User này đã là owner")
                if next_owner.role != 'admin':
                    raise ValidationError("Chỉ có admin mới được nhận quyền owner")
                next_owner.role = 'owner'
                next_owner.save(update_fields=['role'])
                owner_transfer_group.send(
                    sender=self.__class__,
                    group=group,
                    next_owner=next_owner.user,
                    former_owner=request.user,
                )
            member.is_active=False
            member.role = 'member'
            member.save(update_fields=['is_active','role'])
        return Response({"detail": "success"}, status=200)

class CreatePostGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PostSerializer
    throttle_classes = [ScopedRateThrottle]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = 'create_post_group'
    def perform_create(self, serializer):
        group_id = self.kwargs.get("group_id")
        user =self.request.user
        group = get_object_or_404(Group, id=group_id)
        member = get_object_or_404(GroupMember, group=group, user_id=user.id,is_active=True)
        post_status = 'approved' if member.role in ['owner', 'admin'] else 'pending'
        with transaction.atomic():
            post = serializer.save(user=user, group=group, post_status=post_status)
            photos = self.request.FILES.getlist('photos')
            if photos:
                PostPhoto.objects.bulk_create([
                    PostPhoto(post=post, photo=photo) for photo in photos
                ])

class PostReviewGroupList(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    serializer_class = GroupPostSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request,group)
        return Post.objects.filter(group=group,post_status='pending').select_related('user','user__profile','group').prefetch_related('photos').order_by('-created_at')

class ReviewPostGroup(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'review_post_group'

    def post(self, request, group_id, post_id):
        action = request.data.get('action')
        if action not in ['approved', 'rejected']:
            return Response({"detail": "action không hợp lệ"}, status=400)

        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)

        with transaction.atomic():
            post = get_object_or_404(
                Post.objects.select_for_update(),  # tránh 2 admin duyệt cùng lúc
                pk=post_id, group=group, post_status='pending'
            )
            post.post_status = action
            post.save(update_fields=['post_status'])
        review_post_request_group.send(
            sender=self.__class__,
            post=post,
            action=action,
            admin_user=request.user,
            group=group,
        )
        return Response({"detail": "success"}, status=200)

class DeletePostGroup(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'delete_post_group'

    def delete(self, request, group_id, post_id):
        post = get_object_or_404(Post, pk=post_id, group_id=group_id)

        if not request.user.has_perm('group.delete_post', post):  # chỉ truyền post, nó sẽ tự lấy group_id từ Post
            return Response({"detail": "Không có quyền"}, status=403)

        post.delete()
        return Response({"detail": "success"}, status=204)

class UpdatePostGroup(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated,CanEditPost]
    serializer_class = GroupPostSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_post_group'
    def get_object(self):
        post_id = self.kwargs.get('post_id')
        group_id = self.kwargs.get('group_id')
        post= get_object_or_404(Post.objects.select_related('user__profile','user','group').prefetch_related('photos'), pk=post_id,group_id=group_id)
        self.check_object_permissions(self.request, post)
        return post
    def perform_update(self, serializer):
        post = serializer.instance
        user = self.request.user
        member = get_object_or_404(GroupMember, group=post.group_id, user_id=user.id, is_active=True)
        post_status = 'approved' if member.role in ['owner', 'admin'] else 'pending'
        serializer.save(post_status=post_status)

class PostListGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = PostSerializer
    pagination_class = LargePagePagination
    def get_queryset(self):
        if not hasattr(self, '_qs'):
            group_id = self.kwargs.get('group_id')
            group= get_object_or_404(Group,pk=group_id)
            self.check_object_permissions(self.request, group)
            ordering = self.request.query_params.get('ordering', 'newest') # mặc đinh là mới newest
            sort = '-created_at' if ordering == 'newest' else 'created_at'
            self._qs = (
                Post.objects.filter(group=group,post_status='approved').select_related('user','user__profile').prefetch_related('photos')
                .order_by('-is_pinned', sort)
            )
        return self._qs
    def get_serializer_context(self):
        context = super().get_serializer_context()
        objs = getattr(self, 'object_list', None)
        if objs is None:
            objs=self.get_queryset()
        context.update(get_reactions_post_context(objs, self.request.user))
        return context

class PinPostGroup(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'pin_post_group'

    def post(self, request, group_id, post_id):
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        post = get_object_or_404(Post, pk=post_id, group=group, post_status='approved')
        if post.is_pinned:  # nếu bấm vào bài đang pin thì unpin luôn
            post.is_pinned = False
            post.save(update_fields=['is_pinned'])
            return Response({"detail": "success", "is_pinned": False}, status=200)
        
        # nếu chưa pin
        with transaction.atomic():
            Post.objects.filter(group=group, is_pinned=True).update(is_pinned=False) #update tất cả lại post khác bỏ pin
            post.is_pinned = True
            post.save(update_fields=['is_pinned'])
        return Response({"detail": "success", "is_pinned": post.is_pinned}, status=200)


class PostUserGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    pagination_class = SmallPagePagination
    serializer_class = GroupPostSerializer
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        filter = self.request.query_params.get('filter')
        qs= Post.objects.filter(group_id=group_id,user=self.request.user)

        if filter == 'rejected':
            return qs.filter(post_status='rejected')
        if filter == 'pending':
            return qs.filter(post_status='pending')
        return qs.filter(post_status='approved')

class MakeNotification(APIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'make_notification_group'
    def post(self, request, group_id, post_id):
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        make_notification_group.delay(
            group_id=group_id,
            post_id=post_id,
            admin_id = self.request.user.id
        )
        return Response({'detail':'success'}, status=200)

class PostGroupDetail(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = PostSerializer
    def get_object(self):
        post_id = self.kwargs.get('post_id')
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        return get_object_or_404(
            Post.objects.select_related('user__profile','user','group').prefetch_related('photos'),
            pk=post_id, group_id=group_id, post_status='approved'
        )

class SearchInGroup(APIView):
    permission_classes = [IsAuthenticated, IsMemberGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'search'
    def get(self, request, group_id):
        keyword = request.query_params.get('q', '').strip()
        search_type = request.query_params.get('type', 'all')  # all/posts/members

        try:
            page = max(int(request.query_params.get('page', 1)), 1)
        except (ValueError, TypeError):
            page = 1

        size = 20
        offset = (page - 1) * size # =2 → offset=20 → ES lấy [20:40] → kết quả 21 đến 40

        if not keyword:
            return Response({'posts': [], 'members': [], 'pagination': {}})

        group = get_object_or_404(Group, pk=group_id, deleted__isnull=True)
        self.check_object_permissions(request, group)  # check phải là member

        # cache không cần per-user vì member trong group thấy như nhau
        cache_key = hashlib.md5(
            f"search_in_group:{group_id}:{keyword}:{search_type}:{page}".encode()
        ).hexdigest()
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)

        posts   = []
        members = []
        posts_qs = Post.objects.none()   # dùng cho get_reactions_post_context
        members_qs = Profile.objects.none()  # dùng cho get_online_set
        total_posts   = 0
        total_members = 0

        try:
            # Bước 1 lấy các data đã phân tách trong db của elastic và lấy các id
            ms = MultiSearch()

            if search_type in ('all', 'posts'):
                post_search = PostDocument.search().query(
                    "bool",
                    must=[ #must là check điều kiện (AND)
                        ESQ("term", group_id=group_id),      # bắt buộc đúng group
                        ESQ("term", post_status="approved"), # chỉ lấy post đã duyệt
                    ], 
                    should=[ # điều kiện OR
                        ESQ("bool", must=[ESQ("match_phrase", title=keyword)], boost=4.0), # uư tiên lấy đúng hết
                        # gõ đúng cụm → rank cao nhất
                        ESQ("match", title={ # phân tích title và tự đoán
                            "query": keyword,
                            "boost": 2.0,
                            "fuzziness": "AUTO",  # tự sửa lỗi chính tả
                            "prefix_length": 1,   # ký tự đầu phải đúng
                            "max_expansions": 50
                        }),
                    ],
                    minimum_should_match=1  # phải match ít nhất 1 should
                )
                ms = ms.add(post_search[offset:offset + size])

            if search_type in ('all', 'members'):
                member_search = ProfileDocument.search().query(
                    "bool",
                    should=[
                        ESQ("bool", must=[ESQ("match_phrase", full_name=keyword)], boost=5.0),# gõ đúng họ tên → rank cao nhất

                        #tự phân tích theo tự đoán cả full name hoặc user chỉ nhập first và last name
                        ESQ("match", full_name={"query": keyword, "boost": 3.0, "fuzziness": "AUTO", "prefix_length": 1, "max_expansions": 50}),
                        ESQ("match", first_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                        ESQ("match", last_name={"query": keyword, "boost": 2.0, "fuzziness": "AUTO", "prefix_length": 1}),
                    ],
                    minimum_should_match=1
                )
                ms = ms.add(member_search[offset:offset + size])

            responses = ms.execute()
            idx = 0

            # Bước 2, từ cái id lấy trong db elastic đã filter search, lọc ra từ model
            if search_type in ('all', 'posts'):
                try:
                    post_response = responses[idx]; idx += 1
                    total_posts   = post_response.hits.total.value
                    post_ids      = [hit.meta.id for hit in post_response]

                    posts_qs = (
                        Post.objects
                        .filter(
                            post_id__in=post_ids,
                            group_id=group_id,           # double check đúng group
                            post_status='approved',
                            deleted__isnull=True
                        )
                        .select_related('user', 'user__profile')
                        .prefetch_related('photos')
                    )
                    posts_dict = {str(p.post_id): p for p in posts_qs}
                    posts = [posts_dict[pid] for pid in post_ids if pid in posts_dict]
                    # giữ thứ tự relevance từ ES
                except Exception as e:
                    logger.error(f"Group post search error | group={group_id} keyword={keyword} | {e}")
                    posts = []

            if search_type in ("all", "members"):
                try:
                    member_response = responses[idx]
                    idx += 1
                    total_members = member_response.hits.total.value
                    profile_ids = [int(hit.meta.id) for hit in member_response]

                    members_qs = (
                        Profile.objects.filter(
                            id__in=profile_ids,
                            deleted__isnull=True,
                            user__groupmember__group_id=group_id,
                            user__groupmember__is_active=True,
                        )
                        .select_related("user")
                        .prefetch_related(
                            Prefetch(
                                "user__groupmember_set",
                                queryset=GroupMember.objects.filter(
                                    group_id=group_id,
                                    is_active=True,
                                ),
                                to_attr="group_member_info",
                            )
                        )
                        .distinct()
                    )

                    members_dict = {str(p.id): p for p in members_qs}
                    members = [members_dict[str(pid)] for pid in profile_ids if str(pid) in members_dict]

                except Exception as e:
                    logger.error(
                        f"Group member search error | group={group_id} keyword={keyword} | {e}"
                    )
                    members = []

        except Exception as e:
            # MultiSearch fail hoàn toàn → trả rỗng không crash
            logger.error(f"SearchInGroup MultiSearch failed | group={group_id} keyword={keyword} | {e}")

        # Build reaction context một lần cho tất cả post thay vì N query
        post_reaction_ctx = get_reactions_post_context(posts_qs, request.user) if posts else {'reactions_map': {}, 'user_reactions_map': {}}

        result = {
            'posts': PostSerializer(posts, many=True, context={
                'request': request,
                **post_reaction_ctx,  # reactions_map + user_reactions_map
            }).data,
            'members': ProfileSerializer(members, many=True, context={
                'request': request,
                'online_set': get_online_set(members_qs) if members else set()
                # batch check online status tránh N+1 Redis
            }).data,
            'pagination': {
                'page': page,
                'size': size,
                'total_posts':    total_posts,
                'total_members':  total_members,
                'has_next_posts':   offset + size < total_posts,
                'has_next_members': offset + size < total_members,
            }
        }

        if any([posts, members]):
            cache.set(cache_key, result, timeout=30)  # cache 30s tránh spam

        return Response(result)

class PhotoInGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    pagination_class = LargePagePagination
    serializer_class = PostPhotoSerializer
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        return PostPhoto.objects.filter(
            post__group = group,
            post__post_status = 'approved'
        )
class AdminGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    pagination_class = LargePagePagination
    serializer_class = GroupMemberSerializer
    def get_queryset(self):
        group_id = self.kwargs.get('group_id')
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        return GroupMember.objects.filter(
            group=group,
            role__in=['admin','owner'],
            is_active=True
        ).select_related('job_role','job_role__department','user__profile')
#=================Vote Group===============================
class CreateVoteGroup(APIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'create_vote'

    def post(self, request, *args, **kwargs):
        group_id = self.kwargs.get("group_id")
        title = self.request.data.get("title")
        options = self.request.data.get("options", [])  # mảng text option user truyền vào

        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        if not title:
            return Response({"error": "Vui lòng nhập tiêu đề"}, status=400)
        if len(options) < 2:
            return Response({"error": "Vui lòng chọn ít nhất 2 option"}, status=400)

        with transaction.atomic():
            vote = Vote.objects.create(
                created_by=request.user,
                title=title,
                content_type=contenttype,
                object_id=group_id
            )
            VoteOption.objects.bulk_create([
                VoteOption(vote=vote, text=opt) for opt in options
            ])
        vote = Vote.objects.prefetch_related('options').select_related('created_by__profile').get(id=vote.id)
        serializer = VoteSerializer(vote, context={'request': request})
        return Response(serializer.data, status=201)


class DeleteVoteGroup(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'delete_vote'

    def get_object(self):
        group_id = self.kwargs.get("group_id")
        vote_id = self.kwargs.get("vote_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        vote = get_object_or_404(Vote.objects.select_related('created_by__profile'), id=vote_id, object_id=group_id,content_type=contenttype)
        return vote

class UserVoteGroup(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'user_vote'

    def post(self, request, group_id, vote_id, vote_option_id):
        group = get_object_or_404(Group,pk=group_id)
        if not self.request.user.has_perm('group.is_member',group):
            raise PermissionDenied("Bạn không phải thành viên group")
        contenttype = ContentType.objects.get_for_model(Group)
        vote_option = get_object_or_404(  # lấy ra option user chọn
            VoteOption,
            id=vote_option_id,
            vote__object_id=group_id,
            vote__content_type=contenttype,
            vote__is_closed=False
        )

        with transaction.atomic():
            existing_vote = (  # lẩy ra xem user đã vote chưa
                UserVote.objects
                .select_for_update()
                .select_related('option','created_by__profile')
                .filter(option__vote_id=vote_id, created_by=request.user)
                .first()
            )

            if not existing_vote:
                # Chưa vote thì tạo mới
                user_vote = UserVote.objects.create(option=vote_option, created_by=request.user)
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') + 1)

            elif existing_vote.option.id == vote_option_id:
                # Đã vote option thì hủy
                existing_vote.delete()
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') - 1)
                return Response({"message": "Đã hủy vote"}, status=200)

            else:
                # Đã vote option khác → đổi sang option mới
                old_option_id = existing_vote.option.id
                existing_vote.option = vote_option
                existing_vote.save(update_fields=['option'])
                VoteOption.objects.filter(id=old_option_id).update(count=F('count') - 1)
                VoteOption.objects.filter(id=vote_option.id).update(count=F('count') + 1)
                user_vote = existing_vote
        serializer = UserVoteSerializer(user_vote, context={"request": request})
        return Response(serializer.data, status=201)


class UpdateVoteGroup(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = VoteSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_vote'

    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group,pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)

        vote = get_object_or_404(Vote.objects.prefetch_related('options').select_related('created_by__profile'),
                                 id=vote_id, content_type=contenttype, object_id=group_id)
        return vote

class AddOptionVoteGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = VoteOptionSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'add_option_vote'

    def create(self, request, *args, **kwargs):
        vote_id = self.kwargs.get("vote_id")
        group_id = self.kwargs.get("group_id")
        options = request.data.get("options", [])

        group = get_object_or_404(Group,pk=group_id)
        if not self.request.user.has_perm('group.is_member',group):
            raise PermissionDenied("Bạn không phải thành viên group")
        if not options:
            return Response({"error": "Vui lòng truyền option"}, status=400)
        contenttype = ContentType.objects.get_for_model(Group)
        vote = get_object_or_404(Vote, id=vote_id, content_type=contenttype, object_id=group_id, is_closed=False)
        created = VoteOption.objects.bulk_create([
            VoteOption(vote=vote, text=opt)
            for opt in options
        ])
        serializer = self.get_serializer(created, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class UpdateOptionVoteGroup(generics.UpdateAPIView): # cho thêm option nhưng chỉ admin sửa đc title
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    serializer_class = VoteOptionSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'update_option_vote'

    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        option_id = self.kwargs.get("option_id")
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        vote = get_object_or_404(Vote, id=vote_id, content_type=contenttype, object_id=group_id, is_closed=False) # đã đóng thì k đc update
        return get_object_or_404(VoteOption, id=option_id, vote=vote)


class DeleteOptionVoteGroup(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated,IsAdminOrOwnerGroup]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'delete_option_vote'

    def get_object(self):
        vote_id = self.kwargs.get("vote_id")
        option_id = self.kwargs.get("option_id")
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        vote = get_object_or_404(Vote, id=vote_id, content_type=contenttype, object_id=group_id, is_closed=False) # đã đóng thì k đc delete option, muốn can thiệp phải xóa vote hẳn
        option = get_object_or_404(VoteOption, id=option_id, vote=vote)
        return option

class ListVoteGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = VoteSerializer
    pagination_class = LargePagePagination
    filter_backends = (DjangoFilterBackend, SearchFilter)
    search_fields = ['title']

    def get_queryset(self):
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        options_prefetch = Prefetch(
            'options',  # related name của vote option
            queryset=VoteOption.objects.annotate(  # annotate thêm tạm 1 cột trong db và xử lý ở db
                is_voted=Exists(  # trả true false nếu vote option có bảng tham chiếu tới uservote có user
                    UserVote.objects.filter(
                        option=OuterRef('pk'),
                        # OuterRef('pk') = id của VoteOption đang được duyệt qua có liên kết tới user vote có user trong đó
                        created_by=self.request.user
                    )
                )
            )
        )

        return (
            Vote.objects
            .filter(content_type=contenttype, object_id=group_id)
            .select_related('created_by__profile')
            .prefetch_related(
                options_prefetch)  # từ vote , lấy vote option in vote, và với mỗi vote option thì có tồn tại uservote của user
            .order_by('is_closed', '-created_at')  # vote đang mở lên trước, mới nhất trên cùng
        )

class ListUserVoteGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = UserVoteSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        vote_id = self.kwargs.get("vote_id")
        option_id = self.kwargs.get("option_id")
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)
        return UserVote.objects.filter(option_id=option_id, option__vote_id=vote_id,option__vote__content_type=contenttype,option__vote__object_id=group_id).select_related('created_by__profile', 'option','option__vote')

class DetailVoteGroup(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated, IsMemberGroup]
    serializer_class = VoteSerializer
    def get_object(self):
        group_id = self.kwargs.get("group_id")
        vote_id = self.kwargs.get("vote_id")  # ← thêm
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        contenttype = ContentType.objects.get_for_model(Group)

        options_prefetch = Prefetch(
            'options',
            queryset=VoteOption.objects.annotate(
                is_voted=Exists(
                    UserVote.objects.filter(
                        option=OuterRef('pk'),
                        created_by=self.request.user
                    )
                )
            )
        )

        return get_object_or_404(  # ← trả về 1 object
            Vote.objects
            .select_related('created_by__profile')
            .prefetch_related(options_prefetch),
            id=vote_id,
            content_type=contenttype,
            object_id=group_id,
        )

# Event group
class ListCreateEventGroup(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class   = EventSerializer
    pagination_class   = LargePagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['title']
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='create_event'

    def get_throttles(self): #override throttle cho post trong api có listcreate
        if self.request.method == 'POST':
            return [ScopedRateThrottle()]
        return []  # GET không throttle

    def _get_group(self):
        # cache tránh query group 2 lần khi GET gọi get_queryset rồi POST gọi perform_create
        if not hasattr(self, '_group'):
            self._group = get_object_or_404(Group, pk=self.kwargs.get('group_id'))
        return self._group

    def get_queryset(self):
        group = self._get_group()
        if not self.request.user.has_perm('group.is_member', group):
            raise PermissionDenied("Bạn không phải thành viên group")
        content_type = ContentType.objects.get_for_model(Group)
        return (
            Event.objects
            .filter(content_type=content_type, object_id=group.id)
            .select_related('created_by', 'created_by__profile')
            .prefetch_related('participants__user__profile')
            .order_by('start_time')
        )

    def perform_create(self, serializer):
        user         = self.request.user
        group = self._get_group()
        if not self.request.user.has_perm('group.is_admin', group):
            raise PermissionDenied("Chỉ admin/owner mới tạo được event")
        content_type = ContentType.objects.get_for_model(Group)

        # Save event vào DB
        event = serializer.save(
            content_type=content_type,
            object_id=group.id,
            created_by=user,
        )

        EventParticipant.objects.create(
            event = event,
            user= user,
            status = 'accept'
        )
        # Đặt reminder trước 15p
        # Ví dụ: event 3h thứ 2 → nhắc lúc 2h45 thứ 2
        start_time = event.start_time
        remind_at  = start_time - timedelta(minutes=15)
        delta = int((remind_at - timezone.now()).total_seconds())
        if delta > 0:
            task = send_event_reminder.apply_async(args=[event.id, content_type.id], countdown=delta)
        else:
            task = send_event_reminder.apply_async(args=[event.id, content_type.id])
        event.celery_task_id = task.id
        event.save(update_fields=['celery_task_id'])# lưu task id để cancel sau nếu cần

class EventDetailGroup(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = EventSerializer
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='modify_event'
    def get_object(self):
        event_id = self.kwargs.get("event_id")
        group_id = self.kwargs.get("group_id")
        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        content_type = ContentType.objects.get_for_model(Group)
        return get_object_or_404(
            Event.objects
            .select_related('created_by', 'created_by__profile')
            .prefetch_related('participants__user__profile'),
            id=event_id,
            content_type=content_type,
            object_id=group_id,
        )
    def perform_update(self, serializer):
        event = serializer.instance # lấy event trước save
        old_task_id = event.celery_task_id # lấy ra task_id celery cũ
        serializer.save() # save cái update mới(thời gian mới)

        group = event.content_object
        if not self.request.user.has_perm('group.is_admin', group):
            raise PermissionDenied("Chỉ admin/owner mới sửa được event")

        if 'start_time' in serializer.validated_data:  # chỉ reschedule khi start_time đổi
            if old_task_id: # nếu đưa vào start time mới thì xóa celery cái cũ
                from backend.celery import app
                app.control.revoke(old_task_id, terminate=True)

            remind_at = event.start_time - timedelta(minutes=15)
            content_type = ContentType.objects.get_for_model(Group)
            delta = int((remind_at - timezone.now()).total_seconds())
            if delta > 0:
                task = send_event_reminder.apply_async(args=[event.id, content_type.id], countdown=delta)
            else:
                task = send_event_reminder.apply_async(args=[event.id, content_type.id])
            Event.objects.filter(id=event.id).update(celery_task_id=task.id)

    def perform_destroy(self, instance):
        group = instance.content_object  # Group object
        if not self.request.user.has_perm('group.is_admin', group):
            raise PermissionDenied("Chỉ admin/owner mới xóa được event")
        # Hủy celery task trước khi xóa
        if instance.celery_task_id:
            from backend.celery import app
            app.control.revoke(instance.celery_task_id, terminate=True)

class EventResponseGroup(APIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    throttle_classes=[ScopedRateThrottle]
    throttle_scope='response_event'
    def patch(self, request, *args, **kwargs):
        user = request.user
        event_id = self.kwargs.get('event_id')
        group_id = self.kwargs.get("group_id")

        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        content_type = ContentType.objects.get_for_model(Group)

        new_status = request.data.get('status')
        if new_status not in ('accept', 'decline'):
            raise ValidationError({'status': 'Chỉ chấp nhận "accept" hoặc "decline".'})

        event = get_object_or_404(Event, id=event_id, content_type=content_type, object_id=group_id)

        participant, created = EventParticipant.objects.update_or_create( # nếu chưa tham gia thì tạo, nếu đã tham gia rồi thì chỉ update status
            event=event,
            user=request.user,
            defaults={'status': new_status} # khi update chỉ update default còn create sẽ gán event,user và default
        )
        return Response(
            {'detail': f'Bạn đã {new_status} sự kiện "{event.title}".'},
            status=status.HTTP_200_OK,
        )

class EventParticipantGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated,IsMemberGroup]
    serializer_class = EventParticipantSerializer
    pagination_class   = SmallPagePagination
    filter_backends = [DjangoFilterBackend,SearchFilter]
    search_fields = ['user__profile__first_name', 'user__profile__last_name']
    def get_queryset(self):
        event_id = self.kwargs.get('event_id')
        group_id = self.kwargs.get("group_id")

        group = get_object_or_404(Group, pk=group_id)
        self.check_object_permissions(self.request, group)
        content_type = ContentType.objects.get_for_model(Group)

        return EventParticipant.objects.filter(
           event__content_type = content_type,
            event__object_id = group_id,
            event_id =event_id,
            status = 'accept'
        ).select_related('user__profile')

class CreateSuggestionGroup(generics.CreateAPIView):
    permission_classes = [IsAuthenticated, IsMemberGroup]
    serializer_class = GroupSuggestionSerializer

    def perform_create(self, serializer):
        group = get_object_or_404(Group, pk=self.kwargs.get('group_id'))
        self.check_object_permissions(self.request, group)
        if not group.is_company:
            raise PermissionDenied("Chỉ group công ty mới có chức năng này")
        serializer.save(group=group)  # không lưu user


class ListSuggestionGroup(generics.ListAPIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwnerGroup]
    serializer_class = GroupSuggestionSerializer
    pagination_class = LargePagePagination

    def get_queryset(self):
        group = get_object_or_404(Group, pk=self.kwargs.get('group_id'))
        self.check_object_permissions(self.request, group)
        return GroupSuggestion.objects.filter(group=group).order_by('-created_at')

