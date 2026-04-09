from django.contrib import admin
from django.db.models.functions import TruncDate

from .models import *
# SAFE DELETE
from safedelete.admin import SafeDeleteAdminFilter, SafeDeleteAdmin
from safedelete.models import HARD_DELETE

class PostPhotoInline(admin.TabularInline):  # hoặc StackedInline để hiển thị theo chiều dọc vào trong phần chỉnh Post
    model = PostPhoto
    extra = 1  # số ô upload ảnh trống ban đầu
    min_num = 1  # optional: yêu cầu ít nhất 1 ảnh
    max_num = 10  # optional: giới hạn số ảnh tối đa

#========================POST=============================================
@admin.register(Post) #sửa lại trường có thể show trong trang admin
class PostAdmin(SafeDeleteAdmin):
    inlines = [PostPhotoInline] #thêm trường hiển thị trong Post do khác bảng mà muốn gộp lại  
    list_display = ('post_id', 'user', 'title', 'created_at','deleted') #trường lấy ra sẵn 
    list_filter = (SafeDeleteAdminFilter,'user') #lọc theo trạng thái xóa mềm và user
    list_select_related = ['user']# Join giảm thgian load trang thqua query, tự select related với chính model instance này là post
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) bài viết đã xóa mềm")
    def undelete_selected(self, request, queryset): #lấy ra các bài viết và lọc ra, nếu nhấn sẽ set undelete, querryset là các bài viết được chọn
        restored = queryset.undelete() 
        self.message_user(request, f"✅ Đã khôi phục {restored} bài viết.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)  # xóa thật
        self.message_user(request, f"⚠️ Đã xóa cứng {count} bài viết.")
#==========================PENDING PROFILE==========================================
@admin.register(PendingProfile)
class PendingProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'first_name', 'last_name', 'date_of_birth')
    search_fields = ('user__username', 'first_name', 'last_name')
    list_filter = ('date_of_birth',)
    list_select_related = ['user']
