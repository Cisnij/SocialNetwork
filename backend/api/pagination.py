from rest_framework.pagination import PageNumberPagination

#viết trang riêng v sẽ áp dụng cho 1 view bất kì, còn setting thì sẽ áp dụng toàn bộ
class SmallPagePagination(PageNumberPagination):
    page_size = 5 # mặc định 5 item/trang
    page_size_query_param = 'page_size' # client có thể chỉnh ?page_size=20
    max_page_size = 20 # tránh client yêu cầu quá lớn, có thể tùy chỉnh page size k phài là 5 như trên mà là 1-20. Ví dụ nếu cliend chỉnh ?page_size=50 thì sẽ lấy 20 làm max


class LargePagePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100