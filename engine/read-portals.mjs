#!/usr/bin/env node
// Minimal YAML-subset reader for career-ops portals.yml → JSON on stdout.
// Supports the shapes this file uses: nested maps, string lists, scalars.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const path = process.argv[2] ?? join(homedir(), "Documents/Codex/2026-09-16/sh/career-ops-data/portals.yml");
const lines = readFileSync(path, "utf8").split("\n");

function parseBlock(idx, indent) {
  const obj = {};
  let list = null;
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const cur = line.length - line.trimStart().length;
    if (cur < indent) break;
    if (cur > indent) { i++; continue; } // deeper nesting handled recursively below
    const t = line.trim();
    if (t.startsWith("- ")) {
      if (list === null) list = [];
      list.push(t.slice(2).trim().replace(/^['"]|['"]$/g, ""));
      i++;
      continue;
    }
    const m = t.match(/^([^:]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1].trim();
    const rest = m[2].trim();
    if (rest === "") {
      // nested block or list
      let j = i + 1;
      let childIndent = null;
      let childIsList = false;
      while (j < lines.length) {
        const l2 = lines[j];
        if (!l2.trim() || l2.trim().startsWith("#")) { j++; continue; }
        childIndent = l2.length - l2.trimStart().length;
        childIsList = l2.trim().startsWith("- ");
        break;
      }
      if (childIndent !== null && childIndent > indent) {
        if (childIsList) {
          const [val, next] = parseBlock(i + 1, childIndent);
          obj[key] = val.__list ?? [];
          i = next;
          continue;
        }
        const [val, next] = parseBlock(i + 1, childIndent);
        obj[key] = val;
        i = next;
        continue;
      }
      obj[key] = null;
      i++;
      continue;
    }
    if (list !== null) { obj.__list = list; list = null; }
    obj[key] = rest.replace(/^['"]|['"]$/g, "");
    i++;
  }
  if (list !== null) obj.__list = list;
  const out = { ...obj };
  if (out.__list !== undefined) {
    // pure list block: represent as { __list }
  }
  return [out, i];
}

function clean(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    if (v.__list !== undefined && Object.keys(v).length === 1) return v.__list;
    const o = {};
    for (const [k, val] of Object.entries(v)) if (k !== "__list") o[k] = clean(val);
    return o;
  }
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function listAt(idx, indent) {
  const items = [];
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const cur = line.length - line.trimStart().length;
    if (cur !== indent || !line.trim().startsWith("- ")) break;
    items.push(line.trim().slice(2).trim().replace(/^['"]|['"]$/g, ""));
    i++;
  }
  return [items, i];
}

// top-level walk (handles nested lists explicitly)
const result = {};
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
  const indent = line.length - line.trimStart().length;
  if (indent !== 0) { i++; continue; }
  const t = line.trim();
  if (t.startsWith("- ")) { i++; continue; }
  const m = t.match(/^([^:]+):\s*(.*)$/);
  if (!m) { i++; continue; }
  const key = m[1].trim();
  const rest = m[2].trim();
  if (rest !== "") {
    result[key] = rest.replace(/^['"]|['"]$/g, "");
    i++;
    continue;
  }
  // find first non-empty child line
  let j = i + 1;
  let childIndent = null;
  let childIsList = false;
  while (j < lines.length) {
    const l2 = lines[j];
    if (!l2.trim() || l2.trim().startsWith("#")) { j++; continue; }
    childIndent = l2.length - l2.trimStart().length;
    childIsList = l2.trim().startsWith("- ");
    break;
  }
  if (childIndent === null) { result[key] = null; i++; continue; }
  if (childIsList) {
    const [items, next] = listAt(j, childIndent);
    result[key] = items;
    i = next;
    continue;
  }
  const [sub, next] = parseBlock(j, childIndent);
  result[key] = clean(sub);
  i = next;
}

console.log(JSON.stringify(result, null, 2));
