// UI wiring test with a tiny DOM stub. Guards the iOS-audio regression: the
// "Begin playing" button must invoke onPlay() SYNCHRONOUSLY inside the click
// (so audio unlocks within the user gesture), and the help overlay must close.
import { Chrome } from "../Source/UI/Chrome.js";

function makeEl() {
  const handlers = {};
  const set = new Set();
  const el = {
    addEventListener(type, fn) {
      (handlers[type] ||= []).push(fn);
    },
    dispatch(type) {
      (handlers[type] || []).forEach((fn) => fn({ target: el }));
    },
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, f) => {
        const on = f === undefined ? !set.has(c) : f;
        on ? set.add(c) : set.delete(c);
        return on;
      },
    },
  };
  return el;
}

const els = {};
const muteIcon = makeEl();
globalThis.document = {
  getElementById: (id) => (els[id] ||= makeEl()),
  querySelector: (sel) => (sel === "#mute-btn i" ? muteIcon : null),
};

const fail = [];
const ok = (c, m) => {
  if (!c) fail.push(m);
};

let played = 0,
  closed = 0,
  muted = 0;
const chrome = new Chrome({
  onPlay: () => played++,
  onHelpClosed: () => closed++,
  onMute: () => muted++,
});
const overlay = els["help-overlay"];
overlay.classList.add("visible"); // intro is showing

// Click "Begin playing": onPlay must fire synchronously, the overlay must close,
// and onHelpClosed must run — all within the click.
els["play-btn"].dispatch("click");
ok(played === 1, "play-btn calls onPlay synchronously within the click");
ok(!overlay.classList.contains("visible"), "play-btn closes the help overlay");
ok(closed === 1, "play-btn fires onHelpClosed");

// Mute button forwards to onMute and the icon swaps.
els["mute-btn"].dispatch("click");
ok(muted === 1, "mute-btn calls onMute");

chrome.setMuted(true);
ok(
  muteIcon.classList.contains("fa-volume-xmark") &&
    !muteIcon.classList.contains("fa-volume-high"),
  "setMuted(true) shows the muted icon",
);
chrome.setMuted(false);
ok(
  muteIcon.classList.contains("fa-volume-high") &&
    !muteIcon.classList.contains("fa-volume-xmark"),
  "setMuted(false) shows the unmuted icon",
);

if (fail.length) {
  console.error("UI check FAILED:\n  " + fail.join("\n  "));
  process.exit(1);
}
console.log("UI check passed (play-btn sync gesture + overlay close + mute).");
