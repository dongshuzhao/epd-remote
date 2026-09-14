// 图像生成沿用 epdiy.cn 上位机的流水线（见 epd-image.js），蓝牙操作调用后端 API。
let canvas, ctx;
let paintManager, cropManager;
let startTime;
let sending = false;
let mtuOverridden = false;  // MTU 默认由固件上报，仅在手工改过时才覆盖
let ditherAlgOverridden = false;  // 手工改过抖动算法后不再自动切换
let previewZoom = 'auto';   // 预览缩放：auto 或整数倍
let deviceStatus = { connected: false };
let savedDevices = [];
let lastAddress = '';       // 上次使用的设备，后端持久化
let historyEntries = [];    // 当前设备的历史版本，最新在前
let historySelectedId = ''; // 列表里高亮的那条
let rssiCache = {};        // 地址 → { rssi, at }，来自最近一次扫描
let statusHideTimer = null; // 状态条的延时隐藏定时器
let livePreviewTimer = null; // 模板表单实时预览的防抖定时器
let lastRenderKey = '';      // 画布上这一帧对应的模板+变量指纹
let retryStatus = { active: false }; // 后端自动轮询重试的状态，来自 WebSocket 推送/轮询
let retryCountdownTimer = null; // 顶栏轮询倒计时的刷新定时器

// ---------------- 选项初始化 ----------------

function fillSelect(id, items, valueKey, labelKey) {
  const select = el(id);
  const keep = select.value;
  select.innerHTML = '';
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.text = item[labelKey];
    select.appendChild(opt);
  });
  if (keep && items.some((i) => i[valueKey] === keep)) select.value = keep;
}

// 固件版本以 -s 结尾表示小屏固件，驱动表不同
function driverTable() {
  return deviceStatus.small_screen ? EPD_DRIVERS_SMALL : EPD_DRIVERS_LARGE;
}

function initOptions() {
  fillSelect('epddriver', driverTable(), 'value', 'label');
  fillSelect('canvasSize', EPD_CANVAS_SIZES.map((s) => (
    { value: s.name, label: `${s.name.split('_')[0]} (${s.width}x${s.height})` }
  )), 'value', 'label');
  fillSelect('ditherMode', EPD_COLOR_MODES, 'value', 'label');
  fillSelect('ditherAlg', EPD_DITHER_ALGS, 'value', 'label');
}

// ---------------- 本地模板 ----------------

function templateStorageKey(name) { return `epdTemplate:${name}`; }

function loadTemplateVars(tpl) {
  const saved = localStorage.getItem(templateStorageKey(tpl.name));
  const vars = templateDefaults(tpl);
  if (saved) {
    try {
      Object.assign(vars, JSON.parse(saved));
    } catch (e) { /* 存档损坏则用默认值 */ }
  }
  return vars;
}

function initTemplates() {
  // 「图片」也作为一种模板类型，它的填写内容就是选文件
  const items = [{ value: '', label: '空白画布' }, { value: 'image', label: '图片' }]
    .concat(EPD_TEMPLATES.map((t) => ({ value: t.name, label: t.display })));
  fillSelect('templateSelect', items, 'value', 'label');
}

// 切换模板：图片类型显示文件选择框，普通模板重建变量输入框
function onTemplateChange() {
  const value = el('templateSelect').value;
  const container = el('templateVars');
  const isImage = value === 'image';
  const tpl = findTemplate(value);

  el('imageRow').classList.toggle('hide', !isImage);
  el('tplRenderbutton').textContent = isImage ? '载入图片' : '渲染到画布';
  el('tplDefaultsbutton').classList.toggle('hide', !tpl);
  el('tplClearbutton').classList.toggle('hide', !tpl);

  container.innerHTML = '';
  if (!tpl) {
    container.classList.remove('open');
    setCanvasTitle('');
    // 已经选过文件就直接载入
    if (isImage && el('imageFile').files.length > 0) updateImage();
    // 选「空白画布」就把预览清空，直接在上面手绘
    if (!isImage) blankCanvas();
    return;
  }

  const vars = loadTemplateVars(tpl);
  // 模板可以声明固定列数，让字段换行位置稳定
  container.classList.toggle('cols-4', tpl.formColumns === 4);
  tpl.variables.forEach((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'tpl-var';
    // span: 'full' 独占一行；span: 2 占两列（宽屏下正好一行两项）
    if (item.span === 'full') wrap.classList.add('span-full');
    else if (item.span === 2) wrap.classList.add('span-2');
    const label = document.createElement('label');
    label.textContent = item.label || item.name;
    label.title = item.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.varName = item.name;
    input.value = vars[item.name] || '';
    // 边填边预览
    input.addEventListener('input', () => scheduleLivePreview());
    wrap.appendChild(label);
    wrap.appendChild(input);
    container.appendChild(wrap);
  });
  container.classList.add('open');
  // 预览框不显示模板名，标题区只留给画笔/裁剪的操作提示
  setCanvasTitle('');
  // 换模板等于内容变了，直接预览
  scheduleLivePreview(0);
}

function currentTemplateVars() {
  const vars = {};
  el('templateVars').querySelectorAll('input[data-var-name]').forEach((input) => {
    vars[input.dataset.varName] = input.value;
  });
  return vars;
}

