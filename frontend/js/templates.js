// 本地模板：直接在画布上绘制，变量在页面里编辑，不依赖任何外部渲染服务。
// 布局按画布尺寸等比缩放，因此同一个模板可用于不同尺寸的屏。
//
// 字体策略（针对黑白墨水屏）：
// - 正文用内置的文泉驿点阵宋，字号吸附到 12/16 的整数倍，笔画正好压在像素格上，
//   二值化后没有灰边；
// - 标题用系统黑体栈，字号大、笔画粗，矢量字体二值化后同样清晰。

const TPL_BODY_12 = '"WQY Bitmap Song 12", "WenQuanYi Bitmap Song", SimSun, serif';
const TPL_BODY_16 = '"WQY Bitmap Song 16", "WenQuanYi Bitmap Song", SimSun, serif';
// 标题黑体：优先细黑一类的细字体，笔画细、结构清楚，二值化后不糊成一团。
// 名称里带 Light 的放前面，后面再靠 font-weight 让可变字重的字体取细体。
const TPL_TITLE_FONT = '"STXihei", "Hiragino Sans GB W3", "Hiragino Sans GB", '
  + '"PingFang SC", "Microsoft YaHei Light", "Source Han Sans SC", "Noto Sans SC", '
  + '"WenQuanYi Zen Hei", "Microsoft Yahei", SimHei, sans-serif';
// 标题默认用细体；bold 只提到常规字重，避免又回到粗黑
const TPL_TITLE_WEIGHT = 300;
const TPL_TITLE_WEIGHT_BOLD = 400;
// 反白文字（彩色标题栏上的白字）例外：细笔画二值化后会断，最少给到 500
const TPL_TITLE_WEIGHT_INVERT = 500;

// 两个点阵字体的 em 框分别是 15 / 18 个设计像素（1 设计像素 = 100 字体单位，已核对字形坐标），
// 所以 CSS 字号必须取 15 或 18 的整数倍，字形才严格压在像素格上：
//   12 点阵 → 15px（1 倍）、30px（2 倍）…
//   16 点阵 → 18px（1 倍）、36px（2 倍）…
// 16 点阵的字形细节明显好于 12 点阵，所以档位里只在最小一档用 12 点阵，
// 其余都走 16 点阵的整数倍，避免出现「大而糙」的 12 点放大字。
const TPL_BODY_STEPS = [
  { px: 15, family: TPL_BODY_12 },
  { px: 18, family: TPL_BODY_16 },
  { px: 36, family: TPL_BODY_16 },
  { px: 54, family: TPL_BODY_16 },
  { px: 72, family: TPL_BODY_16 },
];

// 按画布高度选正文档位：小屏用 12 点阵，常规尺寸起用 16 点阵
function tplBodySize(height) {
  if (height < 200) return 15;
  if (height < 420) return 18;
  if (height < 760) return 36;
  return 54;
}

// 比正文低一档，用于标签这类小字
function tplSmallSize(height) {
  const idx = TPL_BODY_STEPS.findIndex((s) => s.px === tplBodySize(height));
  return TPL_BODY_STEPS[Math.max(0, idx - 1)].px;
}

// 页脚固定用 12 点阵（15px 是它的 1 倍 em 框），不随画布放大
const TPL_FOOTER_SIZE = TPL_BODY_STEPS[0].px;

// 要在 avail 高度里排 rows 行时，取放得下的最大档位
function tplBodySizeFit(avail, rows, height) {
  const max = tplBodySize(height);
  const candidates = TPL_BODY_STEPS.filter((s) => s.px <= max).reverse();
  for (const step of candidates) {
    if (Math.max(1, rows) * Math.round(step.px * TPL_LINE_FACTOR) * 1.15 <= avail) return step.px;
  }
  return TPL_BODY_STEPS[0].px;
}

// 默认行距系数，以及装不下时逐档收紧的档位
const TPL_LINE_FACTOR = 1.35;
const TPL_LINE_FACTORS = [1.35, 1.2, 1.1, 1.0];

// 与 16 点阵档位对应的 12 点阵档位（都是各自 em 框的整数倍）
const TPL_FALLBACK_SIZE = { 18: 15, 36: 30, 54: 45, 72: 60 };

