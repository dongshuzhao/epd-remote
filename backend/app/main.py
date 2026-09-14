"""EPD 远程管理服务：前端负责图像生成，后端负责蓝牙。"""

import asyncio
import base64
import os
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import devices as devstore
from . import history as histstore
from .ble import EpdError, EpdManager
from .retry import RetryTask

FRONTEND_DIR = os.environ.get("EPD_FRONTEND_DIR", "/app/frontend")

# 单次「连接 → 发送 → 断开」的上限，超过就当失败返回，让前端去重试
IMAGE_TIMEOUT = float(os.environ.get("EPD_IMAGE_TIMEOUT", "180"))

_subscribers: "set[asyncio.Queue]" = set()


def emit(event: Dict[str, Any]) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


manager = EpdManager(emit)
retry_task = RetryTask(emit)
app = FastAPI(title="EPD 远程管理", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(EpdError)
async def _epd_error_handler(_request, exc: EpdError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


class ScanReq(BaseModel):
    timeout: float = Field(6.0, ge=1, le=30)


class ConnectReq(BaseModel):
    address: str


class CmdReq(BaseModel):
    hex: str  # 首字节为命令，其余为参数
    address: Optional[str] = None


class DriverReq(BaseModel):
    pins: str = ""
    driver: str
    address: Optional[str] = None


class TimeReq(BaseModel):
    mode: int = Field(1, ge=1, le=2)  # 1=日历 2=时钟
    tz_offset: int = 8
    address: Optional[str] = None


class ClearReq(BaseModel):
    address: Optional[str] = None


class SysReq(BaseModel):
    action: str  # reset | erase | sleep
    address: Optional[str] = None


class Plane(BaseModel):
    step: str = "bw"
    data: str  # base64


class ImageReq(BaseModel):
    planes: List[Plane]
    interleaved: int = Field(10, ge=0, le=500)
    mtu: Optional[int] = None
    address: Optional[str] = None
    auto_retry: bool = False  # 前端重试次数用尽后仍失败，交给后端进入定时轮询


# ---------- 状态 / 连接 ----------

@app.get("/api/status")
async def api_status():
    return manager.status()


@app.post("/api/scan")
async def api_scan(req: ScanReq):
    found = await manager.scan(req.timeout)
    known = {d["address"].upper(): d for d in devstore.list_devices()}
    for d in found:
        d["saved"] = d["address"] in known
    return {"devices": found}


@app.post("/api/connect")
async def api_connect(req: ConnectReq):
    return await manager.connect(req.address)


@app.post("/api/disconnect")
async def api_disconnect():
    await manager.disconnect()
    return manager.status()


# ---------- 设备控制 ----------
# 这些接口都支持“未连接时临时连接、用完自动断开”：
# 传 address 即可；若已经手动连接，则复用当前连接且不断开。

@app.post("/api/driver")
async def api_driver(req: DriverReq):
    pins, driver = req.pins.strip(), req.driver.strip()
    try:
        bytes.fromhex(pins)
        bytes.fromhex(driver)
    except ValueError:
        raise HTTPException(400, "引脚或驱动参数不是合法的 hex 串")
    async with manager.session(req.address):
        await manager.set_driver(pins, driver)
    return {"ok": True}


@app.post("/api/time")
async def api_time(req: TimeReq):
    async with manager.session(req.address):
        await manager.sync_time(req.mode, req.tz_offset)
    return {"ok": True}


@app.post("/api/clear")
async def api_clear(req: ClearReq = Body(default=ClearReq())):
    async with manager.session(req.address):
        await manager.clear_screen()
    return {"ok": True}


@app.post("/api/cmd")
async def api_cmd(req: CmdReq):
    try:
        raw = bytes.fromhex(req.hex.strip().replace(" ", ""))
    except ValueError:
        raise HTTPException(400, "不是合法的 hex 串")
    if not raw:
        raise HTTPException(400, "命令为空")
    async with manager.session(req.address):
        await manager.write(raw[0], raw[1:])
    return {"ok": True}


@app.post("/api/sys")
async def api_sys(req: SysReq):
    async with manager.session(req.address):
        await manager.sys_command(req.action)
    return {"ok": True}


@app.post("/api/image")
async def api_image(req: ImageReq):
    planes = _decode_planes(req.planes)
    if not req.auto_retry:
        return await _send_once(planes, req.interleaved, req.mtu, req.address)

    # 最后一次尝试交给后端完整负责：连接失败、发送失败都在这一次 try 里，
    # 任何一步出错都转入后台轮询——不能像前端那样只兜住发送阶段的异常，
    # 设备离线时失败往往发生在更早的连接阶段。
    address = req.address or devstore.get_last_address()
    if not address:
        raise EpdError("无法进入自动轮询：不知道目标设备地址")
    try:
        return await _send_once(planes, req.interleaved, req.mtu, address)
    except (EpdError, asyncio.TimeoutError, HTTPException) as e:
        message = e.detail if isinstance(e, HTTPException) else str(e)
        dev = devstore.get_device(address)
        name = (dev or {}).get("name") or address

        async def _retry_send():
            await _send_once(planes, req.interleaved, req.mtu, address)

        retry_task.start(address, name, _retry_send)
        manager.log(f"发送失败（{message}），已转入自动轮询，每 {int(retry_task.POLL_INTERVAL_S)}s 重试一次")
        # 200 而非异常状态码：这不是接口调用失败，是「已受理、转入后台轮询」的正常结果，
        # 前端靠 auto_retry 字段区分「发送成功」和「已转入轮询」两种情况
        return {"auto_retry": True, "error": str(message), "retry": retry_task.status()}


def _decode_planes(planes: List[Plane]) -> List[Dict[str, Any]]:
    result = []
    for p in planes:
        try:
            result.append({"step": p.step, "data": base64.b64decode(p.data)})
        except Exception:
            raise HTTPException(400, "图像数据不是合法的 base64")
    return result


async def _send_once(planes: List[Dict[str, Any]], interleaved: int,
                     mtu: Optional[int], address: Optional[str]) -> Dict[str, Any]:
    # 兜底看门狗：BLE 层每笔写入都有超时，但连接/协商阶段仍可能被系统卡住，
    # 这里给整个「连接 → 发送 → 断开」加个上限，避免请求永远挂着
    try:
        async with manager.session(address):
            return await asyncio.wait_for(
                manager.send_image(planes, interleaved, mtu),
                timeout=IMAGE_TIMEOUT)
    except asyncio.TimeoutError:
        manager.log(f"发送超时：{IMAGE_TIMEOUT}s 内没有完成，已放弃本次传输")
        raise HTTPException(504, f"发送超时（{IMAGE_TIMEOUT}s）")


# ---------- 自动轮询重试 ----------
# 前端重试 N 次仍失败后，交给后端每隔固定时间检查设备是否在范围内并重发；
# 只在内存里维护，进程重启会丢失（图像数据不落盘，参见 retry.py 的说明）。

@app.get("/api/retry")
async def api_retry_status():
    return retry_task.status()


@app.post("/api/retry/cancel")
async def api_retry_cancel():
    retry_task.cancel()
    return retry_task.status()


# ---------- 设备记忆 ----------

@app.get("/api/devices")
async def api_devices():
    return {"devices": devstore.list_devices(), "last_address": devstore.get_last_address()}


class LastDeviceReq(BaseModel):
    address: str = ""


@app.post("/api/devices/last")
async def api_device_last(req: LastDeviceReq):
    return {"last_address": devstore.set_last_address(req.address)}


@app.post("/api/devices")
async def api_device_save(payload: Dict[str, Any] = Body(...)):
    try:
        return devstore.save_device(payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/devices/{address}")
async def api_device_delete(address: str):
    if not devstore.delete_device(address):
        raise HTTPException(404, "设备不存在")
    return {"ok": True}


# ---------- 发送历史 ----------

@app.get("/api/history")
async def api_history(address: str = ""):
    return {"entries": histstore.list_entries(address or None)}


@app.post("/api/history")
async def api_history_add(payload: Dict[str, Any] = Body(...)):
    try:
        return histstore.add_entry(payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/history")
async def api_history_clear(address: str = ""):
    try:
        return {"removed": histstore.clear_entries(address)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/history/{entry_id}")
async def api_history_delete(entry_id: str):
    if not histstore.delete_entry(entry_id):
        raise HTTPException(404, "版本不存在")
    return {"ok": True}


# ---------- 日志 / 进度推送 ----------

@app.websocket("/api/ws")
async def ws_events(ws: WebSocket):
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    _subscribers.add(queue)
    try:
        await ws.send_json({"type": "status", "status": manager.status()})
        await ws.send_json({"type": "retry_status", "retry": retry_task.status()})
        while True:
            event = await queue.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _subscribers.discard(queue)


if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

