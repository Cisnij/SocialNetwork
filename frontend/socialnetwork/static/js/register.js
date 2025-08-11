// import {checkLogin} from './auth.js'
document.getElementById('register-form').addEventListener('submit',function(e){
    e.preventDefault();
    const firstname = document.getElementById('first_name').value.trim()
    const lastname = document.getElementById('last_name').value.trim()
    const email=document.getElementById('email').value.trim()
    const phone_number =document.getElementById('phone_number').value.trim()
    const password1 =document.getElementById('password1').value.trim()
    const password2 =document.getElementById('password2').value.trim()
    const birthday =document.getElementById('birthday').value.trim()
    const errorDiv = document.getElementById('login-error');
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
    if(password1!==password2){
        errorDiv.textContent = 'Mật khẩu không khớp';
        errorDiv.classList.remove('hidden');
        document.getElementById('password1').value = '';
        document.getElementById('password2').value = '';
        return
    }
    const data = {
        email: email,
        firstname: firstname,
        lastname: lastname,
        phone_number: phone_number,
        birthday: birthday,
        password1: password1,
        password2: password2
    };
    const url_register='http://localhost:8000/api/auth/registration/'
    fetch(url_register,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body:JSON.stringify(data)
    })
    .then(async response => {
        let data = {};
        try {
            data = await response.json();
        } catch (err) {
            console.error("Không thể parse JSON:", err);
        }

        if (response.status === 201) {
            window.location.href = `http://localhost:3000/email-verified-send/?email=${encodeURIComponent(email)}`;//Phải có ?email để lấy ra và encodeuri là để lấy kí tự đặc biệt
        } else {
            let messages = '';
            for (let field in data) {
                if (Array.isArray(data[field])) {
                    messages += field + ':'+ " " + data[field].join(', ') + '\n';
                } else {
                    messages += data[field] + '\n';
                }
            }
            errorDiv.textContent = messages.trim() || 'Đã xảy ra lỗi, vui lòng thử lại.';
            errorDiv.classList.remove('hidden');
        }
})
    .then(data=>{})
    .catch(error=>console.error('Error:',error))
})