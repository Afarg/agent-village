// Decor part library (docs/design/09-ai-office-redesign.md §5-§6).
//
// Built-in parts are drawn by the client (public/js/decor/parts.js) and never
// touch the server; this module only handles *uploaded* parts, stored as
// `assets/custom/decor/<category>/<name>.png`. The file name doubles as the
// part's name, so a PNG dropped into that folder by hand shows up in the
// library exactly like one uploaded from the dashboard.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { inspectPng } = require("./png");

// Image spec per category. `exact` = must match w×h exactly; otherwise w×h is
// the maximum. `opaque` = no transparent pixels allowed (tiled layers).
const DECOR_SPEC = {
  floor: { label: "床", w: 16, h: 16, exact: true, opaque: true },
  wall: { label: "壁", w: 16, h: 48, exact: true, opaque: true },
  rug: { label: "敷物", w: 160, h: 96, exact: false, opaque: false },
  wallDecor: { label: "壁飾り", w: 48, h: 40, exact: false, opaque: false },
  desk: { label: "机", w: 64, h: 32, exact: true, opaque: false },
  chair: { label: "椅子", w: 32, h: 32, exact: true, opaque: false },
  sideDecor: { label: "脇置き", w: 32, h: 48, exact: false, opaque: false },
};
const DECOR_MAX_BYTES = 512 * 1024;
const DECOR_MIN_SIZE = 8; // for the "max size" categories

// Room-panel rows -> the category each one draws from. `nullable` rows can be
// set to "なし" (nothing drawn); floor/wall/desk always need a part.
const DECOR_SLOTS = [
  { id: "floor", category: "floor", nullable: false },
  { id: "wall", category: "wall", nullable: false },
  { id: "rug", category: "rug", nullable: true },
  { id: "wall1", category: "wallDecor", nullable: true },
  { id: "wall2", category: "wallDecor", nullable: true },
  { id: "wall3", category: "wallDecor", nullable: true },
  { id: "desk", category: "desk", nullable: false },
  { id: "chair", category: "chair", nullable: true },
  { id: "side1", category: "sideDecor", nullable: true },
  { id: "side2", category: "sideDecor", nullable: true },
];
const SLOT_BY_ID = new Map(DECOR_SLOTS.map((s) => [s.id, s]));
// floor/wall/rug are top-level keys of a room's `decor`; the rest live under `decor.slots`.
const TOP_LEVEL_SLOTS = new Set(["floor", "wall", "rug"]);

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PART_ID_RE = /^(builtin|custom):([A-Za-z]+)\/([a-z0-9][a-z0-9-]{0,63})$/;

function parsePartId(partId) {
  const m = PART_ID_RE.exec(String(partId));
  return m ? { source: m[1], category: m[2], name: m[3] } : null;
}

function customFile(dir, category, name) {
  return path.join(dir, category, `${name}.png`);
}

function customExists(dir, category, name) {
  return Object.prototype.hasOwnProperty.call(DECOR_SPEC, category) && NAME_RE.test(name) && fs.existsSync(customFile(dir, category, name));
}

