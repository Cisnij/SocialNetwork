from django.shortcuts import render
from django.contrib.auth.decorators import login_required
# Create your views here.
from django.shortcuts import render

# Create your views here.

def getBase(request):
    context={}
    return render(request, 'app/home.html', context)
def getLogin(request):
    context={}
    return render(request,'authenticate/login.html',context)
def getRegister(request):
    context={}
    return render(request, 'authenticate/register.html', context)
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