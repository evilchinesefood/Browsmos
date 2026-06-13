// Background music + sound effects. Asset URLs resolve relative to this module,
// so the game works at any deploy subpath (e.g. /osmosis/). DOM updates are
// pushed out via onSong / onMute callbacks rather than reaching into the page.
const audioUrl = (rel) =>
  new URL("../Assets/Audio/" + rel, import.meta.url).href;

const TRACKS = [
  { src: "Music/BlackRainbow.ogg", title: "Black Rainbow", artist: "Pitx" },
  { src: "Music/Circles.ogg", title: "Circles", artist: "rewob" },
];
const SFX = {
  blip: "Fx/Blip.ogg",
  win: "Fx/Win.ogg",
  death: "Fx/Death.ogg",
  bounce: "Fx/Bounce.ogg",
};

export class MusicPlayer {
  constructor({ onSong, onMute } = {}) {
    this.default_volume = 0.6;
    this.song_volume = this.default_volume;
    this.current_song = 0;
    this.song_audio = null;
    this.muted = false;
    this.onSong = onSong || (() => {});
    this.onMute = onMute || (() => {});

    // Each effect keeps two clones so rapid repeats can overlap (round-robin).
    this.sounds = {};
    for (const [name, rel] of Object.entries(SFX)) {
      const url = audioUrl(rel);
      this.sounds[name] = { clips: [new Audio(url), new Audio(url)], next: 0 };
    }
  }

  init() {
    this.load_song();
  }

  load_song() {
    const track = TRACKS[this.current_song];
    if (!track) return;
    if (this.song_audio) this.song_audio.pause();
    this.song_audio = new Audio(audioUrl(track.src));
    this.song_audio.volume = this.default_volume;
    this.song_audio.addEventListener("ended", () => this.next_song());
    this.onSong({ title: track.title, artist: track.artist });
  }

  next_song() {
    this.current_song = (this.current_song + 1) % TRACKS.length;
    this.load_song();
    this.play_song();
  }

  play_song() {
    if (this.song_audio && !this.muted) this.song_audio.play().catch(() => {});
  }

  lower_volume() {
    this.song_volume = 0.2;
  }
  raise_volume() {
    this.song_volume = this.default_volume;
  }

  mute() {
    this.muted = !this.muted;
    if (this.muted) this.song_audio?.pause();
    else this.song_audio?.play().catch(() => {});
    this.onMute(this.muted);
  }

  // Play the named sound effect, alternating clips for overlap.
  play_sound(name) {
    if (this.muted) return;
    const fx = this.sounds[name];
    if (!fx) return;
    fx.clips[fx.next].play().catch(() => {});
    fx.next = (fx.next + 1) % fx.clips.length;
  }

  // Ease the music toward the current target volume (called each frame).
  update(frame_delta = 1) {
    if (!this.song_audio || this.song_audio.volume === this.song_volume) return;
    const k = Math.min(0.1 * frame_delta, 1);
    let v =
      this.song_audio.volume + (this.song_volume - this.song_audio.volume) * k;
    if (Math.abs(v - this.song_volume) < 0.005) v = this.song_volume;
    this.song_audio.volume = Math.max(0, Math.min(1, v));
  }
}