// 点阵字体必须先加载完，否则 canvas 会退化用系统宋体渲染
async function ensureTemplateFonts() {
  if (!document.fonts) return;
  try {
    await Promise.all(TPL_PRELOAD_FONTS.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch (e) {
    addLog('点阵字体加载失败，正文将退化为系统字体: ' + e.message);
  }
}

// silent=true 用于表单实时预览：不弹框、不写日志、不打断裁剪
async function renderCurrentTemplate(options = {}) {
  const { silent = false } = options;
  const value = el('templateSelect').value;
  if (value === 'image') {
    if (el('imageFile').files.length === 0) {
      if (!silent) alert('请先选择图片文件');
      return;
    }
    updateImage();
    return;
  }

  const tpl = findTemplate(value);
  if (!tpl) {
    if (!silent) alert('请先选择一个模板');
    return;
  }
  if (cropManager.isCropMode()) {
    if (silent) return;
    cropManager.exitCropMode();
  }

  const vars = currentTemplateVars();
  localStorage.setItem(templateStorageKey(tpl.name), JSON.stringify(vars));

  await ensureTemplateFonts();
  paintManager.clearElements();
  renderTemplate(tpl.name, vars, ctx, canvas.width, canvas.height, el('ditherMode').value);
  paintManager.clearHistory();
  paintManager.saveToHistory();
  convertDithering();
  lastRenderKey = templateRenderKey();
  if (!silent) addLog(`已渲染模板「${tpl.display}」到 ${canvas.width}x${canvas.height} 画布`);
}

// 当前模板 + 变量 + 画布参数的指纹，用来判断画布上的内容是不是最新的
function templateRenderKey() {
  return JSON.stringify([el('templateSelect').value, currentTemplateVars(),
    el('canvasSize').value, el('ditherMode').value]);
}

// 发送前兜底：选了模板但还没渲染（或渲染后又改过表单）就先渲染一次
async function ensureTemplateRendered() {
  const tpl = findTemplate(el('templateSelect').value);
  if (!tpl) return;
  if (livePreviewTimer) {
    clearTimeout(livePreviewTimer);
    livePreviewTimer = null;
  }
  if (lastRenderKey === templateRenderKey()) return;
  addLog('画布内容不是最新的，发送前先渲染一次');
  await renderCurrentTemplate();
}

// 表单一改就重渲染，实现实时预览；输入时防抖，避免每敲一个字都重画整帧
function scheduleLivePreview(delay = 250) {
  if (livePreviewTimer) clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => {
    livePreviewTimer = null;
    if (sending) return;
    renderCurrentTemplate({ silent: true });
  }, delay);
}

function fillTemplateDefaults() {
  const tpl = findTemplate(el('templateSelect').value);
  if (!tpl) return;
  const defaults = templateDefaults(tpl);
  el('templateVars').querySelectorAll('input[data-var-name]').forEach((input) => {
    input.value = defaults[input.dataset.varName] || '';
  });
  scheduleLivePreview(0);
}

function clearTemplateVars() {
  el('templateVars').querySelectorAll('input[data-var-name]').forEach((input) => {
    input.value = '';
  });
  scheduleLivePreview(0);
}

// ---------------- 设备记忆 ----------------

function el(id) { return document.getElementById(id); }

async function refreshSavedDevices(selectAddress) {
  try {
    const data = await API.listDevices();
    savedDevices = data.devices || [];
    lastAddress = data.last_address || '';
  } catch (e) {
    addLog('读取设备记忆失败: ' + e.message);
    return;
  }
  const select = el('savedDevices');
  // 优先用调用方指定的设备，其次保持当前选择，最后回到上次用过的设备
  const keep = selectAddress || select.value || lastAddress;
  select.innerHTML = '';
  if (savedDevices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.text = '(暂无记忆设备)';
    select.appendChild(opt);
  }
  savedDevices.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.address;
    opt.text = `${d.name || d.address} (${d.address})`;
    select.appendChild(opt);
  });
  if (keep && savedDevices.some((d) => d.address === keep)) select.value = keep;
  onSavedDeviceChange();
}

function findSavedDevice(address) {
  return savedDevices.find((d) => d.address === address);
}

// 选中记忆设备时恢复它的驱动/画布/颜色模式等参数
function onSavedDeviceChange() {
  const address = el('savedDevices').value;
  const dev = findSavedDevice(address);
  if (dev) {
    if (dev.driver) el('epddriver').value = dev.driver;
    if (dev.pins !== undefined) el('epdpins').value = dev.pins;
    if (dev.mtu) el('mtusize').value = dev.mtu;
    if (dev.interleaved !== undefined) el('interleavedcount').value = dev.interleaved;
    if (dev.color_mode) el('ditherMode').value = dev.color_mode;
    if (dev.canvas_size) {
      el('canvasSize').value = dev.canvas_size;
      updateCanvasSize();
    }
  }
  // 记住这次用的设备，下次打开页面直接回到它
  if (address && address !== lastAddress) {
    lastAddress = address;
    API.setLastDevice(address).catch((e) => addLog('记录当前设备失败: ' + e.message));
  }
  refreshHistory();
  renderRssi();
}

// ---------------- 历史版本 ----------------
// 每次成功发送都记一条（模板 + 变量 + 画布参数），切换版本时在前端重新渲染。

function historyLabel(entry) {
  const name = entry.template_display || (entry.template ? entry.template : '空白画布');
  const time = String(entry.created_at || '').replace('T', ' ');
  return `${name} · ${time}`;
}

async function refreshHistory(options = {}) {
  const { apply = false } = options;
  const address = el('savedDevices').value;
  historyEntries = [];
  if (address) {
    try {
      const data = await API.listHistory(address);
      historyEntries = data.entries || [];
    } catch (e) {
      addLog('读取历史版本失败: ' + e.message);
    }
  }
  if (!historyEntries.some((e) => e.id === historySelectedId)) {
    historySelectedId = historyEntries.length ? historyEntries[0].id : '';
  }
  renderHistoryList(address);
  if (apply && historyEntries.length) await applyHistoryEntry(historyEntries[0]);
}

// 自绘列表：每行点击即载入，行右侧的垃圾桶按钮 hover 才出现
function renderHistoryList(address) {
  const box = el('historyList');
  box.innerHTML = '';
  el('historyClearbutton').disabled = historyEntries.length ? null : 'disabled';
  if (historyEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = address ? '暂无记录' : '先选择设备';
    box.appendChild(empty);
    return;
  }
  historyEntries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item' + (entry.id === historySelectedId ? ' active' : '');
    item.dataset.id = entry.id;
    item.title = `载入「${historyLabel(entry)}」`;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = historyLabel(entry);
    item.appendChild(label);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = '删除这条历史';
    del.innerHTML = '<svg class="icon"><use href="#i-trash" /></svg>';
    del.onclick = (ev) => {
      ev.stopPropagation();   // 别触发整行的载入
      deleteHistoryEntry(entry.id);
    };
    item.appendChild(del);

    item.onclick = () => {
      historySelectedId = entry.id;
      renderHistoryList(address);
      applyHistoryEntry(entry);
    };
    box.appendChild(item);
  });
}

async function deleteHistoryEntry(id) {
  const entry = historyEntries.find((e) => e.id === id);
  try {
    await API.deleteHistory(id);
    addLog(`已删除历史版本「${entry ? historyLabel(entry) : id}」`);
  } catch (e) {
    addLog('删除历史版本失败: ' + e.message);
  }
  await refreshHistory();
}

