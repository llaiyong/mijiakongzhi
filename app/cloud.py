import time
import json
import base64
import hashlib
import logging
import urllib.parse
import os
import requests
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# mijiaAPI auth storage path
MIJIA_API_AUTH_PATH = os.path.join(
    os.path.expanduser("~"), ".config", "mijia-api", "auth.json"
)

SERVICE_LOGIN = "https://account.xiaomi.com/pass/serviceLogin"
LONG_POLLING = "https://account.xiaomi.com/longPolling/loginUrl"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

# Global state for QR login sessions
_active_sessions: dict = {}


def _gen_device_id() -> str:
    raw = hashlib.md5(str(time.time()).encode()).digest()
    return base64.b64encode(raw).decode().replace("=", "").replace("+", "_").replace("/", "-")[:16]


class CloudManager:
    def __init__(self):
        self.session = requests.Session()
        self.device_id = _gen_device_id()
        self.pass_o = _gen_device_id()
        self.service_token = None
        self.auth_data = {}

    def _make_service_cookie(self) -> str:
        device_id_std = self.device_id.replace("-", "+").replace("_", "/")
        raw = base64.b64decode(device_id_std + "==")
        h = hashlib.sha1(raw).digest()
        return base64.b64encode(h[:8]).decode().replace("=", "").replace("+", "_").replace("/", "-")

    def get_qr_code(self) -> dict:
        """生成二维码登录"""
        try:
            if self.service_token:
                try:
                    result = self._refresh_token()
                    if result.get("code") == 0:
                        return {"success": True, "message": "Token仍然有效", "already_logged_in": True}
                except Exception:
                    pass

            location_data = self._get_location()
            if location_data.get("code") == 0:
                if self.service_token:
                    return {"success": True, "message": "Token仍然有效", "already_logged_in": True}

            if not location_data:
                return {"success": False, "message": "无法获取登录参数"}

            params = {
                "theme": "white",
                "bizDeviceType": "android",
                "_hasLogo": "true",
                "_qrsize": "240",
                "_dc": str(int(time.time() * 1000)),
            }
            params.update(location_data)

            url = LONG_POLLING + "?" + urllib.parse.urlencode(params)
            
            resp = self.session.get(url, headers=HEADERS, timeout=15)
            
            content = resp.text
            if content.startswith("&&&START&&&"):
                content = content[len("&&&START&&&"):]
            
            try:
                data = json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"QR response parse error: {content[:500]}")
                return {"success": False, "message": "解析二维码响应失败"}

            qr_url = data.get("loginUrl", "")
            lp_url = data.get("lp", "")
            qr_image_url = data.get("qr", "")

            if not qr_url or not lp_url:
                error_msg = data.get("message", data.get("description", "获取二维码失败"))
                return {"success": False, "message": f"获取二维码失败: {error_msg}"}

            session_id = hashlib.md5(str(time.time()).encode()).hexdigest()[:12]
            _active_sessions[session_id] = {
                "lp": lp_url,
                "created": time.time(),
            }

            return {
                "success": True,
                "sessionId": session_id,
                "qrUrl": qr_url,
                "qrImage": qr_image_url,
                "lp": lp_url,
            }
        except requests.exceptions.Timeout:
            return {"success": False, "message": "请求超时，请检查网络连接"}
        except requests.exceptions.ConnectionError:
            return {"success": False, "message": "网络连接失败，请检查网络"}
        except Exception as e:
            logger.exception("Get QR code failed")
            return {"success": False, "message": f"获取二维码失败: {str(e)}"}

    def _get_location(self) -> dict:
        sid = "xiaomiio"
        service_cookie = self._make_service_cookie()
        url = f"{SERVICE_LOGIN}?_json=true&sid={sid}&_locale=zh_CN"
        headers = {
            **HEADERS,
            "Cookie": f"deviceId={self.device_id};pass_o={self.pass_o};serviceToken={self.service_token or ''}",
        }
        
        try:
            resp = self.session.get(url, headers=headers, timeout=15)
            logger.info(f"Location request status: {resp.status_code}")
            
            content = resp.text
            if content.startswith("&&&START&&&"):
                content = content[len("&&&START&&&"):]
            
            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                logger.error(f"Location response parse error: {content[:500]}")
                return {}
            
            location = data.get("location", "")
            logger.info(f"Location data: code={data.get('code')}, location_exists={bool(location)}")
            
            if data.get("code") == 0:
                s = requests.Session()
                s.headers.update(HEADERS)
                s.cookies.update(self.session.cookies)
                ret = s.get(location, headers=HEADERS, timeout=15)
                if ret.status_code == 200 and ret.text == "ok":
                    cookies = s.cookies.get_dict()
                    self.auth_data.update(cookies)
                    self.auth_data["ssecurity"] = data.get("ssecurity", "")
                    if "serviceToken" in cookies:
                        self.service_token = cookies["serviceToken"]
                        self.session.cookies.set("serviceToken", self.service_token)
                    return {"code": 0, "message": "刷新Token成功"}
            
            parsed = urllib.parse.urlparse(location)
            qs = urllib.parse.parse_qs(parsed.query)
            result = {k: v[0] for k, v in qs.items()}
            logger.info(f"Extracted params: {list(result.keys())}")
            return result
            
        except Exception as e:
            logger.exception("Get location failed")
            return {}

    def _refresh_token(self) -> dict:
        return self._get_location()

    def check_qr_login(self, lp_url: str) -> dict:
        """轮询检查扫码登录状态"""
        try:
            session = requests.Session()
            session.headers.update(HEADERS)
            session.cookies.update(self.session.cookies)

            # Use shorter timeout for polling (3 seconds)
            resp = session.get(lp_url, headers=HEADERS, timeout=5)
            content = resp.text
            if content.startswith("&&&START&&&"):
                content = content[len("&&&START&&&"):]

            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                return {"success": False, "status": "waiting", "message": "等待扫码"}

            logger.info(f"QR login response: {json.dumps(data, ensure_ascii=False)[:500]}")

            # Check if there's a location (means login succeeded)
            location = data.get("location", "")
            if not location:
                # No location yet - user hasn't scanned or confirmed
                return {"success": False, "status": "waiting", "message": "等待扫码或确认"}

            # Location exists - login succeeded
            # Extract auth data
            auth_keys = ["psecurity", "nonce", "ssecurity", "passToken", "userId", "cUserId"]
            for key in auth_keys:
                if key in data:
                    self.auth_data[key] = data[key]

            # Follow the callback URL to get serviceToken
            session.get(location, headers=HEADERS, timeout=15, allow_redirects=True)
            cookies = session.cookies.get_dict()
            self.auth_data.update(cookies)
            self.session.cookies.update(cookies)

            # Extract serviceToken
            self.service_token = (
                self.auth_data.get("serviceToken")
                or self.session.cookies.get("serviceToken")
                or cookies.get("serviceToken")
            )

            if self.service_token:
                self._save_auth()
                devices = self.get_devices()
                logger.info(f"Devices raw response count: {len(devices)}")
                if devices:
                    logger.info(f"First device example: {json.dumps(devices[0])[:500]}")
                
                from app.devices import device_manager
                device_manager.cloud_logged_in = True
                device_manager.cloud_devices = {}
                for dev in devices:
                    did = dev.get("did") or dev.get("deviceId") or dev.get("id")
                    if did:
                        device_manager.cloud_devices[did] = dev
                    else:
                        logger.warning(f"Skipping device without ID: {dev.get('name', 'Unknown')}")

                # 同步家庭和房间信息
                device_manager.sync_homes_and_rooms()

                # 打印房间映射样本
                if device_manager.rooms_map:
                    sample = dict(list(device_manager.rooms_map.items())[:5])
                    logger.info(f"Rooms map sample: {json.dumps(sample, ensure_ascii=False)}")
                else:
                    logger.warning("No rooms_map entries after sync")

                return {
                    "success": True,
                    "status": "success",
                    "message": f"登录成功，发现 {len(device_manager.cloud_devices)} 个设备",
                    "device_count": len(device_manager.cloud_devices),
                }

            return {"success": False, "status": "error", "message": "未能获取serviceToken"}
        except requests.exceptions.Timeout:
            return {"success": False, "status": "waiting", "message": "等待扫码"}
        except requests.exceptions.ConnectionError as e:
            return {"success": False, "status": "error", "message": f"网络错误: {str(e)}"}
        except Exception as e:
            logger.exception("Check QR login failed")
            return {"success": False, "status": "error", "message": f"登录检查失败: {str(e)}"}

    def _save_mijia_api_auth(self):
        """Save auth data in mijiaAPI-compatible format."""
        if not self.service_token or not self.auth_data.get("userId"):
            return
        import random
        import tzlocal

        dt = datetime.now().astimezone()
        tz = tzlocal.get_localzone_name()
        ua_id1 = "".join(random.choices("012345ABCDEF", k=40))
        ua_id2 = "".join(random.choices("012345ABCDEF", k=32))
        ua_id3 = "".join(random.choices("012345ABCDEF", k=32))
        ua_id4 = "".join(random.choices("012345ABCDEF", k=40))
        device_id = self.device_id.replace("-", "+").replace("_", "/")

        auth = {
            "psecurity": self.auth_data.get("psecurity", ""),
            "nonce": self.auth_data.get("nonce", ""),
            "ssecurity": self.auth_data.get("ssecurity", ""),
            "passToken": self.auth_data.get("passToken", ""),
            "userId": self.auth_data.get("userId", ""),
            "cUserId": self.auth_data.get("cUserId", f"cn-{self.auth_data.get('userId', '')}"),
            "serviceToken": self.service_token,
            "expireTime": int((datetime.now() + timedelta(days=30)).timestamp() * 1000),
            "deviceId": device_id,
            "pass_o": self.pass_o,
            "ua": f"Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-{ua_id1}-CN-{ua_id3}-{ua_id2}-SmartHome-MI_APP_STORE-{ua_id1}|{ua_id4}|{self.pass_o}-64",
            "saveTime": int(time.time() * 1000),
            "timezone_id": tz,
            "timezone": f"GMT{dt.strftime('%z')[:3]}:{dt.strftime('%z')[3:]}",
            "locale": "zh_CN",
        }
        try:
            os.makedirs(os.path.dirname(MIJIA_API_AUTH_PATH), exist_ok=True)
            with open(MIJIA_API_AUTH_PATH, "w", encoding="utf-8") as f:
                json.dump(auth, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved mijiaAPI auth to {MIJIA_API_AUTH_PATH}")
        except Exception as e:
            logger.warning(f"Failed to save mijiaAPI auth: {e}")

    def _get_mijia_api(self):
        """Get mijiaAPI instance with loaded auth."""
        from mijiaAPI import mijiaAPI
        if os.path.exists(MIJIA_API_AUTH_PATH):
            return mijiaAPI(MIJIA_API_AUTH_PATH)
        return None

    def _sync_from_mijia_api(self, api):
        """Sync auth data back from mijiaAPI after token refresh."""
        self.service_token = api.auth_data.get("serviceToken", "")
        self.auth_data.update({
            k: api.auth_data.get(k, "")
            for k in ("userId", "cUserId", "passToken", "ssecurity", "psecurity")
        })
        from app.devices import device_manager, save_config
        device_manager.config["cloud"]["serviceToken"] = self.service_token
        device_manager.config["cloud"]["userId"] = self.auth_data.get("userId", "")
        device_manager.config["cloud"]["passToken"] = self.auth_data.get("passToken", "")
        device_manager.config["cloud"]["ssecurity"] = self.auth_data.get("ssecurity", "")
        save_config(device_manager.config)

    def _save_auth(self):
        from app.devices import device_manager, save_config
        device_manager.config["cloud"]["serviceToken"] = self.service_token or ""
        device_manager.config["cloud"]["userId"] = self.auth_data.get("userId", "")
        device_manager.config["cloud"]["passToken"] = self.auth_data.get("passToken", "")
        device_manager.config["cloud"]["ssecurity"] = self.auth_data.get("ssecurity", "")
        save_config(device_manager.config)
        self._save_mijia_api_auth()

    def _load_auth(self) -> bool:
        from app.devices import device_manager
        cloud_config = device_manager.config.get("cloud", {})
        self.service_token = cloud_config.get("serviceToken", "")
        self.auth_data["userId"] = cloud_config.get("userId", "")
        self.auth_data["passToken"] = cloud_config.get("passToken", "")
        self.auth_data["ssecurity"] = cloud_config.get("ssecurity", "")
        if self.service_token:
            self.session.cookies.set("serviceToken", self.service_token)
            device_manager.cloud_logged_in = True
            # Also ensure mijiaAPI auth is synced
            self._save_mijia_api_auth()
            return True

        # Try loading from mijiaAPI auth path
        if os.path.exists(MIJIA_API_AUTH_PATH):
            try:
                with open(MIJIA_API_AUTH_PATH, "r", encoding="utf-8") as f:
                    mijia_auth = json.load(f)
                self.service_token = mijia_auth.get("serviceToken", "")
                self.auth_data.update({
                    "userId": mijia_auth.get("userId", ""),
                    "cUserId": mijia_auth.get("cUserId", ""),
                    "passToken": mijia_auth.get("passToken", ""),
                    "ssecurity": mijia_auth.get("ssecurity", ""),
                    "psecurity": mijia_auth.get("psecurity", ""),
                })
                if self.service_token:
                    self.session.cookies.set("serviceToken", self.service_token)
                    device_manager.cloud_logged_in = True
                    return True
            except Exception:
                pass
        return False

    def get_devices(self, country: str = "cn") -> list:
        try:
            api = self._get_mijia_api()
            if api is None:
                logger.warning("No mijiaAPI auth data found")
                return []
            # Try refreshing if token expired
            if not api.available:
                try:
                    api._refresh_token()
                    self._sync_from_mijia_api(api)
                except Exception:
                    logger.exception("mijiaAPI token refresh failed")
                    return []
            devices = api.get_devices_list()
            logger.info(f"Found {len(devices)} devices via mijiaAPI")
            # 打印房间相关字段
            if devices:
                # 打印前3个设备的所有room相关字段
                for dev in devices[:3]:
                    room_fields = {}
                    for k, v in dev.items():
                        if any(kw in k.lower() for kw in ['room', 'home', 'dids', 'device_id', 'name', 'alias']):
                            room_fields[k] = v
                    logger.info(f"Device room fields (sample): {json.dumps(room_fields, ensure_ascii=False)}")
            return devices
        except Exception as e:
            logger.exception(f"Error getting devices: {e}")
            return []

    def logout(self):
        """清除云端登录状态"""
        self.service_token = None
        self.auth_data = {}
        self.session.cookies.clear()
        self.device_id = _gen_device_id()
        self.pass_o = _gen_device_id()
        self.session = requests.Session()
        # 清除 mijiaAPI 认证文件
        if os.path.exists(MIJIA_API_AUTH_PATH):
            try:
                os.remove(MIJIA_API_AUTH_PATH)
            except Exception:
                pass

cloud_manager = CloudManager()
