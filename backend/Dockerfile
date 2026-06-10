
#Dùng build APP để đóng gói chạy ở bất kì đâu và deploy
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=backend.settings

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


# Cài Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code// khi source code/requirements thay đổi sẽ build lại và xóa xây lại hết
COPY . .

#Tạo sẵn các thư mục mà Volume sẽ mount vào, sau đó tạo user và phân quyền CHÍNH XÁC toàn bộ thư mục gốc.
RUN mkdir -p /app/staticfiles /app/logs /app/backups /app/media && \
    useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

#dùng user non root
USER appuser
EXPOSE 8000

# Entrypoint chạy migrate + collectstatic trước, sau đó mới chạy CMD
ENTRYPOINT ["sh", "-c", "\
    echo '==> [1/3] Running migrations...' && \
    python manage.py migrate --noinput && \
    echo '==> [2/3] Collecting static files...' && \
    python manage.py collectstatic --noinput && \
    echo '==> [3/3] Starting server...' && \
    exec \"$@\"", "--"]

# ASGI vì có Channels WebSocket
CMD ["granian", \
     "--interface", "asginl", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "3", \
     "--runtime-threads", "6", \
     "--backlog", "2048", \
     "--http", "1", \
     "backend.asgi:application"]