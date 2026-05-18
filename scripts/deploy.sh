#!/bin/bash
set -e

PROJECT_DIR="/opt/mijiakongzhi"

echo "============================================"
echo "  米家控制 (Mijiakongzhi) 部署脚本"
echo "============================================"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
    echo "错误: 请使用 root 或 sudo 运行此脚本"
    exit 1
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装"
    echo "请先运行: curl -fsSL https://get.docker.com | bash"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "错误: Docker Compose 插件未安装"
    exit 1
fi

# 创建目录
echo "[1/5] 创建数据目录..."
mkdir -p "$PROJECT_DIR/data/spec_cache"
mkdir -p "$PROJECT_DIR/data/certbot/www"
mkdir -p "$PROJECT_DIR/data/certbot/conf"
mkdir -p "$PROJECT_DIR/data/mijia_auth"
mkdir -p "$PROJECT_DIR/nginx"

# 创建默认 config.json
if [ ! -f "$PROJECT_DIR/data/config.json" ]; then
    echo "[2/5] 创建默认 config.json..."
    cat > "$PROJECT_DIR/data/config.json" << 'CONFIGEOF'
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

# 创建 .env
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "[3/5] 创建 .env 配置文件..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo ""
    echo "  请编辑 $PROJECT_DIR/.env 文件，设置以下内容："
    echo "  - DOMAIN: 你的域名（如 mijia.example.com）"
    echo "  - CORS_ORIGINS: 你的 HTTPS 域名（如 https://mijia.example.com）"
    echo "  - CERTBOT_EMAIL: 证书申请邮箱"
    echo ""
    read -rp "  编辑完成后按回车继续..."
fi

# 构建并启动
echo "[4/5] 构建镜像并启动服务..."
cd "$PROJECT_DIR"
docker compose build
docker compose up -d

# 显示状态
echo ""
echo "[5/5] 部署完成！"
echo ""
docker compose ps
echo ""
echo "============================================"
echo "  后续步骤："
echo "  1. 浏览器访问 http://ECS_IP 测试页面"
echo "  2. 编辑 .env 配置域名"
echo "  3. 运行 docker compose --profile certbot up 申请 HTTPS 证书"
echo "  4. 修改 nginx/nginx.conf 启用 HTTPS"
echo "  5. （可选）配置 Tailscale 访问本地设备"
echo "============================================"
