import json
import os
import hashlib
import logging
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.security import (
    AuthMiddleware,
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    get_admin_password_hash,
    create_session,
    destroy_session,
    get_client_ip,
)
from app.devices import device_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="米家控制", version="1.0.0")

# ---- 安全中间件（最先注册，最先执行）----
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(AuthMiddleware)

# ---- CORS ----

# 优先从环境变量读取，其次从 config.json 读取
config_path = os.path.join(os.path.dirname(__file__), "config.json")
default_origins = "http://localhost,http://127.0.0.1,http://0.0.0.0"

env_origins = os.getenv("CORS_ORIGINS")
if env_origins:
    allowed_origins = [o.strip() for o in env_origins.split(",")]
elif os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cors = cfg.get("cors_origins", "")
        allowed_origins = [o.strip() for o in cors.split(",") if o.strip()] if cors else default_origins.split(",")
    except Exception:
        allowed_origins = default_origins.split(",")
else:
    allowed_origins = default_origins.split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.include_router(router)


@app.get("/")
async def index():
    return FileResponse(os.path.join(static_dir, "index.html"))


# ============ 认证 API ============

@app.post("/api/auth/login")
async def auth_login(request: Request):
    """Web 管理员登录"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "message": "请求格式错误"})

    password = body.get("password", "")
    if not password:
        return JSONResponse(status_code=400, content={"success": False, "message": "请输入密码"})

    ip = get_client_ip(request)
    expected_hash = get_admin_password_hash(device_manager.config)
    password_hash = hashlib.sha256(password.encode()).hexdigest()

    if password_hash != expected_hash:
        logger.warning(f"Failed login attempt from {ip}")
        return JSONResponse(status_code=401, content={"success": False, "message": "密码错误"})

    token = create_session(ip)
    logger.info(f"Login successful from {ip}")
    response = JSONResponse(content={"success": True, "message": "登录成功"})
    response.set_cookie(
        key="mijia_session",
        value=token,
        httponly=True,
        secure=False,  # 生产环境 HTTPS 时设为 True
        samesite="lax",
        max_age=86400,
        path="/",
    )
    response.headers["X-Auth-Token"] = token
    return response


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """退出登录"""
    token = request.headers.get("X-Auth-Token") or request.cookies.get("mijia_session")
    destroy_session(token)
    response = JSONResponse(content={"success": True, "message": "已退出登录"})
    response.delete_cookie(key="mijia_session", path="/")
    return response


@app.get("/api/auth/status")
async def auth_status(request: Request):
    """检查登录状态"""
    token = request.headers.get("X-Auth-Token") or request.cookies.get("mijia_session")
    from app.security import verify_session
    logged_in = verify_session(token)
    return {"authenticated": logged_in}


@app.post("/api/auth/change-password")
async def change_password(request: Request):
    """修改管理员密码"""
    token = request.headers.get("X-Auth-Token") or request.cookies.get("mijia_session")
    from app.security import verify_session
    if not verify_session(token):
        return JSONResponse(status_code=401, content={"success": False, "message": "未授权"})

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "message": "请求格式错误"})

    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if not old_password or not new_password:
        return JSONResponse(status_code=400, content={"success": False, "message": "请填写完整"})

    if len(new_password) < 6:
        return JSONResponse(status_code=400, content={"success": False, "message": "密码至少6位"})

    expected_hash = get_admin_password_hash(device_manager.config)
    old_hash = hashlib.sha256(old_password.encode()).hexdigest()

    if old_hash != expected_hash:
        return JSONResponse(status_code=401, content={"success": False, "message": "原密码错误"})

    # 保存新密码（明文哈希）
    new_hash = hashlib.sha256(new_password.encode()).hexdigest()
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = {}
    cfg.setdefault("security", {})["admin_password"] = new_password
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)

    device_manager.config = cfg
    logger.info("Admin password changed successfully")
    return {"success": True, "message": "密码修改成功"}
