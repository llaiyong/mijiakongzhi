FROM python:3.12-slim

LABEL maintainer="mijiakongzhi"
LABEL description="米家控制 - Mi Home Device Control Server"

# 安装 python-miio 等 C 扩展依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        pkg-config \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先安装依赖（利用 Docker 层缓存），使用阿里云 PyPI 镜像加速
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

# 创建非 root 用户
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# 复制应用代码
COPY main.py .
COPY app/ ./app/
COPY static/ ./static/

# 创建必要目录
RUN mkdir -p /app/data/spec_cache && \
    chown -R appuser:appuser /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER appuser

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/cloud/login-status || exit 1

ENTRYPOINT ["/entrypoint.sh"]
