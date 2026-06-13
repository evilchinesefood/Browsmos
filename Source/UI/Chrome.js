// View layer: the control buttons, the help/intro overlay, and the four message
// overlays. Holds no game state — it renders and forwards clicks via the
// handlers passed in. The help overlay is plain DOM (not a web component) so it
// shows and hides reliably regardless of Web Awesome's upgrade timing.
const MSG_KINDS = ["paused", "death", "warning", "success"];

export class Chrome {
  constructor(handlers = {}) {
    this.h = handlers;
    this.overlay = document.getElementById("help-overlay");
    this.muteIcon = document.querySelector("#mute-btn i");

    this.messages = {};
    for (const kind of MSG_KINDS)
      this.messages[kind] = document.getElementById("msg-" + kind);

    this._bind();
  }

  _bind() {
    const click = (id, fn) =>
      document.getElementById(id)?.addEventListener("click", fn);

    click("help-btn", () => this.h.onHelpOpen?.());
    click("pause-btn", () => this.h.onPause?.());
    click("newlevel-btn", () => this.h.onNewLevel?.());
    click("mute-btn", () => this.h.onMute?.());

    // "Begin playing" starts synchronously (so audio unlocks in the gesture),
    // then closes. Clicking the dim backdrop does the same.
    click("play-btn", () => {
      this.h.onPlay?.();
      this.closeHelp();
    });
    this.overlay?.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.h.onPlay?.();
        this.closeHelp();
      }
    });

    // Paused resumes on click; the others restart the level.
    this.messages.paused?.addEventListener("click", () => this.h.onResume?.());
    for (const kind of ["death", "warning", "success"])
      this.messages[kind]?.addEventListener("click", () =>
        this.h.onRestart?.(),
      );
  }

  get isHelpOpen() {
    return !!this.overlay?.classList.contains("visible");
  }

  openHelp() {
    this.overlay?.classList.add("visible");
  }

  closeHelp() {
    if (!this.isHelpOpen) return;
    this.overlay.classList.remove("visible");
    this.h.onHelpClosed?.();
  }

  showMessage(kind) {
    for (const k of MSG_KINDS)
      this.messages[k]?.classList.toggle("visible", k === kind);
  }

  clearMessages() {
    for (const k of MSG_KINDS) this.messages[k]?.classList.remove("visible");
  }

  setMuted(muted) {
    if (!this.muteIcon) return;
    this.muteIcon.classList.toggle("fa-volume-high", !muted);
    this.muteIcon.classList.toggle("fa-volume-xmark", muted);
  }
}
