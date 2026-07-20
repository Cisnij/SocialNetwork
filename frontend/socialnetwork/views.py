from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.conf import settings
from django.http import HttpResponse
import urllib.request

# Create your views here.

def getBase(request):
    context={}
    return render(request, 'app/home.html', context)
def getLogin(request):
    context={}
    return render(request,'authenticate/login.html',context)
def getRegister(request):
    return render(request, 'authenticate/register.html')
def getAbout(request):
    return render(request, 'app/about.html')
def getSuccessRegis(request):
    return render(request, 'authenticate/success_regis.html')
def getEmailVerified(request):
    return render(request,'authenticate/email-verified.html')
def getLocked(request):
    return render(request, 'authenticate/locked.html')
def getGoogleCallback(request):
    return render(request, 'authenticate/google-login.html')
def getForgotPasswd(request):
    return render(request, 'authenticate/forgot-password.html')
def getPasswordReset(request):
    return render(request, 'authenticate/password-reset.html')
def getPasswordResetDone(request):
    return render(request, 'authenticate/password-reset-done.html')
def getChangePassword(request):
    return render(request, 'authenticate/change-password.html')
def getEmailResetPassword(request):
    return render(request, 'authenticate/email-reset-password.html')
def getEmailVerifiedSend(request):
    return render(request, 'authenticate/email-verified-send.html')
def getMyProfile(request,pk):
    return render(request, 'app/myprofile.html', {"user_id": pk})
def getAddPost(request):
    return render(request, 'app/add_post.html')

def getFriends(request):
    return render(request, 'app/friends.html')

def getChat(request):
    return render(request, 'app/chat.html')

def getNotifications(request):
    return render(request, 'app/notifications.html')

def getSettings(request):
    return render(request, 'app/settings.html')

def getSearch(request):
    return render(request, 'app/search.html', {'query': request.GET.get('q', '')})

def getShares(request):
    return render(request, 'app/shares.html')

BOT_KEYWORDS = [
    'facebookexternalhit', 'twitterbot', 'telegrambot',
    'whatsapp', 'linkedinbot', 'zalo', 'pinterest', 'bingbot',
    'googlebot', 'crawler', 'spider', 'bot', 'slurp', 'duckduckbot',
]

import logging
import urllib.request
import urllib.error
import json
logger = logging.getLogger(__name__)

def getShareView(request, share_code):
    user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
    is_bot = any(bot in user_agent for bot in BOT_KEYWORDS)

    if is_bot:
        # Gọi internal API backend lấy JSON post data (không cần auth vì đây là share link public-facing)
        # Dùng endpoint không cần auth — PostShareView trả HTML, ta cần JSON từ PostShareDetailView
        # Nhưng PostShareDetailView yêu cầu auth → dùng PostShareView ở backend nhưng request JSON
        backend_url = f"{getattr(settings, 'BACKEND_URL', 'http://django:8000')}/api/share/{share_code}/"
        try:
            req = urllib.request.Request(
                backend_url,
                headers={
                    'User-Agent': request.META.get('HTTP_USER_AGENT', ''),
                    'Accept': 'text/html,application/xhtml+xml',
                    # Cho backend biết đây là internal HTTPS request để bypass SECURE_SSL_REDIRECT
                    'X-Forwarded-Proto': 'https',
                    'X-Forwarded-Host': request.get_host(),
                    'Host': request.get_host(),  # truyền host thật để backend không bị lỗi ALLOWED_HOSTS
                }
            )
            # disable auto redirect để nhận HTML thật sự
            opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
            with opener.open(req, timeout=10) as resp:
                content = resp.read().decode('utf-8')
                return HttpResponse(content, content_type='text/html; charset=utf-8')
        except urllib.error.HTTPError as e:
            logger.warning(f"Bot proxy failed HTTP {e.code} for share_code={share_code}: {e}")
        except Exception as e:
            logger.exception(f"Failed to fetch share preview from backend for share_code={share_code}: {e}")

    return render(request, 'app/share-view.html', {'share_code': share_code})

def getPostDetail(request, post_id):
    return render(request, 'app/post_detail.html', {'post_id': post_id})

def getGroupPostDetail(request, group_id, post_id):
    return render(request, 'app/post_detail.html', {'post_id': post_id, 'group_id': group_id})

def getBlocked(request):
    return render(request, 'app/blocked.html')

def getActivity(request):
    return render(request, 'app/activity.html')

def getFriendSuggest(request):
    return render(request, 'app/friend-suggest.html')

def getSearchHistory(request):
    return render(request, 'app/search-history.html')

def getSupport(request):
    return render(request, 'app/support.html')

def getRelationship(request, profile_id):
    return render(request, 'app/relationship.html', {'profile_id': profile_id})

def getAddArticle(request):
    return render(request, 'app/add_article.html')

def getTestDarkmode(request):
    return render(request, 'app/test-darkmode.html')

def getFinanceDashboard(request):
    return render(request, 'app/finance-dashboard.html')

def getGroupPage(request, group_id):
    return render(request, 'app/group.html', {'group_id': group_id})

def getGroupList(request):
    return render(request, 'app/groups.html')
