import { Cell } from "./Cell.js";
import { makeSpecies, ITEM_INFO, drawGlyph } from "./Species.js";

const FPS = 30;
const MSPF = 1000 / FPS;
const MAX_DELTA = 4; // cap a stall (tab refocus, GC) so physics can't explode
const TAU = Math.PI * 2;

// Angle of the vector (x, y), normalized to [0, 2π). Used for wall bounces.
function angleForVector(x, y) {
  let ang = Math.atan(y / x);
  if (x < 0) ang += Math.PI;
  else if (y < 0) ang += 2 * Math.PI;
  return ang;
}

export class World {
  constructor({ canvas, ctx, cam, music, ui }) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.cam = cam;
    this.music = music;
    this.ui = ui;

    this.cells = [];
    this.level_radius = 500;
    this.level_total_mass = 0;

    this.won = false;
    this.paused = false;
    this.has_started = false;
    this.user_did_zoom = false; // disables auto-zoom once the player scrolls
    this.shadows = true;
    this.debug = false;

    this._lastTick = 0;
    this.frame_delta = 1;

    // Active power-up timers (seconds remaining). Shrink is instant, not timed.
    this.effects = { grow: 0, speed: 0, magnet: 0 };

    // Background life + edible morsels (both persist across levels).
    this.particles = this._initParticles();
    this.morsels = this._initMorsels();