// 流式排版（待办、作业清单）的字号与行距自适应：
// 先用 16 点阵，装不下退到 12 点阵，还装不下就逐档收紧行距；
// 全都装不下时返回最紧的一档，由调用方按行截断。
function tplFitFlow(ctx, avail, height, measure) {
  const primary = tplBodySize(height);
  const fallback = TPL_FALLBACK_SIZE[primary] || TPL_BODY_STEPS[0].px;

  const attempts = [];
  if (fallback !== primary) attempts.push({ px: primary, factor: TPL_LINE_FACTOR });
  TPL_LINE_FACTORS.forEach((factor) => attempts.push({ px: fallback, factor }));

  let last = attempts[attempts.length - 1];
  for (const attempt of attempts) {
    const lineHeight = Math.round(attempt.px * attempt.factor);
    last = { px: attempt.px, factor: attempt.factor, lineHeight, fits: false };
    if (measure(attempt.px, lineHeight) <= avail) {
      last.fits = true;
      return last;
    }
  }
  return last;
}

// 正文在留出页脚后仍排不下时，把页脚这块高度让给正文（页脚是装饰，正文不能丢）。
// 返回 { fit, bottom, showFooter }，调用方按 showFooter 决定还画不画页脚。
function tplFitFlowFooter(ctx, top, h, footerH, measure) {
  const fit = tplFitFlow(ctx, h - footerH - top, h, measure);
  if (fit.fits || footerH <= 0) {
    return { fit, bottom: h - footerH, showFooter: footerH > 0 };
  }
  return { fit: tplFitFlow(ctx, h - top, h, measure), bottom: h, showFooter: false };
}

// 取不超过 limit 的最大档位
function tplBodySizeUnder(limit) {
  const fits = TPL_BODY_STEPS.filter((s) => s.px <= limit);
  return (fits.length ? fits[fits.length - 1] : TPL_BODY_STEPS[0]).px;
}

// 把任意字号吸附到最近的点阵档位
function tplSnapBody(size) {
  let best = TPL_BODY_STEPS[0];
  let bestDiff = Infinity;
  for (const step of TPL_BODY_STEPS) {
    const diff = Math.abs(step.px - size);
    if (diff < bestDiff) { bestDiff = diff; best = step; }
  }
  return best;
}

// 吸附到最近的点阵档位，但不超过 limit（用于标题栏这类高度有限的位置）
function tplBodySizeCapped(size, limit) {
  const snapped = tplSnapBody(size).px;
  return snapped <= limit ? snapped : tplBodySizeUnder(limit);
}

// 以 400x300 为基准的缩放系数
function tplScale(width, height) {
  return Math.min(width / 400, height / 300);
}

// 供预加载使用的字体列表
const TPL_PRELOAD_FONTS = ['15px "WQY Bitmap Song 12"', '18px "WQY Bitmap Song 16"'];

// 设置上下文字体：body 用点阵档位，title 用细黑
//
// 点阵字体必须关掉字形微调（hinting）：Chrome 默认会把轮廓往「视觉最优」的位置挪
// 半个像素，点阵字的方块边缘因此被反锯齿糊成灰边（实测 15px 时只有 37% 的墨点是纯黑）。
// textRendering = 'geometricPrecision' 表示严格按几何位置光栅化，实测纯度 100%。
function tplSetFont(ctx, size, opts = {}) {
  const { bold = false, title = false, weight = 0 } = opts;
  if (title) {
    const px = Math.max(10, Math.round(size));
    const w = weight || (bold ? TPL_TITLE_WEIGHT_BOLD : TPL_TITLE_WEIGHT);
    ctx.textRendering = 'auto';
    ctx.font = `${w} ${px}px ${TPL_TITLE_FONT}`;
    return px;
  }
  const step = tplSnapBody(size);
  ctx.textRendering = 'geometricPrecision';
  ctx.font = `${step.px}px ${step.family}`;
  return step.px;
}

