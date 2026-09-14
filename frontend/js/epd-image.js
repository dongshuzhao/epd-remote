// 图像处理流水线：驱动/尺寸表、调色板、抖动、位面打包与驱动专属变换。
// 逻辑对齐 epdiy.cn 上位机（同一固件协议），以保证生成的数据与其一致。

// 大屏固件（固件版本不带 -s 后缀）
const EPD_DRIVERS_LARGE = [
  { value: '13', color: 'BWRY', size: '3.98_768_552', label: '3.98寸A0(四色,JD79665)' },
  { value: '14', color: 'BWRY', size: '3.98_768_552', label: '3.98寸A1(四色,JD79665)' },
  { value: '01', color: 'BW', size: '4.2_400_300', label: '4.2寸(黑白,UC8176)' },
  { value: '03', color: 'BWR', size: '4.2_400_300', label: '4.2寸(三色,UC8176)' },
  { value: '04', color: 'BW', size: '4.2_400_300', label: '4.2寸(黑白,SSD1619)' },
  { value: '02', color: 'BWR', size: '4.2_400_300', label: '4.2寸(三色,SSD1619)' },
  { value: '17', color: 'BW', size: '4.2_400_300', label: '4.2寸(黑白,SSD1683)' },
  { value: '16', color: 'BWR', size: '4.2_400_300', label: '4.2寸(三色,SSD1683)' },
  { value: '05', color: 'BWRY', size: '4.2_400_300', label: '4.2寸(四色,JD79668)' },
  { value: '1f', color: 'BWRY', size: '4.2_400_300', label: '4.2寸(四色,JD79668,LUT)' },
  { value: '28', color: 'BW', size: '5.81_720_256', label: '5.81寸(黑白,龙亭)' },
  { value: '29', color: 'BWR', size: '5.81_720_256', label: '5.81寸(三色,龙亭)' },
  { value: '1e', color: 'BW', size: '5.83_600_448', label: '5.83寸低分(黑白,UC8159)' },
  { value: '1d', color: 'BWR', size: '5.83_600_448', label: '5.83寸低分(三色,UC8159)' },
  { value: '19', color: 'BW', size: '5.83_648_480', label: '5.83寸(黑白,UC8179)' },
  { value: '18', color: 'BWR', size: '5.83_648_480', label: '5.83寸(三色,UC8179)' },
  { value: '0f', color: 'BW', size: '5.83_648_480', label: '5.83寸(黑白,JD79686)' },
  { value: '0e', color: 'BWR', size: '5.83_648_480', label: '5.83寸(三色,JD79686)' },
  { value: '0d', color: 'BWRY', size: '5.83_648_480', label: '5.83寸(四色,JD79665)' },
  { value: '2a', color: 'BW', size: '7.4_800_480', label: '7.4寸(黑白,龙亭)' },
  { value: '2b', color: 'BWR', size: '7.4_800_480', label: '7.4寸(三色,龙亭)' },
  { value: '06', color: 'BW', size: '7.5_800_480', label: '7.5寸(黑白,UC8179)' },
  { value: '07', color: 'BWR', size: '7.5_800_480', label: '7.5寸(三色,UC8179)' },
  { value: '0c', color: 'BWRY', size: '7.5_800_480', label: '7.5寸(四色,JD79665)' },
  { value: '08', color: 'BW', size: '7.5_640_384', label: '7.5寸低分(黑白,UC8159)' },
  { value: '09', color: 'BWR', size: '7.5_640_384', label: '7.5寸低分(三色,UC8159)' },
  { value: '0a', color: 'BW', size: '7.5_880_528', label: '7.5寸HD(黑白,SSD1677)' },
  { value: '0b', color: 'BWR', size: '7.5_880_528', label: '7.5寸HD(三色,SSD1677)' },
  { value: '1a', color: 'BWRY', size: '9.7_960_672', label: '9.7寸(四色,SSD2677)' },
  { value: '1b', color: 'BWRY', size: '9.7_960_672', label: '9.7寸(四色,SSD2677,LUT)' },
  { value: '11', color: 'BWR', size: '10.2_960_640', label: '10.2寸(三色,SSD1677)' },
  { value: '12', color: 'BW', size: '10.2_960_640', label: '10.2寸(黑白,SSD1677)' },
  { value: '10', color: 'BWRY', size: '10.2_960_640', label: '10.2寸(四色,SSD2677)' },
  { value: '1c', color: 'BWRY', size: '10.2_960_640', label: '10.2寸(四色,SSD2677,LUT)' },
  { value: '15', color: 'SPECTRA6', size: '7.3E6_800_480', label: '7.3寸(六色,Spectra 6)' },
];

