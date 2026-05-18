import json
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api import router

app = FastAPI(title="米家控制", version="1.0.0")

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