#==========================PROFILE========================================
@admin.register(Profile)
class ProfileAdmin(SafeDeleteAdmin):
    list_display = ('id','user', 'first_name', 'last_name', 'is_completed', 'phone_number','deleted')
    search_fields = ('user__username', 'first_name', 'last_name', 'phone_number')
    list_filter = (SafeDeleteAdminFilter,'is_completed',)
    list_select_related = ['user']
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) Profile đã xóa mềm")
    def undelete_selected(self, request, queryset):
        restored = queryset.undelete()
        self.message_user(request, f"✅ Đã khôi phục {restored} hồ sơ.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)
        self.message_user(request, f"⚠️ Đã xóa cứng {count} hồ sơ.")
#===========================COMMENT============================================
@admin.register(Comment)
class CommentAdmin(SafeDeleteAdmin):
    list_display = ('user', 'post', 'content', 'created_at','deleted')
    search_fields = ('user__username', 'content', 'post__title')
    list_filter = (SafeDeleteAdminFilter,'created_at',)
    list_select_related = ['user', 'post']
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) bình luận")
    def undelete_selected(self, request, queryset):
        restored = queryset.undelete()
        self.message_user(request, f"✅ Đã khôi phục {restored} bình luận.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)
        self.message_user(request, f"⚠️ Đã xóa cứng {count} bình luận.")
#===========================LOG============================================
@admin.register(Log)
class LogAdmin(SafeDeleteAdmin):
    list_display = ('metadata_json', 'created_log_at','deleted')
    search_fields = ('metadata_json',)
    list_filter = (SafeDeleteAdminFilter,'created_log_at',)
    ordering = ('-created_log_at',)
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) Log")
    def undelete_selected(self, request, queryset):
        restored = queryset.undelete()
        self.message_user(request, f"✅ Đã khôi phục {restored} bài viết Log.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)
        self.message_user(request, f"⚠️ Đã xóa cứng {count} Log.")

#===========================SETTING============================================
@admin.register(Setting)
class SettingAdmin(admin.ModelAdmin):
    list_display = ('user', 'darkmode')
    search_fields = ('user__username',)
    list_select_related = ['user']

#===========================POST ARTICLE============================================
@admin.register(PostArticle)
class PostArticleAdmin(SafeDeleteAdmin):
    list_display = ('user', 'title', 'slug', 'created_at','deleted')
    search_fields = ('user__username', 'title', 'content')
    list_filter = (SafeDeleteAdminFilter,'created_at',)
    list_select_related = ['user']
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) bài viết dạng Article")
    def undelete_selected(self, request, queryset):
        restored = queryset.undelete()
        self.message_user(request, f"✅ Đã khôi phục {restored} bài viết Article.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)
        self.message_user(request, f"⚠️ Đã xóa cứng {count} bài viết Article.")

#===========================POST PHOTO============================================
@admin.register(PostPhoto)
class PostPhotoAdmin(SafeDeleteAdmin):
    list_display = ('id', 'post', 'photo', 'deleted')
    search_fields = ('post__title',)
    list_filter = (SafeDeleteAdminFilter,)
    list_select_related = ['post']  # join post sẵn tránh N+1
    actions = ['undelete_selected', 'hard_delete_selected']

    @admin.action(description="♻️ Khôi phục (undelete) ảnh đã xóa mềm")
    def undelete_selected(self, request, queryset):
        restored = queryset.undelete()
        self.message_user(request, f"✅ Đã khôi phục {restored} ảnh.")

    @admin.action(description="💀 Xóa cứng (hard delete) khỏi DB")
    def hard_delete_selected(self, request, queryset):
        count = queryset.count()
        for obj in queryset:
            obj.delete(force_policy=HARD_DELETE)
        self.message_user(request, f"⚠️ Đã xóa cứng {count} ảnh.")
    
admin.site.register([Conversation,ConversationMember,Message,MessageAttachment,FCMToken,Notification,SearchHistory])

#==========================CHART====================================================


from django.contrib.auth.models import User
from django.db.models import Count
from django.utils import timezone
from datetime import timedelta
import json

def get_daily_counts(queryset, date_field, days=30):
    today = timezone.now().date()
    start = today - timedelta(days=days - 1)

    # lấy tên primary key của model thay vì hardcode 'id'
    pk_name = queryset.model._meta.pk.name

    qs = (
        queryset
        .filter(**{f'{date_field}__date__gte': start})
        .annotate(day=TruncDate(date_field))
        .values('day')
        .annotate(count=Count(pk_name))  # ← dùng pk_name thay vì 'id'
        .order_by('day')
    )
    count_map = {row['day']: row['count'] for row in qs}

    labels, data = [], []
    for i in range(days):
        day = start + timedelta(days=i)
        labels.append(day.strftime('%d/%m'))
        data.append(count_map.get(day, 0))

    return labels, data

class CustomAdminSite(admin.AdminSite):
    def index(self, request, extra_context=None):
        extra_context = extra_context or {}

        # Stats cards
        extra_context['stats'] = {
            'total_users':          User.objects.count(),
            'active_users':         User.objects.filter(is_active=True).count(),
            'total_posts':          Post.objects.count(),
            'total_articles':       PostArticle.objects.count(),
            'total_comments':       Comment.objects.count(),
            'total_messages':       Message.objects.count(),
            'total_conversations':  Conversation.objects.count(),
            'unread_notifications': Notification.objects.filter(is_read=False).count(),
            'pending_profiles':     PendingProfile.objects.count(),
        }

        # Charts 30 ngày
        labels, user_data    = get_daily_counts(User.objects,    'date_joined', 30)
        _,      post_data    = get_daily_counts(Post.objects,    'created_at',  30)
        _,      comment_data = get_daily_counts(Comment.objects, 'created_at',  30)
        _,      message_data = get_daily_counts(Message.objects, 'created_at',  30)

        extra_context['chart_users']    = json.dumps({'labels': labels, 'data': user_data})
        extra_context['chart_posts']    = json.dumps({'labels': labels, 'data': post_data})
        extra_context['chart_comments'] = json.dumps({'labels': labels, 'data': comment_data})
        extra_context['chart_messages'] = json.dumps({'labels': labels, 'data': message_data})
        extra_context['stats']['total_conversations'] = Conversation.objects.count()
        extra_context['stats']['total_searches']      = SearchHistory.objects.count()

        _, conv_data   = get_daily_counts(Conversation.objects,  'created_at', 90)
        _, search_data = get_daily_counts(SearchHistory.objects, 'created_at', 90)

        # đổi tất cả days=30 thành days=90 để nút 90 ngày hoạt động
        labels, user_data    = get_daily_counts(User.objects,    'date_joined', 90)
        _,      post_data    = get_daily_counts(Post.objects,    'created_at',  90)
        _,      comment_data = get_daily_counts(Comment.objects, 'created_at',  90)
        _,      message_data = get_daily_counts(Message.objects, 'created_at',  90)

        extra_context['chart_conversations'] = json.dumps({'labels': labels, 'data': conv_data})
        extra_context['chart_searches']      = json.dumps({'labels': labels, 'data': search_data})

        # Devices pie chart
        devices = FCMToken.objects.values('device').annotate(count=Count('device'))
        extra_context['chart_devices'] = json.dumps({
            'labels': [d['device'] for d in devices],
            'data':   [d['count'] for d in devices],
        })
        # Pie charts
        notif_types = Notification.objects.values('type').annotate(count=Count('type'))
        extra_context['chart_notifications'] = json.dumps({
            'labels': [n['type'] for n in notif_types],
            'data':   [n['count'] for n in notif_types],
        })

        msg_types = Message.objects.values('message_type').annotate(count=Count('message_type'))
        extra_context['chart_message_types'] = json.dumps({
            'labels': [m['message_type'] for m in msg_types],
            'data':   [m['count'] for m in msg_types],
        })

        return super().index(request, extra_context)

# Override admin.site mặc định
admin.site.__class__ = CustomAdminSite
#============================================================================
#Trang check thay đổi của admin
from django.contrib import admin
from django.contrib.admin.models import LogEntry

@admin.register(LogEntry)
class LogEntryAdmin(admin.ModelAdmin):
    # Khai báo các cột muốn hiển thị
    list_display = ['action_time', 'user', 'content_type', 'object_repr', 'get_action', 'change_message']
    list_filter = ['action_flag', 'user', 'content_type']
    search_fields = ['user__email', 'change_message', 'object_repr']
    
    # Chỉ cho đọc, cấm thằng Admin nào vào đây xoá log để phi tang chứng cứ
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False
    def has_delete_permission(self, request, obj=None):
        return False

    # Hàm phụ để hiển thị chữ Thêm/Sửa/Xoá thay vì số 1,2,3
    @admin.display(description='Hành động')
    def get_action(self, obj):
        if obj.action_flag == 1: return "🟢 THÊM"
        if obj.action_flag == 2: return "🟡 SỬA"
        if obj.action_flag == 3: return "🔴 XOÁ"
        return "KHÁC"
