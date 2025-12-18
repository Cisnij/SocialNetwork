from django.db import models

# Create your models here.
class Conversation(models.Model):
    is_group=models.BooleanField(default=False)
    created_at=models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.room_name