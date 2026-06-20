from google import genai
from backend.env_config import env

_client = genai.Client(api_key=env('GEMINI_API_KEY')) #taọ client với api key

def get_gemini_reply(message:str) ->str: #nhận string trả string
    try:
        response = _client.models.generate_content(
            model='gemini-2.5-flash',
            contents=message
        ) # gửi input lên model
        return response.text #nhận output
    except Exception:
        return "Xin lỗi, tôi đang gặp sự cố. Vui lòng thử lại sau."
