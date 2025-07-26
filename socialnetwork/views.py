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