// 小屏固件（固件版本以 -s 结尾）
const EPD_DRIVERS_SMALL = [
  { value: '33', color: 'BW', size: '2.13_250_122', label: '2.13寸(黑白,SSD1675)' },
  { value: '32', color: 'BWR', size: '2.13_250_122', label: '2.13寸(三色,SSD1675)' },
  { value: '35', color: 'BW', size: '2.13_212_104', label: '2.13寸低分(黑白,SSD1675)' },
  { value: '34', color: 'BWR', size: '2.13_212_104', label: '2.13寸低分(三色,SSD1675)' },
  { value: '3b', color: 'BW', size: '2.13_250_122', label: '2.13寸(黑白,SSD1680)' },
  { value: '3a', color: 'BWR', size: '2.13_250_122', label: '2.13寸(三色,SSD1680)' },
  { value: '4e', color: 'BWR', size: '2.13_250_122', label: '2.13寸(三色,SSD1680,ZK)' },
  { value: '48', color: 'BW', size: '2.13_212_104', label: '2.13寸低分(黑白,SSD1680)' },
  { value: '47', color: 'BWR', size: '2.13_212_104', label: '2.13寸低分(三色,SSD1680)' },
  { value: '4d', color: 'BW', size: '2.13_250_122', label: '2.13寸(黑白,SSD1608)' },
  { value: '37', color: 'BW', size: '2.13_250_122', label: '2.13寸(黑白,UC8151)' },
  { value: '36', color: 'BWR', size: '2.13_250_122', label: '2.13寸(三色,UC8151)' },
  { value: '39', color: 'BW', size: '2.13_212_104', label: '2.13寸低分(黑白,UC8151)' },
  { value: '38', color: 'BWR', size: '2.13_212_104', label: '2.13寸低分(三色,UC8151)' },
  { value: '4c', color: 'BW', size: '2.13_250_122', label: '2.13寸(黑白,JD79651)' },
  { value: '4b', color: 'BWR', size: '2.13_250_122', label: '2.13寸(三色,JD79651)' },
  { value: '4f', color: 'BWRY', size: '2.13_250_128', label: '2.13寸(四色,JD79676)' },
  { value: '4a', color: 'BW', size: '2.66_296_152', label: '2.6寸(黑白,SSD1675)' },
  { value: '49', color: 'BWR', size: '2.66_296_152', label: '2.6寸(三色,SSD1675)' },
  { value: '3d', color: 'BW', size: '2.66_296_152', label: '2.6寸(黑白,SSD1680)' },
  { value: '3c', color: 'BWR', size: '2.66_296_152', label: '2.6寸(三色,SSD1680)' },
  { value: '3f', color: 'BW', size: '2.66_296_152', label: '2.6寸(黑白,UC8151)' },
  { value: '3e', color: 'BWR', size: '2.66_296_152', label: '2.6寸(三色,UC8151)' },
  { value: '50', color: 'BWRY', size: '2.66_296_152', label: '2.6寸(四色,JD79661)' },
  { value: '55', color: 'BWRY', size: '2.66_296_152', label: '2.6寸(四色,JD79661,ZK)' },
  { value: '51', color: 'BWRY', size: '2.66_360_184', label: '2.6寸高分(四色,JD79667)' },
  { value: '45', color: 'BW', size: '2.9_296_128', label: '2.9寸(黑白,SSD1675)' },
  { value: '44', color: 'BWR', size: '2.9_296_128', label: '2.9寸(三色,SSD1675)' },
  { value: '41', color: 'BW', size: '2.9_296_128', label: '2.9寸(黑白,SSD1680)' },
  { value: '40', color: 'BWR', size: '2.9_296_128', label: '2.9寸(三色,SSD1680)' },
  { value: '43', color: 'BW', size: '2.9_296_128', label: '2.9寸(黑白,UC8151)' },
  { value: '42', color: 'BWR', size: '2.9_296_128', label: '2.9寸(三色,UC8151)' },
  { value: '46', color: 'BW', size: '2.9_296_128', label: '2.9寸(黑白,SSD1608)' },
  { value: '52', color: 'BWRY', size: '2.9_296_128', label: '2.9寸(四色,JD79661)' },
  { value: '53', color: 'BWRY', size: '2.9_384_168', label: '2.9寸高分(四色,JD79667)' },
  { value: '54', color: 'BWRY', size: '3.5_384_184', label: '3.5寸(四色,JD79667)' },
];

