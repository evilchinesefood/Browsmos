// View layer: the control buttons, the help dialog, and the four message
// overlays. Holds no game state — it just renders and forwards clicks via the
// handlers passed in.
const MSG_KINDS = ["paused", "death", "warning", "success"];

export class Chrome {
  constructor(handlers = {}) {
    this.h = handlers;
    this.dialog = document.getElementById("help-dialog");
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
    // Start synchronously here (inside the click gesture) so audio unlocks on
    // iOS/Safari. wa-after-hide fires AFTER the async hide animation — too late
    // for the autoplay policy — so it only handles the dismiss/resume path.
    click("play-btn", () => {
      this.h.onPlay?.();
      this.closeHelp();
    });

    // Paused resumes on click; the others restart the level.
    this.messages.paused?.addEventListener("click", () => this.h.onResume?.());
    for (const kind of ["death", "warning", "success"])
      this.messages[kind]?.addEventListener("click", () =>
        this.h.onRestart?.(),
      );

    // Fires for the × button, Escape, backdrop, and our play button alike.
    this.dialog?.addEventListener("wa-after-hide", (e) => {
      if (e.target === this.dialog) this.h.onHelpClosed?.();
    });
  }

  showMessage(kind) {
    for (const k of MSG_KINDS)
      this.messages[k]?.classList.toggle("visible", k === kind);
  }

  clearMessages() {
    for (const k of MSG_KINDS) this.messages[k]?.classList.remove("visible");
  }

  openHelp() {
    if (this.dialog) this.dialog.open = true;
  }
  closeHelp() {
    if (this.dialog) this.dialog.open = false;
  }

  setMuted(muted) {
    if (!this.muteIcon) return;
    this.muteIcon.classList.toggle("fa-volume-high", !muted);
    this.muteIcon.classList.toggle("fa-volume-xmark", muted);
  }
}
