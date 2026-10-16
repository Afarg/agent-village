// Built-in decor parts for the "AI office" (docs/design/09-ai-office-redesign.md).
// Every part is drawn with plain rects on a Phaser Graphics object and baked
// into a texture once at startup via generateTexture(), so the whole office
// ships without any external image assets. Sizes follow the §5 spec exactly —
// an uploaded PNG of the same category/size can replace any of these later.
//
// Theme: a warm, modern business office — oak desks, warm-gray carpet tiles,
// cream walls with a walnut baseboard, city-view windows, whiteboards, plants.

export const C = {
  out: 0x2b2320,
  // woods
  oakD: 0x8a5a33, oak: 0xb07a45, oakL: 0xcf9a5e, oakH: 0xe6b97c,
  walD: 0x3f2a1d, wal: 0x5e3d2a, walL: 0x7d5238,
  // floor / wall
  carpet: 0x9a9189, carpetD: 0x8a8179, carpetL: 0xa89f96,
  tile: 0xe9dcc2, tileD: 0xd2c3a6, tileL: 0xf4ead6,
  wall: 0xefe4cf, wallD: 0xdccfb5, wallL: 0xf7eedd,
  navyWall: 0x3b4f6e, navyWallD: 0x31425d, navyWallL: 0x4a6186,
  // metal / plastic
  mD: 0x4b5058, m: 0x6f7680, mL: 0x9aa1aa, mH: 0xc9ced4,
  white: 0xf6f4ef, paper: 0xfbfaf6, offW: 0xe4e0d8,
  // screens / glass
  scr: 0x1f2a3a, scrL: 0x3f6f9f, glow: 0x7fb7e0,
  sky: 0x9cc9e8, skyL: 0xc7e3f4, bld: 0x6f8aa6, bldD: 0x5a738e, lit: 0xf3e3a0,
  // plants
  leafD: 0x3f6b3a, leaf: 0x5f8a4c, leafL: 0x86b060, pot: 0xc9c2b8, potD: 0x9e968b,
  // chairs
  chD: 0x26282c, ch: 0x3a3d43, chL: 0x55595f,
  navy: 0x2f4468, navyL: 0x44619a, navyD: 0x223250,
  // accents
  red: 0xc4553d, brass: 0xc9a227, yellow: 0xf3e38a, pink: 0xf2b8b0, blue: 0xb9d4ee, green: 0x9fd08a,
  cork: 0xc79a5c, corkD: 0xa97f45, mug: 0xd8d2c4,
};

function r(g, color, x, y, w, h) {
  g.fillStyle(color, 1);
  g.fillRect(x, y, w, h);
}

// Filled ellipse, one scanline at a time so edges stay on the pixel grid.
function ellipse(g, color, cx, cy, rx, ry) {
  for (let dy = -ry; dy < ry; dy++) {
    const t = (dy + 0.5) / ry;
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    if (half > 0) r(g, color, cx - half, cy + dy, half * 2, 1);
  }
}

// ------------------------------------------------------------------ floor ---
function floorCarpet(g) {
  r(g, C.carpet, 0, 0, 16, 16);
  r(g, C.carpetD, 15, 0, 1, 16);
  r(g, C.carpetD, 0, 15, 16, 1);
  r(g, C.carpetL, 0, 0, 15, 1);
  for (const [x, y] of [[3, 3], [9, 5], [5, 10], [12, 11], [7, 7]]) r(g, C.carpetD, x, y, 1, 1);
  for (const [x, y] of [[11, 2], [2, 7], [10, 9]]) r(g, C.carpetL, x, y, 1, 1);
}

