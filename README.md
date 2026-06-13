# Browsmos

An ambient cell-eating game for the browser, inspired by [Osmos](https://www.hemispheregames.com/osmos/). Absorb cells smaller than you to grow; avoid the bigger ones. Become the biggest cell in the pond and you win.

**Play:** https://dev.jdayers.com/osmosis

Originally written in 2014 by Stephen Eisenhauer; rebuilt in 2026 as a buildless ES-module PWA.

## Controls

- **Click / tap** any side of your cell to propel yourself the opposite way (you shed a little mass each push).
- **Scroll / pinch** to zoom.
- **R** new random level · **P** pause · **M** mute · **H** help.

## Tech

Buildless — no bundler, no framework. Open `Index.html` on any static host.

- **Vanilla JS ES modules** + HTML5 Canvas 2D for the game.
- **[Web Awesome](https://webawesome.com) v3** (vendored) for the help dialog and control buttons.
- **Font Awesome 7 Pro Duotone** (vendored) for the control icons.
- **PWA** — installable and playable offline (`Manifest.webmanifest` + `ServiceWorker.js`).

<details>
<summary><strong>Project structure</strong></summary>

```
Index.html              Entry point
Manifest.webmanifest    PWA manifest
ServiceWorker.js        Offline cache (network-first for code, cache-first for assets)
.htaccess               Apache static-host config (MIME, CSP, SW no-cache)
Source/
  Main.js               Bootstrap: wiring, input, the rAF loop, SW registration
  Game/                 Mover, Cell, Species, Camera, World, MusicPlayer
  UI/Chrome.js          Control buttons, help overlay, message overlays
  Styles/               Reset, Theme, Game
  Assets/               Icons, logo, fonts, audio (Fx + Music)
  Vendor/               Web Awesome + Font Awesome (vendored, do not edit)
Tests/                  Structure, Sim (headless physics), Ui (DOM-stub wiring)
```

</details>

<details>
<summary><strong>Develop</strong></summary>

```bash
npm test          # structure integrity + headless sim + UI wiring
npm run format    # Prettier

# serve locally (any static server), e.g.:
npx serve .       # then open the printed URL
```

`Tests/Structure.mjs` enforces that every `Source/*.js` is listed in the service worker shell, so add new modules to both.

</details>

## Credits

- Game design and original code by [Stephen Eisenhauer](https://stepheneisenhauer.com).
- Inspired by [Osmos](https://www.hemispheregames.com/osmos/) by Hemisphere Games — buy it, it's wonderful.
- Music from the [ccMixter](https://ccmixter.org) community: "Black Rainbow" by Pitx and "Circles" by rewob.
