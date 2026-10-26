// bin/lib/console/item-resolution.js — the one sanctioned post-execution rewrite
// of a single console.json item (#4170). An `unattended` console resolves a
// Queue-writes item to `apply` before the write runs; when that write then
// fails, the stored `apply` is a lie that hides the item from console-residue.
// This rewrites it to `keep-staged` (an unresolved resolution the residue
// reader already surfaces), recording what it replaced and when.
//
// Consumed by bin/console-resolve.js's `--set-item` shape. Run-dir anchoring is
// the caller's job (resolveTarget). The read-modify-write runs under
// withLock(<dir>/.console.lock) — the same lock bin/console-residue.js's ack
// takes — and lands via writeFileAtomic. Only this CLI's own auto-resolve shape
// (`mode: 'auto-resolve'`) is ever rewritten; a PR-rendered console is refused.
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { withLock } = require('../file-lock');

const CONSOLE_LOCK = '.console.lock';
// target resolution -> the stored resolutions it may replace.
const REWRITE_FROM = Object.freeze({ 'keep-staged': Object.freeze(['apply']) });

// { consolePath, id, resolution, reason, at } ->
//   { status: 'rewrote', from, item } | { status: 'unchanged', item } | { status: 'refused', why }
// Throws when the write fails.
function rewriteItemResolution({ consolePath, id, resolution, reason, at }) {
  return withLock(path.join(path.dirname(consolePath), CONSOLE_LOCK), () => {
    let raw;
    try { raw = fs.readFileSync(consolePath, 'utf8'); } catch { return { status: 'refused', why: 'no console.json' }; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { status: 'refused', why: 'console.json does not parse as JSON' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'refused', why: 'console.json is not a JSON object' };
    if (parsed.mode !== 'auto-resolve') return { status: 'refused', why: 'console.json is not an auto-resolved console (mode is not auto-resolve)' };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const matches = items.filter((i) => i && i.id === id);
    if (matches.length === 0) return { status: 'refused', why: `console.json holds no item ${id}` };
    if (matches.length > 1) return { status: 'refused', why: `console.json holds ${matches.length} items with id ${id}` };
    const item = matches[0];
    if (item.resolution === resolution) return { status: 'unchanged', item };
    const allowed = REWRITE_FROM[resolution] || [];
    if (!allowed.includes(item.resolution)) return { status: 'refused', why: `item ${id} is ${item.resolution}, not rewritable to ${resolution} (only ${allowed.join('/') || 'nothing'} → ${resolution})` };
    const from = item.resolution;
    const rewritten = { ...item, resolution, reason, rewrittenFrom: from, rewrittenAt: at };
    const { residueAcknowledgedAt, ...rest } = parsed;
    writeFileAtomic(consolePath, `${JSON.stringify({ ...rest, items: items.map((i) => (i === item ? rewritten : i)) }, null, 2)}\n`);
    return { status: 'rewrote', from, item: rewritten };
  });
}

module.exports = { CONSOLE_LOCK, REWRITE_FROM, rewriteItemResolution };