// 点阵文字必须落在整数像素上，否则浏览器会做子像素定位导致糊边。
// 对齐也自己算，避免浏览器按测量宽度算出小数原点。
function tplDrawAligned(ctx, str, x, y, align, bitmap) {
  if (!bitmap) {
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
    return;
  }
  ctx.textAlign = 'left';
  let left = x;
  if (align === 'center') left = x - ctx.measureText(str).width / 2;
  else if (align === 'right') left = x - ctx.measureText(str).width;
  ctx.fillText(str, Math.round(left), Math.round(y));
}

// 画一行文字，支持右/居中对齐与超宽截断（截断时补省略号）
function tplText(ctx, text, x, y, opts = {}) {
  const { size = 16, color = '#000000', align = 'left', maxWidth = 0, title = false } = opts;
  tplSetFont(ctx, size, opts);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  let str = String(text == null ? '' : text);
  if (maxWidth > 0 && ctx.measureText(str).width > maxWidth) {
    while (str.length > 1 && ctx.measureText(str + '…').width > maxWidth) {
      str = str.slice(0, -1);
    }
    str += '…';
  }
  tplDrawAligned(ctx, str, x, y, align, !title);
}

// 按宽度折行：中文逐字断，英文/数字尽量整词断，单词超宽再硬切
// maxWidth 可以是数字，也可以是 (行号) => 宽度 的函数，用于首行让出科目名宽度、
// 第二行起用整行宽度这种悬挂缩进的反向排版
function tplWrapLines(ctx, text, maxWidth, maxLines = 0) {
  const str = String(text == null ? '' : text);
  if (str === '') return [];
  const widthAt = typeof maxWidth === 'function' ? maxWidth : () => maxWidth;
  const lines = [];
  const pushLine = (s) => {
    if (maxLines > 0 && lines.length >= maxLines) return false;
    lines.push(s);
    return true;
  };

  for (const paragraph of str.split('\n')) {
    const tokens = paragraph.match(/[A-Za-z0-9@._:+\-\/%#]+|\s+|[\s\S]/g) || [];
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (line !== '' && ctx.measureText(candidate).width > widthAt(lines.length)) {
        if (!pushLine(line)) return lines;
        line = /^\s+$/.test(token) ? '' : token;
      } else {
        line = candidate;
      }
      // 单个词本身就超宽：硬切
      while (ctx.measureText(line).width > widthAt(lines.length) && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1
          && ctx.measureText(line.slice(0, cut)).width > widthAt(lines.length)) cut--;
        if (!pushLine(line.slice(0, cut))) return lines;
        line = line.slice(cut);
      }
    }
    if (line !== '' && !pushLine(line)) return lines;
  }
  return lines;
}

// 折行绘制，返回 { lines, lineHeight, height }
function tplWrapText(ctx, text, x, y, opts = {}) {
  const {
    size = 16, color = '#000000', align = 'left',
    maxWidth = 0, maxLines = 0, title = false, lineFactor = TPL_LINE_FACTOR,
  } = opts;
  const px = tplSetFont(ctx, size, opts);
  const lineHeight = Math.round(px * lineFactor);
  const lines = maxWidth > 0
    ? tplWrapLines(ctx, text, maxWidth, maxLines)
    : [String(text == null ? '' : text)];

  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    tplDrawAligned(ctx, line, x, y + lineHeight * i, align, !title);
  });
  return { lines: lines.length, lineHeight, height: lineHeight * Math.max(1, lines.length) };
}

// 只测量折行后的行数，用于先算布局再绘制
function tplMeasureLines(ctx, text, size, maxWidth, maxLines = 0) {
  tplSetFont(ctx, size);
  return Math.max(1, tplWrapLines(ctx, text, maxWidth, maxLines).length);
}

// 该字号吸附后的实际行高
function tplLineHeight(ctx, size, factor = TPL_LINE_FACTOR) {
  return Math.round(tplSetFont(ctx, size) * factor);
}

function tplRect(ctx, x, y, w, h, opts = {}) {
  const { fill = null, stroke = null, lineWidth = 1 } = opts;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth);
  }
}

