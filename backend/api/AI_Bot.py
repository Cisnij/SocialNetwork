
from google import genai
from google.genai import types
from backend.env_config import env

# api_key = env("GEMINI_API_KEY").strip()
api_key= 'AQ.Ab8RN6I8Ymso6rBYKsLAQHab7bFMNmV_qy5GJ6dLgHO-ChtjwA'


_client = genai.Client(api_key=api_key) #taọ client với api key
async def get_gemini_reply(message:str, sender_name:str ,old_messages:str) ->str: #nhận string trả string
    SYSTEM_PROMPT = f"""
        Bạn là một trợ lý AI cho MXH doanh nghiệp, bạn chỉ có thể nhớ được ngữ cảnh 10 tin nhắn gần nhất theo thứ tự giảm dần thgian
        User có tên hiện tại là {sender_name}
        Đây là những message tôi và bạn chat 10 tin gần nhất {old_messages}
    """
    try:
        response = await _client.aio.models.generate_content( # gửi input lên model
            model='gemini-2.5-flash',
            contents=message,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT, # hướng dẫn hệ thống
                temperature=0.3 # độ cẩn thận, càng thấp càng cẩn thận, càng cao thì càng sáng tạo
            )
        )
        return response.text #nhận output
    except Exception as e:
        print(f"Gemini error: {e}")
        return "Xin lỗi, tôi đang gặp sự cố. Vui lòng thử lại sau."
