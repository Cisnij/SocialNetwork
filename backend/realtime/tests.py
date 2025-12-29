from django.test import TestCase

# Create your tests here.
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from backend.asgi import application

class SimpleWebSocketTest(TransactionTestCase):

    async def test_ws_connect_and_send(self):
        ws = WebsocketCommunicator(
            application,
            "/ws/chat/test/"
        )

        connected, _ = await ws.connect()
        self.assertTrue(connected)

        await ws.send_json_to({"message": "hello"})
        response = await ws.receive_json_from()

        self.assertEqual(response["message"], "hello")

        await ws.disconnect()
