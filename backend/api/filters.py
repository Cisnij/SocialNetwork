from django_filters import rest_framework as filters
from reaction.models import UserReaction

class UserReactionFilter(filters.FilterSet):
    slug=filters.CharFilter(field_name='react__slug',lookup_expr='iexact') #lây ra dữ liệu con của FK, iexact là k phân biệt hoa thường
    class Meta:
        model = UserReaction
        fields =['user']