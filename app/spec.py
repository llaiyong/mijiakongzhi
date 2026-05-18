import os
import json
import hashlib
import logging
import requests

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "spec_cache")
SPEC_API = "https://miot-spec.org/miot-spec-v2/instance"


SPEC_CN_NAMES = {
    # 服务名称
    "Device Information": "设备信息",
    "Device Fault": "设备故障",
    "Light": "灯光",
    "Switch Sensor": "开关传感器",
    "Left Switch Service": "左路开关",
    "Right Switch Service": "右路开关",
    "Switch Status": "开关状态",
    "Indicator Light": "指示灯",
    "Speaker": "扬声器",
    "Intelligent Speaker": "智能音箱",
    "Temperature": "温度",
    "Humidity": "湿度",
    "Battery": "电池",
    "Battery Level": "电量",
    "Occupancy Sensor": "人体传感器",
    "Submersion Sensor": "水浸传感器",
    "Door State": "门状态",
    "Cook Mode": "烹饪模式",
    "Health Pot": "养生壶",
    "Oven": "烤箱",
    "Alarm": "报警",
    "Gateway IP Address": "网关IP地址",
    "IP Address": "IP地址",
    "Subnet Mask": "子网掩码",
    "DNS Auto Mode": "DNS自动模式",
    "DNS IP Address": "DNS地址",
    "WiFi Managerment": "WiFi管理",
    "WiFi Bandwidth": "WiFi带宽",
    "WiFi Channel": "WiFi信道",
    "WiFi SSID Hidden": "WiFi隐藏SSID",
    "WiFi Service Set Identifier": "WiFi名称",
    "WiFi Encrypted Password": "WiFi密码",
    "WiFi Band Combine": "WiFi双频合一",
    "Guest WiFi": "访客WiFi",
    "PPPOE Username": "PPPOE用户名",
    "PPPOE Encrypted Password": "PPPOE密码",
    "Network Connection Type": "网络连接类型",
    "Static IP Address": "静态IP地址",
    "Remote Control Management": "遥控管理",
    "Speed Control": "速度控制",
    "Flow": "流量",
    "Router": "路由器",
    "Message Router": "消息路由",
    "TV Box": "电视盒子",
    "Physical Control Locked": "物理控制锁定",
    "Current Physical Control Lock": "当前物理控制锁定",
    "Default Power On State": "默认通电状态",
    "Night Light Switch": "夜灯开关",
    "Sleep Mode": "睡眠模式",
    "No Disturb": "勿扰模式",
    "Enable Time Period": "启用时间段",
    "Online Time": "在线时间",
    "Sync Finished": "同步完成",
    "Mute": "静音",
    "Volume": "音量",
    "Play Control": "播放控制",
    "Play Loop Mode": "播放循环模式",
    "Playing State": "播放状态",
    "Ringtone": "铃声",
    "Text Content": "文本内容",
    "Seek Time": "搜索时间",
    "Audio Id": "音频ID",
    "Microphone": "麦克风",
    "Status": "状态",
    "Mode": "模式",
    "Brightness": "亮度",
    "Color": "颜色",
    "Color Temperature": "色温",
    "Saturability": "饱和度",
    "Target Temperature": "目标温度",
    "Illumination": "光照度",
    "Occupancy Status": "人体状态",
    "Has Someone Duration": "有人时长",
    "No One Duration": "无人时长",
    "Has Someone Detection Sensitivity": "有人检测灵敏度",
    "Signal Strength": "信号强度",
    "Received Signal Strength Indicator": "信号强度指示",
    "Working Level": "工作档位",
    "Delay": "延时",
    "Delay Time": "延时时间",
    "Delay Remain Time": "剩余延时时间",
    "Timeout Time": "超时时间",
    "Gradual Duration": "渐变时长",
    "Brightness Delta": "亮度变化量",
    "Color Temperature Delta": "色温变化量",
    "Light On Gradient Time": "开灯渐变时间",
    "Light Off Gradient Time": "关灯渐变时间",
    "Left Switch Sensor": "左开关传感器",
    "Right Switch Sensor": "右开关传感器",
    "Switch Sensor": "开关传感器",
    "Left Time": "剩余时间",
    "Auto Keep Warm": "自动保温",
    "Keep Warm Temperature": "保温温度",
    "Keep Warm Time": "保温时间",
    "Cook Time": "烹饪时间",
    "Cook Step": "烹饪步骤",
    "Continuous Cooking Time": "持续烹饪时间",
    "Pot Lift Memory": "提壶记忆",
    "Recipe Command": "食谱指令",
    "Recipe Id": "食谱ID",
    "Recipe Name": "食谱名称",
    "Recipe Type": "食谱类型",
    "Furnace Light Mode": "炉灯模式",
    "Steam Level": "蒸汽档位",
    "Microwave Level": "微波档位",
    "Water Box Status": "水箱状态",
    "Water Box Exist": "水箱存在",
    "Self Check": "自检",
    "Self Check Items": "自检项",
    "Self Check Results": "自检结果",
    "Manual Check Results": "手动检测结果",
    "Set Factory Reset Flag": "恢复出厂设置标志",
    "Request": "请求",
    "Response": "响应",
    "Silent Execution": "静默执行",
    "change-value": "变化值",
    "current-cook-mode": "当前烹饪模式",
    "custom": "自定义",
    "customer": "客户",
    "device-version": "设备版本",
    "left-toggle": "左路开关",
    "power-change": "电源变化",
    "remote-control": "远程控制",
    "right-toggle": "右路开关",
    "test-event-id": "测试事件ID",
    "toggle": "开关",
    "tv-switch": "电视开关",
    "version": "版本",
    "Access Mode": "访问模式",
    "Connected Device Number": "连接设备数",
    "Download Speed": "下载速度",
    "Upload Speed": "上传速度",
    "Max Download Speed": "最大下载速度",
    "Max Upload Speed": "最大上传速度",
    "Encrypted Strength": "加密强度",
    "Flex Switch": "灵活开关",
    "Device Manufacturer": "设备制造商",
    "Device Model": "设备型号",
    "Device Serial Number": "设备序列号",
    "Device ID": "设备ID",
    "Current Firmware Version": "当前固件版本",
    "Serial Number": "序列号",
    "Door State": "门状态",
    "Submersion State": "水浸状态",
    "reservation-left-time": "预约剩余时间",
    "Reservation Left Time": "预约剩余时间",
}