function planks(g, base, light, dark, seams) {
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    r(g, row % 2 ? base : light, 0, y, 16, 4);
    r(g, dark, 0, y + 3, 16, 1);
    r(g, dark, seams[row], y, 1, 3);
  }
}
function floorOak(g) {
  planks(g, C.oak, C.oakL, C.oakD, [5, 12, 2, 9]);
}
function floorWalnut(g) {
  planks(g, C.wal, C.walL, C.walD, [7, 1, 11, 4]);
}
function floorTile(g) {
  r(g, C.tile, 0, 0, 16, 16);
  r(g, C.tileD, 15, 0, 1, 16);
  r(g, C.tileD, 0, 15, 16, 1);
  r(g, C.tileL, 0, 0, 15, 1);
  r(g, C.tileL, 0, 0, 1, 15);
}

// ------------------------------------------------------------------- wall ---
function baseboard(g) {
  r(g, C.wal, 0, 43, 16, 5);
  r(g, C.walL, 0, 43, 16, 1);
  r(g, C.walD, 0, 47, 16, 1);
}
function wallCream(g) {
  r(g, C.wall, 0, 0, 16, 48);
  r(g, C.wallD, 0, 0, 16, 3);
  r(g, C.wallL, 0, 3, 16, 1);
  baseboard(g);
}
function wallWainscot(g) {
  wallCream(g);
  r(g, C.oak, 0, 24, 16, 19);
  r(g, C.oakH, 0, 24, 16, 1);
  r(g, C.oakD, 0, 25, 16, 1);
  r(g, C.oakL, 2, 28, 12, 12);
  r(g, C.oakD, 2, 39, 12, 1);
  r(g, C.oakD, 13, 28, 1, 12);
  baseboard(g);
}
function wallNavy(g) {
  r(g, C.navyWall, 0, 0, 16, 48);
  r(g, C.navyWallD, 0, 0, 16, 3);
  r(g, C.navyWallL, 0, 3, 16, 1);
  r(g, C.navyWallD, 15, 4, 1, 39);
  baseboard(g);
}

// -------------------------------------------------------------------- rug ---
function rugNavy(g) {
  r(g, C.navyD, 0, 0, 144, 80);
  r(g, C.navy, 2, 2, 140, 76);
  r(g, C.brass, 6, 6, 132, 1);
  r(g, C.brass, 6, 73, 132, 1);
  r(g, C.brass, 6, 6, 1, 68);
  r(g, C.brass, 137, 6, 1, 68);
  for (let x = 12; x < 134; x += 8) r(g, C.navyL, x, 40, 4, 1);
}
function rugRound(g) {
  ellipse(g, C.corkD, 64, 36, 64, 36);
  ellipse(g, C.tileD, 64, 36, 61, 33);
  ellipse(g, C.cork, 64, 36, 54, 28);
  ellipse(g, C.tileD, 64, 36, 44, 21);
}