async function clearHistory() {
  const address = el('savedDevices').value;
  if (!address || historyEntries.length === 0) return;
  if (!confirm(`确定清空该设备的 ${historyEntries.length} 条历史版本？`)) return;
  try {
    const res = await API.clearHistory(address);
    addLog(`已清空历史版本，共删除 ${res && res.removed} 条`);
  } catch (e) {
    addLog('清空历史版本失败: ' + e.message);
  }
  historySelectedId = '';
  await refreshHistory();
}

// 把某个版本完整还原到右侧：画布参数 → 模板 → 填写内容 → 渲染预览
async function applyHistoryEntry(entry) {
  if (!entry) return;
  if (entry.driver) {
    const driverSelect = el('epddriver');
    if ([...driverSelect.options].some((o) => o.value === entry.driver)) {
      driverSelect.value = entry.driver;
    }
  }
  if (entry.color_mode) el('ditherMode').value = entry.color_mode;
  if (entry.canvas_size) {
    el('canvasSize').value = entry.canvas_size;
    updateCanvasSize();
  }

  el('templateSelect').value = entry.template || '';
  onTemplateChange();
  const vars = entry.vars || {};
  el('templateVars').querySelectorAll('input[data-var-name]').forEach((input) => {
    input.value = vars[input.dataset.varName] || '';
  });

  if (entry.template === 'image') {
    addLog(`历史版本「${historyLabel(entry)}」是直接发送的图片，图片本身没有保存，请重新选择文件`);
    return;
  }
  if (!findTemplate(entry.template)) {
    addLog(`已载入历史版本「${historyLabel(entry)}」（空白画布）`);
    return;
  }
  await renderCurrentTemplate();
  addLog(`已载入历史版本「${historyLabel(entry)}」`);
}

// 变量表归一化：忽略键顺序与空值，用来判断两次发送的内容是否一致
function normalizeHistoryVars(vars) {
  const out = {};
  Object.keys(vars || {}).sort().forEach((k) => {
    const v = String(vars[k] == null ? '' : vars[k]);
    if (v !== '') out[k] = v;
  });
  return JSON.stringify(out);
}

function sameHistoryContent(a, b) {
  if (!a || !b) return false;
  if (['template', 'canvas_size', 'color_mode', 'driver']
    .some((k) => String(a[k] || '') !== String(b[k] || ''))) return false;
  return normalizeHistoryVars(a.vars) === normalizeHistoryVars(b.vars);
}

// 发送成功后记一条历史；失败不记。
// 内容与该设备最新一条完全相同就不再重复记录——同一份作业清单反复发不该刷出一堆版本。
async function recordHistory(address) {
  if (!address) return;
  const name = el('templateSelect').value;
  const tpl = findTemplate(name);
  const payload = {
    address,
    template: name,
    template_display: tpl ? tpl.display : (name === 'image' ? '图片' : '空白画布'),
    vars: tpl ? currentTemplateVars() : {},
    canvas_size: el('canvasSize').value,
    color_mode: el('ditherMode').value,
    driver: el('epddriver').value,
  };

  // 「图片」类型不存图，内容无从比较，一律记录
  const latest = historyEntries[0];
  if (name !== 'image' && latest
    && String(latest.address || '').toUpperCase() === String(address).toUpperCase()
    && sameHistoryContent(payload, latest)) {
    addLog(`内容与最新历史版本「${historyLabel(latest)}」一致，不新增记录`);
    return;
  }

  try {
    await API.addHistory(payload);
    await refreshHistory();
  } catch (e) {
    addLog('记录历史版本失败: ' + e.message);
  }
}

async function saveScannedDevice() {
  const value = el('scanResults').value;
  if (!value) {
    alert('请先扫描并选择一个设备');
    return;
  }
  const [address, name] = value.split('|');
  try {
    await API.saveDevice({ address, name, driver: el('epddriver').value });
    addLog(`已记忆设备: ${name} (${address})`);
    await refreshSavedDevices(address);
  } catch (e) {
    addLog('保存失败: ' + e.message);
  }
}

// 把当前页面上的驱动/画布/抖动参数写回该设备的记忆
async function saveDeviceSettings() {
  const address = el('savedDevices').value || (deviceStatus.address || '');
  if (!address) {
    alert('请先选择或连接一个设备');
    return;
  }
  const dev = findSavedDevice(address) || {};
  const payload = {
    address,
    name: dev.name || deviceStatus.name || address,
    driver: el('epddriver').value,
    pins: el('epdpins').value,
    canvas_size: el('canvasSize').value,
    color_mode: el('ditherMode').value,
    mtu: parseInt(el('mtusize').value, 10),
    interleaved: parseInt(el('interleavedcount').value, 10),
  };
  try {
    await API.saveDevice(payload);
    addLog('设备参数已保存到记忆');
    await refreshSavedDevices(address);
  } catch (e) {
    addLog('保存失败: ' + e.message);
  }
}

async function forgetDevice() {
  const address = el('savedDevices').value;
  if (!address) return;
  if (!confirm(`删除对 ${address} 的记忆？`)) return;
  try {
    await API.deleteDevice(address);
    addLog(`已删除记忆: ${address}`);
    await refreshSavedDevices();
  } catch (e) {
    addLog('删除失败: ' + e.message);
  }
}

// ---------------- 信号强度 ----------------
// RSSI 只在广播包里有，所以只能靠扫描取；这里把每次扫描的结果缓存起来给顶栏胶囊用。

function rememberRssi(devices) {
  const now = Date.now();
  (devices || []).forEach((d) => {
    if (d.address) rssiCache[d.address.toUpperCase()] = { rssi: d.rssi, at: now };
  });
  renderRssi();
}

// -60 以上很稳，-75 以内够用，再弱就要担心丢包；格数用来配合颜色再加一层直观提示
function rssiLevel(rssi) {
  if (rssi >= -60) return { cls: 'good', text: '强', bars: 3 };
  if (rssi >= -75) return { cls: 'fair', text: '良', bars: 2 };
  return { cls: 'weak', text: '弱', bars: 1 };
}

// 三格柱状图标，未点亮的格子降低透明度
function rssiBarsHtml(bars) {
  let html = '';
  for (let i = 1; i <= 3; i++) {
    html += `<span class="rssi-bar${i <= bars ? ' lit' : ''}" style="height:${i * 4 + 2}px"></span>`;
  }
  return `<span class="rssi-bars">${html}</span>`;
}

