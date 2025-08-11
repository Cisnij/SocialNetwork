async function confirmEmail() {
        const resultParagraph = document.getElementById("result");
        const confirmButton = document.getElementById("confirmButton");

        resultParagraph.textContent = "Đang xác thực email...";
        resultParagraph.className = "message loading";
        confirmButton.disabled = true;

        const urlParams = new URLSearchParams(window.location.search);
        const key = urlParams.get("key");

        if (!key) {
            resultParagraph.textContent = "Không tìm thấy khóa xác thực trong URL.";
            resultParagraph.className = "message error";
            confirmButton.disabled = false;
            return;
        }

        try {
            const res = await fetch("http://127.0.0.1:8000/api/auth/registration/verify-email/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ key }),
            });

            const data = await res.json();
            if (res.ok) {
                resultParagraph.textContent ="Email đã được xác thực thành công!";
                resultParagraph.className = "message success";
                setTimeout(() => {
                    window.location.href = "/login";
                }, 1000);
                
            } else {
                resultParagraph.textContent = "Xác thực email thất bại. Vui lòng thử lại.";
                resultParagraph.className = "message error";
            }
        } catch (err) {
            resultParagraph.textContent = "Lỗi kết nối đến máy chủ.";
            resultParagraph.className = "message error";
            console.error("Lỗi xác thực:", err);
        } finally {
            confirmButton.disabled = false;
        }
    }