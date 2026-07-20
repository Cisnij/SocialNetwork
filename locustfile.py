import random
import uuid
import json
import math
import gevent
import websocket
from locust import HttpUser, task, between, events, LoadTestShape

NUM_TEST_USERS = 10
WS_URL = "wss://api.socialnetwork.dpdns.org"

class SocialNetworkUser(HttpUser):
    # Rút ngắn thời gian chờ để đẩy RPS lên cao nhất có thể (chế độ spam)
    wait_time = between(0.1, 0.5)

    def safe_get(self, url, **kwargs):
        """Helper để bỏ qua các lỗi 4xx do business logic"""
        with self.client.get(url, catch_response=True, **kwargs) as res:
            if res.status_code in (200, 201, 204, 400, 403, 404):
                res.success()
            return res

    def safe_post(self, url, **kwargs):
        with self.client.post(url, catch_response=True, **kwargs) as res:
            if res.status_code in (200, 201, 204, 400, 403, 404):
                res.success()
            return res

    def safe_put(self, url, **kwargs):
        with self.client.put(url, catch_response=True, **kwargs) as res:
            if res.status_code in (200, 201, 204, 400, 403, 404):
                res.success()
            return res

    def safe_patch(self, url, **kwargs):
        with self.client.patch(url, catch_response=True, **kwargs) as res:
            if res.status_code in (200, 201, 204, 400, 403, 404):
                res.success()
            return res

    def safe_delete(self, url, **kwargs):
        with self.client.delete(url, catch_response=True, **kwargs) as res:
            if res.status_code in (200, 201, 204, 400, 403, 404):
                res.success()
            return res

    def on_start(self):
        self.user_id = None
        self.token = None
        
        self.friend_ids = set()
        self.blocked_ids = set()
        self.pending_incoming = set()
        self.feed_posts = set()
        self.conversations = set()

        self.login()
        if self.token:
            self.fetch_initial_state()

    def login(self):
        user_index = random.randint(1, NUM_TEST_USERS)
        email = f"testuser{user_index}@example.com"
        password = f"SecureP@ss{user_index}!2024"
        
        res = self.client.post("/api/auth/login/", json={"email": email, "password": password, "username": email})
        if res.status_code == 200:
            data = res.json()
            # dj-rest-auth với SimpleJWT thường trả về field "access"
            self.token = data.get("access") or data.get("access_token") or data.get("key") or data.get("token")
            if self.token:
                self.client.headers.update({"Authorization": f"Bearer {self.token}"})

    def fetch_initial_state(self):
        res = self.safe_get("/api/user/", name="/api/user/")
        if res.status_code == 200: self.user_id = res.json().get("id")

        res = self.safe_get("/api/friends/", name="/api/friends/")
        if res.status_code == 200:
            data = res.json()
            results = data.get("results") if isinstance(data, dict) and "results" in data else data
            if isinstance(results, list):
                for f in results:
                    if isinstance(f, dict):
                        fid = f.get("id") or f.get("friend_id") or f.get("profile", {}).get("id")
                        if fid: self.friend_ids.add(fid)

        res = self.safe_get("/api/block/user/", name="/api/block/user/")
        if res.status_code == 200:
            data = res.json()
            results = data.get("results") if isinstance(data, dict) and "results" in data else data
            if isinstance(results, list):
                for b in results:
                    if isinstance(b, dict):
                        bid = b.get("id") or b.get("blocked_user", {}).get("id")
                        if bid: self.blocked_ids.add(bid)
                
        res = self.safe_get("/api/friends/requests/incoming/", name="/api/friends/requests/incoming/")
        if res.status_code == 200:
            data = res.json()
            results = data.get("results") if isinstance(data, dict) and "results" in data else data
            if isinstance(results, list):
                for r in results:
                    if isinstance(r, dict) and r.get("id"): 
                        self.pending_incoming.add(r.get("id"))

    # ==================== HEAVY CORE APIs (Trọng số cao) ====================
    @task(10)
    def view_feed_heavy(self):
        if not self.token: return
        res = self.safe_get("/api/user/post/show/", name="/api/user/post/show/")
        if res.status_code == 200:
            data = res.json()
            results = data.get("results") if isinstance(data, dict) and "results" in data else data
            if isinstance(results, list):
                for p in results:
                    if p.get("id"): self.feed_posts.add(p.get("id"))

    @task(6)
    def ws_chat_connection_heavy(self):
        if not self.token or not self.conversations: return
        conv_id = random.choice(list(self.conversations))
        try:
            ws = websocket.WebSocket()
            ws.connect(f"{WS_URL}/ws/chat/{conv_id}/", timeout=5)
            ws.send(json.dumps({"message": "Locust ws chat", "message_type": "text"}))
            ws.close()
        except Exception: pass

    @task(5)
    def react_and_comment_heavy(self):
        if not self.token or not self.feed_posts: return
        post_id = random.choice(list(self.feed_posts))
        self.safe_post(f"/api/posts/{post_id}/react/", json={"reaction_type": random.choice(["like", "love", "haha"])}, name="/api/posts/[id]/react/")
        self.safe_post(f"/api/user/comments/post/{post_id}/", json={"content": f"Locust comment {uuid.uuid4()}"}, name="/api/user/comments/post/[id]/")

    @task(3)
    def create_and_share_heavy(self):
        if not self.token: return
        self.safe_post("/api/user/post/create/", json={"content": f"Test post {uuid.uuid4()}", "privacy": "public"}, name="/api/user/post/create/")
        if self.feed_posts:
            post_id = random.choice(list(self.feed_posts))
            self.safe_post(f"/api/posts/{post_id}/share/", json={"content": "Shared by locust", "privacy": "public"}, name="/api/posts/[id]/share/")

    # ==================== SECONDARY APIs (Trọng số thấp) ====================
    # --- Profile & Settings ---
    @task(1)
    def view_profile(self):
        if not self.token: return
        target_id = random.randint(1, NUM_TEST_USERS)
        self.safe_get(f"/api/auth/profile/userpage/{target_id}", name="/api/auth/profile/userpage/[id]")
        
    @task(1)
    def update_settings(self):
        if not self.token or not self.user_id: return
        self.safe_patch(f"/api/user/setting/{self.user_id}/", json={"theme": random.choice(["dark", "light"])}, name="/api/user/setting/[id]/")

    # --- Notifications & Search ---
    @task(2)
    def check_notifications(self):
        if not self.token: return
        self.safe_get("/api/notifications/", name="/api/notifications/")
        self.safe_get("/api/notifications/count/", name="/api/notifications/count/")

    @task(2)
    def perform_search(self):
        if not self.token: return
        self.safe_get("/api/search/?q=user", name="/api/search/")

    # --- Friends & Relationships ---
    @task(1)
    def friend_interactions(self):
        if not self.token or not self.user_id: return
        target_id = random.randint(1, NUM_TEST_USERS)
        if target_id != self.user_id:
            self.safe_post(f"/api/friends/request/{target_id}/", name="/api/friends/request/[id]/")
            self.safe_post(f"/api/follow/{target_id}/", name="/api/follow/[id]/")
            self.safe_get(f"/api/relationship/{target_id}/", name="/api/relationship/[id]/")
            
    @task(1)
    def handle_friend_requests(self):
        if not self.token or not self.pending_incoming: return
        req_id = random.choice(list(self.pending_incoming))
        self.safe_post(f"/api/friends/request/{req_id}/accept/", name="/api/friends/request/[id]/accept/")
        self.pending_incoming.discard(req_id)

    # --- Chat Operations ---
    @task(1)
    def fetch_messages(self):
        if not self.token or not self.conversations: return
        conv_id = random.choice(list(self.conversations))
        self.safe_get(f"/api/chat/messages/list/{conv_id}/", name="/api/chat/messages/list/[id]/")

    @task(1)
    def start_new_conversation(self):
        if not self.token or not self.user_id: return
        target_id = random.randint(1, NUM_TEST_USERS)
        if target_id != self.user_id:
            res = self.safe_post(f"/api/chat/start/{target_id}/", name="/api/chat/start/[id]/")
            if res.status_code in (200, 201) and res.json().get("id"):
                self.conversations.add(res.json().get("id"))

    # --- Photo & Article ---
    @task(1)
    def view_photos_and_articles(self):
        if not self.token: return
        self.safe_get("/api/user/post-photo/", name="/api/user/post-photo/")
        self.safe_get("/api/user/post-article/", name="/api/user/post-article/")

    # --- Profile & Auth Settings ---
    @task(1)
    def auth_and_profile_advanced(self):
        if not self.token or not self.user_id: return
        self.safe_patch(f"/api/user/profile/{self.user_id}/", json={"bio": f"Stress test {uuid.uuid4()}"}, name="/api/user/profile/[id]/")
        self.safe_get("/api/user/profile/", name="/api/user/profile/")
        self.safe_get("/api/user/email/", name="/api/user/email/")
        self.safe_get("/api/user/setting/", name="/api/user/setting/")

    # --- Advanced Posts Interactions ---
    @task(2)
    def advanced_post_interactions(self):
        if not self.token or not self.feed_posts: return
        post_id = random.choice(list(self.feed_posts))
        self.safe_post(f"/api/post/{post_id}/privacy-change/", json={"privacy": "friends"}, name="/api/post/[id]/privacy-change/")
        self.safe_post(f"/api/post/{post_id}/pin/", name="/api/post/[id]/pin/")

    # --- Comment Interactions ---
    @task(3)
    def comment_interactions(self):
        if not self.token or not self.feed_posts: return
        post_id = random.choice(list(self.feed_posts))
        res = self.safe_get(f"/api/user/comments/post/{post_id}/", name="/api/user/comments/post/[id]/")
        if res.status_code == 200:
            data = res.json()
            results = data.get("results") if isinstance(data, dict) and "results" in data else data
            if isinstance(results, list) and len(results) > 0:
                comment = random.choice(results)
                if isinstance(comment, dict) and comment.get("id"):
                    cid = comment.get("id")
                    self.safe_post(f"/api/comments/{cid}/react/", json={"reaction_type": "like"}, name="/api/comments/[id]/react/")
                    self.safe_get(f"/api/user/nested-comments/{cid}/", name="/api/user/nested-comments/[id]/")

    # --- Friends, Follow, Block ---
    @task(1)
    def friends_and_follow_advanced(self):
        if not self.token: return
        self.safe_get("/api/followers/", name="/api/followers/")
        self.safe_get("/api/following/", name="/api/following/")
        self.safe_get("/api/user/friend-suggest/", name="/api/user/friend-suggest/")
        if getattr(self, 'blocked_ids', None):
            bid = random.choice(list(self.blocked_ids))
            self.safe_post(f"/api/unblock/{bid}/", name="/api/unblock/[id]/")
            self.blocked_ids.discard(bid)

    # --- Advanced Chat ---
    @task(2)
    def advanced_chat(self):
        if not self.token or not getattr(self, 'conversations', None): return
        conv_id = random.choice(list(self.conversations))
        self.safe_post(f"/api/chat/conversation/{conv_id}/toogle-hidden/", name="/api/chat/conversation/[id]/toogle-hidden/")
        self.safe_get("/api/chat/conversation/hidden-chat/", name="/api/chat/conversation/hidden-chat/")

    # --- System & Search Logs ---
    @task(1)
    def system_and_logs(self):
        if not self.token: return
        self.safe_get("/api/user/search-history/", name="/api/user/search-history/")
        self.safe_get("/api/user/activity/", name="/api/user/activity/")


