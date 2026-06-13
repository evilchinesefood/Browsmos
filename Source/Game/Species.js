// Cell variety + collectible "spell" items.
//
// Each non-player cell gets a Species: a body shape, optional appendages
// (cilia / flagellum), a behavior (drift or hunter), and sometimes a contained
// item that activates when the player absorbs the cell.

const SHAPES = ["blob", "blob", "blob", "rod", "spiky", "segmented"];
const TAU = Math.PI * 2;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Weighted item roll. Shrink (the only hazard) is deliberately rare so it
// doesn't punish absorbing an item-cell 1-in-4 of the time.
function rollItem() {
  if (Math.random() >= 0.22) return null;
  const r = Math.random();
  if (r < 0.1) return "shrink";
  if (r < 0.4) return "grow";
  if (r < 0.7) return "speed";
  return "magnet";
}

export const ITEM_INFO = {
  grow: { color: "#5cff8a", glyph: "up", label: "Growth", secs: 9 },
  speed: { color: "#5ce0ff", glyph: "bolt", label: "Speed", secs: 9 },
  magnet: { color: "#c98aff", glyph: "magnet", label: "Magnet", secs: 9 },
  shrink: { color: "#ff6a6a", glyph: "down", label: "Shrink", secs: 0 },
};

export function makeSpecies() {
  const cilia = Math.random() < 0.35;
  return {
    shape: pick(SHAPES),
    cilia,
    flagellum: !cilia && Math.random() < 0.4,
    behavior: Math.random() < 0.32 ? "hunter" : "drift",
    item: rollItem(),
    sight: 110 + Math.random() * 90,
    phase: Math.random() * TAU,
  };
}

// Draw a small power-up glyph around the current (translated) origin, size s.
// Shared by the in-cell item marker and the on-screen buff HUD.
export function drawGlyph(ctx, glyph, s, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, s * 0.22);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (glyph) {
    case "up":
    case "down": {
      const d = glyph === "up" ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(0, d * s);
      ctx.lineTo(-s * 0.8, -d * s * 0.45);
      ctx.lineTo(s * 0.8, -d * s * 0.45);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "bolt": {
      ctx.beginPath();
      ctx.moveTo(s * 0.25, -s);
      ctx.lineTo(-s * 0.55, s * 0.1);
      ctx.lineTo(-s * 0.05, s * 0.1);
      ctx.lineTo(-s * 0.25, s);
      ctx.lineTo(s * 0.55, -s * 0.1);
      ctx.lineTo(s * 0.05, -s * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "magnet": {
      ctx.beginPath();
      ctx.arc(0, -s * 0.1, s * 0.7, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 0.1);
      ctx.lineTo(-s * 0.7, s * 0.7);
      ctx.moveTo(s * 0.7, -s * 0.1);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.stroke();
      break;
    }
  }
}
