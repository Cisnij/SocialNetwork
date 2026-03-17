from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient
from rest_framework import status
from .models import (
    Profile, Post, Comment, Setting,
    Conversation, ConversationMember, Message, Notification
)
from friendship.models import Friend, FriendshipRequest, Follow, Block


# =====================================================================
# Helper
# =====================================================================
def make_user(username, password='testpass123'):
    from django.contrib.auth.models import User
    user = User.objects.create_user(username=username, password=password, email=f'{username}@test.com')
    Profile.objects.create(user=user, first_name=username, last_name='Test')
    Setting.objects.create(user=user)
    return user


# =====================================================================
# MODEL TESTS
# =====================================================================
class ProfileModelTest(TestCase):
    def setUp(self):
        self.user = make_user('alice')

    def test_profile_created(self):
        profile = Profile.objects.get(user=self.user)
        self.assertEqual(profile.first_name, 'alice')

    def test_profile_str(self):
        profile = Profile.objects.get(user=self.user)
        self.assertIn('alice', str(profile))

    def test_soft_delete_profile(self):
        profile = Profile.objects.get(user=self.user)
        profile.delete()
        self.assertEqual(Profile.all_objects.filter(user=self.user).count(), 1)


class PostModelTest(TestCase):
    def setUp(self):
        self.user = make_user('bob')

    def test_create_post(self):
        post = Post.objects.create(user=self.user, title='Hello world')
        self.assertEqual(post.title, 'Hello world')

    def test_post_str(self):
        post = Post.objects.create(user=self.user, title='Hello world')
        self.assertIn('bob', str(post))

    def test_soft_delete_post(self):
        post = Post.objects.create(user=self.user, title='To delete')
        post_id = post.post_id
        post.delete()
        self.assertFalse(Post.objects.filter(post_id=post_id).exists())
        self.assertTrue(Post.all_objects.filter(post_id=post_id).exists())


class CommentModelTest(TestCase):
    def setUp(self):
        self.user = make_user('carol')
        self.post = Post.objects.create(user=self.user, title='Post 1')

    def test_create_comment(self):
        comment = Comment.objects.create(user=self.user, post=self.post, content='Nice!')
        self.assertEqual(comment.content, 'Nice!')

    def test_comment_str(self):
        comment = Comment.objects.create(user=self.user, post=self.post, content='Nice!')
        self.assertIn('carol', str(comment))


class NotificationModelTest(TestCase):
    def setUp(self):
        self.sender = make_user('sender')
        self.receiver = make_user('receiver')

    def test_create_notification(self):
        notif = Notification.objects.create(
            reciever=self.receiver,
            actor=self.sender,
            type='follow',
            message='sender followed you'
        )
        self.assertEqual(notif.type, 'follow')
        self.assertFalse(notif.is_read)

    def test_notification_ordering(self):
        Notification.objects.create(reciever=self.receiver, actor=self.sender, type='follow', message='1')
        Notification.objects.create(reciever=self.receiver, actor=self.sender, type='comment', message='2')
        notifs = Notification.objects.filter(reciever=self.receiver)
        self.assertEqual(notifs[0].message, '2')  # -created_at → mới nhất đầu