// rotate: 画布按横向编辑，发送前需旋转到屏幕的实际扫描方向
const EPD_CANVAS_SIZES = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_212_104', width: 212, height: 104, rotate: 270 },
  { name: '2.13_250_122', width: 250, height: 122, rotate: 270 },
  { name: '2.13_250_128', width: 250, height: 128, rotate: 270 },
  { name: '2.66_296_152', width: 296, height: 152, rotate: 270 },
  { name: '2.66_360_184', width: 360, height: 184, rotate: 270 },
  { name: '2.9_296_128', width: 296, height: 128, rotate: 270 },
  { name: '2.9_384_168', width: 384, height: 168, rotate: 270 },
  { name: '3.5_384_184', width: 384, height: 184, rotate: 270 },
  { name: '3.5_360_600', width: 360, height: 600 },
  { name: '3.7_416_240', width: 416, height: 240, rotate: 270 },
  { name: '3.7_480_280', width: 480, height: 280, rotate: 270 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '3.98_768_552', width: 768, height: 552 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.81_720_256', width: 720, height: 256, rotate: 270 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.4_800_480', width: 800, height: 480, rotate: 270 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '9.7_960_672', width: 960, height: 672 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4.0E6_600_400', width: 600, height: 400 },
  { name: '7.3E6_800_480', width: 800, height: 480 },
];

const EPD_COLOR_MODES = [
  { value: 'BW', label: '双色(黑白)' },
  { value: 'BWR', label: '三色(黑白红)' },
  { value: 'BWRY', label: '四色(黑白红黄)' },
  { value: 'SPECTRA6', label: '六色(黑白红黄蓝绿)' },
  { value: '4G', label: '四级灰度(黑白)' },
  { value: '16G', label: '十六级灰度(黑白)' },
];

// 默认 none：模板/文字这类本来就是纯色的画面，抖动只会把笔画打散；
// 选了照片时 main.js 会自动切到 Floyd-Steinberg
const EPD_DITHER_ALGS = [
  { value: 'none', label: '无抖动（文字/模板）' },
  { value: 'floydSteinberg', label: 'Floyd-Steinberg（照片）' },
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'bayer', label: 'Bayer' },
  { value: 'stucki', label: 'Stucki' },
  { value: 'jarvis', label: 'Jarvis-Judice-Ninke' },
  { value: 'burkes', label: 'Burkes' },
  { value: 'sierra', label: 'Sierra' },
];

// 各颜色模式的调色板，value 为固件识别的像素值
const PALETTE_SPECTRA6 = [
  { name: '黑色', r: 0, g: 0, b: 0, value: 0 },
  { name: '白色', r: 255, g: 255, b: 255, value: 1 },
  { name: '黄色', r: 255, g: 255, b: 0, value: 2 },
  { name: '红色', r: 255, g: 0, b: 0, value: 3 },
  { name: '蓝色', r: 0, g: 0, b: 255, value: 5 },
  { name: '绿色', r: 41, g: 204, b: 20, value: 6 },
];
const PALETTE_BWRY = [
  { name: '黑色', r: 0, g: 0, b: 0, value: 0 },
  { name: '白色', r: 255, g: 255, b: 255, value: 1 },
  { name: '红色', r: 255, g: 0, b: 0, value: 3 },
  { name: '黄色', r: 255, g: 255, b: 0, value: 2 },
];
const PALETTE_BWR = [
  { name: '黑色', r: 0, g: 0, b: 0, value: 0 },
  { name: '白色', r: 255, g: 255, b: 255, value: 1 },
  { name: '红色', r: 255, g: 0, b: 0, value: 2 },
];
const PALETTE_BW = [
  { name: '黑色', r: 0, g: 0, b: 0, value: 0 },
  { name: '白色', r: 255, g: 255, b: 255, value: 1 },
];
const PALETTE_4G = [
  { name: '黑色', r: 0, g: 0, b: 0, value: 0 },
  { name: '深灰', r: 85, g: 85, b: 85, value: 1 },
  { name: '浅灰', r: 170, g: 170, b: 170, value: 2 },
  { name: '白色', r: 255, g: 255, b: 255, value: 3 },
];
const PALETTE_16G = Array.from({ length: 16 }, (_, i) => (
  { name: `灰${i}`, r: i * 17, g: i * 17, b: i * 17, value: i }
));

