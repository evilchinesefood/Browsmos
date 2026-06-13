// Buildless integrity checks — no browser, no deps. Guards the wiring that
// silently breaks an offline/static deploy:
//   1. every first-party Source/*.js is precached in the service worker
//   2. every asset Index.html references actually exists
//   3. every relative import inside Source resolves on disk
//   4. every Manifest icon exists
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const check = (cond, msg) => {
  if (!cond) fail.push(msg);
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "Vendor") continue;
      walk(p, out);
    } else out.push(p);
  }
}

// --- 1. Service worker shell covers every first-party module ---------------
const sw = readFileSync(join(ROOT, "ServiceWorker.js"), "utf8");
const shellBlock = sw.match(/SHELL_FIRST_PARTY = \[([\s\S]*?)\]/)[1];
const shell = [...shellBlock.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
const shellSet = new Set(shell);

const srcFiles = [];
walk(join(ROOT, "Source"), srcFiles);
for (const abs of srcFiles) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  if (rel.endsWith(".js") && !rel.startsWith("Source/Vendor/"))
    check(shellSet.has(rel), `SW shell missing first-party module: ${rel}`);
}
for (const rel of shell)
  check(existsSync(join(ROOT, rel)), `SW shell lists a missing file: ${rel}`);

// --- 2. Index.html asset references resolve --------------------------------
const html = readFileSync(join(ROOT, "Index.html"), "utf8");
for (const m of html.matchAll(
  /(?:href|src)="(Source\/[^"]+|Manifest\.webmanifest)"/g,
))
  check(
    existsSync(join(ROOT, m[1])),
    `Index.html references a missing file: ${m[1]}`,
  );

// --- 3. Relative imports inside Source resolve -----------------------------
for (const abs of srcFiles) {
  if (!abs.endsWith(".js")) continue;
  const code = readFileSync(abs, "utf8");
  for (const m of code.matchAll(/(?:import|from)\s+["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(abs), m[1]);
    check(
      existsSync(target),
      `Unresolved import "${m[1]}" in ${relative(ROOT, abs).replace(/\\/g, "/")}`,
    );
  }
  // import.meta.url-relative URLs (the audio dir prefix, the service worker)
  for (const m of code.matchAll(
    /new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url/g,
  )) {
    check(
      existsSync(resolve(dirname(abs), m[1])),
      `Unresolved import.meta.url asset "${m[1]}" in ${relative(ROOT, abs).replace(/\\/g, "/")}`,
    );
  }
}

// --- 4. Manifest icons exist ----------------------------------------------
const manifest = JSON.parse(
  readFileSync(join(ROOT, "Manifest.webmanifest"), "utf8"),
);
for (const icon of manifest.icons) {
  const rel = icon.src.replace(/^\.\//, "");
  check(existsSync(join(ROOT, rel)), `Manifest icon missing: ${icon.src}`);
}

if (fail.length) {
  console.error("Structure check FAILED:\n  " + fail.join("\n  "));
  process.exit(1);
}
console.log(
  `Structure check passed (${srcFiles.length} source files, ${shell.length} shell entries).`,
);