def cn_name(text: str) -> str:
    if not text:
        return text
    return SPEC_CN_NAMES.get(text, text)


class SpecManager:
    def __init__(self):
        os.makedirs(CACHE_DIR, exist_ok=True)
        self._instances_cache = None
        self._instances_cached_at = 0
        self._instances_ttl = 3600  # 1 hour

    def _cache_path(self, urn: str) -> str:
        name = hashlib.md5(urn.encode()).hexdigest()
        return os.path.join(CACHE_DIR, f"{name}.json")

    def get_spec(self, urn: str) -> dict:
        if not urn:
            return {}
        cache_file = self._cache_path(urn)
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        try:
            resp = requests.get(f"{SPEC_API}?type={urn}", timeout=10)
            if resp.status_code == 200:
                spec = resp.json()
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(spec, f, ensure_ascii=False)
                return spec
        except Exception as e:
            logger.warning(f"Failed to fetch spec for {urn}: {e}")
        return {}

    def get_instances(self) -> list:
        """Get miot-spec instances list with caching."""
        import time
        now = time.time()
        if self._instances_cache and (now - self._instances_cached_at) < self._instances_ttl:
            return self._instances_cache
        try:
            resp = requests.get(f"https://miot-spec.org/miot-spec-v2/instances?mode=list", timeout=15)
            if resp.status_code == 200:
                self._instances_cache = resp.json().get("instances", [])
                self._instances_cached_at = now
                return self._instances_cache
        except Exception as e:
            logger.warning(f"Failed to fetch instances list: {e}")
        return self._instances_cache or []

    def extract_controls(self, spec: dict) -> list:
        controls = []
        for service in spec.get("services", []):
            s_type = service.get("type", "")
            s_desc = cn_name(service.get("description", ""))
            for prop in service.get("properties", []):
                access = prop.get("access", [])
                if "write" in access or "notify" in access:
                    control = {
                        "siid": service.get("iid"),
                        "piid": prop.get("iid"),
                        "name": cn_name(prop.get("description", "")),
                        "service_name": s_desc,
                        "type": prop.get("type", ""),
                        "format": prop.get("format", ""),
                        "access": access,
                        "readable": "read" in access,
                        "writable": "write" in access,
                    }
                    val_range = prop.get("value-range")
                    if val_range:
                        control["control_type"] = "range"
                        control["min"] = val_range[0]
                        control["max"] = val_range[1]
                        control["step"] = val_range[2] if len(val_range) > 2 else 1
                    elif prop.get("value-list"):
                        control["control_type"] = "select"
                        control["options"] = prop["value-list"]
                        # 翻译选项名称
                        for opt in control["options"]:
                            if "description" in opt:
                                opt["description"] = cn_name(opt["description"])
                    elif prop.get("format") == "bool":
                        control["control_type"] = "toggle"
                    else:
                        control["control_type"] = "text"
                    controls.append(control)
            for action in service.get("actions", []):
                controls.append({
                    "siid": service.get("iid"),
                    "aiid": action.get("iid"),
                    "name": cn_name(action.get("description", "")),
                    "service_name": s_desc,
                    "control_type": "button",
                })
        return controls


spec_manager = SpecManager()
