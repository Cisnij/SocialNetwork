# run_test.py
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()
from django.test.utils import setup_test_environment
from django.test.runner import DiscoverRunner

runner = DiscoverRunner(verbosity=0)
old_config = runner.setup_databases()
setup_test_environment()

django.setup()

from faker import Faker
from django.contrib.auth.models import User
from api.models import *
from friendship.models import Friend, Follow
import random, time

fake = Faker('vi_VN')

print("🌱 Tạo data giả...")

users = []
for i in range(50):
    user = User.objects.create_user(
        username=f"user_{i}", email=f"user{i}@test.com", password="123456"
    )
    Profile.objects.create(user=user, first_name=fake.first_name(), last_name=fake.last_name(), is_completed=True)
    Setting.objects.create(user=user)
    users.append(user)

Post.objects.bulk_create([Post(user=random.choice(users), title=fake.sentence()) for _ in range(50)])
posts = list(Post.objects.all())

Comment.objects.bulk_create([
    Comment(user=random.choice(users), post=random.choice(posts), content=fake.sentence())
    for _ in range(50)
])

for _ in range(50):
    u1, u2 = random.sample(users, 2)
    try:
        if not Friend.objects.are_friends(u1, u2):
            Friend.objects.add_friend(u1, u2).accept()
    except: pass

for _ in range(50):
    u1, u2 = random.sample(users, 2)
    conv = Conversation.objects.create(is_group=False, status='accept')
    ConversationMember.objects.bulk_create([
        ConversationMember(conversation=conv, user=u1),
        ConversationMember(conversation=conv, user=u2),
    ])
    Message.objects.bulk_create([
        Message(conversation=conv, sender=random.choice([u1, u2]), content=fake.sentence(), message_type='text')
        for _ in range(50)
    ])

Notification.objects.bulk_create([
    Notification(reciever=random.choice(users), actor=random.choice(users),
                 type=random.choice(['follow', 'comment', 'reaction']), message=fake.sentence())
    for _ in range(50)
])

print(f"✅ Data xong: {len(users)} users | {Post.objects.count()} posts | {Message.objects.count()} messages\n")

# =====================================================================
# GỌI API
# =====================================================================
from rest_framework.test import APIClient

client = APIClient()
user = random.choice(users)
profile = Profile.objects.get(user=user)
client.force_authenticate(user=user)

conv = Conversation.objects.filter(conversationmember__user=user).first()
post = random.choice(posts)

results = []

def call(label, method, url, data=None):
    start = time.time()
    res = client.get(url) if method == 'GET' else client.post(url, data, format='json')
    elapsed = (time.time() - start) * 1000
    status = "✅" if res.status_code < 400 else "❌"
    results.append((elapsed, label, res.status_code))
    print(f"{status} {label:<55} {res.status_code}  {elapsed:.0f}ms")

print(f"{'API':<57} {'Status'}  {'Time'}")
print("-" * 70)

# Profile
call("GET /api/user/",                                      'GET', '/api/user/')
call("GET /api/user/profile/",                              'GET', '/api/user/profile/')
call(f"GET /api/user/profile/{profile.id}/",                'GET', f'/api/user/profile/{profile.id}/')
call(f"GET /api/auth/profile/userpage/{profile.id}/",       'GET', f'/api/auth/profile/userpage/{profile.id}/')

# Post
call("GET /api/user/post/show",                             'GET', '/api/user/post/show')
call(f"GET /api/user/post/userpage/{profile.id}/",          'GET', f'/api/user/post/userpage/{profile.id}/')
call(f"GET /api/user/post/{post.post_id}/",                 'GET', f'/api/user/post/{post.post_id}/')
call("POST /api/user/post/create/",                         'POST', '/api/user/post/create/', {'title': fake.sentence()})
call("GET /api/admin/post/",                                'GET', '/api/admin/post/')

# Post Article
call("GET /api/user/post-article/",                         'GET', '/api/user/post-article/')

# Comment
call(f"GET /api/user/comments/post/{post.post_id}",         'GET', f'/api/user/comments/post/{post.post_id}')
call("POST comment",                                        'POST', f'/api/user/comments/post/{post.post_id}', {'content': fake.sentence()})

# Setting
call(f"GET /api/user/setting/{profile.id}/",               'GET', f'/api/user/setting/{profile.id}/')

# Friend
call("GET /api/friends/",                                   'GET', '/api/friends/')
call("GET /api/friends/requests/incoming/",                 'GET', '/api/friends/requests/incoming/')
call("GET /api/friends/requests/outgoing/",                 'GET', '/api/friends/requests/outgoing/')

# Follow
call("GET /api/followers/",                                 'GET', '/api/followers/')
call("GET /api/following/",                                 'GET', '/api/following/')

# Block
call("GET /api/block/user",                                 'GET', '/api/block/user')
call("GET /api/block/touser",                               'GET', '/api/block/touser')

# Reaction
call(f"GET /api/user/reaction/{post.post_id}",              'GET', f'/api/user/reaction/{post.post_id}')

# Chat
call("GET /api/chat/conversations/",                        'GET', '/api/chat/conversations/')
if conv:
    call(f"GET /api/chat/messages/list/{conv.id}/",         'GET', f'/api/chat/messages/list/{conv.id}/')
    call(f"GET /api/chat/conversation/members/{conv.id}/",  'GET', f'/api/chat/conversation/members/{conv.id}/')

# Notification
call("GET /api/notifications/",                             'GET', '/api/notifications/')

# Relationship
call(f"GET /api/relationship/{profile.id}/",                'GET', f'/api/relationship/{profile.id}/')

# =====================================================================
# KẾT QUẢ
# =====================================================================
print("\n" + "=" * 70)
print("📊 KẾT QUẢ — sắp xếp chậm nhất")
print("=" * 70)
for elapsed, label, code in sorted(results, reverse=True):
    icon = "🔴" if elapsed > 300 else "🟡" if elapsed > 100 else "🟢"
    print(f"{icon} {label:<55} {elapsed:.0f}ms")

print("\n🔴 > 300ms  → cần fix gấp")
print("🟡 100-300ms → nên tối ưu")
print("🟢 < 100ms  → ổn!")

runner.teardown_databases(old_config)
print("\n🧹 DB test đã xóa!")