# =====================================================================
# API TESTS - PROFILE
# =====================================================================
class ProfileAPITest(APITestCase):
    def setUp(self):
        self.user = make_user('dave')
        self.profile = Profile.objects.get(user=self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_my_profile(self):
        res = self.client.get(reverse('profile-modify', kwargs={'pk': self.profile.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['first_name'], 'dave')

    def test_update_profile(self):
        res = self.client.patch(
            reverse('profile-modify', kwargs={'pk': self.profile.id}),
            {'bio': 'Hello!'}
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['bio'], 'Hello!')

    def test_unauthenticated_blocked(self):
        self.client.force_authenticate(user=None)
        res = self.client.get(reverse('profile-modify', kwargs={'pk': self.profile.id}))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_get_profile_view(self):
        # GET /api/user/ → profile của user hiện tại
        res = self.client.get(reverse('profile-view'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - POST
# =====================================================================
class PostAPITest(APITestCase):
    def setUp(self):
        self.user = make_user('eve')
        self.other = make_user('frank')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_post(self):
        res = self.client.post(reverse('post-create'), {'title': 'My first post'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Post.objects.filter(user=self.user).count(), 1)

    def test_create_post_no_title_fails(self):
        res = self.client.post(reverse('post-create'), {})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_get_post(self):
        post = Post.objects.create(user=self.user, title='Get me')
        res = self.client.get(reverse('post-modify', kwargs={'pk': post.post_id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'Get me')

    def test_update_own_post(self):
        post = Post.objects.create(user=self.user, title='Old title')
        res = self.client.patch(
            reverse('post-modify', kwargs={'pk': post.post_id}),
            {'title': 'New title'}
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['title'], 'New title')

    def test_delete_own_post(self):
        post = Post.objects.create(user=self.user, title='Delete me')
        res = self.client.delete(reverse('post-modify', kwargs={'pk': post.post_id}))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_cannot_delete_others_post(self):
        post = Post.objects.create(user=self.other, title='Not mine')
        res = self.client.delete(reverse('post-modify', kwargs={'pk': post.post_id}))
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_list_user_posts(self):
        profile = Profile.objects.get(user=self.user)
        Post.objects.create(user=self.user, title='p1')
        Post.objects.create(user=self.user, title='p2')
        res = self.client.get(reverse('post-user', kwargs={'user': profile.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - COMMENT
# =====================================================================
class CommentAPITest(APITestCase):
    def setUp(self):
        self.user = make_user('grace')
        self.post = Post.objects.create(user=self.user, title='Post')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_comment(self):
        res = self.client.post(
            reverse('comment-list', kwargs={'post_id': self.post.post_id}),
            {'content': 'Great post!'}
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_list_comments(self):
        Comment.objects.create(user=self.user, post=self.post, content='c1')
        Comment.objects.create(user=self.user, post=self.post, content='c2')
        res = self.client.get(reverse('comment-list', kwargs={'post_id': self.post.post_id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_delete_own_comment(self):
        comment = Comment.objects.create(user=self.user, post=self.post, content='bye')
        res = self.client.delete(reverse('comment-modify', kwargs={'pk': comment.id}))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_cannot_delete_others_comment(self):
        other = make_user('hank')
        comment = Comment.objects.create(user=other, post=self.post, content='other')
        res = self.client.delete(reverse('comment-modify', kwargs={'pk': comment.id}))
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)


# =====================================================================
# API TESTS - FRIENDSHIP
# =====================================================================
class FriendshipAPITest(APITestCase):
    def setUp(self):
        self.user1 = make_user('henry')
        self.user2 = make_user('iris')
        self.profile2 = Profile.objects.get(user=self.user2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user1)

    def test_send_friend_request(self):
        res = self.client.post(reverse('send-friend-request', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(FriendshipRequest.objects.filter(from_user=self.user1, to_user=self.user2).exists())

    def test_cannot_send_request_to_self(self):
        profile1 = Profile.objects.get(user=self.user1)
        res = self.client.post(reverse('send-friend-request', kwargs={'pk': profile1.id}))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_send_duplicate_request(self):
        url = reverse('send-friend-request', kwargs={'pk': self.profile2.id})
        self.client.post(url)
        res = self.client.post(url)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_accept_friend_request(self):
        fr = Friend.objects.add_friend(self.user1, self.user2)
        self.client.force_authenticate(user=self.user2)
        res = self.client.put(reverse('accept-request', kwargs={'pk': fr.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(Friend.objects.are_friends(self.user1, self.user2))

    def test_reject_friend_request(self):
        fr = Friend.objects.add_friend(self.user1, self.user2)
        self.client.force_authenticate(user=self.user2)
        res = self.client.put(reverse('reject-request', kwargs={'pk': fr.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(Friend.objects.are_friends(self.user1, self.user2))

    def test_cancel_friend_request(self):
        fr = Friend.objects.add_friend(self.user1, self.user2)
        res = self.client.delete(reverse('cancel-request', kwargs={'pk': fr.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(FriendshipRequest.objects.filter(id=fr.id).exists())

    def test_unfriend(self):
        Friend.objects.add_friend(self.user1, self.user2).accept()
        res = self.client.delete(reverse('unfriend', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(Friend.objects.are_friends(self.user1, self.user2))

    def test_friend_list(self):
        Friend.objects.add_friend(self.user1, self.user2).accept()
        res = self.client.get(reverse('friends-list'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - FOLLOW
# =====================================================================
class FollowAPITest(APITestCase):
    def setUp(self):
        self.user1 = make_user('jack')
        self.user2 = make_user('kate')
        self.profile2 = Profile.objects.get(user=self.user2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user1)

    def test_follow_user(self):
        res = self.client.post(reverse('follow', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Follow.objects.follows(self.user1, self.user2))

    def test_cannot_follow_self(self):
        profile1 = Profile.objects.get(user=self.user1)
        res = self.client.post(reverse('follow', kwargs={'pk': profile1.id}))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_follow_twice(self):
        Follow.objects.add_follower(self.user1, self.user2)
        res = self.client.post(reverse('follow', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unfollow_user(self):
        Follow.objects.add_follower(self.user1, self.user2)
        res = self.client.delete(reverse('unfollow', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(Follow.objects.follows(self.user1, self.user2))

    def test_followers_list(self):
        Follow.objects.add_follower(self.user2, self.user1)
        res = self.client.get(reverse('followers'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_following_list(self):
        Follow.objects.add_follower(self.user1, self.user2)
        res = self.client.get(reverse('following'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - BLOCK
# =====================================================================
class BlockAPITest(APITestCase):
    def setUp(self):
        self.user1 = make_user('leo')
        self.user2 = make_user('mia')
        self.profile2 = Profile.objects.get(user=self.user2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user1)

    def test_block_user(self):
        res = self.client.post(reverse('block', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Block.objects.is_blocked(self.user1, self.user2))

    def test_block_removes_friendship(self):
        Friend.objects.add_friend(self.user1, self.user2).accept()
        self.client.post(reverse('block', kwargs={'pk': self.profile2.id}))
        self.assertFalse(Friend.objects.are_friends(self.user1, self.user2))

    def test_block_removes_follow(self):
        Follow.objects.add_follower(self.user1, self.user2)
        self.client.post(reverse('block', kwargs={'pk': self.profile2.id}))
        self.assertFalse(Follow.objects.follows(self.user1, self.user2))

    def test_cannot_block_self(self):
        profile1 = Profile.objects.get(user=self.user1)
        res = self.client.post(reverse('block', kwargs={'pk': profile1.id}))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unblock_user(self):
        Block.objects.add_block(self.user1, self.user2)
        res = self.client.delete(reverse('unblock', kwargs={'pk': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(Block.objects.is_blocked(self.user1, self.user2))

    def test_blocked_user_list(self):
        Block.objects.add_block(self.user1, self.user2)
        res = self.client.get(reverse('listblockfromuser'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - CHAT
# =====================================================================
class ChatAPITest(APITestCase):
    def setUp(self):
        self.user1 = make_user('noah')
        self.user2 = make_user('olivia')
        Friend.objects.add_friend(self.user1, self.user2).accept()
        self.profile2 = Profile.objects.get(user=self.user2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user1)

    def _start_conv(self):
        res = self.client.post(reverse('conversation-start', kwargs={'user_id': self.profile2.id}))
        return res.data['id']

    def test_start_conversation(self):
        res = self.client.post(reverse('conversation-start', kwargs={'user_id': self.profile2.id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(Conversation.objects.exists())

    def test_start_conversation_idempotent(self):
        url = reverse('conversation-start', kwargs={'user_id': self.profile2.id})
        id1 = self.client.post(url).data['id']
        id2 = self.client.post(url).data['id']
        self.assertEqual(id1, id2)

    def test_cannot_chat_with_self(self):
        profile1 = Profile.objects.get(user=self.user1)
        res = self.client.post(reverse('conversation-start', kwargs={'user_id': profile1.id}))
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_send_message(self):
        conv_id = self._start_conv()
        res = self.client.post(reverse('send-message', kwargs={'pk': conv_id}), {'content': 'Hello!'})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Message.objects.filter(conversation_id=conv_id).count(), 1)

    def test_list_messages(self):
        conv_id = self._start_conv()
        self.client.post(reverse('send-message', kwargs={'pk': conv_id}), {'content': 'msg1'})
        self.client.post(reverse('send-message', kwargs={'pk': conv_id}), {'content': 'msg2'})
        res = self.client.get(reverse('message-list', kwargs={'pk': conv_id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_unsend_message(self):
        conv_id = self._start_conv()
        msg_id = self.client.post(
            reverse('send-message', kwargs={'pk': conv_id}), {'content': 'delete me'}
        ).data['id']
        res = self.client.delete(reverse('unsend-message', kwargs={'pk': msg_id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_cannot_unsend_others_message(self):
        conv_id = self._start_conv()
        self.client.force_authenticate(user=self.user2)
        msg_id = self.client.post(
            reverse('send-message', kwargs={'pk': conv_id}), {'content': 'from user2'}
        ).data['id']
        self.client.force_authenticate(user=self.user1)
        res = self.client.delete(reverse('unsend-message', kwargs={'pk': msg_id}))
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_seen_message(self):
        conv_id = self._start_conv()
        self.client.post(reverse('send-message', kwargs={'pk': conv_id}), {'content': 'hi'})
        res = self.client.post(reverse('mark-message-seen', kwargs={'pk': conv_id}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_conversation_list(self):
        self._start_conv()
        res = self.client.get(reverse('conversation-list'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)


# =====================================================================
# API TESTS - NOTIFICATION
# =====================================================================
class NotificationAPITest(APITestCase):
    def setUp(self):
        self.user = make_user('peter')
        self.actor = make_user('quinn')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_notifications(self):
        Notification.objects.create(reciever=self.user, actor=self.actor, type='follow', message='followed')
        Notification.objects.create(reciever=self.user, actor=self.actor, type='comment', message='commented')
        res = self.client.get(reverse('notification-list'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 2)

    def test_only_own_notifications(self):
        other = make_user('rachel')
        Notification.objects.create(reciever=other, actor=self.actor, type='follow', message='test')
        res = self.client.get(reverse('notification-list'))
        self.assertEqual(res.data['count'], 0)

    def test_unauthenticated_blocked(self):
        self.client.force_authenticate(user=None)
        res = self.client.get(reverse('notification-list'))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


# =====================================================================
# API TESTS - PROFILE RELATIONSHIP
# =====================================================================
class ProfileRelationshipAPITest(APITestCase):
    def setUp(self):
        self.user1 = make_user('sam')
        self.user2 = make_user('tina')
        self.profile2 = Profile.objects.get(user=self.user2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user1)

    def _get_status(self):
        res = self.client.get(f'/api/user/relationship/{self.profile2.id}/')  # sesuaikan url jika ada
        return res.data.get('status')

    def test_myself(self):
        profile1 = Profile.objects.get(user=self.user1)
        res = self.client.get(f'/api/user/relationship/{profile1.id}/')
        self.assertEqual(res.data['status'], 'myself')

    def test_none_relationship(self):
        res = self.client.get(f'/api/user/relationship/{self.profile2.id}/')
        self.assertEqual(res.data['status'], 'none')

    def test_friend_status(self):
        Friend.objects.add_friend(self.user1, self.user2).accept()
        res = self.client.get(f'/api/user/relationship/{self.profile2.id}/')
        self.assertEqual(res.data['status'], 'friend')

    def test_request_sent_status(self):
        Friend.objects.add_friend(self.user1, self.user2)
        res = self.client.get(f'/api/user/relationship/{self.profile2.id}/')
        self.assertEqual(res.data['status'], 'request_sent')