const EPD_PALETTES = {
  SPECTRA6: PALETTE_SPECTRA6,
  BWRY: PALETTE_BWRY,
  BWR: PALETTE_BWR,
  BW: PALETTE_BW,
  '4G': PALETTE_4G,
  '16G': PALETTE_16G,
};

function adjustBrightness(imageData, factor) {
  const d = imageData.data;
  const delta = (factor - 1) * 128;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.max(0, d[i] + delta));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + delta));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + delta));
  }
  return imageData;
}

function adjustContrast(imageData, factor) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.max(0, (d[i] - 128) * factor + 128));
    d[i + 1] = Math.min(255, Math.max(0, (d[i + 1] - 128) * factor + 128));
    d[i + 2] = Math.min(255, Math.max(0, (d[i + 2] - 128) * factor + 128));
  }
  return imageData;
}

function rgbToLab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  r *= 100; g *= 100; b *= 100;

  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  x /= 95.047; y /= 100; z /= 108.883;
  x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;

  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

// 加权 Lab 距离：压低亮度差权重，避免彩色被判成黑白
function labDistance(c1, c2) {
  const dl = c1.l - c2.l, da = c1.a - c2.a, db = c1.b - c2.b;
  return Math.sqrt(0.2 * dl * dl + 3 * da * da + 3 * db * db);
}

function rgbDistance(c1, c2) {
  return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
}

function nearestByRgb(color, palette) {
  let best = palette[0], bestDist = rgbDistance(color, palette[0]);
  for (let i = 1; i < palette.length; i++) {
    const d = rgbDistance(color, palette[i]);
    if (d < bestDist) { bestDist = d; best = palette[i]; }
  }
  return best;
}

// 把任意 RGB 映射到该颜色模式的调色板颜色
function matchPaletteColor(r, g, b, mode) {
  const palette = EPD_PALETTES[mode] || PALETTE_SPECTRA6;

  if (mode === 'BW') {
    return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? PALETTE_BW[0] : PALETTE_BW[1];
  }
  if (mode === '4G' || mode === '16G') {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    return palette.reduce((a, b2) => (
      Math.abs(a.r - gray) <= Math.abs(b2.r - gray) ? a : b2
    ));
  }
  // 六色屏之外的模式没有蓝色，深蓝像素在此保持特殊处理以对齐上位机
  if (mode !== 'BWRY' && mode !== 'BWR' && r < 50 && g < 150 && b > 100) {
    return PALETTE_SPECTRA6[4];
  }
  if (mode === 'BWR') return nearestByRgb({ r, g, b }, palette);

  const lab = rgbToLab(r, g, b);
  let best = palette[0], bestDist = Infinity;
  for (const c of palette) {
    const d = labDistance(lab, rgbToLab(c.r, c.g, c.b));
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function spreadError(data, idx, er, eg, eb, weight) {
  data[idx] = Math.min(255, Math.max(0, data[idx] + er * weight));
  data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + eg * weight));
  data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + eb * weight));
}

// 误差扩散抖动。inPlace=true 时边算边写回，false 时先累积误差再统一量化
function diffuseDither(imageData, strength, mode, kernel, inPlace = false) {
  const { width, height, data } = imageData;
  const buf = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const c = matchPaletteColor(r, g, b, mode);
      if (inPlace) { data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; }

      const er = (r - c.r) * strength, eg = (g - c.g) * strength, eb = (b - c.b) * strength;
      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          spreadError(buf, (ny * width + nx) * 4, er, eg, eb, weight);
        }
      }
    }
  }

  if (!inPlace) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const c = matchPaletteColor(buf[i], buf[i + 1], buf[i + 2], mode);
        data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
      }
    }
  }
  return imageData;
}

