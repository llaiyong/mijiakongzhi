import json
import os
import time
import uuid
import logging
from typing import Optional

from app.spec import spec_manager, cn_name

logger = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"cloud": {"username": "", "password": "", "country": "cn"}, "local_devices": [], "default_control_mode": "local"}


def save_config(config):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=4, ensure_ascii=False)


def guess_device_type(model: str) -> str:
    model_lower = model.lower()
    if any(k in model_lower for k in ["light", "lamp", "bulb", "led"]):
        return "light"
    if any(k in model_lower for k in ["plug", "outlet", "socket"]):
        return "plug"
    if any(k in model_lower for k in ["switch", "relay"]):
        return "switch"
    if any(k in model_lower for k in ["fan"]):
        return "fan"
    if any(k in model_lower for k in ["curtain", "blind"]):
        return "curtain"
    if any(k in model_lower for k in ["airpurifier", "air_con", "heater", "ac"]):
        return "climate"
    if any(k in model_lower for k in ["camera", "gateway"]):
        return "camera"
    return "unknown"


def get_device_icon(device_type: str) -> str:
    icons = {
        "light": "💡",
        "plug": "🔌",
        "switch": "🔘",
        "fan": "🌀",
        "curtain": "🪟",
        "climate": "🌡️",
        "camera": "📷",
    }
    return icons.get(device_type, "📱")


class LocalDevice:
    def __init__(self, did: str, name: str, ip: str, token: str, model: str = "", device_type: str = "unknown"):
        self.did = did
        self.name = name
        self.ip = ip
        self.token = token
        self.model = model
        self.type = device_type
        self._device = None

    def _get_device(self):
        if self._device is None:
            from miio import GenericMiot
            try:
                self._device = GenericMiot(self.ip, self.token)
            except Exception:
                from miio import Device
                self._device = Device(self.ip, self.token)
        return self._device

    def get_status(self) -> dict:
        try:
            dev = self._get_device()
            info = dev.info()
            props = {}
            try:
                result = dev.send("get_properties", [])
                if result:
                    props = {"properties": result}
            except Exception:
                pass
            return {
                "did": self.did,
                "name": self.name,
                "type": self.type,
                "model": self.model or getattr(info, "model", ""),
                "online": True,
                "mode": "local",
                "info": str(info) if info else "",
                **props,
            }
        except Exception as e:
            return {
                "did": self.did,
                "name": self.name,
                "type": self.type,
                "model": self.model,
                "online": False,
                "mode": "local",
                "error": str(e),
            }

    def send_action(self, action: str, params: dict = None) -> dict:
        dev = self._get_device()
        params = params or {}

        if action == "power_on":
            try:
                dev.set_property_by(siid=params.get("siid", 2), piid=params.get("piid", 1), value=True)
                return {"success": True}
            except Exception:
                pass
            try:
                dev.send("set_power", ["on"])
                return {"success": True}
            except Exception:
                pass

        if action == "power_off":
            try:
                dev.set_property_by(siid=params.get("siid", 2), piid=params.get("piid", 1), value=False)
                return {"success": True}
            except Exception:
                pass
            try:
                dev.send("set_power", ["off"])
                return {"success": True}
            except Exception:
                pass

        if action == "toggle":
            try:
                dev.send("toggle")
                return {"success": True}
            except Exception:
                pass

        if action == "set_property" and "siid" in params and "piid" in params:
            dev.set_property_by(siid=params["siid"], piid=params["piid"], value=params["value"])
            return {"success": True}

        if action == "send" and "method" in params:
            result = dev.send(params["method"], params.get("args", []))
            return {"success": True, "result": result}

        try:
            result = dev.send(action, params.get("args", []))
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}


