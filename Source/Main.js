import { Camera } from "./Game/Camera.js";
import { MusicPlayer } from "./Game/MusicPlayer.js";
import { World } from "./Game/World.js";
import { Chrome } from "./UI/Chrome.js";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Song-info readout (fades in on track change, then idles out).
const songInfo = document.getElementById("song-info");
const songTitle = document.getElementById("song-title");
const songArtist = document.getElementById("song-artist");
let songFadeTimer;

const cam = new Camera();

const music = new MusicPlayer({
  onSong: ({ title, artist }) => {
    if (!songInfo) return;
    songTitle.textContent = title;
    songArtist.textContent = artist;
    songInfo.classList.add("featured");
    clearTimeout(songFadeTimer);
    songFadeTimer = setTimeout(
      () => songInfo.classList.remove("featured"),
      2000,
    );
  },
  onMute: (muted) => chromeUI.setMuted(muted),
});

const chromeUI = new Chrome({
  onHelpOpen: () => {
    if (world.has_started) world.pause(true);
    chromeUI.openHelp();
  },
  onHelpClosed: () => {
    if (!world.has_started) world.start();
    else if (world.paused) world.pause(); // resume
  },
  // "Begin playing" — runs inside the click gesture so audio can unlock.
  onPlay: () => world.start(),
  onPause: () => world.pause(),
  onNewLevel: () => world.load_level(),
  onMute: () => music.mute(),
  onResume: () => world.pause(),
  onRestart: () => world.load_level(),
});

const world = new World({ canvas, ctx, cam, music, ui: chromeUI });

music.init();
chromeUI.setMuted(music.muted); // make the icon authoritative, not assumed
world.load_level(); // a live board animates behind the help overlay (shown via HTML)

// --- Input ---------------------------------------------------------------
let audioPrimed = false;
canvas.addEventListener(
  "pointerdown",
  (e) => {
    e.preventDefault();
    // First in-game tap is a user gesture — ensure music is going even if the
    // overlay was dismissed via Escape/backdrop (which can't unlock audio on iOS).
    if (!audioPrimed) {
      audioPrimed = true;
      music.play_song();
    }
    const rect = canvas.getBoundingClientRect();
    world.click_at_point(e.clientX - rect.left, e.clientY - rect.top);
  },
  { passive: false },
);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    world.zoom(e.deltaY);
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (chromeUI.isHelpOpen) {
    if (k === "escape" || k === "h") chromeUI.closeHelp();
    return; // the overlay owns input while it's up
  }
  switch (k) {
    case "p":
      world.pause();
      break;
    case "r":
      world.load_level();
      break;
    case "h":
      chromeUI.h.onHelpOpen();
      break;
    case "m":
      music.mute();
      break;
    case "n":
      music.next_song();
      break;
    case "s":
      world.shadows = !world.shadows;
      break;
    case "d":
      world.debug = !world.debug;
      break;
  }
});

window.addEventListener("blur", () => {
  if (world.has_started) world.pause(true);
});

// --- Loop ----------------------------------------------------------------
// Lock to a steady ~60 fps. The gate (1000/65) is just under a 60 Hz frame so
// 60 Hz displays never skip, while high-refresh displays are capped to ~60.
const MIN_FRAME_MS = 1000 / 65;
let lastFrameTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastFrameTime < MIN_FRAME_MS) return;
  lastFrameTime = now;
  world.update(now);
}
requestAnimationFrame(frame);

// --- PWA -----------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL("../ServiceWorker.js", import.meta.url))
      .catch(() => {});
  });
}
