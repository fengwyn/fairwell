from django.contrib.auth import login
from django.shortcuts import redirect, render

from core.seeders import seed_user

from .forms import SignupForm


def signup_view(request):
    if request.user.is_authenticated:
        return redirect('home')
    if request.method == 'POST':
        form = SignupForm(request.POST)
        if form.is_valid():
            user = form.save()
            seed_user(user)
            login(request, user)
            return redirect('home')
    else:
        form = SignupForm()
    return render(request, 'registration/signup.html', {'form': form})
