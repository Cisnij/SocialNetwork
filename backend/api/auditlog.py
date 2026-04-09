from auditlog.registry import auditlog
from .models import Profile

auditlog.register(Profile)