function renderRssi() {
  const chip = el('rssiChip');
  if (!chip) return;
  const address = (targetAddress() || '').toUpperCase();
  chip.classList.remove('good', 'fair', 'weak');
  if (!address) {
    chip.innerHTML = '信号 --';
    chip.title = '先选择目标设备再测量信号';
    return;
  }
  const hit = rssiCache[address];
  if (!hit) {
    chip.innerHTML = '信号 --';
    chip.title = `点击测量 ${address} 的信号强度`;
    return;
  }
  const level = rssiLevel(hit.rssi);
  const ageSec = Math.round((Date.now() - hit.at) / 1000);
  const age = ageSec < 60 ? `${ageSec}s 前` : `${Math.round(ageSec / 60)}min 前`;
  chip.classList.add(level.cls);
  chip.innerHTML = `${rssiBarsHtml(level.bars)}信号 ${hit.rssi}dBm`;
  chip.title = `${address} 信号${level.text}（${age}测得，点击重新测量）`;
}

// 点胶囊做一次短扫描重新测量
async function measureRssi() {
  const address = (targetAddress() || '').toUpperCase();
  if (!address) {
    alert('请先在“已记忆”里选择设备，或点击“扫描”后选择一个设备。');
    return;
  }
  if (sending) {
    addLog('发送过程中不测信号，避免干扰传输');
    return;
  }
  const chip = el('rssiChip');
  chip.disabled = 'disabled';
  chip.classList.add('measuring');
  chip.innerHTML = '测量中…';
  try {
    const data = await API.scan(5);
    rememberRssi(data.devices);
    const hit = rssiCache[address];
    addLog(hit ? `信号强度 ${hit.rssi}dBm（${rssiLevel(hit.rssi).text}）`
      : `没扫到 ${address}，它可能没在广播（正在连接中或已断电）`);
  } catch (e) {
    addLog('测信号失败: ' + e.message);
  } finally {
    chip.classList.remove('measuring');
    chip.disabled = null;
    renderRssi();
  }
}

// ---------------- 自动轮询重试 ----------------
// 发送重试用尽后仍失败，后端会转入每 5 分钟一次的后台轮询；顶栏这个胶囊只是展示
// 该状态（数据权威来源是后端 retry_task），刷新页面/WebSocket 重连都会重新拿到。

function applyRetryStatus(status) {
  retryStatus = status || { active: false };
  renderRetryChip();
}

function renderRetryChip() {
  const chip = el('retryChip');
  if (!chip) return;
  if (retryCountdownTimer) {
    clearInterval(retryCountdownTimer);
    retryCountdownTimer = null;
  }
  if (!retryStatus.active) {
    chip.classList.add('hidden');
    return;
  }
  chip.classList.remove('hidden');
  const update = () => {
    const leftMs = (retryStatus.next_at || 0) * 1000 - Date.now();
    const leftText = leftMs > 0 ? `${Math.ceil(leftMs / 1000)}s 后` : '即将';
    el('retryChipText').textContent =
      `自动轮询中：${retryStatus.name || retryStatus.address}（已试 ${retryStatus.attempts} 次，${leftText}重试）`;
  };
  update();
  chip.title = `设备暂时连不上，每 5 分钟自动重试一次；点击停止${retryStatus.last_error ? `\n上次失败: ${retryStatus.last_error}` : ''}`;
  retryCountdownTimer = setInterval(update, 1000);
}

async function cancelAutoRetry() {
  if (!confirm('停止自动轮询重试？之前生成的这次发送内容会被放弃，需要重新点「发送图片」。')) return;
  try {
    applyRetryStatus(await API.cancelRetry());
    addLog('已手动停止自动轮询重试');
  } catch (e) {
    addLog('停止自动轮询失败: ' + e.message);
  }
}

// ---------------- 连接 ----------------

async function doScan() {
  const button = el('scanbutton');
  button.disabled = 'disabled';
  try {
    const data = await API.scan(6);
    const select = el('scanResults');
    select.innerHTML = '';
    (data.devices || []).forEach((d) => {
      const opt = document.createElement('option');
      opt.value = `${d.address}|${d.name}`;
      opt.text = `${d.is_epd ? '★ ' : ''}${d.name} (${d.address}) ${d.rssi}dBm`;
      select.appendChild(opt);
    });
    rememberRssi(data.devices);
  } catch (e) {
    addLog('扫描失败: ' + e.message);
  } finally {
    button.disabled = null;
  }
}

async function doConnect() {
  // 优先连接已记忆设备，否则连接扫描结果中选中的设备
  let address = el('savedDevices').value;
  if (!address && el('scanResults').value) {
    address = el('scanResults').value.split('|')[0];
  }
  if (!address) {
    alert('请先选择要连接的设备（可先点击“扫描”）');
    return;
  }
  const button = el('connectbutton');
  button.disabled = 'disabled';
  try {
    applyStatus(await API.connect(address));
    const dev = findSavedDevice(address);
    if (dev) onSavedDeviceChange();
  } catch (e) {
    addLog('连接失败: ' + e.message);
  } finally {
    button.disabled = null;
  }
}

async function doDisconnect() {
  const button = el('connectbutton');
  button.disabled = 'disabled';
  try {
    applyStatus(await API.disconnect());
  } catch (e) {
    addLog('断开失败: ' + e.message);
  } finally {
    button.disabled = null;
    updateButtonStatus();
  }
}

// 连接与断开合成一个按钮，按当前状态切换
function toggleConnection() {
  return deviceStatus.connected ? doDisconnect() : doConnect();
}

