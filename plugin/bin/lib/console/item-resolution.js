// bin/lib/console/item-resolution.js — the one sanctioned post-execution rewrite
// of a single console.json item (#4170). An `unattended` console resolves a
// Queue-writes item to `apply` before the write runs; when that write then
// fails, the stored `apply` is a lie that hides the item from console-residue.
// This rewrites it to `keep-staged` (an unresolved resolution the residue
// reader already surfaces), recording what it replaced and when. A Reference-repairs
// `approve` whose staged diff no longer applies at Phase 4 goes to `pending` the same way (#4636);
// that rewrite is refused for an `approve` item in any other section.
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
const REWRITE_FROM = Object.freeze({ 'keep-staged': Object.freeze(['apply']), pending: Object.freeze(['approve']) });
// `carried` (#4620, control mode): a failed execution or a can't-tell filing whose create failed (`filed`)
// moves to the acceptance packet instead of back to residue. Its own table, not a REWRITE_FROM key, so the
// original table stays byte-equal for the suites that pin it; REWRITE_TARGETS is every rewritable resolution.
const CARRIED_RESOLUTION = 'carried';
const CARRY_REWRITE_FROM = Object.freeze(['apply', 'approve', 'filed']);
const REWRITE_TARGETS = Object.freeze([...Object.keys(REWRITE_FROM), CARRIED_RESOLUTION]);
// target resolution -> the one console section whose items it may replace (absent: any section).
const REWRITE_ONLY_IN = Object.freeze({ pending: 'Reference repairs' });

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
    const allowed = resolution === CARRIED_RESOLUTION ? CARRY_REWRITE_FROM : REWRITE_FROM[resolution] || [];
    if (!allowed.includes(item.resolution)) return { status: 'refused', why: `item ${id} is ${item.resolution}, not rewritable to ${resolution} (only ${allowed.join('/') || 'nothing'} → ${resolution})` };
    const onlyIn = REWRITE_ONLY_IN[resolution];
    if (onlyIn && item.section !== onlyIn) return { status: 'refused', why: `item ${id} is in section ${item.section}, not rewritable to ${resolution} (only a ${onlyIn} item)` };
    const from = item.resolution;
    const rewritten = { ...item, resolution, reason, rewrittenFrom: from, rewrittenAt: at };
    const { residueAcknowledgedAt, ...rest } = parsed;
    writeFileAtomic(consolePath, `${JSON.stringify({ ...rest, items: items.map((i) => (i === item ? rewritten : i)) }, null, 2)}\n`);
    return { status: 'rewrote', from, item: rewritten };
  });
}

module.exports = { CONSOLE_LOCK, REWRITE_FROM, CARRY_REWRITE_FROM, REWRITE_TARGETS, REWRITE_ONLY_IN, rewriteItemResolution };