class DeviceManager:
    def __init__(self):
        self.config = load_config()
        self.local_devices: dict[str, LocalDevice] = {}
        self.cloud_devices: dict = {}
        self.cloud_logged_in = False
        self.homes: list[dict] = []
        self.rooms_map: dict[str, dict] = {}
        self.device_states: dict[str, dict] = {}
        self._init_local_devices()

    def _init_local_devices(self):
        for dev in self.config.get("local_devices", []):
            did = dev.get("did", f"local_{uuid.uuid4().hex[:8]}")
            device_type = dev.get("type") or guess_device_type(dev.get("model", ""))
            local_dev = LocalDevice(
                did=did,
                name=dev.get("name", "Unknown"),
                ip=dev["ip"],
                token=dev["token"],
                model=dev.get("model", ""),
                device_type=device_type,
            )
            self.local_devices[did] = local_dev

    def get_all_devices(self) -> list[dict]:
        devices = []
        for did, dev in self.local_devices.items():
            devices.append({
                "did": did,
                "name": dev.name,
                "type": dev.type,
                "model": dev.model,
                "ip": dev.ip,
                "mode": "local",
                "online": True,
                "icon": get_device_icon(dev.type),
                "home_name": "",
                "room_name": "",
            })

        # 构建已添加的DID集合，避免重复
        added_dids = set(d["did"] for d in devices)

        for did, dev in self.cloud_devices.items():
            if did in added_dids:
                continue
            device_type = guess_device_type(dev.get("model", ""))
            room_info = self.rooms_map.get(did, {})
            state = self.device_states.get(did, {})
            dev_name = dev.get("name", "Unknown")
            devices.append({
                "did": did,
                "name": dev_name,
                "type": device_type,
                "model": dev.get("model", ""),
                "mode": "cloud",
                "online": state.get("online", True),
                "icon": get_device_icon(device_type),
                "home_name": room_info.get("home_name", ""),
                "room_name": room_info.get("room_name", ""),
            })
            added_dids.add(did)

        return devices

    def sync_homes_and_rooms(self):
        """同步家庭和房间信息"""
        from app.cloud import cloud_manager
        api = cloud_manager._get_mijia_api()
        if api is None:
            logger.warning("No mijiaAPI instance for home sync")
            return

        try:
            homes = api.get_homes_list()
            self.homes = []
            self.rooms_map = {}
            # 子设备DID列表，用于后续汇总
            sub_device_rooms = {}

            for home in homes:
                home_id = str(home.get("id", ""))
                home_name = home.get("name", "未命名")
                home_entry = {
                    "id": home_id,
                    "name": home_name,
                    "address": home.get("address", ""),
                    "rooms": [],
                }
                room_list = (
                    home.get("roomlist")
                    or home.get("rooms")
                    or home.get("room_list")
                    or []
                )
                for room in room_list:
                    room_id = str(room.get("id", ""))
                    room_name = room.get("name", "未命名")
                    home_entry["rooms"].append({
                        "id": room_id,
                        "name": room_name,
                    })
                    device_ids = (
                        room.get("dids")
                        or room.get("device_ids")
                        or room.get("devices")
                        or []
                    )
                    room_info = {
                        "home_id": home_id,
                        "home_name": home_name,
                        "room_id": room_id,
                        "room_name": room_name,
                    }
                    for did in device_ids:
                        did_str = str(did)
                        # 判断是否为子设备（DID 带 .sN 后缀）
                        if ".s" in did_str:
                            parts = did_str.rsplit(".s", 1)
                            parent_did = parts[0]
                            if parent_did not in sub_device_rooms:
                                sub_device_rooms[parent_did] = {
                                    "home_id": home_id,
                                    "home_name": home_name,
                                    "room_id": room_id,
                                    "room_name": room_name,
                                }
                        else:
                            self.rooms_map[did_str] = room_info
                self.homes.append(home_entry)

            # 将子设备的房间信息合并到主 rooms_map（子设备DID对应的父设备已有房间则不覆盖）
            for did_str, room_info in sub_device_rooms.items():
                if did_str not in self.rooms_map:
                    self.rooms_map[did_str] = room_info

            logger.info("Synced %d homes, %d room-device mappings (%d parent devices with sub-devices in different rooms)",
                        len(self.homes), len(self.rooms_map), len(sub_device_rooms))
        except Exception as e:
            logger.exception("Failed to sync homes and rooms: %s", e)

    def refresh_device_states(self, dids: list[str] | None = None):
        """刷新设备状态"""
        from app.cloud import cloud_manager
        api = cloud_manager._get_mijia_api()
        if api is None:
            return

        target_dids = dids or list(self.cloud_devices.keys())
        cloud_dids = [d for d in target_dids if d in self.cloud_devices]
        if not cloud_dids:
            return

        # 构建批量查询（每批15个）
        all_queries = []
        for did in cloud_dids:
            dev = self.cloud_devices.get(did, {})
            spec_type = dev.get("spec_type", "")
            if spec_type:
                spec = spec_manager.get_spec(spec_type)
                for svc in spec.get("services", []):
                    for prop in svc.get("properties", []):
                        if "read" in prop.get("access", []):
                            all_queries.append({
                                "did": did,
                                "siid": svc.get("iid"),
                                "piid": prop.get("iid"),
                                "name": cn_name(prop.get("description", "")),
                                "format": prop.get("format", ""),
                            })
                            if len(all_queries) >= 15 * len(cloud_dids):
                                break
                        if len(all_queries) >= 15 * len(cloud_dids):
                            break
                    if len(all_queries) >= 15 * len(cloud_dids):
                        break

        # 分批查询
        if all_queries:
            try:
                batch_queries = [{"did": q["did"], "siid": q["siid"], "piid": q["piid"]} for q in all_queries]
                results = api.get_devices_prop(batch_queries)
                if isinstance(results, list):
                    for i, r in enumerate(results):
                        q = all_queries[i]
                        did = q["did"]
                        if did not in self.device_states:
                            self.device_states[did] = {"properties": [], "online": True, "last_updated": time.time()}
                        if r.get("code") == 0:
                            self.device_states[did]["properties"].append({
                                "siid": q["siid"],
                                "piid": q["piid"],
                                "name": q["name"],
                                "format": q["format"],
                                "value": r.get("value"),
                            })
                        self.device_states[did]["last_updated"] = time.time()
            except Exception as e:
                logger.warning(f"Failed to refresh device states: {e}")

        # 更新在线状态
        for did in cloud_dids:
            if did not in self.device_states:
                self.device_states[did] = {"properties": [], "online": True, "last_updated": time.time()}

    def add_local_device(self, name: str, ip: str, token: str, model: str = "", device_type: str = "") -> dict:
        did = f"local_{uuid.uuid4().hex[:8]}"
        if not device_type:
            device_type = guess_device_type(model)
        dev = LocalDevice(did=did, name=name, ip=ip, token=token, model=model, device_type=device_type)
        self.local_devices[did] = dev

        dev_entry = {"did": did, "name": name, "ip": ip, "token": token, "model": model, "type": device_type}
        self.config["local_devices"].append(dev_entry)
        save_config(self.config)
        return {"did": did, "name": name, "type": device_type}

    def get_device_status(self, did: str, use_cloud: bool = False) -> dict:
        if did in self.local_devices and not use_cloud:
            return self.local_devices[did].get_status()
        if did in self.cloud_devices:
            return self._cloud_get_status(did)
        return {"error": "Device not found", "did": did}

    def send_device_action(self, did: str, action: str, params: dict = None, use_cloud: bool = False) -> dict:
        if did in self.local_devices and not use_cloud:
            return self.local_devices[did].send_action(action, params or {})
        if did in self.cloud_devices:
            if not self.cloud_logged_in:
                return {"success": False, "error": "Not logged in to cloud"}
            return self._cloud_send_action(did, action, params or {})
        return {"success": False, "error": "Device not found", "did": did}

    def _cloud_get_status(self, did: str) -> dict:
        dev = self.cloud_devices.get(did, {})
        properties = []
        try:
            from app.cloud import cloud_manager
            api = cloud_manager._get_mijia_api()
            if api:
                spec_type = dev.get("spec_type", "")

                queries = []
                if spec_type:
                    spec = spec_manager.get_spec(spec_type)
                    for svc in spec.get("services", []):
                        for prop in svc.get("properties", []):
                            if "read" in prop.get("access", []):
                                queries.append({
                                    "did": did,
                                    "siid": svc.get("iid"),
                                    "piid": prop.get("iid"),
                                    "name": cn_name(prop.get("description", "")),
                                    "format": prop.get("format", ""),
                                })
                                if len(queries) >= 15:
                                    break
                        if len(queries) >= 15:
                            break

                if queries:
                    batch_queries = []
                    for q in queries:
                        batch_queries.append({"did": q["did"], "siid": q["siid"], "piid": q["piid"]})
                    try:
                        results = api.get_devices_prop(batch_queries)
                        if isinstance(results, list):
                            for i, r in enumerate(results):
                                if r.get("code") == 0:
                                    props_entry = {
                                        "siid": queries[i]["siid"],
                                        "piid": queries[i]["piid"],
                                        "name": queries[i]["name"],
                                        "format": queries[i]["format"],
                                        "value": r.get("value"),
                                    }
                                    properties.append(props_entry)
                    except Exception:
                        pass
        except Exception:
            pass
        # 更新 device_states 缓存
        if properties:
            self.device_states[did] = {"properties": properties, "online": True, "last_updated": time.time()}
        dev_name = dev.get("alias") or dev.get("name", "Unknown")
        return {
            "did": did,
            "name": dev_name,
            "type": guess_device_type(dev.get("model", "")),
            "model": dev.get("model", ""),
            "online": True,
            "mode": "cloud",
            "properties": properties,
        }

    def _cloud_send_action(self, did: str, action: str, params: dict) -> dict:
        from app.cloud import cloud_manager
        dev_info = self.cloud_devices.get(did)
        if not dev_info:
            return {"success": False, "error": "Cloud device not found"}

        try:
            api = cloud_manager._get_mijia_api()
            if api is None:
                return {"success": False, "error": "Not logged in"}

            from mijiaAPI.errors import APIError

            if action == "power_on":
                try:
                    api.set_devices_prop({"did": did, "siid": 2, "piid": 1, "value": True})
                    return {"success": True}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            if action == "power_off":
                try:
                    api.set_devices_prop({"did": did, "siid": 2, "piid": 1, "value": False})
                    return {"success": True}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            if action == "toggle":
                try:
                    api.run_action({"did": did, "siid": 2, "aiid": 1})
                    return {"success": True}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            if action == "set_property" and "siid" in params and "piid" in params:
                try:
                    api.set_devices_prop({
                        "did": did,
                        "siid": params["siid"],
                        "piid": params["piid"],
                        "value": params["value"],
                    })
                    return {"success": True}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            if action == "get_property" and "siid" in params and "piid" in params:
                try:
                    result = api.get_devices_prop({
                        "did": did,
                        "siid": params["siid"],
                        "piid": params["piid"],
                    })
                    return {"success": True, "result": result}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            if action == "action" and "siid" in params and "aiid" in params:
                try:
                    result = api.run_action({
                        "did": did,
                        "siid": params["siid"],
                        "aiid": params["aiid"],
                        "value": params.get("value", []),
                    })
                    return {"success": True, "result": result}
                except APIError as e:
                    return {"success": False, "error": str(e)}

            return {"success": False, "error": f"Unsupported action: {action}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


device_manager = DeviceManager()
