// tests/plan-citations-resolve.test.js — #3101.
//
// A repo file outside docs/superpowers/plans/ that names a docs/superpowers/plans/*.md path must
// either name a plan that exists or annotate the citation with the commit that deleted it
// (`(deleted \`{sha}\`)` and its existing variants, on the citation line or the next one). #3097's
// tidy sweep deleted two cited plans and left store.js and ADR 0021 pointing at nothing.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// tests/ is excluded: its plan paths are synthetic fixture data, not citations.
const SCAN_ROOTS = ['plugin', 'docs', path.join('.claude', 'skills')];
const SKIP_DIRS = new Set([path.join('docs', 'superpowers', 'plans'), 'node_modules']);
const CITATION = /docs\/superpowers\/plans\/[A-Za-z0-9._-]+\.md/g;
const DELETED = /deleted[^0-9a-f\n]{0,20}[0-9a-f]{7,40}/;

function walk(rel, out) {
  if (SKIP_DIRS.has(rel)) return;
  let entries;
  try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const child = path.join(rel, e.name);
    if (e.isDirectory()) walk(child, out);
    else if (/\.(md|js|ya?ml)$/.test(e.name)) out.push(child);
  }
}

function danglingCitations() {
  const files = [];
  for (const r of SCAN_ROOTS) walk(r, files);
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.md')) files.push(f);
  const dangling = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(CITATION)) {
        if (fs.existsSync(path.join(ROOT, m[0]))) continue;
        if (DELETED.test(line.slice(m.index)) || DELETED.test(lines[i + 1] || '')) continue;
        dangling.push(`${f}:${i + 1} ${m[0]}`);
      }
    });
  }
  return dangling;
}

test('no file outside docs/superpowers/plans/ cites a deleted plan without its deletion commit (#3101 AC1)', () => {
  assert.deepEqual(danglingCitations(), []);
});