# ==================== STRESS TEST LOAD SHAPE ====================
class StressTestShape(LoadTestShape):
    """
    Kịch bản Stress Test thuần túy: Tập trung tối đa vào Concurrency (số lượng người dùng đồng thời) và RPS.
    Không tự động ngắt, mục tiêu là để dồn ép server trong thời gian dài.
    """
    stages = [
        {"duration": 60, "users": 100, "spawn_rate": 20},     # 1 phút đầu: Khởi động 100 users
        {"duration": 180, "users": 500, "spawn_rate": 50},    # Tăng lên 500 users
        {"duration": 300, "users": 1000, "spawn_rate": 100},  # Ép tải mạnh: 1000 users đồng thời
        {"duration": 600, "users": 3000, "spawn_rate": 200},  # Đỉnh điểm Stress Test: 3000 users
        {"duration": 900, "users": 5000, "spawn_rate": 200},  # Thử nghiệm giới hạn cực đại: 5000 users
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
        return None # Kết thúc test sau 15 phút (900s)

# ==================== METRICS OUTPUT ====================
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    print("=== BẮT ĐẦU QUÁ TRÌNH STRESS TEST HẠNG NẶNG ===")
    print("Mục tiêu: Đẩy tối đa Concurrency và RPS.")

@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    print("\n" + "="*50)
    print("=== BÁO CÁO TỔNG KẾT STRESS TEST ===")
    print(f"Max Concurrency (Đỉnh điểm số lượng User): {environment.runner.user_count} users")
    print(f"Tổng số Requests (Total Hits): {environment.runner.stats.total.num_requests}")
    print(f"RPS Trung bình (Requests per second): {environment.runner.stats.total.total_rps:.2f} req/s")
    print(f"Tỷ lệ lỗi (Error Rate) khi chịu tải: {environment.runner.stats.total.fail_ratio:.2%}")
    print("="*50 + "\n")