const DITHER_KERNELS = {
  floydSteinberg: { inPlace: false, kernel: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]] },
  atkinson: {
    inPlace: true,
    kernel: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  },
  stucki: {
    inPlace: false,
    kernel: [[1, 0, 8 / 42], [2, 0, 4 / 42], [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42],
      [1, 1, 4 / 42], [2, 1, 2 / 42], [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42],
      [1, 2, 2 / 42], [2, 2, 1 / 42]],
  },
  jarvis: {
    inPlace: true,
    kernel: [[1, 0, 7 / 48], [2, 0, 5 / 48], [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48],
      [1, 1, 5 / 48], [2, 1, 3 / 48], [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48],
      [1, 2, 3 / 48], [2, 2, 1 / 48]],
  },
  burkes: {
    inPlace: false,
    kernel: [[1, 0, 8 / 32], [2, 0, 4 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 8 / 32],
      [1, 1, 4 / 32], [2, 1, 2 / 32]],
  },
  sierra: {
    inPlace: false,
    kernel: [[1, 0, 5 / 32], [2, 0, 3 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 5 / 32],
      [1, 1, 4 / 32], [2, 1, 2 / 32], [-1, 2, 2 / 32], [0, 2, 3 / 32], [1, 2, 2 / 32]],
  },
};

const BAYER_MATRIX = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function bayerDither(imageData, strength, mode) {
  const { width, height, data } = imageData;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const threshold = BAYER_MATRIX[y % 8][x % 8] / 64 * 255;
      const bias = (threshold - 127.5) * strength;
      const c = matchPaletteColor(
        Math.min(255, Math.max(0, data[i] + bias)),
        Math.min(255, Math.max(0, data[i + 1] + bias)),
        Math.min(255, Math.max(0, data[i + 2] + bias)),
        mode);
      data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
    }
  }
  return imageData;
}

function ditherImage(imageData, alg, strength, mode) {
  if (alg === 'bayer') return bayerDither(imageData, strength, mode);
  const spec = DITHER_KERNELS[alg];
  if (!spec) return imageData;  // none
  return diffuseDither(imageData, strength, mode, spec.kernel, spec.inPlace);
}

// 把（已抖动的）画布像素打包成固件需要的位面数据
function packImageData(imageData, mode) {
  const { width, height, data } = imageData;
  let out;

  if (mode === 'SPECTRA6') {
    out = new Uint8Array(Math.ceil(width * height / 2));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = matchPaletteColor(data[i], data[i + 1], data[i + 2], mode).value;
        const idx = (y * width + x) >> 1;
        if (x % 2 === 0) out[idx] |= v << 4; else out[idx] |= v;
      }
    }
  } else if (mode === 'BWRY') {
    out = new Uint8Array(Math.ceil(width * height / 4));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = matchPaletteColor(data[i], data[i + 1], data[i + 2], mode).value;
        out[(y * width + x) / 4 | 0] |= v << (6 - x % 4 * 2);
      }
    }
  } else if (mode === 'BW') {
    const byteWidth = Math.ceil(width / 8);
    out = new Uint8Array(byteWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        if (lum >= 140) out[y * byteWidth + Math.floor(x / 8)] |= 1 << (7 - x % 8);
      }
    }
  } else if (mode === '4G') {
    out = new Uint8Array(Math.ceil(width * height / 4));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        out[(y * width + x) >> 2] |= Math.min(3, Math.round(lum / 85)) << (6 - x % 4 * 2);
      }
    }
  } else if (mode === '16G') {
    out = new Uint8Array(Math.ceil(width * height / 2));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        const v = Math.min(15, Math.round(lum / 17));
        const idx = (y * width + x) >> 1;
        if (x % 2 === 0) out[idx] |= v << 4; else out[idx] |= v;
      }
    }
  } else if (mode === 'BWR') {
    const byteWidth = Math.ceil(width / 8);
    const black = new Uint8Array(byteWidth * height);
    const red = new Uint8Array(byteWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const byteIdx = y * byteWidth + Math.floor(x / 8);
        const bit = 7 - x % 8;
        if (Math.round(0.299 * r + 0.587 * g + 0.114 * b) >= 140) black[byteIdx] |= 1 << bit;
        else black[byteIdx] &= ~(1 << bit);
        // 红色像素在红位面里为 0
        if (r > 160 && r > g && r > b) red[byteIdx] &= ~(1 << bit);
        else red[byteIdx] |= 1 << bit;
      }
    }
    out = new Uint8Array(black.length + red.length);
    out.set(black, 0);
    out.set(red, black.length);
  }
  return out;
}

