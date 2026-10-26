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
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
// tests/ is excluded: its plan paths are synthetic fixture data, not citations.
const SCAN_ROOTS = ['plugin', 'docs', path.join('.claude', 'skills')];
const SKIP_DIRS = new Set([path.join('docs', 'superpowers', 'plans'), 'node_modules']);
const CITATION = /docs\/superpowers\/plans\/[A-Za-z0-9._-]+\.md/g;
const DELETED = /deleted[^0-9a-f\n]{0,20}[0-9a-f]{7,40}/;

function walk(rel, out) {
  if (SKIP_DIRS.has(rel)) return;
  let entries;
  try {
    entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true });
  } catch (err) {
    // Only a missing optional root (e.g. .claude/skills) is skippable; anything else would make the invariant pass vacuously.
    if (err.code === 'ENOENT') return;
    throw err;
  }
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
    const lines = readText(path.join(ROOT, f)).split('\n');
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
const WRAP_UP = path.join(ROOT, 'plugin', 'skills', 'wrap-up');

function read(file, dir = TIDY) {
  return readText(path.join(dir, file));
}

function rowStartingWith(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

test('/tidy keeps a plan a repo file still cites, naming the citing file, at scan and at pre-delete re-verify (#3101 AC2)', () => {
  const scan = read('scan-procedures.md');
  const step4 = scan.slice(scan.indexOf('## Step 4: Audit Execution Plans'), scan.indexOf('Also glob `docs/plans/*-ledger.md`'));
  assert.match(step4, /Before any plan Delete:\*\* run `plan-citation-check\.md`/, 'Step 4 must route every plan Delete through the citation check');
  // The rule itself lives in its own sub-file, split out while scan-procedures.md carried a byte cap (retired by #3311).
  const check = read('plan-citation-check.md');
  assert.match(check, /basename/, 'the citation check must grep for the plan basename');
  assert.match(check, /excluding `docs\/superpowers\/plans\/` and `\.claude-tweaks\/`/);
  assert.match(check, /Keep \(cited by \{file\}\)/, 'the citation check must name the citing file in its Keep');
  assert.match(check, /git -C "\{REPO_ROOT\}" grep -lF -- '\{basename\}' -- ':!docs\/superpowers\/plans\/' ':!\.claude-tweaks\/'/, 'the citation check must name the tracked-files-only git grep');
  assert.match(check, /Yours \(\{N\}\)/, 'the citation check must route a cited Keep to Yours');
  assert.match(check, /Auto \(no-op, always surfaced\)/);
  assert.match(check, /Any other non-zero exit means the check could not run/, 'a failed grep must fail closed');
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

test('/wrap-up prune-after-wrapup keeps a plan a repo file still cites, naming the citing file, instead of deleting it (#3109)', () => {
  const cleanup = read('cleanup-procedures.md', WRAP_UP);
  const policy = cleanup.slice(
    cleanup.indexOf("**Item 1's plan-retention policy"),
    cleanup.indexOf("**Item 5's two framings"),
  );
  assert.match(
    policy,
    /before deleting, run the same tracked-files citation check `skills\/tidy\/plan-citation-check\.md` already runs/,
    'prune-after-wrapup must route every plan delete through the same citation check tidy uses, cited rather than restated',
  );
  assert.match(
    policy,
    /keep the plan — never delete it — and stage a `staged\/plan-citation-\{n\}\.md` proposal for the Wrap-Up Review Console naming every citing file/,
    'a cited plan must be kept and staged for the Review Console, naming the citing file',
  );
  assert.match(
    policy,
    /the check itself errors \(any exit other than 0 or 1[^)]*\): keep the plan/,
    'a citation-check error must never fall through to a delete',
  );
});
