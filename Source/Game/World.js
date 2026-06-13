import { Cell } from "./Cell.js";

const FPS = 30;
const MSPF = 1000 / FPS;
const MAX_DELTA = 4; // cap a stall (tab refocus, GC) so physics can't explode

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
    this.surr_color = "#1D40B5"; // outside the pond
    this.bg_color = "#2450E4"; // inside the pond
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
  }

  // First dismissal of the help screen. The board is already live (load_level
  // ran at boot, animating behind the dialog), so just flag started + play.
  start() {
    if (this.has_started) return;
    this.has_started = true;
    this.music.play_song();
  }

  load_level() {
    this.cells = [];
    this.user_did_zoom = false;
    this.won = false;
    this.ui.clearMessages();

    // Player is always cell 0, at the origin.
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
      cell.x_veloc = (Math.random() - 0.5) * 0.35;
      cell.y_veloc = (Math.random() - 0.5) * 0.35;
      this.cells.push(cell);
    }

    // Center on the player/pond (both at the origin). The original used
    // level_width/2 here, which was a latent offset bug.
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

  // Scale 1x reads best when the player radius is ~40px.
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

    const area = player.area();
    const fx = dx * (5 / 9);
    const fy = dy * (5 / 9);
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

  // A viewport click/tap propels the player (ignored while paused).
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
    const mass_exchange = overlap * smaller.area() * this.frame_delta;

    smaller.radius -= mass_exchange / (2 * Math.PI * smaller.radius);
    bigger.radius += mass_exchange / (2 * Math.PI * bigger.radius);

    if (bigger === player && !this.user_did_zoom) this.zoom_to_player();

    if (smaller.radius <= 1) {
      smaller.dead = true;
      if (smaller === player) this.player_did_die();
    }
  }

  player_did_die() {
    this.music.play_sound("death");
    this.ui.showMessage("death");

    // Collapse the player to the origin and pull every cell gently inward.
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
    // Pull it back just inside the wall, then reflect its velocity.
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

  // One frame: integrate physics, resolve collisions, render, track the camera.
  update(now) {
    if (this._lastTick === 0) this._lastTick = now;
    this.frame_delta = Math.min((now - this._lastTick) / MSPF, MAX_DELTA);
    this._lastTick = now;

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

    // Surrounding fill, then the pond disc (with a soft drop shadow).
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = this.surr_color;
    ctx.fillRect(0, 0, cssW, cssH);

    const px = cam.world_to_viewport_x(0);
    const py = cam.world_to_viewport_y(0);
    const pr = Math.abs(this.level_radius * cam.scale);
    ctx.fillStyle = this.bg_color;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    if (this.shadows) {
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + 2, py + 4, pr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.stroke();

    const player = this.get_player();
    let smallest_big_mass = Infinity;
    let total_usable_mass = 0;

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

        const area = cell.area();
        if (cell.radius > player.radius)
          smallest_big_mass = Math.min(smallest_big_mass, area);
        else total_usable_mass += area;

        if (this._bounceOffBoundary(cell) && i === 0)
          this.music.play_sound("bounce");
      }

      if (i !== 0) cell.draw(ctx, cam, this.shadows, player.radius);
    }

    if (!player.dead && !this.paused && !this.won) {
      if (smallest_big_mass === Infinity) this.player_did_win();
      else if (total_usable_mass < smallest_big_mass)
        this.ui.showMessage("warning");
    }

    player.draw(ctx, cam, this.shadows);
    cam.update(player.x_pos, player.y_pos, this.frame_delta);
    this.music.update(this.frame_delta);
  }
}
