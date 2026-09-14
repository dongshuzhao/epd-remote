# 墨水屏远程管理服务

把墨水屏上位机改造成前后端分离：图像生成（抖动、画笔、裁剪）仍在浏览器完成，蓝牙扫描/连接/传输由 NAS 上的后端通过 BlueZ 执行。这样在外网访问 NAS 页面就能刷新家里的墨水屏，不再依赖浏览器的 Web Bluetooth。

图像处理流水线与驱动表对齐 [epdiy.cn](https://epdiy.cn/) 上位机，页面骨架来自开源版 [EPD-nRF5](https://github.com/tsl0922/EPD-nRF5)。

## 两个上位机的蓝牙协议差异

两者用的是同一套 GATT 协议，可以互换：

- Service `62750001-…`、读写+通知特征 `62750002-…`、版本特征 `62750003-…` 完全相同
- 基础命令相同：`0x00` SET_PINS、`0x01` INIT、`0x02` CLEAR、`0x05` REFRESH、`0x20` SET_TIME（6 字节负载也一致）、`0x90/0x91/0x92/0x99`
- 图片下发 `0x30` WRITE_IMG 的分片格式、首包/红块/RLE 标志位、RLE 编码算法逐位相同

epdiy.cn 的固件是超集，多出来的部分：

- 命令：`0x21` 星期起始、`0x22` 倒计时、`0x23` 节假日、`0x31` 槽位选择/显示、`0x32` 删除槽位、`0x33` 轮播、`0x34` 回读图片；`REFRESH` 可带 `0xA5` 表示只存不刷
- 版本特征可返回字符串（如 `1.7-nrf5`，`-s` 后缀代表小屏固件），旧固件只返回一个字节
- 通知增加 `err=busy`、`t=… bat=…`、`clock_enable=`、`nrf_dfu=`、`a0_fix=`、`slots=`、`sid=`、`img=`/`chunk=` 等字段；首帧配置的第 14 字节是当前槽位
- 驱动表大得多，且不同驱动对数据有专属变换（UC8159 合并、龙亭拆分、逐行镜像、四色 A0 行交织、取反）
- 固件 OTA 走另一套 `67fc…` DFU 服务

本项目已同步的：完整驱动/尺寸/颜色模式表与全部驱动专属变换、亮度调节、Burkes/Sierra 抖动、固件版本串与小屏驱动表切换、电池电压、`err=busy`、`clock_enable`、`a0_fix`、槽位信息展示、重启与恢复出厂、发送统计（压缩比与失败块数）。

未同步的：图片槽位管理与轮播、倒计时、节假日、固件 OTA。

epdiy.cn 的模板功能无法照搬：模板是在它的服务端渲染的（`POST /render` 带 `X-Machine-ID`，未授权设备返回 401），公开的只有变量名和默认值，排版布局并不公开。本项目改为**本地模板**：在浏览器里用 canvas 直接画，模板定义写在 `frontend/js/templates.js`，完全离线、可随意增改。`sid=` 那套授权校验只是它前端的门禁，本服务直接忽略，不影响下发。

## 模板

页面「图像生成与发送」里选模板 → 编辑变量，画布会**实时预览**：换模板、改任意变量、点「填入默认值」/「清空变量」都会自动重渲染（`scheduleLivePreview`，输入时 250ms 防抖，静默模式不写日志、不弹框、裁剪中不打断）。「渲染到画布」按钮仍在，位于「清除画布」左侧，用于手动重渲染。变量按模板分别存在浏览器 localStorage 里，下次自动带出。

内置五个：待办事项、作业清单、个人名片、设备标签、课程表。布局按画布尺寸等比缩放，所以同一模板在 400x300 / 800x480 / 250x122 上都能用；在支持彩色的模式（BWR/BWRY/SPECTRA6）下强调色用红色，双色/灰度模式自动退化为黑色。

待办事项与作业清单是流式排版，字号和行距会自适应（`tplFitFlow`）：先按 16 点阵试排，装不下退到 12 点阵，仍装不下就把行距从 1.35 逐档收紧到 1.2 / 1.1 / 1.0；到这一步还是放不下，就把页脚整块（含分隔线）去掉、把这块高度让给正文再重排一遍（`tplFitFlowFooter`），最后才按行截断。页脚固定用 12 点阵（CSS 15px 正好是它的 1 倍 em 框，字形高度就是 12 像素，不随画布放大）、强调色，上方的分隔线是 1px 黑色实线、左右贯穿整屏（描边坐标取 `Math.round(y)+0.5`，正好压在一行像素上，不会糊成两行灰边）。

「作业清单」复用待办事项的风格（彩色标题栏 + 标题/日期，底部页脚），正文按语文、数学、英语、其他、通知依次排列，每个条目占整行——「通知」和科目共用同一套渲染逻辑，只是排在最后。条目名用点阵宋写成【语文】这样的形式、强调色底＋白字（单色屏下强调色即黑色），内容紧挨其后用白底黑字；首行让出条目名的宽度，折行后从第二行起回到左边距、不带缩进（不限行数，内容有多少折多少行，放不放得下交给字号/行距自适应）；条目之间用强调色横向点线（一个点一个空白）分隔，留空的条目不占位。变量表单用固定 4 列（模板里声明 `formColumns: 4`）：标题/日期/页脚共一行，五个条目各占两列、每行两项；窗口窄于 1200px 时自动退回 2 列。

字体针对黑白墨水屏做了处理：正文用内置的**文泉驿点阵宋**（见 `frontend/fonts/README.md`）。这两个字体的 em 框是 15 / 18 个设计像素（不是 12 / 16），所以 CSS 字号必须取 15 或 18 的整数倍才能 1:1 压在像素格上；档位只用 15px（12 点阵，小屏）和 18/36/54/72（16 点阵），按画布高度自动选，绘制时基线与对齐原点取整。另外点阵字必须关掉字形微调：Chrome 默认会把轮廓挪半个像素做「视觉优化」，方块边缘被反锯齿糊成灰边（15px 时只有 37% 的墨点是纯色），所以 `tplSetFont` 给点阵字设 `ctx.textRendering = 'geometricPrecision'`，实测纯度 100%；矢量标题仍用 `auto` 保留抗锯齿。标题用系统细黑栈（华文细黑优先）、字重 300，彩色标题栏上的反白白字例外用 500 并对该区域做硬二值化，避免细笔画在三色屏上断裂。标题栏右上角的日期改用点阵宋（`tplHeader` 的 `rightBitmap` 选项），字号吸附到点阵档位并按标题栏高度封顶，数字串在墨水屏上更规整。正文超宽会自动折行（中文逐字断、英文整词断、超长单词硬切），排不下的内容按行截断并补省略号。

加模板就是在 `frontend/js/templates.js` 的 `EPD_TEMPLATES` 里追加一项。变量的 `value` 可以写成函数，用于日期这类每次都要取当前值的字段（如 `value: () => tplToday()`，输出 `2026-09-07` 格式）：

```js
{
  name: 'my_tpl',
  display: '我的模板',
  variables: [{ name: 'text', label: '文字', value: '默认值' }],
  draw(ctx, v, w, h, accent) {
    const s = tplScale(w, h);
    tplText(ctx, v.text, w / 2, h / 2, { size: 20 * s, align: 'center', color: accent });
  },
}
```

可用的绘制辅助函数：`tplScale`、`tplText`、`tplWrapText`、`tplMeasureLines`、`tplLineHeight`、`tplRect`、`tplLine`、`tplHeader`。`tplText`/`tplWrapText` 的 `title: true` 切到黑体（标题用），默认走点阵宋（正文用）。

## 结构

- `frontend/js/epd-image.js` — 驱动/尺寸/调色板表、抖动、位面打包与解码、驱动专属变换（已与 epdiy.cn 原实现逐字节比对）
- `frontend/js/templates.js` — 本地模板（待办事项、个人名片、设备标签、课程表），在画布上直接绘制，按画布尺寸等比缩放
- `frontend/js/api.js` — 后端 REST + WebSocket 封装；`main.js` 里原来的 Web Bluetooth 调用全部换成 API 调用。每个请求都带 `AbortController` 超时（发图 200s、扫描/连接 60s、其余 30s），后端若被系统卡住页面不会无限等待；`/api/image` 服务端另有 `EPD_IMAGE_TIMEOUT`（默认 180s）看门狗
- `backend/app/ble.py` — bleak 单连接管理器：扫描、连接、命令、图片分块（含 RLE）传输，`session()` 负责“按需连接、用完即断”（图片走前端分步编排，不用它）。连接后会调 `client._backend._acquire_mtu()` 取真实 ATT MTU——BlueZ 后端不调它的话 `mtu_size` 恒为 23（bleak 会打 "Using default MTU value" 警告），分片会退化成 18 字节，一帧 3 万字节要切近 1700 片、传 27 秒。每帧之前都会 INIT 一次，与验证过的上位机保持一致。连接时读写特征的 properties：只声明 `write-without-response` 的固件一律降级为无确认写入（否则 CoreBluetooth 等不到 `didWrite` 回调，数据其实发出去了、屏也闪了，请求却永远挂着），此时靠每 `interleaved` 个分片 `sleep(0.02)` 做流控。带确认的写入都有超时（命令 10s / 分片 5s），连续 3 个分片写失败就放弃整帧交给上层重试；订阅通知后等 0.3s 再下第一条命令
- `backend/app/rle.py` — RLE 压缩的 Python 移植（已与 JS 实现逐字节比对一致）
- `backend/app/devices.py` — 设备记忆（含 `last_address` 上次用的设备），存 `${EPD_DATA_DIR}/devices.json`
- `backend/app/history.py` — 发送历史，按设备存 `${EPD_DATA_DIR}/history.json`，每台设备最多 50 条
- `data/devices.json` — 设备记忆文件，可直接手工编辑
- `docker-entrypoint.sh` — 容器启动时按需拉起 `dbus-daemon` + `bluetoothd`（用 D-Bus `ListNames`/`org.bluez` ping 判断是否已就绪，容器重启后会清掉残留的套接字与 pid 文件），最后 `exec` uvicorn

## 部署（amd64 / Docker）

```bash
docker compose up -d --build
# 打开 http://<NAS地址>:8655
```

蓝牙用宿主机的适配器，所以必须 `network_mode: host`（`AF_BLUETOOTH` 套接字按 netns 隔离，hci0 在宿主机的 netns 里）。**BlueZ 用户态默认跑在容器内**：`docker-entrypoint.sh` 会起 `dbus-daemon` + `bluetoothd --experimental`，宿主机不用装任何东西（Unraid 这类系统默认就没有 BlueZ）。

- 管理 hci 设备需要 `NET_ADMIN`/`NET_RAW`；仍报 `Operation not permitted` 或 D-Bus 被拒时改用 `privileged: true`。
- 宿主机若**自己**装了 BlueZ 并跑着 `bluetoothd`，改成复用它：挂 `/run/dbus:/run/dbus:ro` 并设 `EPD_USE_HOST_DBUS=1`。两个 `bluetoothd` 同时抢 hci0 会互相踢，别同时开。
- 默认端口 8655（`EPD_PORT`）。host 网络下端口若被别的容器占用，换一个即可。
- NAS 没有内置蓝牙就插一个 USB 蓝牙棒，宿主机 `ls /sys/class/bluetooth/` 能看到 `hci0` 即可。

### Unraid 实测（7.3.1 / 内核 6.18 / CSR USB 蓝牙棒）

宿主机只需要认到适配器，**不需要装 bluez**：

```bash
ls /sys/class/bluetooth/          # 有 hci0 就行
lsmod | grep btusb                # 驱动已加载
# bluetoothctl / hciconfig 没有也没关系，它们在容器里
```

跑起来（Unraid 的 appdata 放源码与数据，端口用默认的 8655）：

```bash
mkdir -p /mnt/user/appdata/epd-remote/{src,data}
# 把仓库同步到 /mnt/user/appdata/epd-remote/src（rsync/git clone 都行）
cd /mnt/user/appdata/epd-remote/src && docker build -t epd-remote:latest .
docker run -d --name epd-remote --network host \
  --cap-add NET_ADMIN --cap-add NET_RAW \
  -e EPD_DATA_DIR=/data -e TZ=Asia/Shanghai \
  -v /mnt/user/appdata/epd-remote/data:/data \
  --restart unless-stopped epd-remote:latest
docker logs epd-remote           # 应看到 dbus-daemon 就绪 / bluetoothd 就绪
curl -s -X POST http://127.0.0.1:8655/api/scan -d '{"timeout":8}' -H 'content-type: application/json'
```

实测输出（就是这台屏）：`{"address":"A0:A3:B8:2D:86:55","name":"NRF_EPD_8655","rssi":-49,"is_epd":true}`。

本地开发（不走 Docker）：直接跑仓库根目录的 `dev.sh`，它会建/复用 `.venv`、装依赖、把 `frontend/` 和 `data/` 指到仓库里，然后以 `--reload` 启动后端。前端不需要单独的 server，后端把 `frontend/` 挂在 `/`，同源、无 CORS；改前端刷新浏览器，改后端自动重启。

```bash
./dev.sh                # http://127.0.0.1:8655
PORT=9000 ./dev.sh      # 换端口
HOST=0.0.0.0 ./dev.sh   # 允许局域网访问
RELOAD=0 ./dev.sh       # 关掉自动重载
```

脚本会自动挑 Python 3.9~3.12（`bleak 0.22.3` 装不上 3.13+）。蓝牙用本机适配器：macOS 首次扫描会弹权限，Linux 需要 `bluetoothd` 在跑。

## 页面布局

Material 风格、自适应两栏（≤1023px 自动堆成单栏）：

- 左栏：设备连接、设备控制、历史版本、运行日志。控制类按钮全部是 **36px 单图标按钮**（文案走 `title` 悬浮提示）：「已记忆 + 连接 + 设备管理」一行，设备控制的日历/时钟/清屏/保存参数/重启/恢复出厂挤一行，日志的清空按钮在卡片标题右侧。扫描/记忆/删除记忆收在「设备管理」的浮层里（`details.subtle`，向下展开、不撑开布局）
- 顶栏：标题、连接状态胶囊、**信号强度胶囊**（目标设备的 RSSI，点一下做 5s 快速扫描重新测量；≥-60 绿=强、≥-75 黄=良、更低红=弱，鼠标悬停显示地址与测得时间；扫描/选设备时会自动刷新，发送过程中拒绝测量以免干扰传输）、**传输状态胶囊**（发送进度/刷新倒计时，空闲时隐藏，发送完成 5s 后自动收起）、开发模式开关
- 左栏所有按钮都带图标：图标取自 [Lucide](https://lucide.dev)（ISC 许可），内联成 `<symbol>` sprite 放在 `index.html` 顶部，`<use href="#i-xxx">` 引用，**不产生任何外链请求**；`.icon` 用 `stroke: currentColor`，所以主/次/危险按钮的配色自动跟随。连接按钮按状态换图标与提示（`#i-plug`/「连接」⇄ `#i-unplug`/「断开」）。「清空」类操作用手绘的扫把图标 `#i-broom`（Lucide 里没有现成的，按同样的 24 网格 / 2px 描边画的），「删除单条」保持垃圾桶 `#i-trash`，两者一眼可分
- 行内的下拉用 `flex: 1 1 0; width: 0` 自己让宽并省略号截断，按钮 `flex: 0 0 auto`，所以设备名再长也不会把同行按钮挤到下一行
- 右栏：图像生成与发送、预览（独立卡片，画布单独拉出来，带整数倍缩放）。画布在预览框里上下居中，画笔/橡皮/文字/裁剪的按钮和各自的参数收在同一条 40px 工具条里，`position: sticky` 粘在预览框底部；当前模式提示（「画笔模式」「裁剪模式: …」）也放在这条工具条里、过长时省略号截断，不再占画布上方的一行
- 模板下拉里「图片」也是一种类型，选中后它的填写内容就是文件选择框；抖动算法、强度、亮度、对比度以及画布尺寸/颜色模式/MTU 等参数收进「图像调整」——它是发送按钮同一行的小开关，展开为浮层，不额外占布局高度
- 宽屏（≥1024px）下整页高度锁在视口内，**页面不出现纵向滚动条**：多出来的高度由日志卡片吸收，实在放不下时只有对应那一栏内部滚动；预览的自适应倍率同时受可用宽度和可用高度约束
- 深浅色跟随系统 `prefers-color-scheme`
- 高级控件（驱动/引脚/画布尺寸/颜色模式/MTU/确认间隔/原始指令/重启/恢复出厂/旋转画布/下载数组）默认隐藏，点顶栏右上角的「开发模式」（即 `?debug=true`）后显示

「历史版本」按设备记录每次**成功发送**的内容：存的是模板名、模板变量和画布参数（尺寸/颜色模式/驱动）加时间戳，不存图像本身——回滚时在前端按这些参数重新渲染，所以文件体积很小。版本名称形如「作业清单 · 2026-09-08 00:45:39」，在左栏「历史版本」里是一个自绘列表（`#historyList`，最高 150px 可滚动）：**点某一行就直接载入那个版本**，当前载入的那行高亮；鼠标移到行上时右侧出现垃圾桶按钮可删除单条（点它不会触发载入）；卡片标题右侧的扫把按钮清空该设备的全部历史（带确认，运行日志的清空按钮同款扫把图标）。切换版本时右栏会完整还原它的模板、填写内容并重新渲染预览。发送内容与该设备最新一条完全相同时不会新增记录（比较模板、变量表、画布尺寸/颜色模式/驱动，变量表忽略键顺序与空值），只在日志里提示一句；「图片」类型不存图、内容无从比较，所以照常记录。页面加载时自动回到上次用过的设备（后端 `last_address`）并载入它最新的一条历史。「图片」类型的历史只记一条痕迹，原始文件没有保存，回滚时需要重新选文件。

## 使用

生成与发送是解耦的：不连接任何设备也能改图、抖动、预览、下载数组，只有真正下发数据时才碰蓝牙。

1. 打开页面直接选模板/选图、调抖动参数、用画笔/文字/裁剪工具改图，全程不需要设备。模板下拉里选「空白画布」会把预览清空，可以直接在上面手绘再发送。
2. 点「扫描」，列表里带 ★ 的是带 EPD 服务的设备；选中后点「记忆」存下来。之后从「已记忆」下拉框选设备即可作为下发目标。
3. 点「发送图片」：只要「已记忆」里选了设备就不用先连接。**发送走的是与手动操作完全相同的分步路径**——`POST /api/connect`（后端扫描等待 25s，这个屏的广播间隔偏长，扫太快容易连着好几次都找不到）→ 轮询 `GET /api/status` 直到状态真的变成「已连接」（上限 30s，每 300ms 一次）→ 再等 1.5s → 重新渲染一次画布 → `POST /api/image`（不带 `address`，复用当前连接）→ **保持连接等 30s 让墨水屏刷完**（状态条上有倒计时，`REFRESH_WAIT`）→ `POST /api/disconnect`。整屏刷新要几十秒，发完立刻断开会把刷新打断。已经手动连着时只发送、不动连接。日志和进度通过 WebSocket 实时回显；前端另外会把 `/api/image` 的返回值（耗时/压缩比/失败块数）记一条，WebSocket 抽风也能确认成败。失败会把整段重来，最多重试 2 次（共 3 次尝试，间隔 1.5s）。日历/时钟/清屏/发送命令这类小指令仍走后端的临时连接（带 `address` 一次调用即可）。
   - **弱信号自适应**：连接时用 `find_device_by_filter` 从广播包里取一次 RSSI（`backend/app/ble.py` 的 `RSSI_WEAK=-75`/`RSSI_POOR=-85` 两档阈值），信号偏弱/极弱时自动把分片 MTU 收紧到 100/40 字节、单片超时放宽到 8s/12s，减少弱信号跨房间场景下的丢包代价。另外每个分片写入失败时会原地立即重试一次（同一片数据，不算入失败计数），大部分偶发丢包第二次就能过，明显抬高成功率；连续失败仍达到 `MAX_FAIL_STREAK=3` 才会放弃整帧交给上层重试。
   - **自动轮询重试**：前端 3 次尝试仍失败（比如设备暂时不在信号范围内），最后一次会带 `auto_retry: true` 请求后端接管——`backend/app/retry.py` 的 `RetryTask` 每 5 分钟检查一次设备是否能连上并重发，直到成功或手动停止；这是个纯内存的单任务（不落盘，进程重启会丢失），同一时刻只保留最新一个，新的发送请求会取消上一个还没成功的轮询。顶栏「自动轮询中」胶囊显示当前尝试次数与下次重试倒计时，点击可停止；页面刷新或重新打开会用 `GET /api/retry` 拿到真实状态（哪怕是另一个标签页发起的轮询）。
4. 调试时可以点「连接」保持长连接，此时上述操作复用已有连接、结束后不会断开，方便反复试。这个按钮是连接/断开二合一：未连接时显示「连接」（主按钮样式），已连接时变成「断开」。
5. 调好某块屏的驱动/画布/颜色模式后，点「保存当前参数到记忆」，下次选中该设备自动恢复。

页面默认驱动是「4.2寸(三色,UC8176)」（`03`），对应画布 400x300、颜色模式 BWR，模板里的强调色因此默认是红的；换驱动时颜色模式和画布尺寸会自动跟着对齐，设备记忆里存过的值优先。

MTU 默认由固件连接时上报，页面不会覆盖；只有你在开发模式里手工改过 MTU 输入框，才会把该值下发给后端。固件不上报时后端按链路 MTU 推算并**封顶 244**（macOS 的 `mtu_size` 会报到 500+，按它切片会触发 ATT 长写，固件不支持长写那笔写入就永远不会完成）；如果整帧还是写不动，会自动退到最保守的 `MTU=20`（上位机的默认值）把整帧重发一遍。

画布预览只按整数倍缩放（放不下时用 1/2、1/3 这类整数分之一），并且 `image-rendering: pixelated`，所以点阵字体在页面上看到的就是屏上的样子，不会被浏览器插值糊掉。「预览缩放」可选自适应或固定 1x（点对点）/2x/3x/4x，右侧会显示当前画布尺寸与实际倍率。

抖动算法默认「无抖动」：模板和文字本来就是纯色，误差扩散会把 1px 线框和笔画边缘打散（实测 Floyd-Steinberg 会让勾选框和分隔线变虚线）。选了图片文件时会自动切到 Floyd-Steinberg，你手工改过算法之后就不再自动干预。

## API

- `GET /api/status`、`POST /api/scan`、`POST /api/connect`、`POST /api/disconnect`（后两个用于保持长连接调试）
- `POST /api/driver`（引脚+驱动）、`POST /api/time`（1=日历 2=时钟）、`POST /api/clear`、`POST /api/cmd`（原始 hex）
- `POST /api/sys` — `{"action":"reset"|"erase"|"sleep"}`，重启 / 恢复出厂 / 休眠
- `POST /api/image` — `{"planes":[{"step":"bw","data":"<base64>"}],"interleaved":10,"mtu":null,"address":"AA:BB:.."}`
- 上面这些下发类接口都接受可选的 `address`：未连接时临时连接、执行完自动断开；已手动连接则复用连接且不断开（出错也会正确收尾）
- `GET/POST /api/devices`、`DELETE /api/devices/{address}`；`GET /api/devices` 同时返回 `last_address`，`POST /api/devices/last` 记录上次用的设备
- `GET /api/history?address=..`（按时间倒序）、`POST /api/history`（发送成功后由前端写入）、`DELETE /api/history/{id}`（删单条）、`DELETE /api/history?address=..`（清空某设备，返回删除条数）
- `WS /api/ws` — 日志与进度推送；交互式文档在 `/api/docs`

## 安全提醒

服务本身没有任何认证，任何能访问该端口（默认 8655）的人都能操作墨水屏并驱动蓝牙扫描。不要把端口直接暴露到公网，请通过 Tailscale/WireGuard，或带鉴权的反向代理（nginx basic auth 等）访问。
