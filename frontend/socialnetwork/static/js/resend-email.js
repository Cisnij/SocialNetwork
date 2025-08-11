
const search = new URLSearchParams(window.location.search)
const email = search.get('email')
const url= 'http://localhost:8000/api/auth/registration/resend-email/'

document.getElementById('resend-email-btn').addEventListener('click',()=>{
    const msg = document.getElementById('resend-message');
    const btn = document.getElementById('resend-email-btn');
    if(!email){
        msg.textContent = 'Không tìm thấy email để gửi lại.';
        msg.className = 'text-red-500 mb-6 text-sm';
        return;
    } 
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';
    msg.textContent = '';

    fetch(url,{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({email})
    })
    .then(res => {
        if (res.ok) return res.json();
        throw new Error('Lỗi khi gửi email');
    })
    .then(data => {
        msg.textContent = 'Email xác minh đã được gửi lại. Vui lòng kiểm tra hộp thư.';
        msg.className = 'text-green-400 mb-6 text-sm';
    })
    .catch(error => {
        msg.textContent = 'Gửi email thất bại, vui lòng thử lại sau.';
        msg.className = 'text-red-500 mb-6 text-sm';
    })
    .finally(() => {
        btn.disabled = false;
        btn.textContent = 'Gửi lại email xác minh';
    });
})

