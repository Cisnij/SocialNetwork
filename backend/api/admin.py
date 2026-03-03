from django.contrib import admin
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
#==========================PROFILE========================================
@admin.register(Profile)
class ProfileAdmin(SafeDeleteAdmin):
    list_display = ('id','user', 'first_name', 'last_name', 'is_completed', 'phone_number','deleted')
    search_fields = ('user__username', 'first_name', 'last_name', 'phone_number')
    list_filter = (SafeDeleteAdminFilter,'is_completed',)
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

#===========================POST ARTICLE============================================
@admin.register(PostArticle)
class PostArticleAdmin(SafeDeleteAdmin):
    list_display = ('user', 'title', 'slug', 'created_at','deleted')
    search_fields = ('user__username', 'title', 'content')
    list_filter = (SafeDeleteAdminFilter,'created_at',)
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
    
admin.site.register([Conversation,ConversationMember,Message,MessageAttachment,FCMToken,Notification])