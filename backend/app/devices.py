"""设备记忆：把常用墨水屏的地址与参数存到本地 JSON。"""

import json
import os
import threading
from typing import Any, Dict, List, Optional

DATA_DIR = os.environ.get("EPD_DATA_DIR", "/data")
DEVICES_FILE = os.path.join(DATA_DIR, "devices.json")

_lock = threading.Lock()

# 允许保存的字段（其余字段忽略，避免文件被写脏）
FIELDS = (
    "address",
    "name",
    "driver",       # 驱动编号，如 "01"
    "pins",         # 引脚配置 hex 串
    "canvas_size",  # 如 "4.2_400_300"
    "color_mode",   # 如 "blackWhiteColor"
    "mtu",
    "interleaved",
    "note",
)


def _ensure_file() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DEVICES_FILE):
        with open(DEVICES_FILE, "w", encoding="utf-8") as f:
            json.dump({"devices": []}, f, ensure_ascii=False, indent=2)


def _read() -> Dict[str, Any]:
    _ensure_file()
    try:
        with open(DEVICES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"devices": []}
    if not isinstance(data, dict) or not isinstance(data.get("devices"), list):
        return {"devices": []}
    return data


def _write(data: Dict[str, Any]) -> None:
    _ensure_file()
    tmp = DEVICES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DEVICES_FILE)


def list_devices() -> List[Dict[str, Any]]:
    return _read()["devices"]


def get_device(address: str) -> Optional[Dict[str, Any]]:
    addr = address.upper()
    for d in list_devices():
        if str(d.get("address", "")).upper() == addr:
            return d
    return None


def save_device(payload: Dict[str, Any]) -> Dict[str, Any]:
    address = str(payload.get("address") or "").strip()
    if not address:
        raise ValueError("address 不能为空")

    entry = {k: payload[k] for k in FIELDS if k in payload and payload[k] is not None}
    entry["address"] = address.upper()

    with _lock:
        data = _read()
        devices = data["devices"]
        for i, d in enumerate(devices):
            if str(d.get("address", "")).upper() == entry["address"]:
                merged = dict(d)
                merged.update(entry)
                devices[i] = merged
                _write(data)
                return merged
        devices.append(entry)
        _write(data)
    return entry


def delete_device(address: str) -> bool:
    addr = address.upper()
    with _lock:
        data = _read()
        before = len(data["devices"])
        data["devices"] = [
            d for d in data["devices"] if str(d.get("address", "")).upper() != addr
        ]
        if len(data["devices"]) == before:
            return False
        if str(data.get("last_address", "")).upper() == addr:
            data.pop("last_address", None)
        _write(data)
    return True


# 上次使用的设备：页面加载时用它恢复目标设备与历史版本
def get_last_address() -> Optional[str]:
    value = _read().get("last_address")
    return str(value) if value else None


def set_last_address(address: str) -> Optional[str]:
    addr = str(address or "").strip().upper()
    with _lock:
        data = _read()
        if addr:
            data["last_address"] = addr
        else:
            data.pop("last_address", None)
        _write(data)
    return addr or None
