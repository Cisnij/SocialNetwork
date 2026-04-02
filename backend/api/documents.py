# documents.py
from django_elasticsearch_dsl import Document, fields
from django_elasticsearch_dsl.registries import registry
from elasticsearch_dsl import analyzer, token_filter
from .models import Post, Profile

# Bộ lọc chuyển tiếng Việt có dấu -> không dấu, preserver để lưu cả bản k dấu và có dấu
ascii_fold = token_filter("ascii_fold", type="asciifolding", preserve_original=True)
#cắt nhỏ từ để tìm kiếm từng phần kiểm tra ví dụ c->co->con , bắt đầu từ cắt từ kí tự thứ 2 và cắt max 20
ngram_filter = token_filter("ngram_filter", type="edge_ngram", min_gram=2, max_gram=20)

vn_analyzer = analyzer( # chuyển thành chuỗi thường và băt đầu phân tích
    "vn_analyzer",
    tokenizer="standard", #chia câu thành từ đơn lẻ ví dụ con cò-> con và cò và lưu
    filter=["lowercase", ascii_fold, ngram_filter] # chuyển thành chữ thường và lọc
)
'''flow là người dùng nhập key sẽ dùng vn_analyzer băm nhỏ thành đơn lẻ và lưu, cũng lưu luôn từ có dấu
và từ bỏ dấu, sau đó mới trả kết quả có sẵn nếu trùng với thằng băm. Sau này có tìm từ mới thì trùng với
thằng đã bị băm thì chỉ cần trả ra'''
@registry.register_document #đăng kí document với hệ thống
class PostDocument(Document):
    # Khai báo thủ công field title để áp dụng analyzer tiếng Việt
    title = fields.TextField(analyzer=vn_analyzer, search_analyzer="standard")# search analyzer để k cắt chữ như ngram ở trên cho nhẹ, chỉ lấy cái ngram đã cắt sẵn trong db

    class Index:
        name = 'posts' #tên kho chứa
        settings = {'number_of_shards': 1, 'number_of_replicas': 0}

    class Django:
        model = Post #model để map dữ liệu sang
        fields = [] # Để trống vì đã khai báo title ở trên

    def get_queryset(self):
        return super().get_queryset().filter(deleted__isnull=True)

@registry.register_document
class ProfileDocument(Document):
    first_name = fields.TextField(analyzer=vn_analyzer, search_analyzer="standard")
    last_name = fields.TextField(analyzer=vn_analyzer, search_analyzer="standard")
    # Thêm field ảo để tìm kiếm cả họ lẫn tên dễ dàng hơn
    full_name = fields.TextField(analyzer=vn_analyzer)

    class Index:
        name = 'profiles'
        settings = {'number_of_shards': 1, 'number_of_replicas': 0}

    class Django:
        model = Profile
        fields = []

    def prepare_full_name(self, instance): # lưu vào trường fullname trong elastic model
        return f"{instance.first_name} {instance.last_name}"

    def get_queryset(self):
        return super().get_queryset().filter(deleted__isnull=True)

# flow: model -> document -> seach query -> trả kết quả
# ví dụ post, nó sẽ map dữ liệu từ thằng post qua bên elastic ở đây là chỉ lấy tilte qua đó, sau đó elastic tự query data nó và cho ra kết quả