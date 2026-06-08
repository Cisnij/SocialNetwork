FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Cài system deps — mysqlclient cần gcc
RUN apt-get update && apt-get install -y \
    gcc \
    default-libmysqlclient-dev \
    pkg-config \
    curl \
    libmagic1 \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

# Cài Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# ASGI vì có Channels WebSocket
CMD ["granian", \
     "--interface", "asgi", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "6", \
     "--runtime-threads", "12", \
     "--backlog", "2048", \
     "--http", "1", \
     "backend.asgi:application"]