// 把打包数据还原成 ImageData，用于画布预览
function decodeImageData(bytes, width, height, mode) {
  const img = new ImageData(width, height);
  const d = img.data;
  const put = (i, r, g, b) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };

  if (mode === 'SPECTRA6') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) >> 1;
        const v = x % 2 === 0 ? (bytes[idx] >> 4) & 15 : bytes[idx] & 15;
        const c = PALETTE_SPECTRA6.find((p) => p.value === v) || PALETTE_SPECTRA6[1];
        put((y * width + x) * 4, c.r, c.g, c.b);
      }
    }
  } else if (mode === 'BWRY') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (bytes[(y * width + x) / 4 | 0] >> (6 - x % 4 * 2)) & 3;
        const c = PALETTE_BWRY.find((p) => p.value === v) || PALETTE_BWRY[1];
        put((y * width + x) * 4, c.r, c.g, c.b);
      }
    }
  } else if (mode === 'BW') {
    const byteWidth = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const on = (bytes[y * byteWidth + Math.floor(x / 8)] >> (7 - x % 8)) & 1;
        const v = on ? 255 : 0;
        put((y * width + x) * 4, v, v, v);
      }
    }
  } else if (mode === '4G') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = ((bytes[(y * width + x) >> 2] >> (6 - x % 4 * 2)) & 3) * 85;
        put((y * width + x) * 4, v, v, v);
      }
    }
  } else if (mode === '16G') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) >> 1;
        const v = (x % 2 === 0 ? (bytes[idx] >> 4) & 15 : bytes[idx] & 15) * 17;
        put((y * width + x) * 4, v, v, v);
      }
    }
  } else if (mode === 'BWR') {
    const byteWidth = Math.ceil(width / 8);
    const black = bytes.slice(0, byteWidth * height);
    const red = bytes.slice(byteWidth * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIdx = y * byteWidth + Math.floor(x / 8);
        const bit = 7 - x % 8;
        const isBlackWhite = (black[byteIdx] >> bit) & 1;
        const notRed = (red[byteIdx] >> bit) & 1;
        const i = (y * width + x) * 4;
        if (notRed) {
          const v = isBlackWhite ? 255 : 0;
          put(i, v, v, v);
        } else {
          put(i, 255, 0, 0);
        }
      }
    }
  }
  return img;
}

function rotateImageData(imageData, degrees) {
  const { width, height, data } = imageData;
  const deg = ((degrees % 360) + 360) % 360;
  if (deg === 0) return imageData;

  const [outW, outH] = deg === 90 || deg === 270 ? [height, width] : [width, height];
  const out = new ImageData(outW, outH);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      let nx, ny;
      if (deg === 90) { nx = height - 1 - y; ny = x; }
      else if (deg === 180) { nx = width - 1 - x; ny = height - 1 - y; }
      else { nx = y; ny = width - 1 - x; }
      const dst = (ny * outW + nx) * 4;
      out.data[dst] = data[src];
      out.data[dst + 1] = data[src + 1];
      out.data[dst + 2] = data[src + 2];
      out.data[dst + 3] = data[src + 3];
    }
  }
  return out;
}

// 每行像素左右镜像（驱动 4e）
function mirrorRows(bytes, width, height) {
  const byteWidth = Math.ceil(width / 8);
  const out = new Uint8Array(bytes.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * byteWidth + Math.floor(x / 8);
      const dst = y * byteWidth + Math.floor((width - 1 - x) / 8);
      if ((bytes[src] & (1 << (7 - x % 8))) !== 0) {
        out[dst] |= 1 << (7 - (width - 1 - x) % 8);
      }
    }
  }
  return out;
}