// -------------------------------------------------------------- wallDecor ---
function windowCity(g) {
  r(g, C.mH, 0, 0, 48, 36);
  r(g, C.m, 0, 35, 48, 1);
  r(g, C.sky, 3, 3, 42, 30);
  r(g, C.skyL, 3, 3, 42, 10);
  const blds = [[3, 14, 7], [10, 20, 6], [16, 10, 8], [24, 17, 6], [30, 12, 9], [39, 19, 6]];
  blds.forEach(([x, top, w], i) => {
    r(g, i % 2 ? C.bldD : C.bld, x, top, w, 33 - top);
    for (let yy = top + 2; yy < 31; yy += 3) {
      for (let xx = x + 1; xx < x + w - 1; xx += 2) if ((xx + yy + i) % 3 === 0) r(g, C.lit, xx, yy, 1, 1);
    }
  });
  r(g, C.mH, 23, 3, 2, 30); // mullion
  r(g, C.mH, 3, 17, 42, 1);
  r(g, C.white, 0, 36, 48, 4); // sill
  r(g, C.mL, 0, 39, 48, 1);
}
function whiteboard(g) {
  r(g, C.mL, 0, 0, 48, 32);
  r(g, C.paper, 2, 2, 44, 26);
  // scribbles: a flow chart in blue, a check list in red
  r(g, C.scrL, 6, 6, 10, 6);
  r(g, C.paper, 7, 7, 8, 4);
  r(g, C.scrL, 16, 9, 6, 1);
  r(g, C.scrL, 22, 6, 10, 6);
  r(g, C.paper, 23, 7, 8, 4);
  r(g, C.scrL, 27, 12, 1, 5);
  r(g, C.scrL, 22, 17, 10, 6);
  r(g, C.paper, 23, 18, 8, 4);
  for (let i = 0; i < 3; i++) {
    r(g, C.red, 36, 7 + i * 5, 2, 2);
    r(g, C.mD, 39, 8 + i * 5, 5, 1);
  }
  r(g, C.m, 4, 28, 40, 3); // marker tray
  r(g, C.red, 8, 28, 4, 1);
  r(g, C.scrL, 14, 28, 4, 1);
}
function clock(g) {
  ellipse(g, C.out, 8, 8, 8, 8);
  ellipse(g, C.white, 8, 8, 7, 7);
  r(g, C.out, 8, 3, 1, 5); // minute hand
  r(g, C.out, 8, 8, 4, 1); // hour hand
  r(g, C.red, 8, 8, 1, 1);
  for (const [x, y] of [[8, 1], [8, 14], [1, 8], [14, 8]]) r(g, C.mD, x, y, 1, 1);
}
function noticeBoard(g) {
  r(g, C.wal, 0, 0, 40, 28);
  r(g, C.cork, 2, 2, 36, 24);
  for (const [x, y] of [[6, 5], [20, 9], [31, 18], [12, 19]]) r(g, C.corkD, x, y, 1, 1);
  const notes = [[4, 4, C.yellow], [14, 6, C.pink], [26, 4, C.blue], [6, 15, C.blue], [18, 16, C.yellow], [29, 15, C.green]];
  for (const [x, y, c] of notes) {
    r(g, c, x, y, 8, 8);
    r(g, C.mL, x + 1, y + 3, 6, 1);
    r(g, C.mL, x + 1, y + 5, 4, 1);
    r(g, C.red, x + 3, y, 2, 1);
  }
}
function chartPoster(g) {
  r(g, C.wal, 0, 0, 32, 32);
  r(g, C.paper, 2, 2, 28, 28);
  r(g, C.mD, 5, 26, 22, 1);
  r(g, C.mD, 5, 6, 1, 20);
  const bars = [6, 9, 8, 13, 17];
  bars.forEach((h, i) => r(g, i === bars.length - 1 ? C.brass : C.scrL, 8 + i * 4, 26 - h, 3, h));
  r(g, C.red, 7, 10, 20, 1);
  r(g, C.mD, 5, 3, 12, 1);
}
function wallTv(g) {
  r(g, C.chD, 0, 0, 48, 28);
  r(g, C.scr, 2, 2, 44, 24);
  for (let x = 5; x < 22; x += 4) {
    const h = 4 + ((x * 7) % 9);
    r(g, C.glow, x, 22 - h, 2, h);
  }
  r(g, C.scrL, 25, 5, 18, 8);
  r(g, C.green, 26, 9, 3, 1);
  r(g, C.green, 29, 8, 3, 1);
  r(g, C.green, 32, 7, 4, 1);
  r(g, C.green, 36, 6, 5, 1);
  r(g, C.scrL, 25, 15, 8, 8);
  r(g, C.lit, 35, 15, 8, 3);
  r(g, C.red, 35, 20, 5, 3);
}
function framedArt(g) {
  r(g, C.oakD, 0, 0, 32, 24);
  r(g, C.oakL, 1, 1, 30, 1);
  r(g, C.paper, 3, 3, 26, 18);
  r(g, C.skyL, 4, 4, 24, 9);
  ellipse(g, C.yellow, 22, 8, 3, 3);
  r(g, C.leafL, 4, 13, 24, 7);
  r(g, C.leaf, 4, 16, 14, 4);
  r(g, C.leafD, 16, 11, 8, 3);
}
function bookShelfWall(g) {
  r(g, C.wal, 0, 18, 48, 4);
  r(g, C.walL, 0, 18, 48, 1);
  const cols = [C.red, C.navy, C.brass, C.leaf, C.offW, C.navyL, C.red, C.oak, C.leafD, C.scrL];
  let x = 2;
  cols.forEach((c, i) => {
    const w = i % 3 === 0 ? 4 : 3;
    const h = 12 + ((i * 5) % 5);
    r(g, c, x, 18 - h, w, h);
    r(g, C.out, x + w, 18 - h, 1, h);
    x += w + 1;
  });
  r(g, C.leaf, 42, 10, 5, 8); // small plant at the end
  r(g, C.pot, 42, 14, 5, 4);
}

