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

const TIDY = path.join(ROOT, 'plugin', 'skills', 'tidy');

function read(file) {
  return fs.readFileSync(path.join(TIDY, file), 'utf8').replace(/\r\n/g, '\n');
}

function rowStartingWith(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

test('/tidy keeps a plan a repo file still cites, naming the citing file, at scan and at pre-delete re-verify (#3101 AC2)', () => {
  const scan = read('scan-procedures.md');
  const step4 = scan.slice(scan.indexOf('## Step 4: Audit Execution Plans'), scan.indexOf('Also glob `docs/plans/*-ledger.md`'));
  assert.match(step4, /basename/, 'Step 4 must grep for the plan basename');
  assert.match(step4, /excluding `docs\/superpowers\/plans\/` and `\.claude-tweaks\/`/);
  assert.match(step4, /Keep \(cited by \{file\}\)/, 'Step 4 must name the citing file in its Keep');
  assert.match(step4, /git -C "\{REPO_ROOT\}" grep -lF -- '\{basename\}' -- ':!docs\/superpowers\/plans\/' ':!\.claude-tweaks\/'/, 'Step 4 must name the tracked-files-only git grep');
  assert.match(step4, /Yours \(\{N\}\)/, 'Step 4 must route a cited Keep to Yours');
  assert.match(step4, /Auto \(no-op, always surfaced\)/);
  const routing = read('collection-routing.md');
  const planRow = rowStartingWith(routing, '| `[backlog]`, `[parked]`');
  assert.ok(planRow, 'collection-routing.md Approve row not found');
  assert.match(planRow, /`\[plan\]` cited-Keep[^.]*\*\*Yours \(\{N\}\)\*\*/, 'a cited [plan] Keep must land in Yours');
  const auto = read('step-6-auto.md');
  const row = rowStartingWith(auto, '| **Delete** (marked-as-specified design docs');
  assert.ok(row, 'step-6-auto.md auto-apply Delete row not found');
  assert.match(row, /no repo file cites the plan's basename/, 'pre-delete re-verify must re-run the citation grep');
  const judgment = rowStartingWith(auto, '| **Delete** (any case requiring judgment');
  assert.ok(judgment, 'judgment Delete row not found');
  assert.match(judgment, /cites the plan's basename/, 'judgment Delete row must re-verify the citation check too');
  const keepRow = rowStartingWith(auto, '| **Keep (cited plan)**');
  assert.ok(keepRow, 'routing table must map a cited-plan Keep');
  assert.match(keepRow, /Auto \(no-op, always surfaced\)/);
});
