"""BLE 设备管理：扫描、连接、命令下发、图片分块传输。"""

import asyncio
import math
import time
from contextlib import asynccontextmanager
from typing import Any, Callable, Dict, List, Optional

from bleak import BleakClient, BleakScanner

from .rle import rle_compress_mtu

EPD_SERVICE = "62750001-d828-918d-fb46-b6c11c675aec"
EPD_CHAR = "62750002-d828-918d-fb46-b6c11c675aec"
EPD_VERSION_CHAR = "62750003-d828-918d-fb46-b6c11c675aec"

# 带确认的写入如果一直等不到 ACK（固件正忙于初始化面板时会出现），
# 没有超时就会把整个请求挂死，所以每次写入都设上限。
WRITE_TIMEOUT = 10.0    # 单条命令
CHUNK_TIMEOUT = 5.0     # 图片分片
NOTIFY_SETTLE = 0.3     # 订阅通知后给固件一点时间再下第一条命令
MAX_FAIL_STREAK = 3     # 连续这么多个分片写入失败就放弃整帧，交给上层重试
MAX_SAFE_MTU = 244      # 固件没上报 MTU 时按链路推算的上限，别触发 ATT 长写
FALLBACK_MTU = 20       # 上位机的默认值，最保守的分片大小
# 有些墨水屏的广播间隔比一般 BLE 设备长，扫描太快结束会连着好几次都扫不到，
# 所以 find_device_by_address 的等待时间给足一点
CONNECT_SCAN_TIMEOUT = 25.0
# 弱信号（跨房间/隔墙）时丢包率会明显升高，按 RSSI 分三档收紧参数：
# 更小的 MTU 减少单包体积（丢一包重传代价更小），单片超时也放宽，
# 因为弱信号下固件处理/无线重传本身就更慢。
RSSI_WEAK = -75          # 低于这个值算弱信号
RSSI_POOR = -85          # 低于这个值算极弱信号
WEAK_SIGNAL_MTU = 100    # 弱信号时的分片上限（对应约 98 字节/片）
POOR_SIGNAL_MTU = 40     # 极弱信号时更保守
WEAK_SIGNAL_CHUNK_TIMEOUT = 8.0   # 弱信号时单片超时也放宽
POOR_SIGNAL_CHUNK_TIMEOUT = 12.0


class EpdCmd:
    SET_PINS = 0x00
    INIT = 0x01
    CLEAR = 0x02
    SEND_CMD = 0x03
    SEND_DATA = 0x04
    REFRESH = 0x05
    SLEEP = 0x06

    SET_TIME = 0x20

    WRITE_IMG = 0x30  # v1.6

    SET_CONFIG = 0x90
    SYS_RESET = 0x91
    SYS_SLEEP = 0x92
    CFG_ERASE = 0x99


class EpdError(Exception):
    """BLE 操作失败。"""


