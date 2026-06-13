import { Mover } from "./Mover.js";

const TAU = Math.PI * 2;

// Cell colors, keyed to size relative to the player.
const PLAYER = "#73DBFF"; // the player cell
const BIGGER = "#FF5A48"; // will eat you — flee
const NEAR = "#FFC24D"; // close to your size
const EDIBLE = "#46C9FF"; // smaller than you — absorb

const parse = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const toward = ([r, g, b], t) => {
  const m = (c) => Math.round(c + (255 - c) * t);
  return [m(r), m(g), m(b)];
};
const darker = ([r, g, b], t) => {
  const m = (c) => Math.round(c * (1 - t));
  return [m(r), m(g), m(b)];
};

const RGB = {
  [PLAYER]: parse(PLAYER),
  [BIGGER]: parse(BIGGER),
  [NEAR]: parse(NEAR),
  [EDIBLE]: parse(EDIBLE),
};
// Precompute the lit core + nucleus tints once, not per-frame.
const CORE = {};
const NUCLEUS = {};
const MEMBRANE = {};
for (const c of [PLAYER, BIGGER, NEAR, EDIBLE]) {
  CORE[c] = toward(RGB[c], 0.6);
  NUCLEUS[c] = darker(RGB[c], 0.32);
  MEMBRANE[c] = toward(RGB[c], 0.45);
}

export class Cell extends Mover {
  constructor(x, y, radius) {
    super();
    if (x !== undefined) this.x_pos = x;
    if (y !== undefined) this.y_pos = y;
    if (radius !== undefined) this.radius = radius;
    this.dead = false;
    // Per-cell phase so each membrane wobbles independently.
    this.seed = Math.random() * TAU;
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }

  update(frame_delta) {
    if (!this.dead) super.update(frame_delta);
  }

  // Trace the organic (wobbling) membrane outline into the current path.
  _membrane(ctx, cx, cy, r, time) {
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const w =
        1 +
        0.05 * Math.sin(a * 3 + this.seed + time * 1.6) +
        0.03 * Math.sin(a * 5 - this.seed * 1.7 + time * 1.1);
      const rr = r * w;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // player_radius is omitted for the player itself, so it keeps its own color.
  draw(ctx, cam, shadow, player_radius, time = 0) {
    if (this.dead) return;

    const vx = cam.world_to_viewport_x(this.x_pos);
    const vy = cam.world_to_viewport_y(this.y_pos);
    const r = this.radius * cam.scale;
    if (r <= 0.5) return;

    const isPlayer = player_radius === undefined;
    let color = PLAYER;
    if (!isPlayer) {
      if (this.radius > player_radius) color = BIGGER;
      else if (player_radius - this.radius < 3) color = NEAR;
      else color = EDIBLE;
    }

    // Soft cast shadow on the slide.
    if (shadow) {
      ctx.fillStyle = "rgba(0,18,38,0.22)";
      this._membrane(ctx, vx + 1.5, vy + 3, r, time);
      ctx.fill();
    }

    // Glow halo — player only (one expensive blur pass per frame).
    if (isPlayer) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = rgba(RGB[color], 0.9);
      this._membrane(ctx, vx, vy, r, time);
      ctx.fill();
      ctx.restore();
    }

    // Translucent cytoplasm — lit core fading to a soft membrane edge.
    const body = ctx.createRadialGradient(
      vx - r * 0.35,
      vy - r * 0.35,
      r * 0.1,
      vx,
      vy,
      r,
    );
    body.addColorStop(0, rgba(CORE[color], isPlayer ? 0.95 : 0.88));
    body.addColorStop(0.65, rgba(RGB[color], isPlayer ? 0.85 : 0.74));
    body.addColorStop(1, rgba(RGB[color], isPlayer ? 0.7 : 0.52));
    ctx.fillStyle = body;
    this._membrane(ctx, vx, vy, r, time);
    ctx.fill();

    // Membrane rim.
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = rgba(MEMBRANE[color], isPlayer ? 0.8 : 0.55);
    this._membrane(ctx, vx, vy, r, time);
    ctx.stroke();

    if (r < 5) return; // too small to bother with internals

    // Nucleus — a denser blob that drifts slowly inside the cell.
    const na = this.seed + time * 0.4;
    const noff = r * 0.16;
    const ncx = vx + Math.cos(na) * noff;
    const ncy = vy + Math.sin(na) * noff;
    const nr = r * 0.34;
    const nuc = ctx.createRadialGradient(
      ncx - nr * 0.3,
      ncy - nr * 0.3,
      nr * 0.1,
      ncx,
      ncy,
      nr,
    );
    nuc.addColorStop(0, rgba(RGB[color], 0.5));
    nuc.addColorStop(1, rgba(NUCLEUS[color], 0.55));
    ctx.fillStyle = nuc;
    ctx.beginPath();
    ctx.arc(ncx, ncy, nr, 0, TAU);
    ctx.fill();

    // A vacuole highlight on larger cells.
    if (r > 16) {
      ctx.fillStyle = rgba(CORE[color], 0.5);
      ctx.beginPath();
      ctx.arc(vx + r * 0.32, vy - r * 0.28, r * 0.12, 0, TAU);
      ctx.fill();
    }
  }
}
