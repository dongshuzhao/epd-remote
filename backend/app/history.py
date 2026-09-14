"""发送历史：按设备记录每次成功发送的模板与填写内容，可回滚到任意版本。

只存模板名和变量这类小数据，不存图像本身——回滚时在前端重新渲染即可，
所以「图片」类型的历史只记录一条痕迹，没法还原原始文件。
"""

import json
import os
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

DATA_DIR = os.environ.get("EPD_DATA_DIR", "/data")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")

# 每台设备最多保留的版本数，超出后丢掉最旧的
MAX_PER_DEVICE = 50

_lock = threading.Lock()

FIELDS = (
    "address",
    "template",          # 模板 name，如 "homework"；空串表示空白画布
    "template_display",  # 模板中文名，用于生成版本名称
    "vars",              # 模板变量表
    "canvas_size",
    "color_mode",
    "driver",
    "note",
)


def _ensure_file() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump({"entries": []}, f, ensure_ascii=False, indent=2)


def _read() -> Dict[str, Any]:
    _ensure_file()
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"entries": []}
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return {"entries": []}
    return data


def _write(data: Dict[str, Any]) -> None:
    _ensure_file()
    tmp = HISTORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, HISTORY_FILE)


def list_entries(address: Optional[str] = None) -> List[Dict[str, Any]]:
    """按时间倒序返回，最新的在最前面。"""
    entries = _read()["entries"]
    if address:
        addr = address.upper()
        entries = [e for e in entries if str(e.get("address", "")).upper() == addr]
    return sorted(entries, key=lambda e: str(e.get("created_at", "")), reverse=True)


def add_entry(payload: Dict[str, Any]) -> Dict[str, Any]:
    address = str(payload.get("address") or "").strip()
    if not address:
        raise ValueError("address 不能为空")

    entry = {k: payload[k] for k in FIELDS if k in payload and payload[k] is not None}
    entry["address"] = address.upper()
    entry["id"] = uuid.uuid4().hex[:12]
    entry["created_at"] = datetime.now().isoformat(timespec="seconds")

    with _lock:
        data = _read()
        data["entries"].append(entry)
        # 按设备裁剪，只保留最近 MAX_PER_DEVICE 条
        same = [e for e in data["entries"]
                if str(e.get("address", "")).upper() == entry["address"]]
        if len(same) > MAX_PER_DEVICE:
            drop = {e["id"] for e in sorted(same, key=lambda e: str(e.get("created_at", "")))
                    [: len(same) - MAX_PER_DEVICE]}
            data["entries"] = [e for e in data["entries"] if e.get("id") not in drop]
        _write(data)
    return entry


def delete_entry(entry_id: str) -> bool:
    with _lock:
        data = _read()
        before = len(data["entries"])
        data["entries"] = [e for e in data["entries"] if e.get("id") != entry_id]
        if len(data["entries"]) == before:
            return False
        _write(data)
    return True


def clear_entries(address: str) -> int:
    """清空某台设备的全部历史，返回删除条数。"""
    addr = str(address or "").strip().upper()
    if not addr:
        raise ValueError("address 不能为空")
    with _lock:
        data = _read()
        keep = [e for e in data["entries"]
                if str(e.get("address", "")).upper() != addr]
        removed = len(data["entries"]) - len(keep)
        if removed:
            data["entries"] = keep
            _write(data)
    return removed
