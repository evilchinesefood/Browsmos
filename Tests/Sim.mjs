// Headless simulation smoke test: stub just enough of the browser to drive the
// real World for many frames, then assert the physics stays finite and the core
// interactions (click-to-propel, zoom, absorb, win/lose) don't throw. No deps.
import { World } from "../Source/Game/World.js";
import { Camera } from "../Source/Game/Camera.js";

// Minimal canvas 2D context — every call is a no-op, gradients are stubs.
const gradient = { addColorStop() {} };
const ctx = new Proxy(
  { createRadialGradient: () => gradient },
  {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: () => true,
  },
);
const canvas = { width: 0, height: 0, clientWidth: 800, clientHeight: 600 };

globalThis.window = { devicePixelRatio: 2, innerWidth: 800, innerHeight: 600 };

const calls = [];
const music = new Proxy(
  {},
  {
    get:
      (_t, k) =>
      (...a) =>
        calls.push([k, ...a]),
  },
);
const messages = [];
const ui = {
  showMessage: (k) => messages.push(k),
  clearMessages: () => {},
};

const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};
const finite = (n) => typeof n === "number" && Number.isFinite(n);

const cam = new Camera();
const world = new World({ canvas, ctx, cam, music, ui });
world.load_level();

ok(world.get_player() !== undefined, "player exists after load_level");
ok(world.cells.length === 31, `expected 31 cells, got ${world.cells.length}`);

// Drive ~20 simulated seconds at 30fps, nudging the player around.
let t = 0;
for (let i = 0; i < 600; i++) {
  t += 1000 / 30;
  if (i % 30 === 0) world.click_at_point(400 + (i % 7) * 10, 300);
  if (i === 100) world.zoom(-1);
  if (i === 200) world.zoom(1);
  world.update(t);

  const p = world.get_player();
  if (!finite(p.x_pos) || !finite(p.y_pos) || !finite(p.radius)) {
    fail.push(`non-finite player state at frame ${i}`);
    break;
  }
  // No live cell should ever escape the pond by more than a hair.
  for (const c of world.cells) {
    if (c.dead) continue;
    if (Math.hypot(c.x_pos, c.y_pos) - c.radius > world.level_radius + 5) {
      fail.push(`cell escaped boundary at frame ${i}`);
      break;
    }
  }
}

ok(finite(cam.scale) && cam.scale > 0, "camera scale stays positive/finite");
ok(canvas.width === 1600, `DPR backing store width (got ${canvas.width})`);

// Giant frame gap (tab refocus / GC stall): the frame_delta clamp must keep
// everything finite instead of teleporting cells.
world.update((t += 5_000_000));
{
  const p = world.get_player();
  ok(
    finite(p.x_pos) && finite(p.y_pos) && finite(p.radius),
    "player stays finite after a multi-second frame gap (frame_delta clamp)",
  );
}

// Death path: collapse the player and confirm it reports a death message.
world.get_player().radius = 0.5;
world.transfer_mass(world.get_player(), world.cells[1]);
world.update((t += 33));
ok(world.get_player().dead, "player dies when radius drops below 1");
ok(messages.includes("death"), "death message shown");

// Win path: clear the board so the player is the largest, then tick.
const fresh = new World({ canvas, ctx, cam, music, ui });
fresh.load_level();
for (let i = 1; i < fresh.cells.length; i++) fresh.cells[i].dead = true;
fresh.update((t += 33));
ok(fresh.won, "player wins when no larger cell remains");

if (fail.length) {
  console.error("Sim check FAILED:\n  " + fail.join("\n  "));
  process.exit(1);
}
console.log("Sim check passed (600 frames, win + death paths exercised).");