class EpdManager:
    """单连接模型：同一时刻只维持一个墨水屏连接，所有 BLE 操作串行执行。"""

    def __init__(self, emit: Callable[[Dict[str, Any]], None]):
        self._emit = emit
        self._client: Optional[BleakClient] = None
        self._lock = asyncio.Lock()
        self._msg_index = 0
        self.address: Optional[str] = None
        self.name: Optional[str] = None
        self.mtu = 20
        self.rle_support = False
        self.version: Optional[str] = None
        self.small_screen = False      # 固件版本以 -s 结尾：小屏驱动表
        self.chip: Optional[str] = None
        self.pins: Optional[str] = None
        self.driver: Optional[str] = None
        self.battery_mv: Optional[int] = None
        self.clock_enable: Optional[bool] = None
        self.nrf_dfu: Optional[bool] = None
        self.a0_fix = False
        self.slots: Dict[str, Any] = {"count": 0, "used_mask": 0, "selected": -1}
        self.busy = False
        self._init_at = 0.0  # 最近一次 INIT 的时间，用来避免连接后立刻重复 INIT
        self._write_response_ok = True  # 写特征是否支持带确认的写入
        self.rssi: Optional[int] = None      # 连接时的信号强度，用来收紧弱信号下的传输参数
        self.chunk_timeout = CHUNK_TIMEOUT   # 按 rssi 调整过的单片超时

    # ---------- 事件 ----------

    def log(self, text: str, action: str = "") -> None:
        self._emit({"type": "log", "action": action, "text": text})

    def _status_event(self) -> None:
        self._emit({"type": "status", "status": self.status()})

    def status(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "address": self.address,
            "name": self.name,
            "mtu": self.mtu,
            "rle": self.rle_support,
            "rssi": self.rssi,
            "version": self.version,
            "small_screen": self.small_screen,
            "chip": self.chip,
            "pins": self.pins,
            "driver": self.driver,
            "battery_mv": self.battery_mv,
            "clock_enable": self.clock_enable,
            "nrf_dfu": self.nrf_dfu,
            "a0_fix": self.a0_fix,
            "slots": dict(self.slots),
            "busy": self.busy,
        }

    @property
    def connected(self) -> bool:
        return self._client is not None and self._client.is_connected

    # ---------- 扫描 / 连接 ----------

    async def scan(self, timeout: float = 6.0) -> List[Dict[str, Any]]:
        self.log(f"开始扫描蓝牙设备（{timeout}s）…")
        try:
            found = await BleakScanner.discover(timeout=timeout, return_adv=True)
        except Exception as e:  # 适配器缺失 / 权限不足
            raise EpdError(f"扫描失败: {e}") from e

        result = []
        for address, (device, adv) in found.items():
            uuids = [u.lower() for u in (adv.service_uuids or [])]
            result.append({
                "address": address.upper(),
                "name": device.name or adv.local_name or "(未知设备)",
                "rssi": adv.rssi,
                "is_epd": EPD_SERVICE in uuids,
            })
        result.sort(key=lambda d: (not d["is_epd"], -(d["rssi"] or -999)))
        self.log(f"扫描完成，发现 {len(result)} 个设备")
        return result

    def _on_disconnect(self, _client: BleakClient) -> None:
        self.log("已断开连接.")
        self._client = None
        self._msg_index = 0
        self._status_event()

    async def connect(self, address: str, timeout: float = CONNECT_SCAN_TIMEOUT) -> Dict[str, Any]:
        async with self._lock:
            await self._disconnect_locked()
            self._msg_index = 0
            self.mtu = 20
            self.rle_support = False
            self.pins = None
            self.driver = None
            self.battery_mv = None
            self.clock_enable = None
            self.nrf_dfu = None
            self.a0_fix = False
            self.slots = {"count": 0, "used_mask": 0, "selected": -1}
            self._init_at = 0.0
            self._write_response_ok = True
            self.rssi = None
            self.chunk_timeout = CHUNK_TIMEOUT

            self.log(f"正在连接: {address}")
            addr_upper = address.upper()
            adv_rssi = {}

            def _match(device, adv):
                if device.address.upper() == addr_upper:
                    adv_rssi["rssi"] = adv.rssi
                    return True
                return False

            # 扫描本身也可能抛底层异常（如 BlueZ 一时报 "No Bluetooth adapters
            # found."——适配器在容器/宿主里偶发瞬时不可用），必须包成 EpdError：
            # 一是让前端拿到清晰的 400 而不是 500，二是让 /api/image 的 auto_retry
            # 能识别并转入定时轮询，而不是当成未捕获异常直接崩掉这次请求。
            try:
                device = await BleakScanner.find_device_by_filter(_match, timeout=timeout)
            except EpdError:
                raise
            except Exception as e:
                raise EpdError(f"扫描失败: {e or repr(e)}") from e
            if device is None:
                raise EpdError(f"未找到设备 {address}，请确认墨水屏已上电且在范围内")
            self.rssi = adv_rssi.get("rssi")
            if self.rssi is not None:
                self.log(f"  信号强度: {self.rssi}dBm")

            client = BleakClient(device, timeout=timeout,
                                 disconnected_callback=self._on_disconnect)
            try:
                await client.connect()
            except Exception as e:
                # BleakError 有时 str() 是空的（比如底层 D-Bus 报错没带文本），用 repr 兜底
                raise EpdError(f"连接失败: {e or repr(e)}") from e

            self._client = client
            self.address = addr_upper
            self.name = device.name or address
            self.log("  找到 GATT Server")
            await self._post_connect(client)
            self._status_event()
            return self.status()

    async def _post_connect(self, client: BleakClient) -> None:
        if client.services.get_service(EPD_SERVICE) is None:
            raise EpdError("设备不包含 EPD Service，可能不是墨水屏固件")
        self.log("  找到 EPD Service")

        # 写特征如果只声明了 write-without-response，用带确认的写法会永远等不到回调
        # （数据其实已经发出去、屏也会闪一下，但请求就挂在那儿），所以按属性决定写法。
        self._write_response_ok = True
        try:
            char = client.services.get_characteristic(EPD_CHAR)
            props = [str(p) for p in (char.properties or [])] if char else []
            if props:
                self.log(f"  写特征属性: {', '.join(props)}")
                self._write_response_ok = "write" in props
                if not self._write_response_ok:
                    self.log("  该特征不支持带确认的写入，改用 write-without-response")
        except Exception as e:
            self.log(f"读取写特征属性失败: {e}")

        # 版本特征值：新固件是字符串（如 "1.7-nrf5"、"-s" 后缀表示小屏），旧固件是单字节
        self.version = None
        self.small_screen = False
        self.chip = None
        try:
            data = await client.read_gatt_char(EPD_VERSION_CHAR)
            if len(data) > 1:
                text = bytes(data).decode("utf-8", errors="replace").rstrip("\x00")
                self.version = text
                self.small_screen = text.endswith("-s")
                parts = text.split("-")
                self.chip = parts[1].lower() if len(parts) > 1 else "nrf5"
            else:
                self.version = f"0x{data[0]:02x}"
                self.chip = "nrf5"
                if data[0] < 0x16:
                    self.log("注意：固件版本过低（<1.6），部分功能可能不可用")
            self.log(f"固件版本: {self.version}")
        except Exception:
            self.log("读取固件版本失败")

        try:
            await client.start_notify(EPD_CHAR, self._on_notify)
        except Exception as e:
            self.log(f"startNotifications: {e}")

        # 固件会通过通知上报真实 MTU；拿不到时用链路 MTU 兜底，但要封顶：
        # macOS 上 mtu_size 可能报到 500+，按它切片会触发 ATT 长写（prepare/execute），
        # 固件不支持长写时那笔写入永远不会完成——上位机的 MTU 输入框上限也只有 255。
        #
        # BlueZ 后端（Linux/容器）不会自动填 mtu_size：不先调 _acquire_mtu() 的话
        # 它固定返回 23 并打 "Using default MTU value" 警告，于是分片退化成 18 字节，
        # 一帧 3 万字节要切近 1700 片、传 27 秒，中途极易撞上写入超时。
        await self._acquire_mtu(client)
        link_mtu = getattr(client, "mtu_size", 0) or 0
        if link_mtu > 23:
            self.mtu = min(link_mtu - 3, MAX_SAFE_MTU)

        # 信号弱时丢包率明显升高，进一步收紧分片大小和单片超时：
        # 包更小丢一片的代价更小，超时放宽给固件/无线重传留够时间。
        downgrade_reason = ""
        if self.rssi is not None and self.rssi <= RSSI_POOR:
            self.mtu = min(self.mtu, POOR_SIGNAL_MTU)
            self.chunk_timeout = POOR_SIGNAL_CHUNK_TIMEOUT
            downgrade_reason = f"，信号极弱（{self.rssi}dBm）已收紧分片/超时"
        elif self.rssi is not None and self.rssi <= RSSI_WEAK:
            self.mtu = min(self.mtu, WEAK_SIGNAL_MTU)
            self.chunk_timeout = WEAK_SIGNAL_CHUNK_TIMEOUT
            downgrade_reason = f"，信号偏弱（{self.rssi}dBm）已收紧分片/超时"

        self.log(f"  分片大小 MTU={self.mtu}"
                 + (f"（链路 ATT MTU={link_mtu}，固件未上报）" if link_mtu > 23
                    else "（默认值，未取到链路 MTU）")
                 + downgrade_reason)

        # 订阅刚建立就写命令，部分固件会漏掉或不回 ACK，先缓一下
        self.log("  已订阅通知，准备发送 INIT")
        await asyncio.sleep(NOTIFY_SETTLE)
        await self._write_locked(EpdCmd.INIT)
        self._init_at = time.monotonic()
        self.log("  INIT 已确认，等待固件回传配置")
        await asyncio.sleep(0.5)  # 等固件回传配置与 mtu
        self.log("  连接就绪")

    async def _acquire_mtu(self, client: BleakClient) -> None:
        """BlueZ 后端要先 AcquireWrite 一次才知道真实 ATT MTU，CoreBluetooth 不需要。

        注意 `_acquire_mtu` / `_mtu_size` 在后端对象上（`client._backend`），
        BleakClient 这层门面没有这两个属性，直接 getattr 会永远取不到。
        """
        backend = getattr(client, "_backend", None) or client
        if getattr(backend, "_mtu_size", None) is not None:
            return
        acquire = getattr(backend, "_acquire_mtu", None)
        if acquire is None:
            return
        try:
            await asyncio.wait_for(acquire(), timeout=WRITE_TIMEOUT)
        except Exception as e:
            self.log(f"  取链路 MTU 失败（按默认分片走）: {e}")

    def _on_notify(self, _sender: Any, data: bytearray) -> None:
        idx = self._msg_index
        self._msg_index += 1
        raw = bytes(data)
        if idx == 0:
            self.pins = raw[0:7].hex()
            if len(raw) > 10:
                self.pins += raw[10:11].hex()
            self.driver = raw[7:8].hex()
            if len(raw) > 13:
                self.slots["selected"] = raw[13]
            self.log(f"收到配置：{raw.hex()}")
            self._status_event()
            return

        msg = raw.decode("utf-8", errors="replace")
        self.log(msg, "⇓")
        self._parse_notify_text(msg)

    def _parse_notify_text(self, msg: str) -> None:
        if msg.startswith("err="):
            if msg[4:] == "busy":
                self.log("屏幕正在刷新中，请稍后再试")
            return

        if msg.startswith("mtu=") and len(msg) > 4:
            fields = msg[4:].split()
            try:
                self.mtu = int(fields[0])
                self.log(f"MTU 已更新为: {self.mtu}")
            except ValueError:
                pass
            if len(fields) > 1 and fields[1] == "rle=1":
                self.rle_support = True
                self.log("已开启 RLE 压缩传输支持")
        elif msg.startswith("t=") and len(msg) > 2:
            fields = msg[2:].split()
            try:
                self.log(f"远端时间戳: {int(fields[0])}")
            except ValueError:
                pass
            if len(fields) > 1 and fields[1].startswith("bat="):
                try:
                    mv = int(fields[1][4:])
                    if mv > 0:
                        self.battery_mv = mv
                        self.log(f"电池电压: {mv} mV")
                except ValueError:
                    pass
        elif msg.startswith("clock_enable="):
            self.clock_enable = msg[13:] == "1"
            if not self.clock_enable:
                self.log("提醒：此固件版本不支持时钟模式")
        elif msg.startswith("nrf_dfu="):
            self.nrf_dfu = msg[8:] == "1"
        elif msg.startswith("a0_fix="):
            self.a0_fix = msg[7:] == "1"
        elif msg.startswith("slots=") and len(msg) > 6:
            fields = msg[6:].split()
            try:
                self.slots["count"] = int(fields[0])
                if len(fields) > 1 and fields[1].strip():
                    self.slots["used_mask"] = int(fields[1])
                if len(fields) > 2:
                    self.slots["selected"] = int(fields[2])
            except ValueError:
                pass
        elif msg.startswith("sid="):
            # epdiy.cn 上位机会拿它去服务端校验授权；自建服务无需校验，仅记录
            return
        else:
            return
        self._status_event()

    # ---------- 写入 ----------

    async def _write_locked(self, cmd: int, data: bytes = b"",
                            response: bool = True, log: bool = True,
                            timeout: float = WRITE_TIMEOUT) -> None:
        client = self._client
        if client is None or not client.is_connected:
            raise EpdError("蓝牙未连接")
        payload = bytes([cmd]) + data
        if log:
            self.log(payload.hex(), "⇑")
        # 特征不支持带确认写入时强制降级，否则会一直等不到 didWrite 回调
        response = response and self._write_response_ok
        try:
            await asyncio.wait_for(
                client.write_gatt_char(EPD_CHAR, payload, response=response),
                timeout=timeout)
        except asyncio.TimeoutError as e:
            raise EpdError(f"写入超时：{timeout}s 内没有收到确认") from e
        except Exception as e:
            raise EpdError(f"write: {e}") from e

    async def write(self, cmd: int, data: bytes = b"", response: bool = True) -> None:
        async with self._lock:
            await self._write_locked(cmd, data, response)

    async def disconnect(self) -> None:
        async with self._lock:
            await self._disconnect_locked()
        self._status_event()

    @asynccontextmanager
    async def session(self, address: Optional[str] = None):
        """按需连接：已连接则复用（手动连接便于调试），否则用完即断。"""
        auto = not self.connected
        if auto:
            if not address:
                raise EpdError("设备未连接，且未指定要连接的设备")
            await self.connect(address)
        try:
            yield self
        finally:
            if auto:
                await self.disconnect()

    async def _disconnect_locked(self) -> None:
        client = self._client
        self._client = None
        self._init_at = 0.0
        if client is not None and client.is_connected:
            try:
                await client.disconnect()
            except Exception as e:
                self.log(f"disconnect: {e}")

    # ---------- 高层操作 ----------

    async def set_driver(self, pins: str, driver: str) -> None:
        async with self._lock:
            if pins:
                await self._write_locked(EpdCmd.SET_PINS, bytes.fromhex(pins))
            await self._write_locked(EpdCmd.INIT, bytes.fromhex(driver))
            self._init_at = time.monotonic()

    async def sync_time(self, mode: int, tz_offset: int = 8) -> None:
        ts = int(time.time())
        data = bytes([
            (ts >> 24) & 0xFF, (ts >> 16) & 0xFF, (ts >> 8) & 0xFF, ts & 0xFF,
            tz_offset & 0xFF, mode & 0xFF,
        ])
        async with self._lock:
            await self._write_locked(EpdCmd.SET_TIME, data)
        self.log("时间已同步！屏幕刷新完成前请不要操作。")

    async def clear_screen(self) -> None:
        async with self._lock:
            await self._write_locked(EpdCmd.CLEAR)
        self.log("清屏指令已发送！屏幕刷新完成前请不要操作。")

    async def sys_command(self, action: str) -> None:
        cmd = {"reset": EpdCmd.SYS_RESET, "erase": EpdCmd.CFG_ERASE,
               "sleep": EpdCmd.SYS_SLEEP}.get(action)
        if cmd is None:
            raise EpdError(f"不支持的系统操作: {action}")
        async with self._lock:
            await self._write_locked(cmd)
        self.log({"reset": "重启指令已发送", "erase": "恢复出厂指令已发送",
                  "sleep": "休眠指令已发送"}[action])

    # ---------- 图片传输 ----------

    async def send_image(self, planes: List[Dict[str, Any]],
                         interleaved: int = 10, mtu: Optional[int] = None) -> Dict[str, Any]:
        """planes: [{"step": "bw"|"red", "data": bytes}]，顺序即发送顺序。"""
        if not planes:
            raise EpdError("没有要发送的图像数据")
        if self.busy:
            raise EpdError("正在传输图片，请稍候")

        start = time.time()
        self.busy = True
        self._status_event()
        failed = 0
        compressed = 0
        original = 0
        try:
            self.log(f"开始发送图片：{len(planes)} 个位面，MTU={self.mtu}，"
                     f"确认间隔={interleaved}")
            async with self._lock:
                if mtu and mtu >= 20:
                    self.mtu = mtu
                # 每帧之前都 INIT 一次，和验证过的上位机、以及「手动连接后再发送」的
                # 路径完全一致；非标固件的坑太多，这里不做省略优化。
                await self._write_locked(EpdCmd.INIT)
                self._init_at = time.monotonic()
                await asyncio.sleep(0.5)  # 等固件初始化完驱动

                # 分片写不动时（多半是 MTU 猜大了）退到最保守的分片大小重来一遍
                try:
                    failed, compressed, original = await self._write_planes(
                        planes, interleaved)
                except EpdError as e:
                    if not self.connected or self.mtu <= FALLBACK_MTU:
                        raise
                    self.log(f"传输失败（{e}），退到 MTU={FALLBACK_MTU} 重试整帧")
                    self.mtu = FALLBACK_MTU
                    self._status_event()
                    failed, compressed, original = await self._write_planes(
                        planes, interleaved)
                await self._write_locked(EpdCmd.REFRESH)
        finally:
            self.busy = False
            self._status_event()

        elapsed = round(time.time() - start, 2)
        ratio = round(compressed / original * 100, 2) if compressed and original else None
        text = f"发送完成！耗时: {elapsed}s"
        if ratio is not None:
            text += f"（压缩比: {ratio}%）"
        if failed:
            text += f"，失败块数: {failed}，若显示不正常请重新发送"
        self.log(text + "，屏幕刷新完成前请不要操作。")
        self._emit({"type": "progress", "step": "done", "current": 1, "total": 1,
                    "elapsed": elapsed, "ratio": ratio, "failed": failed})
        return {"elapsed": elapsed, "ratio": ratio, "failed": failed}

    async def _write_planes(self, planes: List[Dict[str, Any]],
                            interleaved: int) -> tuple:
        """按当前 MTU 把所有位面写一遍，返回 (失败块数, 压缩后, 原始)。"""
        failed = compressed = original = 0
        for plane in planes:
            stat = await self._write_image(bytes(plane["data"]),
                                          plane.get("step", "bw"), interleaved)
            failed += stat["failed"]
            compressed += stat["compressed"]
            original += stat["original"]
        return failed, compressed, original

    async def _write_image(self, data: bytes, step: str,
                           interleaved: int) -> Dict[str, int]:
        chunk_size = self.mtu - 2
        if chunk_size < 1:
            raise EpdError(f"MTU 过小: {self.mtu}")

        rle_chunks = rle_compress_mtu(data, chunk_size) if self.rle_support else None
        rle_len = sum(len(c) for c in rle_chunks) if rle_chunks else len(data)
        use_rle = self.rle_support and rle_len < len(data)
        total = len(rle_chunks) if use_rle else math.ceil(len(data) / chunk_size)
        self.log(f"传输{'红色块' if step == 'red' else '数据块'}: {len(data)} 字节, "
                 f"{total} 个分片, MTU={self.mtu}, RLE={'开' if use_rle else '关'}")

        failed = 0
        streak = 0  # 连续失败次数
        no_reply = interleaved
        for i in range(total):
            if use_rle:
                chunk = rle_chunks[i]
            else:
                chunk = data[i * chunk_size:(i + 1) * chunk_size]

            if self.rle_support:
                flags = ((0x00 if step == "bw" else 0x01)
                         | (0x02 if i == 0 else 0x00)
                         | (0x04 if use_rle else 0x00))
            else:
                flags = (0x0F if step == "bw" else 0x00) | (0x00 if i == 0 else 0xF0)

            with_response = no_reply <= 0
            try:
                await self._write_locked(EpdCmd.WRITE_IMG, bytes([flags]) + chunk,
                                         response=with_response, log=False,
                                         timeout=self.chunk_timeout)
            except EpdError as e:
                # 弱信号下偶发丢包很正常，先原地重试一次同一片，别急着计入失败——
                # 大部分情况下第二次就通了，能明显抬高整体成功率
                if not self.connected:
                    raise
                try:
                    await self._write_locked(EpdCmd.WRITE_IMG, bytes([flags]) + chunk,
                                             response=with_response, log=False,
                                             timeout=self.chunk_timeout)
                except EpdError as e2:
                    # 单个分片失败不中断整帧，与上位机一致，最后统计失败块数；
                    # 但连续失败说明链路已经不行了，早点报错让上层重试，别耗在超时上
                    if not self.connected:
                        raise
                    failed += 1
                    streak += 1
                    if failed == 1:
                        self.log(f"分片写入失败（重试后仍失败）: {e2}")
                    if streak >= MAX_FAIL_STREAK:
                        raise EpdError(
                            f"连续 {streak} 个分片写入失败，链路可能已断开：{e2}") from e2
                else:
                    streak = 0
            else:
                streak = 0
            no_reply = interleaved if with_response else no_reply - 1
            # 不能用带确认的写入时，没有天然的流控，每隔 interleaved 个分片让一次路，
            # 避免把系统的写队列灌满导致丢包
            if not self._write_response_ok and interleaved > 0 \
                    and (i + 1) % interleaved == 0:
                await asyncio.sleep(0.02)

            if i % 10 == 0 or i == total - 1:
                self._emit({"type": "progress", "step": step, "current": i + 1,
                            "total": total, "elapsed": None})

        return {"failed": failed,
                "compressed": rle_len if use_rle else 0,
                "original": len(data) if use_rle else 0}

