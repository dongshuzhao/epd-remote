"""发送失败后的自动轮询重试：每隔固定时间检查设备是否在范围内，若能连上就发送。

只在内存里维护，不落盘——图像数据（planes）本身有几十 KB，且这个场景很少见
（正常网络下发送 2~3 次总会成功），进程重启就清空是可接受的取舍；
真要用也不会等太久（下次发送前用户大概率会看一眼页面）。
"""

import asyncio
import time
from typing import Any, Callable, Dict, List, Optional

POLL_INTERVAL = 300.0  # 5 分钟


class RetryTask:
    """单个后台重试任务：同一时刻只允许存在一个，新任务会取消旧的。"""

    POLL_INTERVAL_S = POLL_INTERVAL

    def __init__(self, emit: Callable[[Dict[str, Any]], None]):
        self._emit = emit
        self._task: Optional[asyncio.Task] = None
        self.address: Optional[str] = None
        self.name: Optional[str] = None
        self.attempts = 0
        self.next_at: Optional[float] = None  # time.time() 时间戳，给前端算倒计时
        self.last_error: Optional[str] = None
        self.started_at: Optional[float] = None

    @property
    def active(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> Dict[str, Any]:
        if not self.active:
            return {"active": False}
        return {
            "active": True,
            "address": self.address,
            "name": self.name,
            "attempts": self.attempts,
            "next_at": self.next_at,
            "last_error": self.last_error,
            "started_at": self.started_at,
        }

    def _status_event(self) -> None:
        self._emit({"type": "retry_status", "retry": self.status()})

    def start(self, address: str, name: str,
              send_fn: Callable[[], Any]) -> None:
        """send_fn 是一个无参协程工厂：每次重试都重新调用它拿一个新的发送协程
        （不能复用同一个 coroutine 对象，协程只能 await 一次）。
        """
        self.cancel()
        self.address = address
        self.name = name
        self.attempts = 0
        self.last_error = None
        self.started_at = time.time()
        self.next_at = time.time() + POLL_INTERVAL
        self._task = asyncio.create_task(self._run(send_fn))
        self._status_event()

    def cancel(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        was_active = self.address is not None
        self.address = None
        self.name = None
        self.next_at = None
        if was_active:
            self._status_event()

    async def _run(self, send_fn: Callable[[], Any]) -> None:
        try:
            while True:
                self.next_at = time.time() + POLL_INTERVAL
                self._status_event()
                await asyncio.sleep(POLL_INTERVAL)
                self.attempts += 1
                self._emit({"type": "log",
                            "text": f"自动轮询第 {self.attempts} 次：尝试连接 {self.name or self.address}"})
                try:
                    await send_fn()
                except Exception as e:  # noqa: BLE001 - 重试循环里要吞掉所有异常继续轮询
                    self.last_error = str(e)
                    self._emit({"type": "log", "text": f"自动轮询第 {self.attempts} 次仍失败: {e}"})
                    self._status_event()
                    continue
                self._emit({"type": "log", "text": f"自动轮询第 {self.attempts} 次发送成功，停止轮询"})
                self.address = None
                self.name = None
                self.next_at = None
                self._status_event()
                return
        except asyncio.CancelledError:
            raise
