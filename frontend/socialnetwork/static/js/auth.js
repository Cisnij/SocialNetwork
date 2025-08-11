let accessToken=localStorage.getItem('accessToken');


async function refreshAccessToken() { // Hàm này sẽ được gọi khi access token hết hạn, dùng refresh gọi 
  if(!refreshToken){
    throw new Error('No refresh token found');
  }
  else{
    const res = await fetch('http://localhost:8000/api/auth/web/token/refresh/',{
        method:'POST',
        credentials:'include',
        headers:{
            'Content-Type':'application/json',
            
        },
        body: JSON.stringify({refresh: refreshToken})
    })
    if(!res.ok){
        throw new Error('Refresh token expired');
    }
    const data = await res.json();
    accessToken=data.access;
    localStorage.setItem('accessToken', accessToken);
  }
}

//Hàm này sẽ dùng để gọi tới api với access token đã được xác thực, nếu k sẽ xử lý 
async function authFetch(url, options={}){ // truyền vào đây url, options là một object chứa các tùy chọn như method, headers, body
    if (!accessToken) {
        try{
            await refreshAccessToken(); // nếu không có access token thì gọi hàm refreshAccessToken để lấy access token mới
        }
        catch (error) {
            logout();
            throw error;
        }
    }
    let res = await fetch(url,{
        ...options, // dùng để lấy các tùy chọn , ở đây là method
        headers:{
            ...options.headers, // nếu có headers thì sẽ lấy các headers đó
            Authorization: `Bearer ${accessToken}`
        }
    })
    if(res.status === 401){// nếu trả về 401 thì token đã hết hạn, gọi lại hàm refreshAccessToken để lấy token mới
        try{
            await refreshAccessToken();
        }catch(e){
            logout();
            throw e;
        }
        
        res = await fetch(url,{ //Nếu bị lỗi thì phải gọi lai hèm fetch để lấy lại token mới
            ...options,
            headers:{
                ...options.headers,
                Authorization: `Bearer ${accessToken}`
            },
        });    
    } 
    return res 
}

function checkLogin(){
    return !!accessToken; // Kiểm tra xem người dùng đã đăng nhập hay chưa, nếu có cả accessToken và refreshToken thì trả về true
}

function RedirectIfAuth(){ // Nếu đã đăng nhập thì chuyển hướng về trang chính
    if (checkLogin()) {
        window.location.href = 'http://localhost:3000/'; 
    }
}
function logout(){
    accessToken=null;
    refreshToken=null;
    localStorage.removeItem('accessToken');
    window.location.href = 'http://localhost:3000/login'; // Chuyển hướng về trang đăng nhập
}
export{refreshAccessToken,authFetch,RedirectIfAuth,logout};