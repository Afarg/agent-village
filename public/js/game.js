// Phaser 3 scene: renders the pixel-art "village" map and the agent characters.
// Placeholder characters/rooms use geometric primitives (docs/design/03 §4.1 P0);
// either can be swapped for a user-uploaded PNG via the HUD (see hud.js).
import { store } from "./store.js";

const WALK_SPEED = 110; // logical px/sec
const BUBBLE_MS = 3400;
const EMOTE_MS = 900;
const TEXT_RESOLUTION = 2; // render text at higher density so it stays crisp under pixelArt nearest-neighbor scaling
const FONT_STACK = '"Yu Gothic UI", "Yu Gothic", Meiryo, monospace';

function colorInt(hex, fallback = 0x94b0c2) {
  if (!hex) return fallback;
  return parseInt(hex.replace("#", ""), 16);
}

function facingFromDelta(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

// docs/design/07-directional-animation-support.md §4.2 fallback table. The
// chain always ends at "front" since front is animation's only required view
// (img_to_pixcel_app/docs/design/06-multi-angle-input.md §2) - so this never
// returns a view the character doesn't actually have walk frames for, as long
// as the caller also has a `front` walk fallback (Phase 1 front-only bundles
// carry walk frames on front itself, see ani_convert_app's bundle.py).
//
// diagonal_left/diagonal_right replace the old single "diagonal" view
// (2026-07-29, img_to_pixcel_app/docs/design/06-multi-angle-input.md update
// history) so asymmetric characters can supply a real image for each side
// instead of relying on a horizontal flip. "left"/"right" facing prefer the
// matching-side image un-flipped, falling back to the opposite side flipped
// only when the matching one wasn't provided. "down"/"up" have no left/right
// lean of their own, so they arbitrarily but deterministically prefer
// diagonal_right over diagonal_left when both exist.
function pickWalkView(animation, facing) {
  const views = animation?.views || {};
  const hasWalk = (v) => views[v]?.walk?.length > 0;

  switch (facing) {
    case "down":
      if (hasWalk("diagonal_right")) return { viewName: "diagonal_right", flipX: false };
      if (hasWalk("diagonal_left")) return { viewName: "diagonal_left", flipX: false };
      return { viewName: "front", flipX: false };
    case "up":
      if (hasWalk("back")) return { viewName: "back", flipX: false };
      if (hasWalk("diagonal_right")) return { viewName: "diagonal_right", flipX: false };
      if (hasWalk("diagonal_left")) return { viewName: "diagonal_left", flipX: false };
      return { viewName: "front", flipX: false };
    case "left":
      if (hasWalk("side")) return { viewName: "side", flipX: false };
      if (hasWalk("diagonal_left")) return { viewName: "diagonal_left", flipX: false };
      if (hasWalk("diagonal_right")) return { viewName: "diagonal_right", flipX: true };
      return { viewName: "front", flipX: false };
    case "right":
      if (hasWalk("side")) return { viewName: "side", flipX: true };
      if (hasWalk("diagonal_right")) return { viewName: "diagonal_right", flipX: false };
      if (hasWalk("diagonal_left")) return { viewName: "diagonal_left", flipX: true };
      return { viewName: "front", flipX: false };
    default:
      return { viewName: "front", flipX: false };
  }
}

// A character whose def carries `tools: []` (empty, explicitly declared) is
// one of the decorative placeholder characters (test-character-*,
// business-character-*) that exist purely for pipeline/UI showcase and are
// never real delegation targets (see each one's .claude/agents/*.md
// description). Every currently-real agent def declares at least one tool.
// Dimming these to a translucent look keeps them visually distinguishable
// from actually-working agents at a glance (2026-08-21 user request) without
// having to introduce a separate "dummy" frontmatter field that could drift
// out of sync with the tools:[] convention already required to keep them out
// of agent-dispatcher's delegation pool.
const DUMMY_ALPHA = 0.45;

function isDummyAgent(agent) {
  return Array.isArray(agent.tools) && agent.tools.length === 0;
}

function eyeOffset(facing, charSize) {
  const d = charSize * 0.3; // 6/20 = 0.3, the original hand-tuned ratio at CHAR_SIZE=20
  switch (facing) {
    case "up": return { x: 0, y: -d };
    case "left": return { x: -d, y: 0 };
    case "right": return { x: d, y: 0 };
    default: return { x: 0, y: d };
  }
}

class VillageScene extends Phaser.Scene {
  constructor(roomsConfig) {
    super("village");
    this.roomsConfig = roomsConfig;
    this.characters = new Map(); // agentId -> entry
    this.breakSpotIndex = new Map(); // agentId -> idleSpots index
    this.deskSlotIndex = new Map(); // roomId -> Map(agentId -> slot index)
    this.roomVisuals = new Map(); // roomId -> { bg, border, labelText, rect }
    this.textureVersion = new Map(); // key -> current texture key in use (for cleanup on swap)

    // Character on-screen size (logical px), for both placeholder and custom
    // sprites. Design rule (2026-08-17 user feedback: uploaded character art
    // was rendering far too large): a character must fit within 1/9 of the
    // break room cell's area - i.e. if the break room were divided into a 3x3
    // grid, one character occupies at most one of those 9 cells. Computed
    // from the break room's own rect (rather than hardcoded) so it stays
    // correct if `agents/config/rooms.json`'s `layout.cellWidth/cellHeight`
    // ever changes, and applies uniformly to every current AND future
    // character regardless of the resolution of the source PNG it was
    // generated at (img_to_pixcel_app's `output_size` can be 64/128/etc. -
    // this is independent of that). `0.9` leaves a small margin so adjacent
    // characters in the break room don't touch edge-to-edge.
    const { w: roomW, h: roomH } = roomsConfig.breakRoom.rect;
    this.charSize = Math.floor((Math.min(roomW, roomH) / 3) * 0.9);
  }

  create() {
    this.drawMap();

    this.unsubscribe = store.subscribe((type, data) => this.onStoreEvent(type, data));
    for (const agent of store.getAgents()) this.createCharacter(agent);

    for (const room of this.allRoomDefs()) {
      if (room.tileUrl) this.applyRoomTile(room.id, room.tileUrl);
    }
  }

  allRoomDefs() {
    const { breakRoom, rooms } = this.roomsConfig;
    return [breakRoom, ...rooms];
  }

  // ---------------------------------------------------------------- map ---
  drawMap() {
    const { canvas, breakRoom, rooms, genericDesk } = this.roomsConfig;
    this.cameras.main.setBackgroundColor(0x11142a);

    for (const room of rooms) this.drawRoom(room.id, room, 0xc9d3e6, 0x2b3350, "#1b2038");
    this.drawRoom(breakRoom.id, breakRoom, 0xf6e6bd, 0xb8860b, "#5a4620");

    if (genericDesk) {
      this.add
        .text(genericDesk.deskSpot.x, genericDesk.deskSpot.y - 14, genericDesk.label, {
          fontFamily: FONT_STACK,
          fontSize: "10px",
          color: "#5a4620",
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5, 1);
    }

    this.add
      .text(canvas.width / 2, canvas.height - 3, "Agent Village", {
        fontFamily: FONT_STACK,
        fontSize: "9px",
        color: "#4a5170",
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5, 1);
  }

  drawRoom(roomId, room, fillColor, strokeColor, labelColor) {
    const { x, y, w, h } = room.rect;
    const bg = this.add.rectangle(x + w / 2, y + h / 2, w - 2, h - 2, fillColor);
    const border = this.add.rectangle(x + w / 2, y + h / 2, w - 2, h - 2).setStrokeStyle(2, strokeColor);
    const labelText = this.add
      .text(x + 5, y + 4, room.label, { fontFamily: FONT_STACK, fontSize: "12px", color: labelColor, resolution: TEXT_RESOLUTION })
      .setOrigin(0, 0);

    this.roomVisuals.set(roomId, { bg, border, labelText, rect: room.rect, fillColor });
  }

  // -------------------------------------------------------- room tiles ---
  applyRoomTile(roomId, tileUrl) {
    const visual = this.roomVisuals.get(roomId);
    if (!visual || !tileUrl) return;

    const key = `room-tile-${roomId}-${tileUrl}`;
    this.loadTexture(key, tileUrl, (ok) => {
      if (!ok || !this.roomVisuals.has(roomId)) return;
      const v = this.roomVisuals.get(roomId);
      if (v.image) v.image.destroy();
      const { x, y, w, h } = v.rect;
      const image = this.add.image(x + w / 2, y + h / 2, key).setDisplaySize(w - 2, h - 2);
      image.setDepth(-1);
      v.bg.setVisible(false);
      v.image = image;
      this.roomVisuals.set(roomId, v);
    });
  }

  clearRoomTile(roomId) {
    const visual = this.roomVisuals.get(roomId);
    if (!visual) return;
    if (visual.image) {
      visual.image.destroy();
      visual.image = null;
    }
    visual.bg.setVisible(true);
  }

  // --------------------------------------------------- runtime texture loading ---
  loadTexture(key, url, onDone) {
    if (this.textures.exists(key)) {
      onDone(true);
      return;
    }
    this.load.image(key, url);
    this.load.once(`filecomplete-image-${key}`, () => onDone(true));
    this.load.once("loaderror", (file) => {
      if (file.key === key) onDone(false);
    });
    if (!this.load.isLoading()) this.load.start();
  }

  // --------------------------------------------------------- characters ---
  breakSpotFor(agentId) {
    const spots = this.roomsConfig.breakRoom.idleSpots;
    if (!this.breakSpotIndex.has(agentId)) {
      this.breakSpotIndex.set(agentId, this.breakSpotIndex.size % spots.length);
    }
    return spots[this.breakSpotIndex.get(agentId)];
  }

  // Multiple agents can share one role/room (e.g. two "planner" agents), so
  // desk positions are offset per-occupant to avoid stacking sprites exactly
  // on top of each other. Slot assignment is stable for the character's lifetime.
  roomTargetFor(agent) {
    const base = agent.deskSpot || this.roomsConfig.genericDesk.deskSpot;
    const roomId = agent.roomId || "generic";

    if (!this.deskSlotIndex.has(roomId)) this.deskSlotIndex.set(roomId, new Map());
    const slots = this.deskSlotIndex.get(roomId);
    if (!slots.has(agent.agentId)) slots.set(agent.agentId, slots.size);
    const idx = slots.get(agent.agentId);

    const d = this.charSize * 1.1; // 22/20 = 1.1, the original hand-tuned ratio at CHAR_SIZE=20
    const OFFSETS = [
      [0, 0], [d, 0], [-d, 0], [0, d], [0, -d],
      [d, d], [-d, -d], [d, -d], [-d, d],
    ];
    const [ox, oy] = OFFSETS[idx % OFFSETS.length];
    return { x: base.x + ox, y: base.y + oy };
  }

  spotForStatus(agent) {
    return agent.status === "idle" || agent.status === "error" ? this.breakSpotFor(agent.agentId) : this.roomTargetFor(agent);
  }

  createCharacter(agent) {
    const spot = this.spotForStatus(agent);
    const container = this.add.container(spot.x, spot.y);
    if (isDummyAgent(agent)) container.setAlpha(DUMMY_ALPHA);
    const size = this.charSize;

    // All offsets/sizes below are expressed as ratios of `size`, matching the
    // original hand-tuned pixel values at the old fixed CHAR_SIZE=20 (e.g.
    // nameText.y was -17 = -(20/2 + 7)) so the whole character "ensemble"
    // (name tag, eye, selection ring, speech bubble) keeps its proportions
    // and stacking order as `size` changes with the break room's cell size.
    const body = this.add
      .rectangle(0, 0, size * 0.7, size * 0.7, colorInt(agent.paletteMain))
      .setStrokeStyle(1, 0x1a1c2c);
    const eye = this.add.rectangle(0, size * 0.3, size * 0.2, size * 0.2, 0x1a1c2c);
    const sprite = this.add.image(0, 0, "__DEFAULT").setDisplaySize(size, size).setVisible(false);

    const nameText = this.add
      .text(0, -(size / 2 + 7), agent.displayName, { fontFamily: FONT_STACK, fontSize: "11px", color: "#ffffff", resolution: TEXT_RESOLUTION })
      .setOrigin(0.5, 1);
    const emote = this.add
      .text(0, -(size / 2 + 15), "", { fontFamily: FONT_STACK, fontSize: "14px", color: "#ffffff", resolution: TEXT_RESOLUTION })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const bubbleBg = this.add.graphics().setVisible(false);
    const bubbleText = this.add
      .text(0, 0, "", { fontFamily: FONT_STACK, fontSize: "11px", color: "#1b2038", resolution: TEXT_RESOLUTION, wordWrap: { width: 150 } })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const selectRing = this.add.ellipse(0, size * 0.45, size * 1.4, size * 0.55, 0xffffff, 0.28).setVisible(false);

    container.add([selectRing, body, eye, sprite, nameText, bubbleBg, bubbleText, emote]);
    body.setInteractive({ useHandCursor: true }).on("pointerdown", () => store.select(agent.agentId));
    sprite.setInteractive({ useHandCursor: true }).on("pointerdown", () => store.select(agent.agentId));

    const entry = {
      agent,
      container,
      body,
      eye,
      sprite,
      nameText,
      emote,
      bubbleBg,
      bubbleText,
      selectRing,
      roomId: agent.status === "idle" || agent.status === "error" ? "break" : agent.roomId,
      bubbleTimer: null,
      emoteTimer: null,
      currentSpriteUrl: null,
      isWalking: false,
      blinkTimer: null,
      walkFrameTimer: null,
    };

    this.characters.set(agent.agentId, entry);
    this.setWorkingAnim(entry, agent.status === "working");
    if (agent.status !== "working") this.setIdleAnim(entry, true);
    // animation (docs/design/07-directional-animation-support.md §2) takes
    // priority over the static spriteUrl when both are present.
    if (agent.animation) this.startIdleBlink(entry);
    else if (agent.spriteUrl) this.applyCharacterSprite(entry, agent.spriteUrl);
    if (agent.pendingPermission) this.showPermissionBubble(entry, agent.pendingPermission);
    return entry;
  }

  // -------------------------------------------------- custom character art ---
  applyCharacterSprite(entry, url) {
    if (entry.currentSpriteUrl === url) return;
    const key = `char-sprite-${entry.agent.agentId}-${url}`;
    this.loadTexture(key, url, (ok) => {
      if (!ok || !this.characters.has(entry.agent.agentId)) return;
      // setDisplaySize() sets a scale factor computed against whatever
      // texture is current AT CALL TIME (this.charSize / nativeTextureSize).
      // setTexture() alone does NOT recompute that scale - it keeps the OLD
      // scale factor and applies it to the NEW texture's native pixel size.
      // Custom character art is uploaded at various native resolutions
      // (img_to_pixcel_app's output_size, commonly 128x128), so without
      // re-calling setDisplaySize() here, a sprite created against the small
      // "__DEFAULT" placeholder texture would render several times larger
      // than `this.charSize` once swapped to real art (2026-08-17 user
      // report: uploaded characters were rendering far too large).
      entry.sprite.setTexture(key).setDisplaySize(this.charSize, this.charSize).setVisible(true);
      entry.body.setVisible(false);
      entry.eye.setVisible(false);
      entry.currentSpriteUrl = url;
    });
  }

  clearCharacterSprite(entry) {
    entry.sprite.setVisible(false);
    entry.body.setVisible(true);
    entry.eye.setVisible(true);
    entry.currentSpriteUrl = null;
  }

  // ---------------------------------------------- animation playback ---
  // docs/design/07-directional-animation-support.md §4.1. `ani_convert_app`'s
  // output is individual PNGs, not a spritesheet, so frame switching is just
  // `sprite.setTexture(key)` on a timer rather than Phaser's animation manager.
  loadAnimFrame(entry, url, flipX = false) {
    if (!url) return;
    const key = `char-anim-${entry.agent.agentId}-${url}`;
    this.loadTexture(key, url, (ok) => {
      if (!ok || !this.characters.has(entry.agent.agentId)) return;
      // setDisplaySize() must be re-applied after setTexture() - see the
      // comment in applyCharacterSprite() for why (Phaser doesn't recompute
      // scale when the texture changes, only when setDisplaySize() itself
      // is called).
      entry.sprite.setTexture(key).setDisplaySize(this.charSize, this.charSize).setFlipX(flipX).setVisible(true);
      entry.body.setVisible(false);
      entry.eye.setVisible(false);
    });
  }

  // Idle view is always "front" (docs/design/07 §4.2 table) - blink only
  // matters while stationary, and front is the one view guaranteed to exist.
  startIdleBlink(entry) {
    this.stopIdleBlink(entry);
    const front = entry.agent.animation?.views?.front;
    if (!front?.idle?.length) return;

    const [normalUrl, blinkUrl] = front.idle;
    this.loadAnimFrame(entry, normalUrl, false);
    if (!blinkUrl) return; // only one idle frame provided - nothing to blink between

    const scheduleNext = () => {
      // "3〜8秒ごとにランダムでまばたき" - docs/design/01-visual-concept.md §4.
      const delay = 3000 + Math.random() * 5000;
      entry.blinkTimer = this.time.delayedCall(delay, () => {
        this.loadAnimFrame(entry, blinkUrl, false);
        entry.blinkTimer = this.time.delayedCall(150, () => {
          if (!this.characters.has(entry.agent.agentId)) return;
          this.loadAnimFrame(entry, normalUrl, false);
          scheduleNext();
        });
      });
    };
    scheduleNext();
  }

  stopIdleBlink(entry) {
    if (entry.blinkTimer) {
      entry.blinkTimer.remove();
      entry.blinkTimer = null;
    }
  }

  startWalkFrames(entry, facing) {
    this.stopWalkFrames(entry);
    const animation = entry.agent.animation;
    if (!animation) return;

    const { viewName, flipX } = pickWalkView(animation, facing);
    const frames = animation.views[viewName]?.walk;
    if (!frames || frames.length === 0) return;
    if (frames.length === 1) {
      this.loadAnimFrame(entry, frames[0], flipX);
      return;
    }

    let idx = 0;
    this.loadAnimFrame(entry, frames[idx], flipX);
    entry.walkFrameTimer = this.time.addEvent({
      delay: 260,
      loop: true,
      callback: () => {
        idx = (idx + 1) % frames.length;
        this.loadAnimFrame(entry, frames[idx], flipX);
      },
    });
  }

  stopWalkFrames(entry) {
    if (entry.walkFrameTimer) {
      entry.walkFrameTimer.remove();
      entry.walkFrameTimer = null;
    }
  }

  // ------------------------------------------------------------ motion ---
  setIdleAnim(entry, on) {
    if (entry.idleTween) entry.idleTween.stop();
    if (!on) return;
    entry.idleTween = this.tweens.add({
      targets: entry.container,
      y: entry.container.y - 3,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  setWorkingAnim(entry, on) {
    entry.body.setScale(1);
    entry.sprite.setScale(1);
    // The squash tween (scaleY) that used to run here while `working` read
    // as too large/jarring at this sprite's on-screen size, even after
    // shrinking its amplitude (2026-08-15 user feedback, docs/project-status.md
    // §11.4) - turned off entirely for now rather than keep chasing a smaller
    // number. `working` characters just get the same slow, gentle bob as
    // `idle` instead, so they don't look frozen without reintroducing any
    // stretch.
    this.setIdleAnim(entry, on);
  }

  walkTo(entry, target, onComplete) {
    this.setWorkingAnim(entry, false);
    this.setIdleAnim(entry, false);
    const dx = target.x - entry.container.x;
    const dy = target.y - entry.container.y;
    const dist = Math.hypot(dx, dy);
    const facing = facingFromDelta(dx, dy);
    const off = eyeOffset(facing, this.charSize);
    entry.eye.setPosition(off.x, off.y);

    if (entry.agent.animation) {
      entry.isWalking = true;
      this.stopIdleBlink(entry);
      this.startWalkFrames(entry, facing);
    }

    this.tweens.add({
      targets: entry.container,
      x: target.x,
      y: target.y,
      duration: Math.max(220, (dist / WALK_SPEED) * 1000),
      ease: "Linear",
      onComplete: () => {
        if (entry.agent.animation) {
          entry.isWalking = false;
          this.stopWalkFrames(entry);
          this.startIdleBlink(entry);
        }
        onComplete && onComplete();
      },
    });
  }

  showEmote(entry, char) {
    if (entry.emoteTimer) entry.emoteTimer.remove();
    entry.emote.setText(char).setVisible(true);
    entry.emoteTimer = this.time.delayedCall(EMOTE_MS, () => entry.emote.setVisible(false));
  }

  // `persistent: true` (docs/design/06-permission-wait-bubble.md §5.2) skips the
  // auto-hide timer — caller is responsible for calling hideBubble() once the
  // condition (pendingPermission) clears.
  showBubble(entry, text, { persistent = false, borderColor = 0x1b2038 } = {}) {
    if (entry.bubbleTimer) {
      entry.bubbleTimer.remove();
      entry.bubbleTimer = null;
    }
    const short = text.length > 70 ? `${text.slice(0, 67)}...` : text;
    const anchorY = -(this.charSize / 2 + 18); // 28/20 = 1.4 -> (20/2+18)=28, the original ratio at CHAR_SIZE=20

    entry.bubbleText.setText(short).setPosition(0, anchorY).setVisible(true);
    const bounds = entry.bubbleText.getBounds();
    const w = Math.max(36, bounds.width + 14);
    const h = bounds.height + 10;

    entry.bubbleBg.clear();
    entry.bubbleBg.fillStyle(0xffffff, 0.96);
    entry.bubbleBg.lineStyle(persistent ? 2 : 1, borderColor, 1);
    entry.bubbleBg.fillRoundedRect(-w / 2, anchorY - h, w, h, 5);
    entry.bubbleBg.strokeRoundedRect(-w / 2, anchorY - h, w, h, 5);
    entry.bubbleBg.setVisible(true);
    entry.bubbleText.setPosition(0, anchorY);

    if (!persistent) {
      entry.bubbleTimer = this.time.delayedCall(BUBBLE_MS, () => {
        entry.bubbleBg.setVisible(false);
        entry.bubbleText.setVisible(false);
      });
    }
  }

  hideBubble(entry) {
    if (entry.bubbleTimer) {
      entry.bubbleTimer.remove();
      entry.bubbleTimer = null;
    }
    entry.bubbleBg.setVisible(false);
    entry.bubbleText.setVisible(false);
  }

  showPermissionBubble(entry, pendingPermission) {
    this.showBubble(entry, `🔒 ${pendingPermission.tool} の実行許可を待っています`, {
      persistent: true,
      borderColor: 0xe0a93a, // amber — docs/design/06-permission-wait-bubble.md §5.2 (5th bubble kind)
    });
  }

  tintError(entry, on) {
    if (entry.currentSpriteUrl || entry.agent.animation) return; // custom art isn't recolored
    entry.body.setFillStyle(on ? colorInt("#b13e53") : colorInt(entry.agent.paletteMain));
  }

  // -------------------------------------------------------- transitions ---
  handleStatusChange(entry, prevStatus, nextAgent) {
    const status = nextAgent.status;

    if (status === "assigned" || (status === "working" && prevStatus !== "working")) {
      this.showEmote(entry, "!");
      this.time.delayedCall(650, () => {
        if (entry.roomId !== nextAgent.roomId) {
          this.walkTo(entry, this.roomTargetFor(nextAgent), () => {
            entry.roomId = nextAgent.roomId;
            this.setWorkingAnim(entry, status === "working");
          });
        } else {
          this.setWorkingAnim(entry, status === "working");
        }
      });
    } else if (status === "working") {
      this.setWorkingAnim(entry, true);
    } else if (status === "done") {
      this.showEmote(entry, "✓");
      this.tweens.add({ targets: entry.container, scale: 1.25, duration: 250, yoyo: true, ease: "Sine.easeOut" });
      this.time.delayedCall(900, () => {
        this.walkTo(entry, this.breakSpotFor(entry.agent.agentId), () => {
          entry.roomId = "break";
          this.setWorkingAnim(entry, false);
        });
      });
    } else if (status === "idle") {
      if (entry.roomId !== "break") {
        this.walkTo(entry, this.breakSpotFor(entry.agent.agentId), () => {
          entry.roomId = "break";
          this.setWorkingAnim(entry, false);
        });
      } else {
        this.tintError(entry, false);
        this.setWorkingAnim(entry, false);
      }
    } else if (status === "error") {
      this.showEmote(entry, "⚠");
      this.tintError(entry, true);
      this.setWorkingAnim(entry, false);
    }
  }

  applyAgentUpdate(agentId, prevAgent, nextAgent) {
    let entry = this.characters.get(agentId);
    if (!entry) {
      this.createCharacter(nextAgent);
      return;
    }

    const prevPending = prevAgent?.pendingPermission || null;
    const nextPending = nextAgent.pendingPermission || null;

    if (nextPending) {
      // Re-show on a new requestedAt (a different tool triggered another
      // PermissionRequest) so the text/timestamp stay current; docs/design/06 §7.
      if (!prevPending || prevPending.requestedAt !== nextPending.requestedAt) {
        this.showPermissionBubble(entry, nextPending);
      }
    } else if (prevPending) {
      this.hideBubble(entry);
    } else {
      const prevLogLen = prevAgent?.log?.length || 0;
      const nextLogLen = nextAgent.log?.length || 0;
      if (nextLogLen > prevLogLen) {
        this.showBubble(entry, nextAgent.log[nextLogLen - 1].text);
      }
    }

    if (!prevAgent || prevAgent.status !== nextAgent.status) {
      this.handleStatusChange(entry, prevAgent?.status, nextAgent);
    }

    const prevAnimJson = JSON.stringify(prevAgent?.animation || null);
    const nextAnimJson = JSON.stringify(nextAgent.animation || null);
    if (prevAnimJson !== nextAnimJson) {
      // Animation bundle was uploaded/replaced/removed (docs/design/07 §2:
      // animation takes priority over spriteUrl whenever present).
      this.stopIdleBlink(entry);
      this.stopWalkFrames(entry);
      entry.agent = nextAgent; // startIdleBlink/applyCharacterSprite below read entry.agent
      if (nextAgent.animation) {
        if (!entry.isWalking) this.startIdleBlink(entry);
      } else if (nextAgent.spriteUrl) {
        this.applyCharacterSprite(entry, nextAgent.spriteUrl);
      } else {
        this.clearCharacterSprite(entry);
      }
    } else if (!nextAgent.animation) {
      if (nextAgent.spriteUrl && nextAgent.spriteUrl !== entry.currentSpriteUrl) {
        this.applyCharacterSprite(entry, nextAgent.spriteUrl);
      } else if (!nextAgent.spriteUrl && entry.currentSpriteUrl) {
        this.clearCharacterSprite(entry);
      }
    }

    entry.nameText.setText(nextAgent.displayName);
    entry.container.setAlpha(isDummyAgent(nextAgent) ? DUMMY_ALPHA : 1);
    entry.agent = nextAgent;
  }

  removeCharacter(agentId) {
    const entry = this.characters.get(agentId);
    if (!entry) return;
    // blinkTimer/walkFrameTimer otherwise keep firing forever (walkFrameTimer
    // loops) even after the character is gone, since nothing else stops them.
    this.stopIdleBlink(entry);
    this.stopWalkFrames(entry);
    this.tweens.add({
      targets: entry.container,
      alpha: 0,
      duration: 500,
      onComplete: () => entry.container.destroy(),
    });
    this.characters.delete(agentId);
  }

  refreshCharacterAsset(agentId) {
    const entry = this.characters.get(agentId);
    if (!entry) return;
    const agent = store.getAgent(agentId);
    if (!agent) return;
    entry.agent = agent;
    this.stopIdleBlink(entry);
    this.stopWalkFrames(entry);
    if (agent.animation) {
      if (!entry.isWalking) this.startIdleBlink(entry);
    } else if (agent.spriteUrl) {
      this.applyCharacterSprite(entry, agent.spriteUrl);
    } else {
      this.clearCharacterSprite(entry);
    }
  }

  refreshRoomAsset(roomId) {
    const rooms = store.getRooms();
    if (!rooms) return;
    const all = [rooms.breakRoom, ...rooms.rooms];
    const room = all.find((r) => r.id === roomId);
    if (!room) return;
    if (room.tileUrl) this.applyRoomTile(roomId, room.tileUrl);
    else this.clearRoomTile(roomId);
  }

  onStoreEvent(type, data) {
    if (type === "agent-change") {
      this.applyAgentUpdate(data.agentId, data.prev, data.next);
    } else if (type === "agent-removed") {
      this.removeCharacter(data.agentId);
    } else if (type === "select") {
      for (const [id, entry] of this.characters) {
        entry.selectRing.setVisible(id === data.agentId);
      }
    } else if (type === "asset-change") {
      if (data.assetKind === "character") this.refreshCharacterAsset(data.id);
      else if (data.assetKind === "room") this.refreshRoomAsset(data.id);
    }
  }
}

function computeZoom(canvas, containerEl) {
  const maxW = containerEl.clientWidth || canvas.width;
  const maxH = containerEl.clientHeight || canvas.height;
  const fit = Math.min(maxW / canvas.width, maxH / canvas.height);
  return Math.max(1, Math.min(4, Math.floor(fit)));
}

export async function initGame(containerId) {
  await store.ensureRooms();
  const roomsConfig = store.rooms;
  const containerEl = document.getElementById(containerId);
  const zoom = computeZoom(roomsConfig.canvas, containerEl);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerId,
    width: roomsConfig.canvas.width,
    height: roomsConfig.canvas.height,
    zoom,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: "#11142a",
    scene: new VillageScene(roomsConfig),
  });

  window.addEventListener("resize", () => {
    const newZoom = computeZoom(roomsConfig.canvas, containerEl);
    if (game.scale && typeof game.scale.setZoom === "function") game.scale.setZoom(newZoom);
  });

  return game;
}