function applyStatus(status) {
  if (!status) return;
  const wasSmall = deviceStatus.small_screen;
  const prevAddress = deviceStatus.address;
  deviceStatus = status;
  // 小屏固件用另一张驱动表，切换后需要重建下拉框
  if (status.small_screen !== wasSmall) fillSelect('epddriver', driverTable(), 'value', 'label');
  // 连接时后端会实测一次 RSSI（比扫描缓存更准），顺手更新一下信号胶囊，
  // 不然要等下次手动测量或扫描才会刷新，看起来就跟丢了一样
  if (status.connected && status.address && typeof status.rssi === 'number') {
    rssiCache[status.address.toUpperCase()] = { rssi: status.rssi, at: Date.now() };
  } else if (!status.connected && prevAddress) {
    // 断开（主动断开或意外掉线，比如设备走出信号范围）后这条 RSSI 就过期了，
    // 留着只会让胶囊一直显示一个越来越旧、可能已经不准的值
    delete rssiCache[prevAddress.toUpperCase()];
  }
  renderRssi();

  const state = el('connstate');
  if (status.connected) {
    const parts = [`已连接 ${status.name || ''} ${status.address || ''}`.trim()];
    if (status.version) parts.push(`固件 ${status.version}`);
    parts.push(`MTU ${status.mtu}`);
    if (status.rle) parts.push('RLE');
    if (status.battery_mv) parts.push(`电池 ${status.battery_mv}mV`);
    if (status.slots && status.slots.count) {
      parts.push(`槽位 ${status.slots.count}`);
    }
    if (status.clock_enable === false) parts.push('无时钟模式');
    state.textContent = parts.join(' | ');
    state.className = 'conn-state online';
  } else {
    state.textContent = '未连接';
    state.className = 'conn-state';
  }
  if (status.mtu && !mtuOverridden) el('mtusize').value = status.mtu;
  if (status.pins) el('epdpins').value = status.pins;
  if (status.driver) {
    const driverSelect = el('epddriver');
    if ([...driverSelect.options].some((o) => o.value === status.driver)) {
      driverSelect.value = status.driver;
    }
  }
  updateButtonStatus();
}

function updateButtonStatus(forceDisabled = false) {
  const disabled = forceDisabled || sending ? 'disabled' : null;
  ['sendcmdbutton', 'calendarmodebutton', 'clockmodebutton', 'clearscreenbutton',
    'sendimgbutton', 'setDriverbutton', 'connectbutton', 'scanbutton',
    'resetbutton', 'erasebutton'].forEach((id) => {
      const node = el(id);
      if (node) node.disabled = disabled;
    });
  // 连接/断开是同一个按钮，图标、提示与样式跟着连接状态走
  const connect = el('connectbutton');
  el('connectIcon').setAttribute('href', deviceStatus.connected ? '#i-unplug' : '#i-plug');
  connect.classList.toggle('primary', !deviceStatus.connected);
  connect.classList.toggle('tonal', deviceStatus.connected);
  connect.title = deviceStatus.connected
    ? '断开（发送时会自动临时连接）'
    : '连接（保持长连接便于调试；不连接也能发送）';
}

// 传输过程中禁用下发类按钮，生成/预览类操作不受影响
function setSending(value) {
  sending = value;
  updateButtonStatus();
}

// ---------------- 设备控制 ----------------
// 生成/预览完全不依赖蓝牙；只有真正下发数据时才需要设备。
// 未连接时后端会自动“连接 → 执行 → 断开”，已手动连接则复用连接（便于调试）。

// 下发操作的目标设备：优先已记忆设备，其次扫描结果，最后当前连接
function targetAddress() {
  const saved = el('savedDevices').value;
  if (saved) return saved;
  if (el('scanResults').value) return el('scanResults').value.split('|')[0];
  return deviceStatus.address || '';
}

// 需要设备的操作统一走这里：检查目标、置忙、报错、恢复按钮
async function withDevice(actionName, fn) {
  const address = targetAddress();
  if (!address && !deviceStatus.connected) {
    alert('请先在“已记忆”里选择设备，或点击“扫描”后选择一个设备。');
    return false;
  }
  setSending(true);
  try {
    if (!deviceStatus.connected) addLog(`${actionName}：临时连接 ${address}`);
    await fn(address);
    return true;
  } catch (e) {
    addLog(`${actionName}失败: ` + e.message);
    return false;
  } finally {
    setSending(false);
  }
}

async function setDriver() {
  await withDevice('设置驱动', (address) =>
    API.setDriver(el('epdpins').value, el('epddriver').value, address));
}

async function syncTime(mode) {
  if (mode === 2 && !confirm('提醒：时钟模式目前使用全刷实现，此功能多用于修复老化屏残影问题，不建议长期开启，是否继续？')) return;
  await withDevice('同步时间', (address) =>
    API.syncTime(mode, -(new Date().getTimezoneOffset() / 60), address));
}

async function clearScreen() {
  if (!confirm('确认清除屏幕内容?')) return;
  await withDevice('清屏', (address) => API.clearScreen(address));
}

async function sendcmd() {
  const cmdTXT = el('cmdTXT').value;
  if (cmdTXT == '') return;
  await withDevice('发送命令', (address) => API.sendCmd(cmdTXT, address));
}

async function resetDevice() {
  if (!confirm('是否重启设备？')) return;
  await withDevice('重启设备', (address) => API.sysCommand('reset', address));
}

async function eraseConfig() {
  if (!confirm('此操作将会擦除所有用户设置，恢复到刚刷机后的状态，是否继续？')) return;
  await withDevice('恢复出厂', (address) => API.sysCommand('erase', address));
}

// 发送失败后的重试次数（首次 + SEND_RETRIES 次重试）
const SEND_RETRIES = 2;
const SEND_RETRY_DELAY = 1500;
// 等「已连接」状态出现的上限：这个屏的广播间隔偏长，扫描/连接常要好几秒，
// 后端 connect() 内部的扫描超时也相应调到了 25s（见 backend/app/ble.py），
// 这里给足一点，别在后端还在扫的时候前端先放弃了。
const CONNECT_WAIT = 30000;
const CONNECT_POLL = 300;     // 轮询状态的间隔
const CONNECT_SETTLE = 1500;  // 已连接之后再稍等片刻，和手动操作的节奏一致
const REFRESH_WAIT = 30000;   // 墨水屏整屏刷新约 30s，刷完再断开，别把刷新打断

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 等屏幕刷完，状态条上带倒计时，避免看起来像卡住
async function waitRefresh(ms, prefix = '') {
  const deadline = Date.now() + ms;
  let left = Math.ceil(ms / 1000);
  while (left > 0) {
    showStatus(`${prefix}已下发，等待屏幕刷新… ${left}s`);
    await sleep(1000);
    left = Math.ceil((deadline - Date.now()) / 1000);
  }
}