function tplLine(ctx, x1, y1, x2, y2, opts = {}) {
  const { color = '#000000', width = 1 } = opts;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// 点线：一个点一个空白间隔，墨水屏上比实线更轻
function tplDottedLine(ctx, x1, y1, x2, y2, opts = {}) {
  const { color = '#000000', step = 2 } = opts;
  ctx.fillStyle = color;
  if (Math.abs(y2 - y1) <= Math.abs(x2 - x1)) {
    const y = Math.round(y1);
    for (let x = Math.round(x1); x <= x2; x += step) ctx.fillRect(x, y, 1, 1);
  } else {
    const x = Math.round(x1);
    for (let y = Math.round(y1); y <= y2; y += step) ctx.fillRect(x, y, 1, 1);
  }
}

// 今天的日期，形如 2026-09-07
function tplToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function tplHexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// 反白文字的抗锯齿灰边在三色屏打包时可能被判成红色，笔画就会断。
// 这里把标题栏区域硬二值化成「纯白 / 纯强调色」，边缘变硬但笔画完整。
function tplHardenBar(ctx, x, y, w, h, accent) {
  if (!ctx.getImageData || !ctx.putImageData || w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const c = tplHexToRgb(accent);
  const bgLum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const threshold = (bgLum + 255) / 2;
  for (let i = 0; i < d.length; i += 4) {
    if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > threshold) {
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
    } else {
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b;
    }
    d[i + 3] = 255;
  }
  ctx.putImageData(img, x, y);
}

// 标题栏：底色块 + 居中标题 + 右上角副标题，返回内容区起始 y
// opts.rightBitmap：右上角文字用点阵宋（日期等数字串用点阵更规整）
function tplHeader(ctx, title, right, w, h, s, accent, opts = {}) {
  const { rightBitmap = false } = opts;
  const barH = 34 * s;
  const margin = 10 * s;
  tplRect(ctx, 0, 0, w, barH, { fill: accent });

  // 标题在整条栏里居中；两侧各留出与右上角标签等宽的空间，避免压到标签。
  // 栏太窄时改为在标签左侧的剩余区域里居中。
  let reserved = 0;
  if (right) {
    // 点阵档位只能取 15/18/36…，按标题栏高度限一下，别顶出栏外
    const tagSize = rightBitmap
      ? tplBodySizeCapped(14 * s, barH * 0.6)
      : 14 * s;
    const tagOpts = rightBitmap
      ? { size: tagSize, color: '#FFFFFF', align: 'right' }
      : {
        size: tagSize, title: true, weight: TPL_TITLE_WEIGHT_INVERT,
        color: '#FFFFFF', align: 'right'
      };
    tplSetFont(ctx, tagSize, tagOpts);
    reserved = ctx.measureText(String(right)).width + margin;
    tplText(ctx, right, w - margin, barH - 12 * s, tagOpts);
  }

  let centerX = w / 2;
  let titleW = w - 2 * (reserved + margin);
  if (titleW < w * 0.35) {
    titleW = w - reserved - 2 * margin;
    centerX = margin + titleW / 2;
  }
  tplText(ctx, title, centerX, barH - 11 * s,
    {
      size: 20 * s, title: true, weight: TPL_TITLE_WEIGHT_INVERT,
      color: '#FFFFFF', align: 'center', maxWidth: Math.max(8, titleW)
    });

  tplHardenBar(ctx, 0, 0, w, Math.ceil(barH), accent);
  return barH;
}

const EPD_TEMPLATES = [
  {
    name: 'todo',
    display: '待办事项',
    variables: [
      { name: 'title', label: '标题', value: '今日待办' },
      { name: 'date', label: '日期', value: () => tplToday() },
      { name: 'item1', label: '事项 1', value: '完成项目报告' },
      { name: 'item2', label: '事项 2', value: '回复客户邮件' },
      { name: 'item3', label: '事项 3', value: '团队会议 14:00' },
      { name: 'item4', label: '事项 4', value: '代码审查' },
      { name: 'item5', label: '事项 5', value: '更新文档' },
      { name: 'item6', label: '事项 6', value: '' },
      { name: 'footer', label: '页脚', value: '专注当下，高效完成' },
    ],
    draw(ctx, v, w, h, accent) {
      const s = tplScale(w, h);
      const top = tplHeader(ctx, v.title, v.date, w, h, s, accent, { rightBitmap: true });

      const items = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6']
        .map((k) => v[k]).filter((t) => t && t.trim() !== '');
      const footerSize = TPL_FOOTER_SIZE;
      const footerH = v.footer ? Math.round(footerSize * 1.8) : 0;

      // 字号/行距自适应：16 点阵 → 12 点阵 → 收紧行距 → 去掉页脚 → 截断
      const layout = (px) => {
        const boxSize = Math.round(px * 0.85);
        const textX = 12 * s + boxSize + 8 * s;
        return { boxSize, textX, textW: w - textX - 10 * s, gap: Math.round(px * 0.4) };
      };
      const { fit, bottom, showFooter } = tplFitFlowFooter(ctx, top, h, footerH,
        (px, lineHeight) => {
          const box = layout(px);
          return items.reduce((need, text) =>
            need + tplMeasureLines(ctx, text, px, box.textW, 2) * lineHeight + box.gap,
            box.gap);
        });

      const fontSize = fit.px;
      const lineHeight = fit.lineHeight;
      const { boxSize, textX, textW, gap } = layout(fontSize);

      // 逐条排布，排不下的直接丢掉
      let y = top + gap;
      for (const text of items) {
        const lines = tplMeasureLines(ctx, text, fontSize, textW, 2);
        const rowH = lineHeight * lines;
        if (y + rowH > bottom) break;
        tplRect(ctx, 12 * s, y + lineHeight * 0.15, boxSize, boxSize,
          { stroke: '#000000', lineWidth: Math.max(1, Math.round(1.5 * s)) });
        tplWrapText(ctx, text, textX, y + lineHeight * 0.8,
          { size: fontSize, maxWidth: textW, maxLines: 2, lineFactor: fit.factor });
        y += rowH + gap;
      }

      if (showFooter) {
        // 页脚上方的分隔线：1px 黑色实线，左右贯穿整屏，+0.5 让描边压在一行像素上
        tplLine(ctx, 0, Math.round(bottom) + 0.5, w, Math.round(bottom) + 0.5,
          { color: '#000000', width: 1 });
        tplText(ctx, v.footer, w / 2, h - Math.round(footerSize * 0.5),
          { size: footerSize, align: 'center', color: accent, maxWidth: w - 24 * s });
      }
    },
  },
  {
    name: 'homework',
    display: '作业清单',
    formColumns: 4,
    variables: [
      { name: 'title', label: '标题', value: '今日作业' },
      { name: 'date', label: '日期', value: () => tplToday() },
      { name: 'footer', label: '页脚', value: '好好学习，天天向上' },
      { name: 'chinese', label: '语文', value: '', span: 2 },
      { name: 'math', label: '数学', value: '', span: 2 },
      { name: 'english', label: '英语', value: '', span: 2 },
      { name: 'other', label: '其他', value: '', span: 2 },
      { name: 'notice', label: '通知', value: '', span: 2 },
    ],
    draw(ctx, v, w, h, accent) {
      const s = tplScale(w, h);
      const top = tplHeader(ctx, v.title, v.date, w, h, s, accent, { rightBitmap: true });

      // 「通知」与各科目同一套渲染逻辑，只是排在最后
      const subjects = [['语文', v.chinese], ['数学', v.math],
      ['英语', v.english], ['其他', v.other], ['通知', v.notice]]
        .filter(([, text]) => text && String(text).trim() !== '');
      const footerSize = TPL_FOOTER_SIZE;
      const footerH = v.footer ? Math.round(footerSize * 1.8) : 0;

      // 每个科目占一整行，首行让出科目名宽度，第二行起从左边距开始（不缩进）
      const margin = 10 * s;
      const labelPad = Math.max(2, Math.round(2 * s));
      const labelText = (name) => `★${name}★`;
      const labelWidth = (px) => {
        tplSetFont(ctx, px);
        return Math.max(...['语文', '数学', '英语', '其他', '通知']
          .map((t) => ctx.measureText(labelText(t)).width)) + labelPad * 2;
      };
      const textGap = Math.max(2, Math.round(3 * s));
      const fullW = w - margin * 2;
      // 不限制每科行数，内容有多少就折多少行，能不能放下交给字号/行距自适应
      const maxLinesPerSubject = 0;
      const widthsFor = (px) => {
        const lw = Math.round(labelWidth(px));
        return { lw, first: fullW - lw - textGap, rest: fullW };
      };

      // 字号/行距自适应：16 点阵 → 12 点阵 → 收紧行距 → 去掉页脚 → 截断
      const { fit, bottom, showFooter } = tplFitFlowFooter(ctx, top, h, footerH,
        (px, lineHeight) => {
          const { first, rest } = widthsFor(px);
          const rowGap = Math.round(lineHeight * 0.35);
          return subjects.reduce((need, [, text]) => {
            tplSetFont(ctx, px);
            const lines = Math.max(1, tplWrapLines(ctx, text,
              (i) => (i === 0 ? first : rest), maxLinesPerSubject).length);
            return need + lines * lineHeight + rowGap;
          }, rowGap);
        });

      const fontSize = fit.px;
      const lineHeight = fit.lineHeight;
      const { lw: labelW, first: firstW, rest: restW } = widthsFor(fontSize);
      const rowGap = Math.round(lineHeight * 0.35);

      let y = top + rowGap;
      subjects.forEach(([label, text], index) => {
        tplSetFont(ctx, fontSize);
        const lines = tplWrapLines(ctx, text,
          (i) => (i === 0 ? firstW : restW), maxLinesPerSubject);
        const rowH = Math.max(1, lines.length) * lineHeight + rowGap;
        if (y + rowH > bottom) return;

        const boxTop = Math.round(y);
        const baseline = boxTop + Math.round(lineHeight * 0.8);
        // 科目名：强调色底 + 白字（单色屏时强调色本身就是黑色）
        tplRect(ctx, Math.round(margin), boxTop, labelW, lineHeight, { fill: accent });
        tplText(ctx, labelText(label), Math.round(margin) + labelPad, baseline,
          { size: fontSize, color: '#FFFFFF' });
        tplHardenBar(ctx, Math.round(margin), boxTop, labelW, lineHeight, accent);
        // 内容：首行紧挨科目名，第二行起顶到左边距
        lines.forEach((line, i) => {
          const lx = i === 0 ? Math.round(margin) + labelW + textGap : Math.round(margin);
          tplText(ctx, line, lx, baseline + lineHeight * i, { size: fontSize });
        });

        y += rowH;
        // 科目之间横向点线
        if (index < subjects.length - 1 && y + lineHeight <= bottom) {
          const lineY = y - Math.round(rowGap / 2);
          tplDottedLine(ctx, margin, lineY, w - margin, lineY, { color: accent });
        }
      });

      if (showFooter) {
        // 页脚上方的分隔线：1px 黑色实线，左右贯穿整屏，+0.5 让描边压在一行像素上
        tplLine(ctx, 0, Math.round(bottom) + 0.5, w, Math.round(bottom) + 0.5,
          { color: '#000000', width: 1 });
        tplText(ctx, v.footer, w / 2, h - Math.round(footerSize * 0.5),
          { size: footerSize, align: 'center', color: accent, maxWidth: w - 24 * s });
      }
    },
  },
  {
    name: 'card',
    display: '个人名片',
    variables: [
      { name: 'name', label: '姓名', value: '张三' },
      { name: 'title', label: '职位', value: '高级工程师' },
      { name: 'company', label: '公司', value: '某某科技有限公司' },
      { name: 'phone', label: '电话', value: '138 0000 0000' },
      { name: 'email', label: '邮箱', value: 'zhangsan@example.com' },
      { name: 'address', label: '地址', value: '北京市海淀区某某路 1 号' },
      { name: 'slogan', label: '标语', value: '' },
    ],
    draw(ctx, v, w, h, accent) {
      const s = tplScale(w, h);
      const barW = 8 * s;
      tplRect(ctx, 0, 0, barW, h, { fill: accent });

      const left = barW + 16 * s;
      const maxW = w - left - 14 * s;
      tplText(ctx, v.name, left, 44 * s,
        { size: 32 * s, title: true, maxWidth: maxW });
      tplText(ctx, v.title, left, 68 * s,
        { size: 16 * s, title: true, color: accent, maxWidth: maxW });

      const rows = [['电话', v.phone], ['邮箱', v.email], ['地址', v.address]]
        .filter(([, val]) => val && val.trim() !== '');
      const fontSize = tplBodySizeFit(h - 122 * s, rows.length + 1, h);
      tplText(ctx, v.company, left, 90 * s, { size: fontSize, maxWidth: maxW });

      tplLine(ctx, left, 102 * s, w - 16 * s, 102 * s, { width: Math.max(1, Math.round(s)) });

      const labelW = Math.round(fontSize * 2.6);
      const valueW = maxW - labelW - 6 * s;
      const lineHeight = tplLineHeight(ctx, fontSize);
      let y = 122 * s;
      rows.forEach(([label, val]) => {
        tplText(ctx, label, left, y, { size: fontSize, title: true, color: accent });
        const block = tplWrapText(ctx, val, left + labelW + 6 * s, y,
          { size: fontSize, maxWidth: valueW, maxLines: 2 });
        y += Math.max(lineHeight, block.height) + 6 * s;
      });

      if (v.slogan) {
        tplText(ctx, v.slogan, w - 16 * s, h - 12 * s,
          { size: tplSmallSize(h), align: 'right', maxWidth: maxW, color: accent });
      }
    },
  },
  {
    name: 'device',
    display: '设备标签',
    variables: [
      { name: 'title', label: '标题', value: '设备信息' },
      { name: 'tag', label: '右上角', value: 'NAS-01' },
      { name: 'k1', label: '字段 1 名', value: '设备名称' },
      { name: 'v1', label: '字段 1 值', value: '家庭存储服务器' },
      { name: 'k2', label: '字段 2 名', value: '型号' },
      { name: 'v2', label: '字段 2 值', value: 'DS923+' },
      { name: 'k3', label: '字段 3 名', value: 'IP 地址' },
      { name: 'v3', label: '字段 3 值', value: '192.168.1.10' },
      { name: 'k4', label: '字段 4 名', value: 'MAC' },
      { name: 'v4', label: '字段 4 值', value: 'AA:BB:CC:DD:EE:FF' },
      { name: 'k5', label: '字段 5 名', value: '位置' },
      { name: 'v5', label: '字段 5 值', value: '书房机柜' },
      { name: 'k6', label: '字段 6 名', value: '负责人' },
      { name: 'v6', label: '字段 6 值', value: '' },
      { name: 'footer', label: '页脚', value: '' },
    ],
    draw(ctx, v, w, h, accent) {
      const s = tplScale(w, h);
      const top = tplHeader(ctx, v.title, v.tag, w, h, s, accent);

      const rows = [1, 2, 3, 4, 5, 6]
        .map((i) => [v[`k${i}`], v[`v${i}`]])
        .filter(([k, val]) => (k && k.trim() !== '') || (val && val.trim() !== ''));
      const footerSize = TPL_FOOTER_SIZE;
      const footerH = v.footer ? Math.round(footerSize * 1.6) : 4 * s;
      const bottom = h - footerH;

      const fontSize = tplBodySizeFit(bottom - top, rows.length, h);
      const keyW = Math.max(70 * s, w * 0.28);
      const valueW = w - keyW - 16 * s;
      const lineHeight = tplLineHeight(ctx, fontSize);
      const padY = Math.round(lineHeight * 0.35);

      let y = top;
      const lw = Math.max(1, Math.round(s * 0.8));
      for (const [key, val] of rows) {
        const lines = tplMeasureLines(ctx, val, fontSize, valueW, 2);
        const rowH = lineHeight * lines + padY * 2;
        if (y + rowH > bottom) break;
        tplRect(ctx, 0, y, keyW, rowH, { fill: '#EEEEEE' });
        tplLine(ctx, 0, y, w, y, { width: lw });
        const textY = y + padY + lineHeight * 0.78;
        tplText(ctx, key, 8 * s, textY,
          { size: fontSize, title: true, maxWidth: keyW - 12 * s });
        tplWrapText(ctx, val, keyW + 8 * s, textY,
          { size: fontSize, maxWidth: valueW, maxLines: 2 });
        y += rowH;
      }
      tplLine(ctx, 0, y, w, y, { width: lw });

      if (v.footer) {
        tplText(ctx, v.footer, w / 2, h - Math.round(footerSize * 0.4),
          { size: footerSize, align: 'center', color: accent, maxWidth: w - 16 * s });
      }
    },
  },
  {
    name: 'schedule',
    display: '课程表',
    variables: (() => {
      const vars = [
        { name: 'title', label: '标题', value: '课程表' },
        { name: 'subtitle', label: '副标题', value: '2026 学年第一学期' },
      ];
      const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const dayLabels = ['周一', '周二', '周三', '周四', '周五'];
      const preset = [
        ['语文', '数学', '英语', '语文', '英语'],
        ['数学', '语文', '数学', '数学', '语文'],
        ['体育', '英语', '科学', '信息', '数学'],
        ['美术', '体育', '语文', '劳动', '美术'],
        ['科学', '音乐', '体育', '德法', '心理'],
        ['综合', '德法', '书法', '体育', '体育'],
      ];
      days.forEach((d, di) => {
        preset.forEach((row, pi) => {
          vars.push({ name: `${d}${pi + 1}`, label: `${dayLabels[di]}第${pi + 1}节`, value: row[di] });
        });
      });
      return vars;
    })(),
    draw(ctx, v, w, h, accent) {
      const s = tplScale(w, h);
      const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const dayLabels = ['一', '二', '三', '四', '五'];
      const periods = 6;

      let top = 0;
      if (v.title) {
        tplText(ctx, v.title, w / 2, 24 * s,
          { size: 22 * s, title: true, align: 'center', maxWidth: w });
        top = 30 * s;
      }
      if (v.subtitle) {
        tplText(ctx, v.subtitle, w / 2, top + 13 * s,
          { size: tplSmallSize(h), align: 'center', color: accent, maxWidth: w });
        top += 18 * s;
      }

      const cellW = (w - 2) / (days.length + 1);
      const cellH = (h - top - 2) / (periods + 1);
      const fontSize = tplBodySizeUnder(cellH * 0.7);

      // 表头
      tplRect(ctx, 1, top, w - 2, cellH, { fill: '#EEEEEE' });
      dayLabels.forEach((label, i) => {
        tplText(ctx, label, 1 + cellW * (i + 1.5), top + cellH * 0.7,
          { size: fontSize, title: true, align: 'center', maxWidth: cellW });
      });

      for (let p = 0; p < periods; p++) {
        const y = top + cellH * (p + 1);
        tplText(ctx, String(p + 1), 1 + cellW * 0.5, y + cellH * 0.7,
          { size: fontSize, title: true, align: 'center', color: accent });
        days.forEach((d, di) => {
          tplText(ctx, v[`${d}${p + 1}`], 1 + cellW * (di + 1.5), y + cellH * 0.7,
            { size: fontSize, align: 'center', maxWidth: cellW - 4 * s });
        });
      }

      // 网格线
      const lw = Math.max(1, Math.round(s * 0.8));
      for (let i = 0; i <= days.length + 1; i++) {
        tplLine(ctx, 1 + cellW * i, top, 1 + cellW * i, h - 1, { width: lw });
      }
      for (let p = 0; p <= periods + 1; p++) {
        tplLine(ctx, 1, top + cellH * p, w - 1, top + cellH * p, { width: lw });
      }
    },
  },
];

function findTemplate(name) {
  return EPD_TEMPLATES.find((t) => t.name === name);
}

// 模板默认变量表；value 可以是函数，用于日期这类每次都要取当前值的字段
function templateDefaults(tpl) {
  const out = {};
  tpl.variables.forEach((item) => {
    out[item.name] = typeof item.value === 'function' ? item.value() : item.value;
  });
  return out;
}

// 把模板画到指定画布上下文；accent 在支持彩色的模式下用红色，否则退化为黑色
function renderTemplate(name, vars, ctx, width, height, colorMode) {
  const tpl = findTemplate(name);
  if (!tpl) return false;
  const accent = ['BWR', 'BWRY', 'SPECTRA6'].includes(colorMode) ? '#FF0000' : '#000000';
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  tpl.draw(ctx, vars, width, height, accent);
  ctx.restore();
  return true;
}

