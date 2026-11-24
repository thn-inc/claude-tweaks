// plugin/bin/lib/learned-skills/rebuild.js — rebuilds conflicting learned-skills PRs on the integration tip (#6113).
//
// `resolveDiff3` is the pure part: it resolves the double-append conflicts in `git merge-file --diff3` output
// (ours = integration side, theirs = the PR) by keeping ours first and the PR's new lines after, and renumbers
// a numbered list both sides extended. Anything else — a changed line, an empty side, a hunk inside a list — refuses.
'use strict';

const MARKER_SIZE = 32;

const ITEM = /^(\s*)(\d+)([.)])(\s)/;

const stripCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

function isMarker(line, ch) {
  const text = stripCr(line);
  const run = ch.repeat(MARKER_SIZE);
  return text === run || text.startsWith(run + ' ');
}

const itemOf = (line) => {
  const m = ITEM.exec(stripCr(line));
  return m ? { indent: m[1].length, number: Number(m[2]) } : null;
};

// Renumbers the list items inside one resolved range `[start, end)` of `out`; false means a mid-list hunk.
function renumberRange(out, start, end) {
  let first = null;
  for (let i = start; i < end; i++) {
    const it = itemOf(out[i]);
    if (it) { first = it; break; }
  }
  if (!first) return true;
  const indent = first.indent;
  const items = [];
  for (let i = start; i < end; i++) {
    const it = itemOf(out[i]);
    if (it && it.indent === indent) items.push({ index: i, number: it.number });
  }

  let prev = null;
  for (let i = start - 1; i >= 0; i--) {
    const text = stripCr(out[i]);
    if (text.trim() === '') continue;
    const it = itemOf(out[i]);
    if (it && it.indent === indent) { prev = it.number; break; }
    if (!it && text.length - text.trimStart().length > indent) continue;
    if (it && it.indent > indent) continue;
    break;
  }
  const from = prev !== null ? prev + 1 : items[0].number;

  for (let i = end; i < out.length; i++) {
    if (stripCr(out[i]).trim() === '') continue;
    const it = itemOf(out[i]);
    if (it && it.indent === indent) return false;
    break;
  }

  items.forEach((item, n) => {
    if (item.number === from + n) return;
    out[item.index] = out[item.index].replace(/^(\s*)\d+/, (m, ws) => ws + String(from + n));
  });
  return true;
}

function resolveDiff3(text) {
  const lines = String(text).split('\n');
  const out = [];
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMarker(lines[i], '<')) { out.push(lines[i]); continue; }
    const ours = [];
    const base = [];
    const theirs = [];
    let target = ours;
    let closed = false;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (target === ours && isMarker(line, '|')) target = base;
      else if (target === base && isMarker(line, '=')) target = theirs;
      else if (target === theirs && isMarker(line, '>')) { closed = true; break; }
      else target.push(line);
    }
    if (!closed || target !== theirs || base.length > 0 || ours.length === 0 || theirs.length === 0) return { ok: false };
    const start = out.length;
    const have = new Set(ours.map(stripCr));
    out.push(...ours, ...theirs.filter((l) => !have.has(stripCr(l))));
    ranges.push([start, out.length]);
  }
  for (const [start, end] of ranges) {
    if (!renumberRange(out, start, end)) return { ok: false };
  }
  return { ok: true, text: out.join('\n') };
}

module.exports = { MARKER_SIZE, resolveDiff3 };
