// UI wiring test with a tiny DOM stub. Guards the iOS-audio regression: the
// "Begin playing" button must invoke onPlay() SYNCHRONOUSLY inside the click
// (so audio unlocks within the user gesture) — not via the async wa-after-hide.
import { Chrome } from "../Source/UI/Chrome.js";

function makeEl() {
  const handlers = {};
  const set = new Set();
  const el = {
    open: false,
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
  muted = 0,
  closedSync = false;
const chrome = new Chrome({
  onPlay: () => played++,
  onMute: () => muted++,
});
const dialog = els["help-dialog"];

// Click "Begin playing" — onPlay must have fired synchronously by the time
// dispatch returns, and the dialog must be commanded closed.
els["play-btn"].dispatch("click");
if (played === 1) closedSync = true;
ok(closedSync, "play-btn calls onPlay synchronously within the click");
ok(dialog.open === false, "play-btn closes the dialog");

// Mute button forwards to onMute.
els["mute-btn"].dispatch("click");
ok(muted === 1, "mute-btn calls onMute");

// setMuted swaps the icon classes.
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
console.log("UI check passed (play-btn sync gesture + mute wiring).");
