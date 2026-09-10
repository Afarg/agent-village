const fs = require("fs");
const path = require("path");

const CHARACTER_SPRITE = {
  minSize: 16,
  maxSize: 128,
  maxBytes: 300 * 1024,
  mustBeSquare: true,
};

const ROOM_TILE = {
  minSize: 16,
  maxSize: 1024,
  maxBytes: 800 * 1024,
  mustBeSquare: false,
  recommended: { w: 140, h: 120 },
};

// docs/design/07-directional-animation-support.md §3.2. Per-frame size/shape
// constraints reuse CHARACTER_SPRITE's; the byte cap applies to the whole
// bundle (not each frame) since a 4-angle x 3-frame bundle can have up to 12
// PNGs and the single-sprite 300KB limit would be too tight applied per-frame.
const CHARACTER_ANIMATION = {
  minSize: CHARACTER_SPRITE.minSize,
  maxSize: CHARACTER_SPRITE.maxSize,
  mustBeSquare: true,
  maxTotalBytes: 2 * 1024 * 1024,
};

function filePathFor(dir, id) {
  return path.join(dir, `${id}.png`);
}

function assetInfo(dir, id, publicUrlPrefix) {
  const file = filePathFor(dir, id);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { url: `${publicUrlPrefix}/${id}.png?v=${Math.floor(stat.mtimeMs)}`, updatedAt: stat.mtime.toISOString() };
}

function saveAsset(dir, id, buffer) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePathFor(dir, id), buffer);
}

function removeAsset(dir, id) {
  const file = filePathFor(dir, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---- character animation bundles (docs/design/07-directional-animation-support.md §3.1) ----
// Stored as `<dir>/<id>/` (anim-manifest.json + frame PNGs), alongside the
// existing single-file `<dir>/<id>.png` sprite - the two never collide since
// one has a .png extension and the other doesn't.

function animationDirFor(dir, id) {
  return path.join(dir, id);
}

function animationInfo(dir, id, publicUrlPrefix) {
  const animDir = animationDirFor(dir, id);
  const manifestPath = path.join(animDir, "anim-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null; // corrupt manifest - treat as "no animation" rather than crash the snapshot
  }

  const stat = fs.statSync(manifestPath);
  const v = Math.floor(stat.mtimeMs);
  const views = {};
  for (const [viewName, frames] of Object.entries(manifest.views || {})) {
    views[viewName] = {
      idle: (frames.idle || []).map((fn) => `${publicUrlPrefix}/${id}/${fn}?v=${v}`),
      walk: (frames.walk || []).map((fn) => `${publicUrlPrefix}/${id}/${fn}?v=${v}`),
    };
  }
  return { views, updatedAt: stat.mtime.toISOString() };
}

// `files`: array of multer file objects ({ originalname, buffer, ... }). Wipes
// any previous bundle first so switching to a smaller bundle (e.g. fewer
// angles) doesn't leave stale frames behind.
function saveAnimationBundle(dir, id, files) {
  const animDir = animationDirFor(dir, id);
  fs.rmSync(animDir, { recursive: true, force: true });
  fs.mkdirSync(animDir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(animDir, path.basename(f.originalname)), f.buffer);
  }
}

function removeAnimationBundle(dir, id) {
  fs.rmSync(animationDirFor(dir, id), { recursive: true, force: true });
}

module.exports = {
  CHARACTER_SPRITE,
  ROOM_TILE,
  CHARACTER_ANIMATION,
  filePathFor,
  assetInfo,
  saveAsset,
  removeAsset,
  animationDirFor,
  animationInfo,
  saveAnimationBundle,
  removeAnimationBundle,
};
