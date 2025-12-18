#=======================================SILK=============================================================================
SILKY_PYTHON_PROFILER = True            # Bật profiling cho Python code
SILKY_PYTHON_PROFILER_BINARY = True     # Lưu profile ở dạng binary (có thể dùng với tools như SnakeViz)
SILKY_MAX_REQUEST_BODY_SIZE = -1        # Lưu toàn bộ body request (mặc định là 100kb)
SILKY_MAX_RESPONSE_BODY_SIZE = -1       # Lưu toàn bộ body response
SILKY_INTERCEPT_PERCENT = 100           # % request được Silk ghi nhận

#=================== Django activity stream settings ============================================================================
ACTSTREAM_SETTINGS = {
    'MANAGER': 'actstream.managers.ActionManager', # Hàm mặc định có sẵn các chức năng quản lý hành động sẵn
    'FETCH_RELATIONS':True, #dùng để join các thứ có lien quan đến action khi truy vấn và giảm lượng querry nhưng tăng tốc độ ram
    'USE_JSONFIELD': True, #sử dụng jsonfield để lưu trữ dữ liệu bổ sung
    'USE_PREFETCH': True,
    'GFK_FETCH_DEPTH': 1, #chỉ định độ sâu khi truy xuất các đối tượng liên quan thông qua GenericForeignKey, 1 là chỉ truy vấn các cái liên quan, 2 là đi sâu thêm 1 tầng
}
#actor: ai thực hiện (thường là request.user hoặc model đã đăng ký)
#verb: hành động (chuỗi) — ví dụ 'created', 'liked', 'commented'
#action_object: đối tượng cụ thể tạo ra hành động (ví dụ một comment)
#target: đối tượng bị tác động (ví dụ bài viết, group)
#timestamp tự động lưu.

