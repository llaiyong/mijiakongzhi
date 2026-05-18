from fastapi import APIRouter
from app.models import LocalDeviceAddRequest, DeviceActionRequest
from app.devices import device_manager
from app.cloud import cloud_manager
from app.spec import spec_manager, SPEC_API

router = APIRouter()


@router.get("/api/devices")
def get_devices():
    if not device_manager.cloud_logged_in and not device_manager.local_devices:
        return {"success": True, "devices": [], "require_login": True}
    return {"success": True, "devices": device_manager.get_all_devices()}


@router.get("/api/devices/{did}/status")
def get_device_status(did: str, use_cloud: bool = False):
    result = device_manager.get_device_status(did, use_cloud=use_cloud)
    if "error" in result and "did" in result:
        return {"success": False, "message": result["error"]}
    return {"success": True, **result}


@router.post("/api/devices/{did}/action")
def device_action(did: str, req: DeviceActionRequest):
    result = device_manager.send_device_action(did, req.action, req.params, use_cloud=req.use_cloud)
    return result


@router.post("/api/devices/local/add")
def add_local_device(req: LocalDeviceAddRequest):
    result = device_manager.add_local_device(
        name=req.name, ip=req.ip, token=req.token, model=req.model, device_type=req.type
    )
    return {"success": True, **result}


@router.get("/api/devices/{did}/spec")
def get_device_spec(did: str):
    device = device_manager.local_devices.get(did)
    if not device:
        cloud_dev = device_manager.cloud_devices.get(did)
        urn = cloud_dev.get("spec_type", "") if cloud_dev else ""
    else:
        urn = ""
        if device.model:
            instances = spec_manager.get_instances()
            for inst in instances:
                if device.model in inst.get("model", ""):
                    urn = inst.get("type", "")
                    break
    if not urn:
        return {"success": False, "message": "Spec URN not found", "controls": []}
    spec = spec_manager.get_spec(urn)
    controls = spec_manager.extract_controls(spec)
    return {"success": True, "spec": spec, "controls": controls}


@router.post("/api/cloud/qr-code")
def get_qr_code():
    result = cloud_manager.get_qr_code()
    return result


@router.post("/api/cloud/check-qr-login")
def check_qr_login(req: dict):
    lp_url = req.get("lp", "")
    if not lp_url:
        return {"success": False, "status": "error", "message": "缺少参数"}
    result = cloud_manager.check_qr_login(lp_url)
    return result


@router.get("/api/cloud/login-status")
def get_login_status():
    if device_manager.cloud_logged_in:
        return {"logged_in": True, "device_count": len(device_manager.cloud_devices)}
    return {"logged_in": False}


@router.get("/api/cloud/devices")
def get_cloud_devices():
    if not device_manager.cloud_logged_in:
        return {"success": False, "message": "Not logged in"}
    return {"success": True, "devices": cloud_manager.get_devices()}


@router.post("/api/cloud/logout")
def cloud_logout():
    device_manager.cloud_logged_in = False
    device_manager.cloud_devices = {}
    device_manager.homes = []
    device_manager.rooms_map = {}
    device_manager.device_states = {}
    # 清除 config 中的凭据
    if "cloud" in device_manager.config:
        device_manager.config["cloud"]["serviceToken"] = ""
        device_manager.config["cloud"]["userId"] = ""
        device_manager.config["cloud"]["passToken"] = ""
        device_manager.config["cloud"]["ssecurity"] = ""
    from app.devices import save_config
    save_config(device_manager.config)
    cloud_manager.logout()
    return {"success": True, "message": "已退出登录"}


@router.get("/api/config")
def get_config():
    config = device_manager.config.copy()
    if "cloud" in config and "password" in config["cloud"]:
        config["cloud"]["password"] = "***" if config["cloud"]["password"] else ""
    # 确保返回新字段
    config.setdefault("default_control_mode", "local")
    config.setdefault("cors_origins", "")
    return config


@router.put("/api/config")
def update_config(config: dict):
    device_manager.config.update(config)
    # 防止 CORS 被清空
    if "cors_origins" in config and not config["cors_origins"].strip():
        device_manager.config["cors_origins"] = "http://localhost,http://127.0.0.1,http://0.0.0.0"
    from app.devices import save_config
    save_config(device_manager.config)
    return {"success": True}


@router.get("/api/homes")
def get_homes():
    if not device_manager.homes and device_manager.cloud_logged_in:
        device_manager.sync_homes_and_rooms()
    return {"success": True, "homes": device_manager.homes}


@router.post("/api/homes/sync")
def sync_homes():
    if not device_manager.cloud_logged_in:
        return {"success": False, "message": "未登录云端"}
    device_manager.sync_homes_and_rooms()
    return {"success": True, "homes": device_manager.homes}


@router.get("/api/devices/states")
def get_device_states(dids: str = ""):
    did_list = [d.strip() for d in dids.split(",") if d.strip()] if dids else None
    if did_list:
        device_manager.refresh_device_states(did_list)
    else:
        device_manager.refresh_device_states()
    result = {}
    target_keys = did_list or list(device_manager.device_states.keys())
    for did in target_keys:
        if did in device_manager.device_states:
            result[did] = device_manager.device_states[did]
    return {"success": True, "states": result}


@router.get("/api/debug/room-map")
def debug_room_map():
    """调试端点：输出设备房间映射的原始数据"""
    from app.cloud import cloud_manager

    api = cloud_manager._get_mijia_api()
    if api is None:
        return {"success": False, "message": "API not available"}

    devices = api.get_devices_list()

    # 每个设备的完整字段（只显示room相关的）
    device_room_info = []
    for dev in devices[:20]:
        info = {"did": dev.get("did"), "name": dev.get("name", ""), "model": dev.get("model", "")}
        for k in sorted(dev.keys()):
            if any(kw in k.lower() for kw in ["room", "home", "dids", "alias"]):
                info[k] = dev[k]
        device_room_info.append(info)

    # 当前 rooms_map
    rooms_map_sample = {}
    for did, info in list(device_manager.rooms_map.items())[:10]:
        rooms_map_sample[did] = info

    # 比对：实际API返回的设备DID vs rooms_map中的DID
    api_dids = set(str(d.get("did", "")) for d in devices)
    map_dids = set(device_manager.rooms_map.keys())
    in_api_not_map = api_dids - map_dids
    in_map_not_api = map_dids - api_dids

    return {
        "success": True,
        "total_devices_from_api": len(devices),
        "total_cloud_devices": len(device_manager.cloud_devices),
        "total_rooms_map": len(device_manager.rooms_map),
        "device_room_info": device_room_info,
        "rooms_map_sample": rooms_map_sample,
        "in_api_not_in_map_count": len(in_api_not_map),
        "in_api_not_in_map_sample": list(in_api_not_map)[:20],
        "in_map_not_in_api_count": len(in_map_not_api),
        "in_map_not_in_api_sample": list(in_map_not_api)[:20],
    }
