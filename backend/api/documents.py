# documents.py
from django_elasticsearch_dsl import Document, fields
from django_elasticsearch_dsl.registries import registry
from elasticsearch_dsl import analyzer, token_filter
from .models import Post, Profile
#=================================FILTER để lọc ra từ từ tìm kiếm=================================
# Bộ lọc chuyển tiếng Việt có dấu -> không dấu, preserver để lưu cả bản k dấu và có dấu
ascii_fold = token_filter("ascii_fold", type="asciifolding", preserve_original=True)
#cắt nhỏ từ để tìm kiếm từng phần kiểm tra ví dụ c->co->con , bắt đầu từ cắt từ kí tự thứ 2 và cắt max 20
ngram_filter = token_filter("ngram_filter", type="edge_ngram", min_gram=2, max_gram=20)
shingle_filter = token_filter(
    "shingle_filter",
    type="shingle",
    min_shingle_size=2,
    max_shingle_size=3,           # tạo cụm 2-3 từ: "trần nghị", "trần nghị nguyễn"
    output_unigrams=True          # vẫn giữ từ đơn
)
synonym_filter = token_filter(
    "synonym_filter",
    type="synonym",
    synonyms=[
        # thêm từ đồng nghĩa domain của bạn
        "fb, facebook",
        "ck, chồng",
        "vk, vợ",
        "ib, nhắn tin, message",
        "ko, không"
    ]
)
#=============================ÁP DỤNG FILTER VÀO TÌM KIẾM===============================================
vn_index_analyzer  = analyzer( # chuyển thành chuỗi thường và băt đầu phân tích băm nhỏ
    "vn_index_analyzer",
    tokenizer="standard", #chia câu thành từ đơn lẻ ví dụ con cò-> con và cò và lưu
    filter=["lowercase", ascii_fold, synonym_filter, shingle_filter, ngram_filter] # chuyển thành chữ thường và lọc
)

vn_search_analyzer = analyzer(#tìm kiếm không băm ngram, chỉ lowercase + bỏ dấu
    "vn_search_analyzer",
    tokenizer="standard",
    filter=["lowercase", ascii_fold,synonym_filter,]  # không có ngram_filter
)

'''flow là người dùng nhập key sẽ dùng vn_analyzer băm nhỏ thành đơn lẻ và lưu, cũng lưu luôn từ có dấu
và từ bỏ dấu, sau đó mới trả kết quả có sẵn nếu trùng với thằng băm. Sau này có tìm từ mới thì trùng với
thằng đã bị băm thì chỉ cần trả ra'''
@registry.register_document #đăng kí document với hệ thống
class PostDocument(Document):
    # Khai báo thủ công field title để áp dụng analyzer tiếng Việt
    title = fields.TextField(analyzer=vn_index_analyzer, search_analyzer=vn_search_analyzer)# search analyzer để k cắt chữ như ngram ở trên cho nhẹ, chỉ lấy cái ngram đã cắt sẵn trong db

    class Index:
        name = 'posts' #tên kho chứa
        settings = {'number_of_shards': 3, 'number_of_replicas': 1,'max_ngram_diff': 18,}#shards để chia nhỏ dữ liệu trong db để tìm, replicas bản sao dự phòng

    class Django:
        model = Post #model để map dữ liệu sang
        fields = [] # Để trống vì đã khai báo title ở trên

    def get_queryset(self):
        return super().get_queryset().filter(deleted__isnull=True)

@registry.register_document
class ProfileDocument(Document):
    first_name = fields.TextField(analyzer=vn_index_analyzer, search_analyzer=vn_search_analyzer)
    last_name = fields.TextField(analyzer=vn_index_analyzer, search_analyzer=vn_search_analyzer)
    # Thêm field ảo để tìm kiếm cả họ lẫn tên dễ dàng hơn
    full_name = fields.TextField(analyzer=vn_index_analyzer,search_analyzer=vn_search_analyzer)

    class Index:
        name = 'profiles'
        settings = {'number_of_shards': 3, 'number_of_replicas': 1,'max_ngram_diff': 18,}

    class Django:
        model = Profile
        fields = []

    def prepare_full_name(self, instance): # lưu vào trường fullname trong elastic model phía trên
        # Lưu cả 2 chiều để gõ "nghị trần" cũng ra
        full = f"{instance.last_name} {instance.first_name}"
        reverse = f"{instance.first_name} {instance.last_name}"
        return f"{full} {reverse}"

    def get_queryset(self):
        return super().get_queryset().filter(deleted__isnull=True)

# flow: model -> document -> seach query -> trả kết quả
# ví dụ post, nó sẽ map dữ liệu từ thằng post qua bên elastic ở đây là chỉ lấy tilte qua đó, sau đó elastic tự query data title và cho ra kết quả dựa trên analyzer và search analyzer