// { [category]: [{ id, name, url, updatedAt }] } for every uploaded part.
function listCustomParts(dir, urlPrefix) {
  const result = {};
  for (const category of Object.keys(DECOR_SPEC)) {
    const catDir = path.join(dir, category);
    const files = fs.existsSync(catDir) ? fs.readdirSync(catDir) : [];
    result[category] = files
      .filter((f) => f.endsWith(".png") && NAME_RE.test(f.slice(0, -4)))
      .map((f) => {
        const name = f.slice(0, -4);
        const stat = fs.statSync(path.join(catDir, f));
        return {
          id: `custom:${category}/${name}`,
          name,
          url: `${urlPrefix}/${category}/${f}?v=${Math.floor(stat.mtimeMs)}`,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }
  return result;
}

// Returns an error message (Japanese, shown as-is in the room panel) or null.
// Every message states both the expected and the actual value (§5).
function validateDecorImage(category, file) {
  const spec = DECOR_SPEC[category];
  if (!spec) return `未知のカテゴリです: ${category}`;
  if (!file) return "画像ファイルが送信されていません";
  if (file.mimetype !== "image/png") return `PNG形式の画像のみ登録できます（送信されたファイル: ${file.mimetype || "不明"}）`;
  if (file.size > DECOR_MAX_BYTES) {
    return `ファイルサイズが大きすぎます（上限 ${DECOR_MAX_BYTES / 1024}KB、送信されたファイル: ${Math.ceil(file.size / 1024)}KB）`;
  }

  const info = inspectPng(file.buffer);
  if (!info) return "PNGファイルとして読み取れませんでした";
  const { width, height } = info;
  const actual = `${width}×${height}px`;

  if (spec.exact) {
    if (width !== spec.w || height !== spec.h) return `${spec.label}の画像は ${spec.w}×${spec.h}px ちょうどにしてください（アップロードされた画像: ${actual}）`;
  } else {
    if (width > spec.w || height > spec.h) return `${spec.label}の画像は最大 ${spec.w}×${spec.h}px です（アップロードされた画像: ${actual}）`;
    if (width < DECOR_MIN_SIZE || height < DECOR_MIN_SIZE) return `${spec.label}の画像は ${DECOR_MIN_SIZE}px 以上にしてください（アップロードされた画像: ${actual}）`;
    // Parts are anchored at their bottom-center (rug: center); an odd size
    // puts that anchor on a half pixel and blurs the art.
    if (width % 2 || height % 2) return `${spec.label}の画像は幅・高さとも偶数pxにしてください（アップロードされた画像: ${actual}）`;
  }

  if (spec.opaque) {
    if (info.hasTransparency === null) return "インターレースPNGは透過の有無を確認できないため登録できません。インターレースなしで保存し直してください";
    if (info.hasTransparency) return `${spec.label}の画像は敷き詰めて使うため、透過した部分を含められません（透過ピクセルが見つかりました）`;
  }
  return null;
}

// "My Desk 2.png" -> "my-desk-2-1a2b3c" (readable, collision-free, NAME_RE-safe).
function nameForUpload(originalName) {
  const base = path
    .basename(String(originalName || ""), path.extname(String(originalName || "")))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomBytes(3).toString("hex");
  return base ? `${base}-${suffix}` : `part-${suffix}`;
}

function saveCustomPart(dir, category, originalName, buffer) {
  const name = nameForUpload(originalName);
  fs.mkdirSync(path.join(dir, category), { recursive: true });
  fs.writeFileSync(customFile(dir, category, name), buffer);
  return name;
}

function removeCustomPart(dir, category, name) {
  if (!customExists(dir, category, name)) return false;
  fs.unlinkSync(customFile(dir, category, name));
  return true;
}

// Validates one room-panel change. Returns an error message or null.
function validateSlotValue(dir, slotId, partId) {
  const slot = SLOT_BY_ID.get(slotId);
  if (!slot) return `未知の配置場所です: ${slotId}`;
  if (partId === null) return slot.nullable ? null : `${DECOR_SPEC[slot.category].label}は「なし」にできません`;
  const parsed = parsePartId(partId);
  if (!parsed) return `部品IDの形式が不正です: ${partId}`;
  if (parsed.category !== slot.category) {
    return `${slotId} には ${DECOR_SPEC[slot.category].label}の部品しか置けません（指定された部品: ${partId}）`;
  }
  if (parsed.source === "custom" && !customExists(dir, parsed.category, parsed.name)) return `部品の画像が見つかりません: ${partId}`;
  return null;
}

module.exports = {
  DECOR_SPEC,
  DECOR_MAX_BYTES,
  DECOR_MIN_SIZE,
  DECOR_SLOTS,
  TOP_LEVEL_SLOTS,
  parsePartId,
  listCustomParts,
  validateDecorImage,
  saveCustomPart,
  removeCustomPart,
  validateSlotValue,
};