    this._hunters = []; // refilled in place each frame (no per-frame alloc)
    this.fx = []; // transient morsel-eaten pops
    this._lastEatT = -1; // throttles the eat sound
    // Cached screen-space gradients (rebuilt only on viewport resize).
    this._gradW = 0;
    this._gradH = 0;
    this._surround = null;
    this._vignette = null;
  }

  _randPond(f = 0.97) {
    const ang = Math.random() * TAU;
    const rad = Math.sqrt(Math.random()) * this.level_radius * f;
    return [Math.cos(ang) * rad, Math.sin(ang) * rad];
  }

  _initMorsels() {
    const M = [];
    for (let i = 0; i < 55; i++) {
      const [x, y] = this._randPond(0.95);
      M.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 0.05,
        vy: (Math.random() - 0.5) * 0.05,
        r: 2 + Math.random() * 1.8,
        hue: Math.random() < 0.5 ? "#9fffd0" : "#ffe08a",
        phase: Math.random() * TAU,
      });
    }
    return M;
  }

  _respawnMorsel(mo) {
    const [x, y] = this._randPond(0.9);
    mo.x = x;
    mo.y = y;
    mo.vx = (Math.random() - 0.5) * 0.05;
    mo.vy = (Math.random() - 0.5) * 0.05;
    mo.r = 2 + Math.random() * 1.8;
  }

  // Grow a cell by absorbing a morsel of the given radius (mult > 1 for buffs).
  _growBy(cell, morselR, mult) {
    const add = Math.PI * morselR * morselR * 2 * mult;
    cell.radius = Math.sqrt((cell.area() + add) / Math.PI);
  }

  _initParticles() {
    const P = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const add = (type, count, rMin, rMax, aMin, aMax, sp) => {
      for (let i = 0; i < count; i++) {
        const [x, y] = this._randPond();
        P.push({
          x,
          y,
          vx: rnd(-sp, sp),
          vy: rnd(-sp, sp),
          r: rnd(rMin, rMax),
          a: rnd(aMin, aMax),
          type,
          rot: Math.random() * TAU,
          vrot: rnd(-0.012, 0.012),
        });
      }
    };
    // Out-of-focus background blobs + slow drifting microbes (depth + life).
    add("blob", 10, 16, 46, 0.03, 0.07, 0.03);
    add("microbe", 6, 22, 40, 0.04, 0.08, 0.02);
    // Mid-water debris.
    add("speck", 36, 1.0, 3.2, 0.08, 0.24, 0.06);
    add("rod", 22, 1.4, 4.0, 0.08, 0.22, 0.05);
    add("ring", 14, 2.0, 5.0, 0.07, 0.18, 0.05);
    add("fleck", 18, 1.6, 4.2, 0.08, 0.22, 0.05);
    // Sharp foreground motes.
    add("mote", 46, 0.6, 2.0, 0.12, 0.32, 0.09);
    // Rising bubbles.
    for (let i = 0; i < 22; i++) {
      const [x, y] = this._randPond(0.95);
      P.push({
        x,
        y,
        vx: rnd(-0.02, 0.02),
        vy: -(0.12 + Math.random() * 0.3),
        r: 1.5 + Math.random() * 3,
        a: 0.1 + Math.random() * 0.16,
        type: "bubble",
        rot: 0,
        vrot: 0,
      });
    }
    return P;
  }

  _updateParticles(time) {
    if (this.paused) return;
    const fd = this.frame_delta;
    const R = this.level_radius;
    for (const p of this.particles) {
      if (p.type === "bubble") {
        p.y += p.vy * fd;
        p.x += (p.vx + Math.sin(p.y * 0.05 + time) * 0.03) * fd;
        if (p.y < -R * 0.95) {
          const [x] = this._randPond(0.9);
          p.x = x;
          p.y = R * 0.92;
        }
        continue;
      }
      const fx = Math.sin(p.y * 0.01 + time * 0.3) * 0.02;
      const fy = Math.cos(p.x * 0.011 - time * 0.25) * 0.02;
      p.x += (p.vx + fx) * fd;
      p.y += (p.vy + fy) * fd;
      p.rot += p.vrot * fd;
      if (Math.hypot(p.x, p.y) > R * 0.97) {
        p.vx = -p.vx;
        p.vy = -p.vy;
        p.x *= 0.96;
        p.y *= 0.96;
      }
    }
  }

  _drawParticles(ctx, cam) {
    const W = cam.viewW,
      H = cam.viewH,
      m = 60;
    for (const p of this.particles) {
      const vx = cam.world_to_viewport_x(p.x);
      const vy = cam.world_to_viewport_y(p.y);
      if (vx < -m || vx > W + m || vy < -m || vy > H + m) continue;
      const r = p.r * cam.scale;
      if (r < 0.3) continue;

      switch (p.type) {
        case "microbe": {
          const g = ctx.createRadialGradient(vx, vy, r * 0.2, vx, vy, r);
          g.addColorStop(0, `rgba(120,170,230,${p.a * 1.2})`);
          g.addColorStop(1, "rgba(120,170,230,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(vx, vy, r, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = `rgba(150,190,240,${p.a})`;
          ctx.lineWidth = Math.max(0.5, r * 0.04);
          ctx.beginPath();
          ctx.arc(vx, vy, r * 0.7, 0, TAU);
          ctx.stroke();
          break;
        }
        case "blob": {
          const g = ctx.createRadialGradient(vx, vy, 0, vx, vy, r);
          g.addColorStop(0, `rgba(150,195,255,${p.a})`);
          g.addColorStop(1, "rgba(150,195,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(vx, vy, r, 0, TAU);
          ctx.fill();
          break;
        }
        case "bubble": {
          ctx.strokeStyle = `rgba(210,235,255,${p.a})`;
          ctx.lineWidth = Math.max(0.6, r * 0.18);
          ctx.beginPath();
          ctx.arc(vx, vy, r, 0, TAU);
          ctx.stroke();
          ctx.fillStyle = `rgba(240,250,255,${p.a * 0.9})`;
          ctx.beginPath();
          ctx.arc(vx - r * 0.3, vy - r * 0.3, Math.max(0.5, r * 0.28), 0, TAU);
          ctx.fill();
          break;
        }
        case "ring": {
          ctx.strokeStyle = `rgba(190,220,255,${p.a})`;
          ctx.lineWidth = Math.max(0.5, r * 0.28);
          ctx.beginPath();
          ctx.arc(vx, vy, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case "rod": {
          ctx.save();
          ctx.translate(vx, vy);
          ctx.rotate(p.rot);
          ctx.fillStyle = `rgba(200,222,250,${p.a})`;
          ctx.fillRect(
            -r * 1.5,
            -Math.max(0.4, r * 0.3),
            r * 3,
            Math.max(0.8, r * 0.6),
          );
          ctx.restore();
          break;
        }
        case "fleck": {
          ctx.save();
          ctx.translate(vx, vy);
          ctx.rotate(p.rot);
          ctx.fillStyle = `rgba(195,218,248,${p.a})`;
          ctx.beginPath();
          ctx.moveTo(-r, r * 0.4);
          ctx.lineTo(r, 0);
          ctx.lineTo(-r * 0.6, -r);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        default: {
          // speck / mote
          ctx.fillStyle = `rgba(205,228,255,${p.a})`;
          ctx.beginPath();
          ctx.arc(vx, vy, Math.max(0.5, r), 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  _drawMorsels(ctx, cam, time) {
    const W = cam.viewW,
      H = cam.viewH,
      m = 40;
    for (const mo of this.morsels) {
      const vx = cam.world_to_viewport_x(mo.x);
      const vy = cam.world_to_viewport_y(mo.y);
      if (vx < -m || vx > W + m || vy < -m || vy > H + m) continue;
      const r = mo.r * cam.scale * (0.9 + 0.12 * Math.sin(time * 3 + mo.phase));
      if (r < 0.4) continue;
      // Glowing bead: a saturated body + a bright highlight (no per-morsel
      // gradient — keeps ~55 allocations/frame off the GC).
      ctx.fillStyle = mo.hue;
      ctx.beginPath();
      ctx.arc(vx, vy, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(vx - r * 0.3, vy - r * 0.3, Math.max(0.5, r * 0.45), 0, TAU);
      ctx.fill();
    }
  }

  // First dismissal of the help screen. The board is already live (load_level
  // ran at boot), so just flag started + play.
  start() {
    if (this.has_started) return;
    this.has_started = true;
    this.music.play_song();
  }

  load_level() {
    this.cells = [];
    this.user_did_zoom = false;
    this.won = false;
    this.effects = { grow: 0, speed: 0, magnet: 0 };
    this.ui.clearMessages();

    // Player is always cell 0, at the origin (no species — plain blob).
    this.cells.push(new Cell(0, 0, 10));

    // Scatter 30 cells: a few tiny, a couple large, the rest mixed.
    const num_cells = 30;
    for (let i = 0; i < num_cells; i++) {
      let rad;
      if (i < 4) rad = 5 + Math.random() * 5;
      else if (i < 6) rad = 40 + Math.random() * 15;
      else rad = 7 + Math.random() * 35;
      const ang = Math.random() * 2 * Math.PI;
      const r = Math.random() * (this.level_radius - 20 - rad - rad);
      const x = (30 + rad + r) * Math.sin(ang);
      const y = (30 + rad + r) * Math.cos(ang);
      const cell = new Cell(x, y, rad);
      cell.species = makeSpecies();
      cell.x_veloc = (Math.random() - 0.5) * 0.35;
      cell.y_veloc = (Math.random() - 0.5) * 0.35;
      this.cells.push(cell);
    }

    this.cam.x = 0;
    this.cam.y = 0;
    this.cam.x_target = 0;
    this.cam.y_target = 0;
    this.zoom_to_player();

    this.level_total_mass = this.cells.reduce((sum, c) => sum + c.area(), 0);
  }

  get_player() {
    return this.cells[0];
  }

  zoom_to_player() {
    this.cam.scale_target = 40 / this.get_player().radius;
  }

  zoom(deltaY) {
    this.user_did_zoom = true;
    if (deltaY < 0) this.cam.scale_target *= 1.2;
    else this.cam.scale_target /= 1.2;
  }

  pause(force) {
    if (this.paused && !force) {
      this.paused = false;
      this.music.raise_volume();
      this.ui.clearMessages();
      if (this.won) this.ui.showMessage("success");
      else if (this.get_player()?.dead) this.ui.showMessage("death");
    } else {
      this.paused = true;
      this.music.lower_volume();
      this.ui.showMessage("paused");
    }
  }

  // Propel the player away from world point (x, y), shedding a little mass.
  push_player_from(x, y) {
    const player = this.get_player();
    if (!player || player.dead) return;

    let dx = player.x_pos - x;
    let dy = player.y_pos - y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return;
    dx /= mag;
    dy /= mag;

    const boost = this.effects.speed > 0 ? 1.7 : 1;
    const area = player.area();
    const fx = dx * (5 / 9) * boost;
    const fy = dy * (5 / 9) * boost;
    player.x_veloc += fx;
    player.y_veloc += fy;

    // Lose ~1/25 of our area, expelled as a new cell in the opposite direction.
    const expense = area / 25 / (2 * Math.PI * player.radius);
    player.radius -= expense;
    const newrad = Math.sqrt(area / 20 / Math.PI);
    const newx = player.x_pos - dx * (player.radius + newrad + 1);
    const newy = player.y_pos - dy * (player.radius + newrad + 1);
    const ejecta = new Cell(newx, newy, newrad);
    ejecta.x_veloc = -fx * 9;
    ejecta.y_veloc = -fy * 9;
    this.cells.push(ejecta);

    this.music.play_sound("blip");
  }

  click_at_point(viewX, viewY) {
    if (this.paused) return;
    this.push_player_from(
      this.cam.viewport_to_world_x(viewX),
      this.cam.viewport_to_world_y(viewY),
    );
  }

  // Move mass from the smaller of two overlapping cells into the larger.
  transfer_mass(cell1, cell2) {
    const player = this.get_player();
    let bigger = cell1,
      smaller = cell2;
    if (cell2.radius > cell1.radius) {
      bigger = cell2;
      smaller = cell1;
    }

    let overlap =
      (cell1.radius + cell2.radius - cell1.distance_from(cell2)) /
      (2 * smaller.radius);
    if (overlap > 1) overlap = 1;
    overlap *= overlap;
    let exchange = overlap * smaller.area() * this.frame_delta;
    if (bigger === player && this.effects.grow > 0) exchange *= 1.8;
    exchange = Math.min(exchange, smaller.area());

    smaller.radius -= exchange / (2 * Math.PI * smaller.radius);
    bigger.radius += exchange / (2 * Math.PI * bigger.radius);

    if (bigger === player && !this.user_did_zoom) this.zoom_to_player();

    if (smaller.radius <= 1) {
      smaller.dead = true;
      if (smaller === player) this.player_did_die();
      else if (bigger === player && smaller.species && smaller.species.item) {
        this._activateItem(smaller.species.item);
        smaller.species.item = null;
      }
    }
  }

  _activateItem(type) {
    const player = this.get_player();
    if (type === "shrink") {
      if (player) player.radius *= 0.82;
      this.music.play_sound("death");
    } else {
      this.effects[type] = ITEM_INFO[type].secs;
      this.music.play_sound("blip");
    }
  }

  // Hunter cells steer toward the nearest morsel or smaller cell in sight.
  _runAI(hunters) {
    const fd = this.frame_delta;
    for (const h of hunters) {
      let bx = 0,
        by = 0,
        bestD = h.species.sight,
        found = false;
      for (const mo of this.morsels) {
        const d = Math.hypot(h.x_pos - mo.x, h.y_pos - mo.y);
        if (d < bestD) {
          bestD = d;
          bx = mo.x;
          by = mo.y;
          found = true;
        }
      }
      for (const c of this.cells) {
        if (c === h || c.dead || c.radius >= h.radius * 0.92) continue;
        const d = h.distance_from(c);
        if (d < bestD) {
          bestD = d;
          bx = c.x_pos;
          by = c.y_pos;
          found = true;
        }
      }
      if (found) {
        const dx = bx - h.x_pos,
          dy = by - h.y_pos;
        const d = Math.hypot(dx, dy) || 1;
        h.x_veloc += (dx / d) * 0.06 * fd;
        h.y_veloc += (dy / d) * 0.06 * fd;
      }
    }
  }

  // Drift morsels, apply magnet, and let the player + hunters eat them.
  _updateMorsels(time, hunters) {
    const fd = this.frame_delta;
    const R = this.level_radius;
    const player = this.get_player();
    const magnet = this.effects.magnet > 0 && player && !player.dead;
    for (const mo of this.morsels) {
      mo.x += (mo.vx + Math.sin(mo.y * 0.01 + time * 0.3) * 0.015) * fd;
      mo.y += (mo.vy + Math.cos(mo.x * 0.011 - time * 0.25) * 0.015) * fd;
      if (magnet) {
        const dx = player.x_pos - mo.x,
          dy = player.y_pos - mo.y;
        const d = Math.hypot(dx, dy);
        if (d > 1 && d < 280) {
          mo.x += (dx / d) * 0.9 * fd;
          mo.y += (dy / d) * 0.9 * fd;
        }
      }
      if (Math.hypot(mo.x, mo.y) > R * 0.97) {
        mo.vx = -mo.vx;
        mo.vy = -mo.vy;
        mo.x *= 0.96;
        mo.y *= 0.96;
      }
      if (
        player &&
        !player.dead &&
        Math.hypot(player.x_pos - mo.x, player.y_pos - mo.y) <
          player.radius + mo.r
      ) {
        this._growBy(player, mo.r, this.effects.grow > 0 ? 1.8 : 1);
        this.fx.push({ x: mo.x, y: mo.y, r: mo.r, t: 0 });
        if (time - this._lastEatT > 0.12) {
          this.music.play_sound("blip");
          this._lastEatT = time;
        }
        this._respawnMorsel(mo);
        continue;
      }
      for (const h of hunters) {
        if (Math.hypot(h.x_pos - mo.x, h.y_pos - mo.y) < h.radius + mo.r) {
          this._growBy(h, mo.r, 1);
          this._respawnMorsel(mo);
          break;
        }
      }
    }
  }

  player_did_die() {
    this.music.play_sound("death");
    this.ui.showMessage("death");
    const player = this.get_player();
    player.x_pos = player.y_pos = 0;
    if (this.cam.scale_target > 0.538) this.cam.scale_target = 0.538;
    for (let i = 1; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (!cell.dead) {
        cell.x_veloc += (cell.x_pos - player.x_pos) / 50;
        cell.y_veloc += (cell.y_pos - player.y_pos) / 50;
      }
    }
  }

  player_did_win() {
    if (this.won) return;
    this.won = true;
    this.music.play_sound("win");
    this.ui.showMessage("success");
  }

  // Reflect a cell that has drifted past the circular pond boundary.
  _bounceOffBoundary(cell) {
    const dist = Math.hypot(cell.x_pos, cell.y_pos);
    if (dist + cell.radius <= this.level_radius) return false;

    const xvel = cell.x_veloc,
      yvel = cell.y_veloc;
    const k = (this.level_radius - cell.radius - 1) / dist;
    cell.x_pos *= k;
    cell.y_pos *= k;

    const speed = Math.hypot(xvel, yvel);
    const angle_from_origin = angleForVector(cell.x_pos, cell.y_pos);
    const veloc_ang = angleForVector(xvel, yvel);
    const new_ang =
      Math.PI + angle_from_origin + (angle_from_origin - veloc_ang);
    cell.x_veloc = speed * Math.cos(new_ang);
    cell.y_veloc = speed * Math.sin(new_ang);
    return true;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawBuffs(ctx, cssW) {
    const active = [];
    for (const k of ["grow", "speed", "magnet"])
      if (this.effects[k] > 0)
        active.push([k, this.effects[k] / ITEM_INFO[k].secs]);
    if (!active.length) return;
    const pw = 46,
      ph = 30,
      gap = 8;
    let x = cssW / 2 - (active.length * (pw + gap) - gap) / 2;
    const y = 12;
    for (const [k, frac] of active) {
      const info = ITEM_INFO[k];
      ctx.fillStyle = "rgba(6,18,38,0.72)";
      this._roundRect(ctx, x, y, pw, ph, 8);
      ctx.fill();
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 1;
      this._roundRect(ctx, x, y, pw, ph, 8);
      ctx.stroke();
      ctx.save();
      ctx.translate(x + pw / 2, y + ph / 2 - 3);
      drawGlyph(ctx, info.glyph, 7, info.color);
      ctx.restore();
      ctx.fillStyle = info.color;
      ctx.fillRect(x + 5, y + ph - 6, (pw - 10) * frac, 3);
      x += pw + gap;
    }
  }

  _drawFx(ctx, cam) {
    for (const f of this.fx) {
      const vx = cam.world_to_viewport_x(f.x);
      const vy = cam.world_to_viewport_y(f.y);
      const prog = f.t / 0.4;
      const r = (f.r + f.r * 3 * prog) * cam.scale;
      ctx.strokeStyle = `rgba(180,255,220,${0.6 * (1 - prog)})`;
      ctx.lineWidth = Math.max(0.5, (1 - prog) * 2);
      ctx.beginPath();
      ctx.arc(vx, vy, r, 0, TAU);
      ctx.stroke();
    }
  }

  // Render the microscope field: dark eyepiece surround, illuminated pond,
  // caustics + condenser glow, suspended life, and edible morsels.
  _drawWater(ctx, cam, cssW, cssH, time) {
    if (this._gradW !== cssW || this._gradH !== cssH) {
      this._gradW = cssW;
      this._gradH = cssH;
      const sx = cssW / 2,
        sy = cssH / 2;
      this._surround = ctx.createRadialGradient(
        sx,
        sy,
        0,
        sx,
        sy,
        Math.hypot(cssW, cssH) / 2,
      );
      this._surround.addColorStop(0, "#0a1a2e");
      this._surround.addColorStop(1, "#02060c");
      this._vignette = ctx.createRadialGradient(
        sx,
        sy,
        Math.min(cssW, cssH) * 0.36,
        sx,
        sy,
        Math.max(cssW, cssH) * 0.72,
      );
      this._vignette.addColorStop(0, "rgba(0,0,0,0)");
      this._vignette.addColorStop(1, "rgba(0,0,0,0.45)");
    }
    ctx.fillStyle = this._surround;
    ctx.fillRect(0, 0, cssW, cssH);

    const px = cam.world_to_viewport_x(0);
    const py = cam.world_to_viewport_y(0);
    const pr = Math.abs(this.level_radius * cam.scale);
    if (pr <= 0) return;

    const bloom = ctx.createRadialGradient(px, py, pr * 0.9, px, py, pr * 1.2);
    bloom.addColorStop(0, "rgba(90,160,255,0.32)");
    bloom.addColorStop(1, "rgba(90,160,255,0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(px, py, pr * 1.2, 0, TAU);
    ctx.fill();

    const pond = ctx.createRadialGradient(
      px - pr * 0.2,
      py - pr * 0.25,
      pr * 0.1,
      px,
      py,
      pr,
    );
    pond.addColorStop(0, "#3a6cf0");
    pond.addColorStop(0.6, "#1f49c8");
    pond.addColorStop(1, "#143a8f");
    ctx.fillStyle = pond;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.clip();

    ctx.globalCompositeOperation = "screen";
    const lr = pr * (0.55 + 0.05 * Math.sin(time * 0.4));
    const cond = ctx.createRadialGradient(px, py, 0, px, py, lr);
    cond.addColorStop(0, "rgba(120,180,255,0.12)");
    cond.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = cond;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    for (let i = 0; i < 6; i++) {
      const sc = i < 3 ? 0.5 : 0.28;
      const sp = i < 3 ? 1 : 1.7;
      const ax = px + Math.cos(time * 0.25 * sp + i * 2.1) * pr * 0.5;
      const ay = py + Math.sin(time * 0.21 * sp + i * 1.3) * pr * 0.5;
      const ar = pr * (sc + 0.12 * Math.sin(time * 0.5 + i));
      const cg = ctx.createRadialGradient(ax, ay, 0, ax, ay, ar);
      cg.addColorStop(0, "rgba(150,205,255,0.09)");
      cg.addColorStop(1, "rgba(150,205,255,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    this._drawParticles(ctx, cam);
    this._drawMorsels(ctx, cam, time);

    ctx.restore();

    const inner = ctx.createRadialGradient(px, py, pr * 0.82, px, py, pr);
    inner.addColorStop(0, "rgba(0,10,30,0)");
    inner.addColorStop(1, "rgba(0,8,26,0.4)");
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(212,236,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.stroke();
  }

  // One frame: integrate physics, resolve collisions, render, track the camera.
  update(now) {
    if (this._lastTick === 0) this._lastTick = now;
    this.frame_delta = Math.min((now - this._lastTick) / MSPF, MAX_DELTA);
    this._lastTick = now;
    const time = now / 1000;

    const player0 = this.get_player();
    this._hunters.length = 0;
    if (!this.paused && player0)
      for (const c of this.cells)
        if (!c.dead && c.species && c.species.behavior === "hunter")
          this._hunters.push(c);
    const hunters = this._hunters;

    if (!this.paused) {
      const dt = this.frame_delta / FPS; // seconds
      for (const k of ["grow", "speed", "magnet"])
        if (this.effects[k] > 0)
          this.effects[k] = Math.max(0, this.effects[k] - dt);
      for (let i = this.fx.length - 1; i >= 0; i--) {
        this.fx[i].t += dt;
        if (this.fx[i].t > 0.4) this.fx.splice(i, 1);
      }
      this._runAI(hunters);
      this._updateMorsels(time, hunters);
    }
    this._updateParticles(time);

    const ctx = this.ctx,
      cam = this.cam;
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const bw = Math.round(cssW * dpr),
      bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.set_viewport(cssW, cssH);

    ctx.clearRect(0, 0, cssW, cssH);
    this._drawWater(ctx, cam, cssW, cssH, time);

    // Magnet range cue around the player.
    if (this.effects.magnet > 0 && player0 && !player0.dead) {
      ctx.strokeStyle = "rgba(201,138,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(
        cam.world_to_viewport_x(player0.x_pos),
        cam.world_to_viewport_y(player0.y_pos),
        280 * cam.scale,
        0,
        TAU,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const player = player0;
    let smallest_big_mass = Infinity;

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (cell.dead) continue;

      if (!this.paused) {
        for (let j = 0; j < this.cells.length; j++) {
          if (
            i !== j &&
            !this.cells[j].dead &&
            cell.collides_with(this.cells[j])
          )
            this.transfer_mass(cell, this.cells[j]);
        }
        cell.update(this.frame_delta);

        if (cell.radius > player.radius)
          smallest_big_mass = Math.min(smallest_big_mass, cell.area());

        if (this._bounceOffBoundary(cell) && i === 0)
          this.music.play_sound("bounce");
      }

      if (i !== 0) cell.draw(ctx, cam, this.shadows, player.radius, time);
    }

    if (
      !player.dead &&
      !this.paused &&
      !this.won &&
      smallest_big_mass === Infinity
    )
      this.player_did_win();

    // Remove dead cells + spent ejecta so the O(n^2) loop stays bounded
    // (keep the player pinned at index 0).
    if (!this.paused)
      for (let i = this.cells.length - 1; i >= 1; i--)
        if (this.cells[i].dead) this.cells.splice(i, 1);

    player.draw(ctx, cam, this.shadows, undefined, time);
    cam.update(player.x_pos, player.y_pos, this.frame_delta);

    this._drawFx(ctx, cam);

    // Eyepiece vignette (cached), then the buff HUD on top.
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, cssW, cssH);

    this._drawBuffs(ctx, cssW);

    this.music.update(this.frame_delta);
  }
}
