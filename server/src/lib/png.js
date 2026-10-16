// Minimal PNG header reader — avoids pulling in an image-processing dependency
// just to validate uploaded sprite/tile dimensions.
const zlib = require("zlib");

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a;
  if (!isPng) return null;

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Reverses the per-scanline filters (PNG spec §9) into raw sample bytes.
function unfilter(data, width, height, bitsPerPixel) {
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src++];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let v;
      if (filter === 0) v = raw;
      else if (filter === 1) v = raw + a;
      else if (filter === 2) v = raw + b;
      else if (filter === 3) v = raw + ((a + b) >> 1);
      else if (filter === 4) v = raw + paeth(a, b, c);
      else throw new Error(`unknown PNG filter ${filter}`);
      out[row + x] = v & 0xff;
    }
  }
  return { pixels: out, stride };
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Decodes just enough of a PNG to answer "does any pixel have alpha < 255?"
// (docs/design/09-ai-office-redesign.md §5: floor/wall tiles must be opaque).
// Returns { width, height, hasTransparency } or null when the file isn't a
// readable PNG. `hasTransparency` is null when it can't be determined
// (interlaced images), so the caller can reject with a clear reason instead
// of guessing.
function inspectPng(buffer) {
  const size = readPngSize(buffer);
  if (!size) return null;

  let colorType = null;
  let bitDepth = null;
  let interlace = 0;
  let trns = null;
  const idat = [];
  let pos = 8;
  try {
    while (pos + 8 <= buffer.length) {
      const len = buffer.readUInt32BE(pos);
      const type = buffer.toString("ascii", pos + 4, pos + 8);
      const body = buffer.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") {
        bitDepth = body[8];
        colorType = body[9];
        interlace = body[12];
      } else if (type === "tRNS") {
        trns = body;
      } else if (type === "IDAT") {
        idat.push(body);
      } else if (type === "IEND") {
        break;
      }
      pos += 12 + len;
    }
  } catch {
    return null;
  }
  if (colorType === null || !(colorType in CHANNELS)) return null;

  const { width, height } = size;
  // No alpha channel and no tRNS chunk: every pixel is opaque by definition.
  if ((colorType === 0 || colorType === 2 || colorType === 3) && !trns) {
    return { width, height, hasTransparency: false };
  }
  // Grayscale/RGB + tRNS marks one exact color as transparent; treat as
  // transparent rather than scanning for that color.
  if (colorType === 0 || colorType === 2) return { width, height, hasTransparency: true };
  if (interlace !== 0) return { width, height, hasTransparency: null };

  let pixels;
  let stride;
  try {
    const data = zlib.inflateSync(Buffer.concat(idat));
    ({ pixels, stride } = unfilter(data, width, height, CHANNELS[colorType] * bitDepth));
  } catch {
    return null;
  }

  if (colorType === 3) {
    // Palette image: transparent if any used index has a tRNS alpha < 255.
    const transparentIdx = new Set();
    for (let i = 0; i < trns.length; i++) if (trns[i] < 255) transparentIdx.add(i);
    if (transparentIdx.size === 0) return { width, height, hasTransparency: false };
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = pixels[y * stride + Math.floor(x / perByte)];
        const shift = 8 - bitDepth * ((x % perByte) + 1);
        if (transparentIdx.has((byte >> shift) & mask)) return { width, height, hasTransparency: true };
      }
    }
    return { width, height, hasTransparency: false };
  }

  // colorType 4 (gray+alpha) / 6 (RGBA): alpha is the last sample of each pixel.
  const bytesPerSample = bitDepth / 8;
  const pixelBytes = CHANNELS[colorType] * bytesPerSample;
  const maxAlpha = bitDepth === 16 ? 0xffff : 0xff;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * stride + x * pixelBytes + pixelBytes - bytesPerSample;
      const alpha = bitDepth === 16 ? pixels.readUInt16BE(at) : pixels[at];
      if (alpha < maxAlpha) return { width, height, hasTransparency: true };
    }
  }
  return { width, height, hasTransparency: false };
}

module.exports = { readPngSize, inspectPng };
