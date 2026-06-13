import { Mover } from "./Mover.js";
import { drawGlyph, ITEM_INFO } from "./Species.js";

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
    this.seed = Math.random() * TAU; // per-cell wobble phase
    this.heading = Math.random() * TAU; // for rods / flagella, follows velocity
    this.species = null; // set for NPC cells by World; player stays plain
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }

  update(frame_delta) {
    if (!this.dead) super.update(frame_delta);
  }

  // Trace the (possibly elongated/spiky) wobbling membrane into the current
  // path, around the pre-translated local origin, oriented along `heading`.
  _trace(ctx, ox, oy, r, time, shape, heading) {
    const N = shape === "spiky" ? 22 : 18;
    const ch = Math.cos(heading),
      sh = Math.sin(heading);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      let w;
      if (shape === "spiky")
        w =
          1 +
          0.14 * Math.sin(a * 7 + this.seed) +
          0.04 * Math.sin(a * 3 + time * 1.4 + this.seed);
      else
        w =
          1 +
          0.05 * Math.sin(a * 3 + this.seed + time * 1.6) +
          0.03 * Math.sin(a * 5 - this.seed * 1.7 + time * 1.1);
      let rx = Math.cos(a) * r * w;
      let ry = Math.sin(a) * r * w;
      if (shape === "rod") {
        rx *= 1.55;
        ry *= 0.62;
      }
      const x = ox + rx * ch - ry * sh;
      const y = oy + rx * sh + ry * ch;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  _nucleus(ctx, x, y, nr, color) {
    const g = ctx.createRadialGradient(
      x - nr * 0.3,
      y - nr * 0.3,
      nr * 0.1,
      x,
      y,
      nr,
    );
    g.addColorStop(0, rgba(RGB[color], 0.5));
    g.addColorStop(1, rgba(NUCLEUS[color], 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, nr, 0, TAU);
    ctx.fill();
  }

  // player_radius is omitted for the player itself, so it keeps its own color.
  draw(ctx, cam, shadow, player_radius, time = 0) {
    if (this.dead) return;

    const vx = cam.world_to_viewport_x(this.x_pos);
    const vy = cam.world_to_viewport_y(this.y_pos);
    const r = this.radius * cam.scale;
    if (r <= 0.5) return;

    const m = r * 2 + 30;
    if (vx < -m || vx > cam.viewW + m || vy < -m || vy > cam.viewH + m) return;

    const isPlayer = player_radius === undefined;
    let color = PLAYER;
    if (!isPlayer) {
      if (this.radius > player_radius) color = BIGGER;
      else if (player_radius - this.radius < 3) color = NEAR;
      else color = EDIBLE;
    }

    const sp = this.species;
    const shape = sp ? sp.shape : "blob";
    if (this.x_veloc * this.x_veloc + this.y_veloc * this.y_veloc > 0.0025)
      this.heading = Math.atan2(this.y_veloc, this.x_veloc);
    const heading = this.heading;

    ctx.save();
    ctx.translate(vx, vy);

    // Flagellum tail (behind the body).
    if (sp && sp.flagellum && r >= 4) {
      const baseA = heading + Math.PI;
      const ca = Math.cos(baseA),
        sa = Math.sin(baseA);
      const pa = baseA + Math.PI / 2;
      const cpa = Math.cos(pa),
        spa = Math.sin(pa);
      const len = r * 2.4;
      ctx.strokeStyle = rgba(MEMBRANE[color], 0.5);
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const along = len * t;
        const wob = Math.sin(t * 6 - time * 8 + sp.phase) * r * 0.45 * t;
        const x = ca * along + cpa * wob;
        const y = sa * along + spa * wob;
        s ? ctx.lineTo(x, y) : ctx.moveTo(ca * r * 0.7, sa * r * 0.7);
      }
      ctx.stroke();
    }

    // Soft cast shadow.
    if (shadow) {
      this._trace(ctx, 1.5, 3, r, time, shape, heading);
      ctx.fillStyle = "rgba(0,18,38,0.22)";
      ctx.fill();
    }

    // Player glow halo — a radial gradient behind the body (much cheaper than a
    // per-frame shadowBlur pass).
    if (isPlayer) {
      const gr = r * 2.4;
      const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, gr);
      halo.addColorStop(0, rgba(RGB[color], 0.5));
      halo.addColorStop(1, rgba(RGB[color], 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, TAU);
      ctx.fill();
    }

    // An item-bearing cell glows with the item's color.
    if (sp && sp.item && r >= 5) {
      const ic = parse(ITEM_INFO[sp.item].color);
      const gr = r * 1.9;
      const halo = ctx.createRadialGradient(0, 0, r * 0.65, 0, 0, gr);
      halo.addColorStop(
        0,
        rgba(ic, 0.4 + 0.12 * Math.sin(time * 3 + this.seed)),
      );
      halo.addColorStop(1, rgba(ic, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, TAU);
      ctx.fill();
    }

    // Cilia hairs — drawn behind the body so they peek out under the rim.
    if (sp && sp.cilia && r >= 4) {
      ctx.strokeStyle = rgba(MEMBRANE[color], 0.5);
      ctx.lineWidth = Math.max(0.6, r * 0.045);
      const H = 18;
      for (let i = 0; i < H; i++) {
        const a = (i / H) * TAU;
        const wob = Math.sin(a * 3 + time * 4 + this.seed) * 0.3;
        const oa = a + wob;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
        ctx.lineTo(Math.cos(oa) * r * 1.33, Math.sin(oa) * r * 1.33);
        ctx.stroke();
      }
    }

    // Body path — reused for fill and membrane stroke.
    this._trace(ctx, 0, 0, r, time, shape, heading);

    const ext = shape === "rod" ? 1.5 : 1;
    const body = ctx.createRadialGradient(
      -r * 0.35 * ext,
      -r * 0.35,
      r * 0.1,
      0,
      0,
      r * ext,
    );
    body.addColorStop(0, rgba(CORE[color], isPlayer ? 0.95 : 0.88));
    body.addColorStop(0.65, rgba(RGB[color], isPlayer ? 0.85 : 0.74));
    body.addColorStop(1, rgba(RGB[color], isPlayer ? 0.7 : 0.52));
    ctx.fillStyle = body;
    ctx.fill();

    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.strokeStyle = rgba(MEMBRANE[color], isPlayer ? 0.8 : 0.55);
    ctx.stroke();

    if (r >= 5) {
      if (sp && sp.item && r >= 7) {
        // Opaque item inclusion — a solid colored organelle sitting inside the
        // translucent cytoplasm, with a dark glyph for contrast.
        const info = ITEM_INFO[sp.item];
        const ic = parse(info.color);
        const ir = r * 0.5;
        const incl = ctx.createRadialGradient(
          -ir * 0.3,
          -ir * 0.3,
          ir * 0.1,
          0,
          0,
          ir,
        );
        incl.addColorStop(0, rgba(toward(ic, 0.35), 0.97));
        incl.addColorStop(1, rgba(ic, 0.8));
        ctx.fillStyle = incl;
        ctx.beginPath();
        ctx.arc(0, 0, ir, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(toward(ic, 0.5), 0.9);
        ctx.lineWidth = Math.max(0.6, ir * 0.08);
        ctx.stroke();
        drawGlyph(ctx, info.glyph, ir * 0.62, "rgba(6,16,28,0.92)");
      } else if (shape === "segmented") {
        const ch = Math.cos(heading),
          sh = Math.sin(heading);
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * r * 0.44;
          this._nucleus(ctx, ch * off, sh * off, r * 0.24, color);
        }
      } else {
        const na = this.seed + time * 0.4;
        const noff = r * 0.16;
        this._nucleus(
          ctx,
          Math.cos(na) * noff,
          Math.sin(na) * noff,
          r * 0.34,
          color,
        );
      }

      if (r > 16 && shape !== "segmented" && !(sp && sp.item)) {
        ctx.fillStyle = rgba(CORE[color], 0.5);
        ctx.beginPath();
        ctx.arc(r * 0.32, -r * 0.28, r * 0.12, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}