// 轮询后端状态，直到真的变成「已连接」为止（不只看 /api/connect 的返回值）
async function waitConnected(timeout = CONNECT_WAIT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    applyStatus(await API.status());
    if (deviceStatus.connected) {
      addLog(`已连接: ${deviceStatus.name || deviceStatus.address || ''}`);
      return;
    }
    await sleep(CONNECT_POLL);
  }
  throw new Error(`等待「已连接」状态超时（${timeout / 1000}s）`);
}

// 一次发送尝试：完全复刻手动路径
// 连接 → 等「已连接」状态 → 稍等片刻 → 重新渲染 → 发送 → 等屏幕刷完 → 断开
//
// autoRetry: 前端重试次数用尽后的最后一次尝试传 true。这一次不走上面那条
// 「前端先连接、连上了再发送」的路径——设备已经不在范围内时失败恰恰发生在
// 连接这一步，前端的 try 只包住了发送阶段，连接失败会直接抛出去、永远走不到
// 转入轮询的代码。所以 autoRetry=true 时改成把 address 交给后端一次性处理
// （连接+发送+失败转轮询都在后端一个请求里完成，见 backend/app/main.py 的
// api_image），前端只等结果。
async function sendOnce(interleaved, mtu, address, prefix, autoRetry = false) {
  if (autoRetry) {
    showStatus(`${prefix}最后一次尝试，交给后端处理…`);
    addLog(`发送图片：最后一次尝试，若仍失败将转入自动轮询（目标 ${address}）`);
    await renderCurrentTemplate({ silent: true });
    const planes = generatePlanes(true);
    if (planes === null) throw new Error('图像数据生成失败');
    const res = await API.sendImage(planes, interleaved, mtu, address, true);
    if (res && res.auto_retry) {
      addLog(`后端已转入自动轮询（${res.error}），每 5 分钟重试一次直至成功`);
      applyRetryStatus(res.retry);
      return res;
    }
    addLog(`后端返回：耗时 ${res && res.elapsed}s`
      + (res && res.ratio ? `，压缩比 ${res.ratio}%` : '')
      + `，失败块数 ${res ? res.failed : '?'}`);
    return res;
  }

  const manual = deviceStatus.connected;   // 已经手动连着就复用，不去动连接
  let sent = false;
  if (!manual) {
    showStatus(`${prefix}正在连接 ${address}…`);
    addLog(`发送图片：连接 ${address}`);
    await API.connect(address);
    await waitConnected();
    showStatus(`${prefix}已连接，准备发送…`);
    await sleep(CONNECT_SETTLE);
  }
  try {
    // 发送前重新渲染一次，保证发出去的就是表单里最新的内容
    addLog('发送前重新渲染画布');
    await renderCurrentTemplate({ silent: true });
    const planes = generatePlanes(true);
    if (planes === null) throw new Error('图像数据生成失败');
    showStatus(`${prefix}准备发送 ${totalBytesText(planes)}…`);
    if (!eventsAlive()) {
      addLog('提示：日志通道（WebSocket）未连接，后端的传输日志可能看不到');
    }
    addLog(`开始下发：${totalBytesText(planes)}，MTU=${mtu === null ? '按固件/链路' : mtu}`
      + `，确认间隔=${interleaved}`);
    // 不带 address：后端复用当前连接，发送结束也不会自动断开
    const res = await API.sendImage(planes, interleaved, mtu, null);
    sent = true;
    // 后端的返回值直接记一条，即使 WebSocket 断了也知道到底发成功了没有
    addLog(`后端返回：耗时 ${res && res.elapsed}s`
      + (res && res.ratio ? `，压缩比 ${res.ratio}%` : '')
      + `，失败块数 ${res ? res.failed : '?'}`);
    // 墨水屏刷新要几十秒，期间保持连接别打断它（手动操作时也是发完就搁着）
    if (!manual) {
      addLog(`等待屏幕刷新 ${REFRESH_WAIT / 1000}s 后再断开`);
      await waitRefresh(REFRESH_WAIT, prefix);
    }
    return res;
  } finally {
    if (!manual) {
      addLog(sent ? '刷新等待结束，断开连接' : '发送未完成，断开连接');
      await doDisconnect();
    }
  }
}

function totalBytesText(planes) {
  const bytes = planes.reduce((n, p) => {
    const pad = (p.data.endsWith('==') && 2) || (p.data.endsWith('=') && 1) || 0;
    return n + p.data.length / 4 * 3 - pad;
  }, 0);
  return `${bytes} 字节`;
}

async function sendimg() {
  if (cropManager.isCropMode()) {
    alert('请先完成图片裁剪！发送已取消。');
    return;
  }

  const address = targetAddress();
  if (!address && !deviceStatus.connected) {
    alert('请先在“已记忆”里选择设备，或点击“扫描”后选择一个设备。');
    return;
  }

  await ensureTemplateRendered();

  // 先跑一次生成：既能提前发现驱动/画布不匹配（会弹确认框），也避免连上设备后才失败
  if (generatePlanes() === null) return;
  const mtu = mtuOverridden ? parseInt(el('mtusize').value, 10) : null;
  const interleaved = parseInt(el('interleavedcount').value, 10);

  setSending(true);
  try {
    for (let attempt = 1; attempt <= SEND_RETRIES + 1; attempt++) {
      startTime = new Date().getTime();
      const prefix = attempt > 1 ? `第 ${attempt} 次尝试：` : '';
      const isLastAttempt = attempt === SEND_RETRIES + 1;
      try {
        const res = await sendOnce(interleaved, mtu, address, prefix, isLastAttempt);
        if (res && res.auto_retry) {
          // 转入后台轮询不算「发送成功」，不记历史，但也不再继续前端的重试循环
          showStatus('已转入自动轮询，详见日志');
          hideStatusLater();
          return;
        }
        await recordHistory(address || deviceStatus.address || '');
        // 收尾：状态条别停在倒计时上
        showStatus('发送完成');
        hideStatusLater(5000);
        return;
      } catch (e) {
        addLog(`发送图片失败: ${e.message}`);
      }
      if (attempt > SEND_RETRIES) break;
      showStatus(`发送失败，${SEND_RETRY_DELAY / 1000}s 后重试（${attempt}/${SEND_RETRIES}）`);
      await sleep(SEND_RETRY_DELAY);
    }
    addLog(`发送图片失败：已重试 ${SEND_RETRIES} 次仍未成功`);
    showStatus(`发送失败（已重试 ${SEND_RETRIES} 次），详见日志`);
    hideStatusLater();
  } finally {
    setSending(false);
  }
}

