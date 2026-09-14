// 与后端蓝牙服务通信；页面本身不再使用 Web Bluetooth。
const API = {
  // 请求超时：蓝牙操作再慢也不该让页面永远等下去（发图给足时间，其余 30s）
  timeoutFor(path) {
    return path.includes('/api/image') ? 200000
      : (path.includes('/api/scan') || path.includes('/api/connect') ? 60000 : 30000);
  },

  async request(path, method = 'GET', body = null) {
    const opts = { method, headers: {} };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const ms = API.timeoutFor(path);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(() => controller.abort(), ms);
    }
    let resp;
    try {
      resp = await fetch(path, opts);
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error(`请求超时（${ms / 1000}s）`);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }
    if (!resp.ok) {
      const msg = (data && (data.detail || data.message)) || `HTTP ${resp.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  },

  status() { return API.request('/api/status'); },
  scan(timeout = 6) { return API.request('/api/scan', 'POST', { timeout }); },
  connect(address) { return API.request('/api/connect', 'POST', { address }); },
  disconnect() { return API.request('/api/disconnect', 'POST'); },

  // 以下操作可带 address：未连接时后端会临时连接并在结束后断开
  setDriver(pins, driver, address) {
    return API.request('/api/driver', 'POST', { pins, driver, address });
  },
  syncTime(mode, tzOffset, address) {
    return API.request('/api/time', 'POST', { mode, tz_offset: tzOffset, address });
  },
  clearScreen(address) { return API.request('/api/clear', 'POST', { address }); },
  sendCmd(hex, address) { return API.request('/api/cmd', 'POST', { hex, address }); },
  sysCommand(action, address) {
    return API.request('/api/sys', 'POST', { action, address });
  },
  sendImage(planes, interleaved, mtu, address, autoRetry = false) {
    return API.request('/api/image', 'POST', { planes, interleaved, mtu, address, auto_retry: autoRetry });
  },

  retryStatus() { return API.request('/api/retry'); },
  cancelRetry() { return API.request('/api/retry/cancel', 'POST'); },

  listDevices() { return API.request('/api/devices'); },
  saveDevice(device) { return API.request('/api/devices', 'POST', device); },
  deleteDevice(address) { return API.request(`/api/devices/${encodeURIComponent(address)}`, 'DELETE'); },
  setLastDevice(address) { return API.request('/api/devices/last', 'POST', { address }); },

  listHistory(address) {
    return API.request(`/api/history?address=${encodeURIComponent(address || '')}`);
  },
  addHistory(entry) { return API.request('/api/history', 'POST', entry); },
  deleteHistory(id) { return API.request(`/api/history/${encodeURIComponent(id)}`, 'DELETE'); },
  clearHistory(address) {
    return API.request(`/api/history?address=${encodeURIComponent(address || '')}`, 'DELETE');
  },
};

// 后端日志与传输进度通过 WebSocket 推送，断线后自动重连。
// eventsAlive() 用来判断这条通道是否还活着——它断了会导致后端日志“凭空消失”。
let eventSocket = null;

function eventsAlive() {
  return !!eventSocket && eventSocket.readyState === WebSocket.OPEN;
}

function subscribeEvents(onEvent) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';

  const open = () => {
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    eventSocket = ws;
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = () => {
      if (eventSocket === ws) eventSocket = null;
      setTimeout(open, 3000);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) { } };
  };

  open();
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
