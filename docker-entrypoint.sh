#!/usr/bin/env bash
# 容器内自带 D-Bus + bluetoothd。
#
# 为什么需要：bleak 通过 D-Bus 跟 BlueZ 的 bluetoothd 说话。像 Unraid 这类
# 宿主机默认不装 BlueZ（没有 bluetoothctl/bluetoothd），只能把这套用户态搬进容器。
# 前提是容器共享宿主机网络命名空间（network_mode: host），因为 AF_BLUETOOTH
# 套接字是按 netns 隔离的，hci0 属于宿主机的 netns。
#
# 行为：
#   - EPD_USE_HOST_DBUS=1 → 什么都不起，直接用挂进来的宿主机 D-Bus/BlueZ
#   - 否则在容器里起 dbus-daemon + bluetoothd（能 ping 通就跳过，重启后残留的
#     套接字文件会被清掉重建——只判断文件是否存在会误判）
#   - EPD_START_BLUETOOTHD=0 等价于 EPD_USE_HOST_DBUS=1
set -e

DBUS_SOCKET=/run/dbus/system_bus_socket

log() { echo "[entrypoint] $*"; }

# 用 D-Bus 调用判断服务是否真的活着，而不是看套接字文件在不在。
# 注意：系统总线的默认策略会拒绝对 bus 自身发 Peer.Ping（AccessDenied），
# 所以这里用一定被放行的 ListNames。
bus_alive() {
  dbus-send --system --print-reply --dest=org.freedesktop.DBus \
    /org/freedesktop/DBus org.freedesktop.DBus.ListNames >/dev/null 2>&1
}

bluez_alive() {
  dbus-send --system --print-reply --dest=org.bluez \
    / org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1
}

find_bluetoothd() {
  for p in /usr/libexec/bluetooth/bluetoothd /usr/lib/bluetooth/bluetoothd \
           /usr/sbin/bluetoothd /usr/bin/bluetoothd; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  command -v bluetoothd 2>/dev/null && return 0
  return 1
}

if [ "${EPD_USE_HOST_DBUS:-0}" = "1" ] || [ "${EPD_START_BLUETOOTHD:-1}" = "0" ]; then
  log "使用宿主机的 D-Bus/BlueZ（未在容器内启动 bluetoothd）"
  bus_alive && log "宿主机 D-Bus 可用" || log "警告：ping 不通宿主机 D-Bus，请确认挂载了 /run/dbus"
  bluez_alive && log "宿主机 bluetoothd 可用" || log "警告：宿主机上没有 org.bluez 服务"
else
  if bus_alive; then
    log "D-Bus 已可用，复用现有实例"
  else
    log "启动容器内 dbus-daemon"
    mkdir -p /run/dbus
    # 容器重启后会残留上一轮的套接字与 pid 文件，不清掉 dbus-daemon 起不来
    rm -f /run/dbus/pid "$DBUS_SOCKET"
    dbus-daemon --system --fork
    for _ in $(seq 1 50); do
      bus_alive && break
      sleep 0.1
    done
    bus_alive && log "dbus-daemon 就绪" || log "警告：dbus-daemon 启动失败，蓝牙将不可用"
  fi

  if bluez_alive; then
    log "bluetoothd 已在运行"
  elif BLUETOOTHD=$(find_bluetoothd); then
    log "启动 bluetoothd（$BLUETOOTHD --experimental）"
    # --experimental 打开 BlueZ 的实验接口，部分 BLE 特性依赖它
    "$BLUETOOTHD" --experimental >/tmp/bluetoothd.log 2>&1 &
    for _ in $(seq 1 60); do
      bluez_alive && break
      sleep 0.2
    done
    if bluez_alive; then
      log "bluetoothd 就绪（org.bluez 已注册）"
    else
      log "警告：bluetoothd 未就绪，详见容器内 /tmp/bluetoothd.log"
      log "      多数情况是权限不足：需要 --network host + NET_ADMIN/NET_RAW，或改用 privileged"
    fi
  else
    log "警告：镜像里找不到 bluetoothd"
  fi
fi

exec "$@"