// 只做图像生成：旋转 → 抖动量化 → 位面打包，不涉及蓝牙，可离线调试
function generatePlanes(silent = false) {
  const canvasSize = el('canvasSize').value;
  const mode = el('ditherMode').value;
  const driverValue = el('epddriver').value;
  const driver = findDriver(driverValue);

  if (!silent && driver) {
    if (driver.size !== canvasSize && !confirm('警告：画布尺寸和驱动不匹配，是否继续？')) return null;
    if (driver.color !== mode && !confirm('警告：颜色模式和驱动不匹配，是否继续？')) return null;
  }

  // 竖屏面板在画布上按横向编辑，发送前旋转回屏幕扫描方向
  const sizeEntry = findCanvasSize(canvasSize);
  const rotate = driverValue === '4e' ? 90 : (sizeEntry && sizeEntry.rotate);
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (rotate) imageData = rotateImageData(imageData, rotate);

  const packed = packImageData(imageData, mode);
  if (!packed) {
    addLog('当前固件不支持此颜色模式。');
    return null;
  }
  const planes = buildDriverPlanes(packed, mode, driverValue,
    imageData.width, imageData.height, deviceStatus.a0_fix);
  if (planes === null) {
    addLog('当前固件不支持此颜色模式。');
    return null;
  }

  const total = planes.reduce((n, p) => n + p.bytes.length, 0);
  addLog(`已生成 ${planes.length} 个位面，共 ${total} 字节`
    + (rotate ? `（画布已旋转 ${rotate}°）` : ''));
  return planes.map((p) => ({ step: p.step, data: bytesToBase64(p.bytes) }));
}

// ---------------- 画布 / 图像 ----------------

