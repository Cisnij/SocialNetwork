import { RedirectIfAuth } from './auth.js';
RedirectIfAuth();

// =====================================================
// Compose E.164: +<countryCode><localNumber>
// Strip leading zeros from local number (country code already has +)
// E.g. +84 + "0901234567" → +84901234567
//      +1  + "2025551234" → +12025551234
// =====================================================
function toE164(countryCode, rawLocal) {
  // Remove all non-digit characters
  let digits = rawLocal.replace(/\D/g, '');
  // Remove leading zeros (local numbers shouldn't include country code prefix)
  digits = digits.replace(/^0+/, '');
  return `${countryCode}${digits}`;
}

// =====================================================
// Error / clear
// =====================================================
function showError(msg) {
  const el = document.getElementById('regError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
  const el = document.getElementById('regError');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

// =====================================================
// Submit
// =====================================================
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const btn         = document.getElementById('submitBtn');
  const firstname   = document.getElementById('rFirstName')?.value.trim() ?? '';
  const lastname    = document.getElementById('rLastName')?.value.trim()  ?? '';
  const email       = document.getElementById('rEmail')?.value.trim()     ?? '';
  const countryCode = document.getElementById('rCountryCode')?.value      ?? '+84';
  const rawPhone    = document.getElementById('rPhone')?.value.trim()     ?? '';
  const birthday    = document.getElementById('rBirthday')?.value.trim()  ?? '';
  const password1   = document.getElementById('rPw1')?.value              ?? '';
  const password2   = document.getElementById('rPw2')?.value              ?? '';

  // ---- Client-side validation ----
  if (!firstname || !lastname) {
    showError('Vui lòng nhập đầy đủ họ và tên.');
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('Vui lòng nhập địa chỉ email hợp lệ.');
    return;
  }
  if (!rawPhone) {
    showError('Vui lòng nhập số điện thoại.');
    return;
  }

  const phone_number = toE164(countryCode, rawPhone);

  // Validate E.164 basic format: + followed by 7–15 digits
  if (!/^\+[1-9]\d{6,14}$/.test(phone_number)) {
    showError('Số điện thoại không hợp lệ. Vui lòng kiểm tra lại.');
    return;
  }

  if (!birthday) {
    showError('Vui lòng nhập ngày sinh.');
    return;
  }
  if (password1.length < 8) {
    showError('Mật khẩu phải có ít nhất 8 ký tự.');
    return;
  }
  if (password1 !== password2) {
    showError('Mật khẩu không khớp. Vui lòng kiểm tra lại.');
    document.getElementById('rPw2').value = '';
    return;
  }

  // ---- CSRF ----
  const getCSRF = () => {
    for (const part of document.cookie.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === 'csrftoken') return decodeURIComponent(v);
    }
    return '';
  };

  const payload = {
    email,
    firstname,
    lastname,
    phone_number,  // E.164: e.g. +84901234567
    birthday,
    password1,
    password2,
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Đang xử lý...'; }

  try {
    const res = await fetch('http://localhost:80/api/auth/registration/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCSRF(),
      },
      body: JSON.stringify(payload),
    });

    let data = {};
    try { data = await res.json(); } catch { /* empty */ }

    if (res.status === 201) {
      window.location.href =
        `http://localhost:3000/email-verified-send/?email=${encodeURIComponent(email)}`;
      return;
    }

    // Collect backend error messages
    const lines = [];
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val)) {
        lines.push(...val.map(String));
      } else if (typeof val === 'string') {
        lines.push(val);
      }
    }
    showError(lines.join('\n') || 'Đã xảy ra lỗi. Vui lòng thử lại.');
  } catch {
    showError('Lỗi kết nối. Vui lòng kiểm tra mạng và thử lại.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Đăng ký'; }
  }
});