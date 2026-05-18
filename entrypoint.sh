#!/bin/bash
set -e

# 创建必要目录
mkdir -p /app/data/spec_cache
mkdir -p /home/appuser/.config/mijia-api

# 确保 config.json 存在（首次启动时 volume 可能为空）
if [ ! -f /app/config.json ]; then
    cat > /app/config.json << 'CONFIGEOF'
{
    "cloud": {
        "username": "",
        "password": "",
        "country": "cn",
        "serviceToken": "",
        "userId": "",
        "passToken": "",
        "ssecurity": ""
    },
    "local_devices": [],
    "default_control_mode": "cloud",
    "cors_origins": ""
}
CONFIGEOF
fi

# 确保挂载目录权限正确
chown -R appuser:appuser /app/data /home/appuser/.config 2>/dev/null || true

echo "Starting Mijiakongzhi server..."

# 使用 exec 替换当前 shell，确保信号正确转发给 uvicorn
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1 \
    --log-level info \
    --proxy-headers \
    --forwarded-allow-ips '*'