// ------------------------------------------------------------------- desk ---
// 64x32: back edge of the desk top at y=8, front panel from y=20.
function deskBody(g, top, topL, front, frontD, leg) {
  r(g, top, 0, 8, 64, 12);
  r(g, topL, 0, 8, 64, 1);
  r(g, front, 0, 20, 64, 9);
  r(g, frontD, 0, 20, 64, 1);
  r(g, leg, 2, 29, 4, 3);
  r(g, leg, 58, 29, 4, 3);
  r(g, frontD, 44, 23, 16, 5); // drawer
  r(g, topL, 50, 25, 4, 1);
}
function deskOakMonitor(g) {
  deskBody(g, C.oakL, C.oakH, C.oak, C.oakD, C.walD);
  // monitor (seen from behind) at the left end so it never covers a face
  r(g, C.chD, 3, 0, 18, 12);
  r(g, C.ch, 4, 1, 16, 10);
  r(g, C.chL, 4, 1, 16, 1);
  r(g, C.chD, 11, 12, 2, 3);
  r(g, C.ch, 8, 15, 8, 1);
  r(g, C.mH, 22, 15, 20, 3); // keyboard
  r(g, C.mL, 22, 17, 20, 1);
  r(g, C.mug, 48, 11, 4, 5); // mug
  r(g, C.red, 48, 12, 4, 1);
  r(g, C.paper, 54, 12, 7, 5); // papers
  r(g, C.offW, 55, 13, 7, 5);
}
function deskWhiteLaptop(g) {
  deskBody(g, C.white, C.paper, C.offW, C.mL, C.mD);
  r(g, C.mL, 38, 6, 16, 9); // laptop lid (back)
  r(g, C.mH, 38, 6, 16, 1);
  r(g, C.brass, 45, 10, 2, 2);
  r(g, C.mD, 36, 15, 20, 2);
  r(g, C.leaf, 5, 10, 4, 4); // tiny succulent
  r(g, C.pot, 5, 14, 4, 3);
  r(g, C.paper, 14, 13, 10, 6); // sketch
  r(g, C.scrL, 16, 15, 6, 1);
}
function deskLoungeTable(g) {
  ellipse(g, C.walD, 32, 17, 30, 9);
  ellipse(g, C.walL, 32, 15, 30, 9);
  ellipse(g, C.wal, 32, 16, 28, 7);
  r(g, C.walD, 30, 24, 4, 8);
  r(g, C.walD, 24, 30, 16, 2);
  r(g, C.mug, 18, 12, 4, 4); // cups & a magazine
  r(g, C.mug, 40, 13, 4, 4);
  r(g, C.pink, 27, 12, 8, 5);
  r(g, C.paper, 28, 13, 6, 1);
}

