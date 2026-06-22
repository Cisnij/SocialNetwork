from api.models import Message
from google import genai
from backend.env_config import env

# api_key = env("GEMINI_API_KEY").strip()
api_key= 'AQ.Ab8RN6KrbsiU16IFTvdNG1-CbQWGw4L6MQYS1IdkCsfr-Mlc8Q'

# messages = Message.objects.filter(
#     conversation__conversationmember__user_email='chatbot@system.com'
# ).order_by('-created_at')[:10]

_client = genai.Client(api_key=api_key) #taọ client với api key
async def get_gemini_reply(message:str, sender_name:str) ->str: #nhận string trả string
    SYSTEM_PROMPT = [
        "Bạn là một trợ lý AI cho MXH doanh nghiệp, bạn chỉ có thể nhớ được ngữ cảnh 10 tin nhắn gần nhất theo thứ tự giảm dần thgian"
        f"User có tên hiện tại là {sender_name}"
    ]
    try:
        response = await _client.aio.models.generate_content(
            model='gemini-2.5-flash',
            contents=message
        ) # gửi input lên model
        return response.text #nhận output
    except Exception as e:
        print(f"Gemini error: {e}")
        return "Xin lỗi, tôi đang gặp sự cố. Vui lòng thử lại sau."
