from pydantic import BaseModel


class LocalDeviceAddRequest(BaseModel):
    name: str
    ip: str
    token: str
    model: str = ""
    type: str = "unknown"


class DeviceActionRequest(BaseModel):
    action: str
    params: dict = {}
    use_cloud: bool = False
