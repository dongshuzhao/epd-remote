# 墨水屏远程管理服务（amd64）
FROM --platform=linux/amd64 python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    EPD_DATA_DIR=/data \
    EPD_FRONTEND_DIR=/app/frontend \
    EPD_PORT=8655

# bleak 通过 D-Bus 使用 BlueZ。宿主机没装 BlueZ 时（如 Unraid），
# 由 docker-entrypoint.sh 在容器内起 dbus-daemon + bluetoothd。
RUN apt-get update \
    && apt-get install -y --no-install-recommends libdbus-1-3 dbus bluez \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

COPY backend /app/backend
COPY frontend /app/frontend

VOLUME ["/data"]
EXPOSE 8655

ENTRYPOINT ["/app/docker-entrypoint.sh"]
# 用 host 网络时宿主机端口可能已被占用，EPD_PORT 可换端口
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${EPD_PORT:-8655}"]