function downloadDataArray() {
  if (cropManager.isCropMode()) {
    alert('请先完成图片裁剪！下载已取消。');
    return;
  }

  const mode = el('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = packImageData(imageData, mode);
  if (!processedData) {
    addLog('当前颜色模式无法打包。');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    dataLines.push(`0x${(processedData[i] & 0xff).toString(16).padStart(2, '0')}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'SPECTRA6' ? 0 : mode === 'BWRY' ? 1 : mode === 'BW' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function setStatus(statusText) {
  el('status').innerHTML = statusText;
}

// 状态条：点亮并写文案。会取消上一次发送留下的隐藏定时器，
// 否则紧接着再发一次时，旧定时器会在传输中途把状态条藏掉。
function showStatus(statusText) {
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  el('status').parentElement.style.display = 'inline-flex';
  setStatus(statusText);
}

function hideStatusLater(delay = 5000) {
  if (statusHideTimer) clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => {
    statusHideTimer = null;
    el('status').parentElement.style.display = 'none';
  }, delay);
}

function addLog(logTXT, action = '') {
  const log = el('log');
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0') + ' ';

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  logEntry.className = 'log-line';
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 100) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  el('log').innerHTML = '';
}

function fillCanvas(style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateImage() {
  const imageFile = el('imageFile');
  if (imageFile.files.length == 0) {
    fillCanvas('white');
    return;
  }
  autoPickDitherForImage();

  const image = new Image();
  image.onload = function () {
    URL.revokeObjectURL(this.src);
    if (image.width / image.height == canvas.width / canvas.height) {
      if (cropManager.isCropMode()) cropManager.exitCropMode();
      ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);
      convertDithering();
    } else {
      alert('图片宽高比例与画布不匹配，将进入裁剪模式。\n请放大图片后移动图片使其充满画布, 再点击"完成"按钮。');
      paintManager.setActiveTool(null, '');
      cropManager.initializeCrop();
    }
  };
  image.src = URL.createObjectURL(imageFile.files[0]);
}

// 默认「无抖动」适合模板与文字；换成照片时自动切到 Floyd-Steinberg，
// 但用户手工改过算法后就不再自动干预
function autoPickDitherForImage() {
  if (ditherAlgOverridden) return;
  const select = el('ditherAlg');
  if (select.value === 'none') {
    select.value = 'floydSteinberg';
    addLog('检测到位图，抖动算法自动切换为 Floyd-Steinberg（可手动改回无抖动）');
  }
}

function updateCanvasSize() {
  const selectedSize = findCanvasSize(el('canvasSize').value);
  if (!selectedSize) return;
  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;
  applyPreviewZoom();
  updateImage();
}

// 预览只按整数倍（放不下时用整数分之一）缩放，配合 image-rendering: pixelated
// 做到点对点显示；auto 模式同时受可用宽度和可用高度约束，尽量不让页面出现纵向滚动条
function previewAvailable() {
  const container = canvas.parentElement;
  if (!container) return { width: canvas.width, height: Infinity };

  const cs = getComputedStyle(container);
  const padX = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
  const padY = parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
  const gap = parseFloat(cs.rowGap || cs.gap || 0) || 0;

  // 容器里除画布之外还有标题与底部工具条，先把它们占的高度扣掉
  let others = padY + 2;
  container.querySelectorAll('.canvas-title, .canvas-toolbar').forEach((node) => {
    if (node.offsetParent !== null) others += node.offsetHeight + gap;
  });

  const docTop = container.getBoundingClientRect().top + window.scrollY;
  let height = window.innerHeight - docTop - others - 16;  // 16 留给外边距
  // 单栏（窄屏）下预览本来就在很下面，此时不按高度限制，否则会缩得没法看
  if (height < 240) height = Infinity;

  return { width: Math.max(80, container.clientWidth - padX - 2), height };
}

function applyPreviewZoom() {
  if (!canvas) return;
  const avail = previewAvailable();

  let scale;
  if (previewZoom === 'auto') {
    if (canvas.width > avail.width) {
      // 宽度都放不下：用整数分之一，保持像素对齐
      scale = 1 / Math.ceil(canvas.width / avail.width);
    } else {
      const byWidth = Math.floor(avail.width / canvas.width);
      const byHeight = Number.isFinite(avail.height)
        ? Math.floor(avail.height / canvas.height) : Infinity;
      // 高度不够时最多退到 1x，不再往下缩（那一栏自己滚动就行）
      scale = Math.max(1, Math.min(byWidth, byHeight));
    }
  } else {
    scale = parseFloat(previewZoom) || 1;
  }

  canvas.style.width = Math.round(canvas.width * scale) + 'px';
  canvas.style.height = Math.round(canvas.height * scale) + 'px';
  const info = el('previewZoomInfo');
  if (info) {
    info.textContent = `${canvas.width}x${canvas.height} @ `
      + (scale >= 1 ? `${scale}x` : `1/${Math.round(1 / scale)}`);
  }
}

function setPreviewZoom(value) {
  previewZoom = value;
  applyPreviewZoom();
}

// 切换驱动时自动对齐它的颜色模式与画布尺寸
function updateDitcherOptions() {
  const driver = findDriver(el('epddriver').value);
  if (driver) {
    el('ditherMode').value = driver.color;
    el('canvasSize').value = driver.size;
  }
  updateCanvasSize();
}

function rotateCanvas() {
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  canvas.width = currentHeight;
  canvas.height = currentWidth;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  paintManager.clearHistory();
  paintManager.clearElements();
  paintManager.saveToHistory();
  applyPreviewZoom();
}

function clearCanvas() {
  if (confirm('清除画布内容?')) {
    fillCanvas('white');
    paintManager.clearElements();
    if (cropManager.isCropMode()) cropManager.exitCropMode();
    paintManager.saveToHistory();
    return true;
  }
  return false;
}

// 不弹确认的清空：切到「空白画布」时用，留一张干净的画布给手绘
function blankCanvas() {
  if (!paintManager) return;
  fillCanvas('white');
  paintManager.clearElements();
  if (cropManager && cropManager.isCropMode()) cropManager.exitCropMode();
  paintManager.clearHistory();
  paintManager.saveToHistory();
  lastRenderKey = '';
}

function setCanvasTitle(title) {
  const canvasTitle = document.querySelector('.canvas-title');
  if (canvasTitle) {
    canvasTitle.innerText = title;
    canvasTitle.style.display = title && title !== '' ? 'inline' : 'none';
  }
}

// 画布上按当前颜色模式做亮度/对比度调整 + 抖动，并把量化结果画回画布做预览
function convertDithering() {
  paintManager.redrawTextElements();
  paintManager.redrawLineSegments();

  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustBrightness(imageData, parseFloat(el('ditherBrightness').value));
  adjustContrast(imageData, parseFloat(el('ditherContrast').value));

  const alg = el('ditherAlg').value;
  const strength = parseFloat(el('ditherStrength').value);
  const mode = el('ditherMode').value;
  const dithered = ditherImage(imageData, alg, strength, mode);
  const packed = packImageData(dithered, mode);
  ctx.putImageData(decodeImageData(packed, canvas.width, canvas.height, mode), 0, 0);

  paintManager.saveToHistory();
}

function applyDither() {
  cropManager.finishCrop(() => convertDithering());
}

function initEventHandlers() {
  el('mtusize').addEventListener('input', () => { mtuOverridden = true; });
  el('ditherAlg').addEventListener('change', () => { ditherAlgOverridden = true; });
  // 「图像调整」是浮层，点空白处收起
  const adjust = el('adjustPanel');
  if (adjust) {
    document.addEventListener('click', (e) => {
      if (adjust.open && !adjust.contains(e.target)) adjust.open = false;
    });
  }
  // 容器宽度变化时重算整数倍缩放
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyPreviewZoom, 150);
  });
  el('ditherStrength').addEventListener('input', (e) => {
    el('ditherStrengthValue').innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  el('ditherBrightness').addEventListener('input', (e) => {
    el('ditherBrightnessValue').innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  el('ditherContrast').addEventListener('input', (e) => {
    el('ditherContrastValue').innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
}

function checkDebugMode() {
  const link = el('debug-toggle');
  const debugMode = new URLSearchParams(window.location.search).get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('debug-mode');
    link.innerHTML = '正常模式';
    link.setAttribute('href', window.location.pathname);
    addLog('注意：开发模式功能已开启！不懂请不要随意修改，否则后果自负！');
  } else {
    document.body.classList.remove('debug-mode');
    link.innerHTML = '开发模式';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

// 后端推送的日志与传输进度
function handleEvent(event) {
  if (event.type === 'log') {
    addLog(event.text, event.action || '');
  } else if (event.type === 'status') {
    applyStatus(event.status);
  } else if (event.type === 'retry_status') {
    applyRetryStatus(event.retry);
  } else if (event.type === 'progress') {
    if (event.step === 'done') {
      let text = `发送完成！耗时: ${event.elapsed}s`;
      if (event.ratio) text += `, 压缩比: ${event.ratio}%`;
      if (event.failed) text += `, 失败块数: ${event.failed}`;
      showStatus(text);
      hideStatusLater();
    } else {
      const elapsed = startTime ? (new Date().getTime() - startTime) / 1000.0 : 0;
      const label = event.step === 'red' ? '红色块' : '数据块';
      const percent = event.total ? Math.round(event.current / event.total * 100) : 0;
      showStatus(`${label}: ${event.current}/${event.total} (${percent}%), 总用时: ${elapsed}s`);
    }
  }
}

document.body.onload = async () => {
  // canvas 必须先就位：initOptions 之后的 updateDitcherOptions 会调整画布尺寸
  canvas = el('canvas');
  ctx = canvas.getContext('2d');
  fillCanvas('white');

  initOptions();
  // 默认按 4.2 寸三色（UC8176）来，颜色模式与画布尺寸由 updateDitcherOptions 跟着对齐
  el('epddriver').value = '03';
  updateDitcherOptions();

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  paintManager.initPaintTools();
  cropManager.initCropTools();
  initEventHandlers();
  initTemplates();
  checkDebugMode();
  updateButtonStatus();

  subscribeEvents(handleEvent);
  ensureTemplateFonts();
  onTemplateChange();
  await refreshSavedDevices();
  // 默认回到上次用过的设备，并把它最新的历史版本完整还原到右侧
  await refreshHistory({ apply: true });
  renderRssi();
  try {
    applyStatus(await API.status());
  } catch (e) {
    addLog('无法连接后端服务: ' + e.message);
  }
  // 页面刷新/重新打开时把后端当前的轮询状态显示出来（比如任务是在别的标签页发起的）
  try {
    applyRetryStatus(await API.retryStatus());
  } catch (e) {
    addLog('读取自动轮询状态失败: ' + e.message);
  }
};

