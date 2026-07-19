#!/bin/bash
set -e  # dừng ngay nếu có lệnh nào lỗi

echo "==> Pulling latest code..."
git pull origin main

echo "==> Building images..."
docker compose build

echo "==> Recreating containers..."
docker compose up -d

echo "==> Running migrations..."
docker compose exec -T django python manage.py migrate --noinput

echo "==> Collecting static files..."
docker compose exec -T django python manage.py collectstatic --noinput

echo "==> Deploy done!"