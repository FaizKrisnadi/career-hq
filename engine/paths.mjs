#!/usr/bin/env node
// Emit the engine's machine paths as JSON. Reads engine/.paths.json when
// present (gitignored — real absolute paths); otherwise falls back to
// paths.example.json with $HOME expanded. Used by workflow scripts via
// world.run so no personal paths are hardcoded in workflow code.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function expand(s) {
  return String(s ?? "").replace(/^\$HOME/, homedir());
}

let raw;
try {
  raw = readFileSync(join(here, ".paths.json"), "utf8");
} catch {
  raw = readFileSync(join(here, "paths.example.json"), "utf8");
}
const cfg = JSON.parse(raw);
const out = {};
for (const [k, v] of Object.entries(cfg)) {
  if (typeof v === "string") out[k] = expand(v);
  else if (v && typeof v === "object") {
    out[k] = {};
    for (const [k2, v2] of Object.entries(v)) out[k][k2] = expand(v2);
  } else out[k] = v;
}
console.log(JSON.stringify(out, null, 2));