// 黑白 + 红白两个位面合并成 UC8159 的 4bpp 数据（驱动 08/09/1d/1e）
function mergeUC8159(blackWhite, redWhite) {
  const len = blackWhite.length;
  const out = new Uint8Array(len * 4);
  let o = 0;
  for (let i = 0; i < len; i++) {
    let bw = blackWhite[i], rw = redWhite[i];
    for (let j = 0; j < 8; j++) {
      let v;
      if ((rw & 0x80) === 0) v = 4;        // red
      else if ((bw & 0x80) === 0) v = 0;   // black
      else v = 3;                          // white
      v = (v << 4) & 0xFF;
      bw = (bw << 1) & 0xFF; rw = (rw << 1) & 0xFF;
      j++;
      if ((rw & 0x80) === 0) v |= 4;
      else if ((bw & 0x80) === 0) v |= 0;
      else v |= 3;
      bw = (bw << 1) & 0xFF; rw = (rw << 1) & 0xFF;
      out[o++] = v;
    }
  }
  return out;
}

// 四色屏 A0 行交织（驱动 13，未开启 a0_fix 时需要）。reverse=true 用于回读预览
function interleaveRowsA0(bytes, width, height, reverse = false) {
  const rowBytes = Math.ceil(width / 4);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const mapped = y < Math.floor(height / 2) ? y * 2 : 2 * (height - y) - 1;
    const src = reverse ? mapped : y;
    const dst = reverse ? y : mapped;
    out.set(bytes.slice(src * rowBytes, (src + 1) * rowBytes), dst * rowBytes);
  }
  return out;
}

// 龙亭屏（驱动 29/2b）把三色数据拆成两个位面
function splitLongtingBWR(bytes) {
  const half = Math.floor(bytes.length / 2);
  const black = new Uint8Array(half);
  const red = new Uint8Array(half);
  for (let i = 0; i < half; i++) {
    red[i] = ~bytes[half + i] & 255;
    black[i] = ~bytes[i] & bytes[half + i] & 255;
  }
  return [black, red];
}

function findDriver(value) {
  return EPD_DRIVERS_LARGE.find((d) => d.value === value)
    || EPD_DRIVERS_SMALL.find((d) => d.value === value);
}

function findCanvasSize(name) {
  return EPD_CANVAS_SIZES.find((s) => s.name === name);
}

// 按驱动与颜色模式产出要下发的位面列表：[{step:'bw'|'red', bytes:Uint8Array}]
function buildDriverPlanes(packed, mode, driver, width, height, a0Fix = false) {
  if (mode === 'BWR') {
    const half = Math.floor(packed.length / 2);
    const black = packed.slice(0, half);
    const red = packed.slice(half);
    if (['29', '2b'].includes(driver)) {
      const [b, r] = splitLongtingBWR(packed);
      return [{ step: 'bw', bytes: b }, { step: 'red', bytes: r }];
    }
    if (['08', '09', '1d', '1e'].includes(driver)) {
      return [{ step: 'bw', bytes: mergeUC8159(black, red) }];
    }
    if (driver === '4e') {
      return [
        { step: 'bw', bytes: mirrorRows(black, width, height) },
        { step: 'red', bytes: mirrorRows(red, width, height) },
      ];
    }
    return [{ step: 'bw', bytes: black }, { step: 'red', bytes: red }];
  }

  if (mode === 'BW') {
    if (['28', '2a'].includes(driver)) {
      return [{ step: 'bw', bytes: packed.map((b) => ~b & 255) }];
    }
    if (['08', '09', '1d', '1e'].includes(driver)) {
      const empty = new Uint8Array(packed.length).fill(255);
      return [{ step: 'bw', bytes: mergeUC8159(packed, empty) }];
    }
    return [{ step: 'bw', bytes: packed }];
  }

  if (mode === 'BWRY') {
    const bytes = driver === '13' && !a0Fix
      ? interleaveRowsA0(packed, width, height) : packed;
    return [{ step: 'bw', bytes }];
  }

  if (mode === 'SPECTRA6' || mode === '4G' || mode === '16G') {
    return [{ step: 'bw', bytes: packed }];
  }
  return null;
}