// ------------------------------------------------------------------ chair ---
function officeChair(g, dark, base, light) {
  r(g, dark, 8, 2, 16, 20);
  r(g, base, 9, 3, 14, 18);
  r(g, light, 9, 3, 14, 1);
  r(g, light, 10, 5, 1, 14);
  r(g, dark, 4, 16, 4, 6); // armrests
  r(g, dark, 24, 16, 4, 6);
  r(g, dark, 6, 22, 20, 4); // seat
  r(g, C.mD, 15, 26, 2, 3);
  r(g, C.mD, 8, 29, 16, 2);
  r(g, C.out, 8, 31, 2, 1);
  r(g, C.out, 22, 31, 2, 1);
}
function chairBlack(g) {
  officeChair(g, C.chD, C.ch, C.chL);
}
function chairNavy(g) {
  officeChair(g, C.navyD, C.navy, C.navyL);
}

// ------------------------------------------------------------- sideDecor ---
function plantTall(g) {
  r(g, C.potD, 6, 34, 12, 10);
  r(g, C.pot, 7, 34, 10, 9);
  r(g, C.offW, 7, 34, 10, 1);
  ellipse(g, C.leafD, 12, 20, 11, 14);
  ellipse(g, C.leaf, 11, 18, 9, 12);
  for (const [x, y] of [[6, 10], [14, 8], [9, 20], [16, 18], [5, 24], [12, 27]]) r(g, C.leafL, x, y, 3, 2);
  r(g, C.leafD, 11, 28, 2, 6);
}
function fileCabinet(g) {
  r(g, C.mD, 0, 0, 24, 40);
  r(g, C.mL, 1, 1, 22, 38);
  r(g, C.mH, 1, 1, 22, 1);
  for (let i = 0; i < 3; i++) {
    const y = 3 + i * 12;
    r(g, C.m, 2, y + 10, 20, 1);
    r(g, C.mD, 8, y + 4, 8, 2);
    r(g, C.paper, 3, y + 1, 5, 3);
  }
}
function bookshelf(g) {
  r(g, C.walD, 0, 0, 32, 48);
  r(g, C.wal, 1, 1, 30, 46);
  const cols = [C.red, C.navy, C.brass, C.leaf, C.offW, C.navyL, C.oak, C.leafD, C.scrL, C.pink];
  for (let shelf = 0; shelf < 3; shelf++) {
    const base = 15 + shelf * 15;
    r(g, C.walL, 1, base, 30, 2);
    let x = 3;
    for (let i = 0; x < 28; i++) {
      const c = cols[(i + shelf * 3) % cols.length];
      const h = 9 + ((i + shelf) % 3);
      r(g, c, x, base - h, 3, h);
      x += 4;
      if (shelf === 1 && i === 2) x += 5; // gap with a leaning book
    }
  }
}
function copier(g) {
  r(g, C.mD, 0, 8, 32, 24);
  r(g, C.mH, 1, 9, 30, 22);
  r(g, C.offW, 1, 9, 30, 6);
  r(g, C.mL, 0, 4, 32, 5); // lid
  r(g, C.m, 0, 8, 32, 1);
  r(g, C.scr, 22, 11, 7, 3);
  r(g, C.green, 23, 12, 1, 1);
  r(g, C.m, 3, 18, 18, 2);
  r(g, C.paper, 4, 16, 16, 2);
  r(g, C.mL, 2, 23, 28, 1);
  r(g, C.mL, 2, 27, 28, 1);
}
function waterServer(g) {
  ellipse(g, C.skyL, 8, 7, 7, 7);
  r(g, C.sky, 3, 3, 10, 10);
  r(g, C.skyL, 4, 3, 2, 8);
  r(g, C.mL, 5, 14, 6, 2);
  r(g, C.white, 1, 16, 14, 24);
  r(g, C.offW, 1, 16, 14, 1);
  r(g, C.red, 4, 20, 2, 2);
  r(g, C.scrL, 10, 20, 2, 2);
  r(g, C.mL, 3, 25, 10, 3);
  r(g, C.mL, 1, 39, 14, 1);
}
function coffeeCounter(g) {
  r(g, C.oakD, 0, 20, 24, 20);
  r(g, C.oakL, 0, 20, 24, 2);
  r(g, C.oak, 1, 23, 22, 16);
  r(g, C.oakD, 11, 24, 1, 14);
  r(g, C.chD, 3, 4, 14, 16); // machine
  r(g, C.ch, 4, 5, 12, 6);
  r(g, C.red, 5, 6, 2, 1);
  r(g, C.mL, 7, 13, 6, 5);
  r(g, C.mug, 8, 15, 4, 3);
  r(g, C.mug, 19, 15, 4, 5);
}

