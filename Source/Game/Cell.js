import { Mover } from "./Mover.js";

// Cell colors, keyed to size relative to the player.
const PLAYER = "#73DBFF"; // the player cell
const BIGGER = "#FF441A"; // will eat you — flee
const NEAR = "#FFAF00"; // close to your size
const EDIBLE = "#36B6FF"; // smaller than you — absorb

// Lighten a #rrggbb toward white by t (0..1), for the gradient core.
function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * t);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// Precompute the lit core for each color once — avoids per-cell, per-frame
// parseInt + string building in the render loop.
const CORE = {
  [PLAYER]: lighten(PLAYER, 0.45),
  [BIGGER]: lighten(BIGGER, 0.45),
  [NEAR]: lighten(NEAR, 0.45),
  [EDIBLE]: lighten(EDIBLE, 0.45),
};

export class Cell extends Mover {
  constructor(x, y, radius) {
    super();
    if (x !== undefined) this.x_pos = x;
    if (y !== undefined) this.y_pos = y;
    if (radius !== undefined) this.radius = radius;
    this.dead = false;
  }

  area() {
    return Math.PI * this.radius * this.radius;
  }

  update(frame_delta) {
    if (!this.dead) super.update(frame_delta);
  }

  // player_radius is omitted for the player itself, so it keeps its own color.
  draw(ctx, cam, shadow, player_radius) {
    if (this.dead) return;

    const vx = cam.world_to_viewport_x(this.x_pos);
    const vy = cam.world_to_viewport_y(this.y_pos);
    const r = this.radius * cam.scale;
    if (r <= 0) return;

    if (shadow) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.arc(vx + 1, vy + 3, r, 0, Math.PI * 2);
      ctx.fill();
    }

    let color = PLAYER;
    if (player_radius !== undefined) {
      if (this.radius > player_radius) color = BIGGER;
      else if (player_radius - this.radius < 3) color = NEAR;
      else color = EDIBLE;
    }

    // Glow halo only for the player — it's the focal cell and there's just one,
    // so the (expensive) shadowBlur cost stays at one pass per frame. Threats
    // read clearly enough from the red gradient body alone.
    if (player_radius === undefined) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(vx, vy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Radial gradient body: lit core fading to the base color at the rim.
    const grad = ctx.createRadialGradient(
      vx - r * 0.3,
      vy - r * 0.3,
      r * 0.1,
      vx,
      vy,
      r,
    );
    grad.addColorStop(0, CORE[color]);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(vx, vy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
