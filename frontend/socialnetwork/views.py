from django.shortcuts import render
from django.contrib.auth.decorators import login_required
# Create your views here.
from django.shortcuts import render

# Create your views here.

def getBase(request):
    context={}
    return render(request, 'base.html', context)
def getLogin(request):
    context={}
    return render(request,'login.html',context)
def getRegister(request):
    context={}
    return render(request, 'register.html', context)
def getAbout(request):
    return render(request, 'about.html')
def getSuccessRegis(request):
    return render(request, 'success_regis.html')
def getEmailVerified(request):
    return render(request,'email-verified.html')
def getResetPasswd(request):
    return render(request, 'reset-passwd.html')
def getLocked(request):
    return render(request, 'locked.html')
def getGoogleCallback(request):
    return render(request, 'google-login.html')
def getForgotPasswd(request):
    return render(request, 'forgot-password.html')
def getPasswordReset(request):
    return render(request, 'password-reset.html')