// --------------------------------------------------------------- registry ---
function part(category, name, w, h, draw, label) {
  return { id: `builtin:${category}/${name}`, category, w, h, draw, label };
}

export const PARTS = [
  part("floor", "carpet-gray", 16, 16, floorCarpet, "タイルカーペット（グレー）"),
  part("floor", "oak-plank", 16, 16, floorOak, "フローリング（オーク）"),
  part("floor", "walnut-plank", 16, 16, floorWalnut, "フローリング（ウォルナット）"),
  part("floor", "beige-tile", 16, 16, floorTile, "床タイル（ベージュ）"),

  part("wall", "cream", 16, 48, wallCream, "白壁"),
  part("wall", "oak-wainscot", 16, 48, wallWainscot, "白壁＋腰壁（オーク）"),
  part("wall", "navy", 16, 48, wallNavy, "アクセントウォール（ネイビー）"),

  part("rug", "navy-rect", 144, 80, rugNavy, "ラグ（ネイビー）"),
  part("rug", "round-beige", 128, 72, rugRound, "丸ラグ（ベージュ）"),

  part("wallDecor", "window-city", 48, 40, windowCity, "窓（街並み）"),
  part("wallDecor", "whiteboard", 48, 32, whiteboard, "ホワイトボード"),
  part("wallDecor", "clock", 16, 16, clock, "壁掛け時計"),
  part("wallDecor", "notice-board", 40, 28, noticeBoard, "掲示板"),
  part("wallDecor", "chart-poster", 32, 32, chartPoster, "業績グラフ"),
  part("wallDecor", "wall-tv", 48, 28, wallTv, "壁掛けモニター"),
  part("wallDecor", "framed-art", 32, 24, framedArt, "額縁の絵"),
  part("wallDecor", "book-shelf", 48, 22, bookShelfWall, "壁付け本棚"),

  part("desk", "oak-monitor", 64, 32, deskOakMonitor, "オークのデスク（モニター）"),
  part("desk", "white-laptop", 64, 32, deskWhiteLaptop, "白いデスク（ノートPC）"),
  part("desk", "lounge-table", 64, 32, deskLoungeTable, "ローテーブル"),

  part("chair", "mesh-black", 32, 32, chairBlack, "オフィスチェア（黒）"),
  part("chair", "navy", 32, 32, chairNavy, "オフィスチェア（ネイビー）"),

  part("sideDecor", "plant-tall", 24, 44, plantTall, "観葉植物"),
  part("sideDecor", "file-cabinet", 24, 40, fileCabinet, "書類キャビネット"),
  part("sideDecor", "bookshelf", 32, 48, bookshelf, "本棚"),
  part("sideDecor", "copier", 32, 32, copier, "複合機"),
  part("sideDecor", "water-server", 16, 40, waterServer, "ウォーターサーバー"),
  part("sideDecor", "coffee-counter", 24, 40, coffeeCounter, "コーヒーカウンター"),
];

export const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));

// Bakes every built-in part into a texture keyed by its part id.
export function registerBuiltinParts(scene) {
  for (const p of PARTS) {
    if (scene.textures.exists(p.id)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    p.draw(g);
    g.generateTexture(p.id, p.w, p.h);
    g.destroy();
  }
}
