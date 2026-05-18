"""米家控制 Web 安全中间件：认证 + 限流 + 安全头"""
import time
import hashlib
import secrets
import logging
from collections import defaultdict
from fastapi import Request, HTTPException, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ============ 管理员密码认证 ============

# 内存中存储的 session：{token_hash: {"created": timestamp, "ip": str}}
_active_sessions: dict = {}

# Session 过期时间（秒）
SESSION_TTL = 86400  # 24小时

# 默认管理员密码哈希（默认密码: admin123，首次使用必须修改）
DEFAULT_ADMIN_PASSWORD_HASH = hashlib.sha256("admin123".encode()).hexdigest()


def get_admin_password_hash(config: dict) -> str:
    """从 config 获取管理员密码哈希"""
    security = config.get("security", {})
    pwd = security.get("admin_password", "")
    if pwd:
        return hashlib.sha256(pwd.encode()).hexdigest()
    return DEFAULT_ADMIN_PASSWORD_HASH


def create_session(ip: str) -> str:
    """创建新 session，返回 token"""
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    _active_sessions[token_hash] = {"created": time.time(), "ip": ip}
    # 清理过期 session
    cleanup_expired()
    return token


def verify_session(token: str) -> bool:
    """验证 session token"""
    if not token:
        return False
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    session = _active_sessions.get(token_hash)
    if not session:
        return False
    if time.time() - session["created"] > SESSION_TTL:
        del _active_sessions[token_hash]
        return False
    return True


def destroy_session(token: str):
    """销毁 session"""
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        _active_sessions.pop(token_hash, None)


def cleanup_expired():
    """清理过期 session"""
    now = time.time()
    expired = [k for k, v in _active_sessions.items() if now - v["created"] > SESSION_TTL]
    for k in expired:
        del _active_sessions[k]


# ============ 请求频率限制 ============

class RateLimiter:
    """滑动窗口请求频率限制器"""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        # 清理窗口外的记录
        self.requests[key] = [t for t in self.requests[key] if now - t < self.window]
        if len(self.requests[key]) >= self.max_requests:
            return False
        self.requests[key].append(now)
        return True


# 不同端点的限流配置
rate_limiters = {
    "default": RateLimiter(max_requests=120, window_seconds=60),
    "login": RateLimiter(max_requests=10, window_seconds=300),      # 登录限流: 5分钟内10次
    "action": RateLimiter(max_requests=30, window_seconds=60),       # 设备操作限流: 每分钟30次
    "qr_code": RateLimiter(max_requests=5, window_seconds=60),       # 二维码生成限流: 每分钟5次
}


def get_client_ip(request: Request) -> str:
    """获取客户端真实 IP"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("X-Real-IP", request.client.host)


def check_rate_limit(request: Request) -> bool:
    """检查请求频率限制"""
    ip = get_client_ip(request)
    path = request.url.path

    # 选择限流器
    if "login" in path or "check-qr" in path:
        limiter = rate_limiters["login"]
    elif "action" in path:
        limiter = rate_limiters["action"]
    elif "qr-code" in path:
        limiter = rate_limiters["qr_code"]
    else:
        limiter = rate_limiters["default"]

    return limiter.is_allowed(ip)


# ============ 安全响应头中间件 ============

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """添加安全响应头"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # 安全头
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        # 隐藏服务器信息
        response.headers.pop("Server", None)
        return response


# ============ 认证中间件 ============

# 不需要认证的公开端点
PUBLIC_PATHS = {
    "/",
    "/api/cloud/qr-code",
    "/api/cloud/check-qr-login",
    "/api/cloud/login-status",
}

# 静态文件目录
STATIC_PREFIXES = ("/static/", "/favicon.ico")


class AuthMiddleware(BaseHTTPMiddleware):
    """API 访问认证中间件"""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 公开端点直接放行
        if path in PUBLIC_PATHS:
            return await call_next(request)
        if path.startswith(STATIC_PREFIXES):
            return await call_next(request)

        # 验证 session token
        token = request.headers.get("X-Auth-Token") or request.cookies.get("mijia_session")
        if not verify_session(token):
            return JSONResponse(
                status_code=401,
                content={"success": False, "message": "未授权访问，请先登录", "require_auth": True},
            )

        return await call_next(request)


# ============ 限流中间件 ============

class RateLimitMiddleware(BaseHTTPMiddleware):
    """请求频率限制中间件"""

    async def dispatch(self, request: Request, call_next):
        # 公开端点也限流
        if not check_rate_limit(request):
            return JSONResponse(
                status_code=429,
                content={"success": False, "message": "请求过于频繁，请稍后再试"},
            )
        return await call_next(request)
