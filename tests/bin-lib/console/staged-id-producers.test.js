'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyStagedItem, stagingExemption } = require('../../../plugin/bin/lib/console/resolve');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');

// Every id a producer hands `stage-item.js` / `writeStagedItem` either maps in
// the Review Console's SECTION_MAP (classifyStagedItem names a reason other than
// `unmapped-prefix`) or sits on its documented staging exemption list. A producer
// that does neither lands in Pending review as `unmapped-prefix`, which
// stage-item.js warns about (#3488). The scan reads the producers from the
// skills' command lines and the bin modules' in-process calls, so a new producer
// with an unmapped prefix fails here instead of at a Review Console.
const REPO = path.join(__dirname, '..', '..', '..');
const SKILLS_ROOT = path.join(REPO, 'plugin', 'skills');
const BIN_ROOT = path.join(REPO, 'plugin', 'bin');

// Ids built entirely at run time (an empty static head) name the prefix their
// call site documents; a dynamic call site missing from this map fails the scan.
const DYNAMIC_ID_PREFIXES = { 'plugin/skills/tidy/step-6-auto.md': 'tidy-' };

// `<kind>-<n>` in this file is a usage synopsis, not a producer.
const SYNOPSIS_FILES = new Set(['plugin/skills/_shared/auto-decision-log.md']);
// The CLI forwards the caller's --id to writeStagedItem; the staging lib is the API.
const BIN_SKIP = (rel) => rel === 'plugin/bin/stage-item.js' || rel.startsWith('plugin/bin/lib/stage-item/');

function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(REPO, file).replace(/\\/g, '/');

// The id text before its first `{`, `$` or `<` (a placeholder or interpolation).
function staticHead(id) {
  return id.split(/[{$<]/)[0];
}

// -> [{ file, id }] for every same-line `stage-item.js ... --id <token>` (quoted or bare,
// `--id x` or `--id=x`) in one skill file's text.
function collectMdProducers(text, file) {
  if (SYNOPSIS_FILES.has(file)) return [];
  const out = [];
  const re = /stage-item\.js\b[^\n]*?--id[= ]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`]+))/g;
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(re)) {
      const id = m[1] ?? m[2] ?? m[3];
      // `<kind>-<n>` placeholders in usage text carry no static head and are not call sites.
      if (/^<[^>]*>/.test(id)) continue;
      out.push({ file, id });
    }
  }
  return out;
}

// Text between the open bracket at `open` and its matching close.
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

// -> [{ file, id }] for every `writeStagedItem(` / `deps.writeStagedItem(` call in one bin
// file, comments stripped. The id is the call's `id: \`…\`` / `id: '…'` literal anywhere in
// its argument span; a call without one, or a stripper mis-parse, yields `id: null` + `problem`.
function collectBinProducers(raw, file) {
  if (!/writeStagedItem/.test(raw)) return [];
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  if (verdict !== 'ok') return [{ file, id: null, problem: STRIPPER_VERDICT_MESSAGES[verdict] }];
  const out = [];
  for (const m of src.matchAll(/(?<![\w$])(?:[\w$]+\.)?writeStagedItem\s*\(/g)) {
    if (/function\s*$/.test(src.slice(Math.max(0, m.index - 9), m.index))) continue;
    const args = balanced(src, m.index + m[0].length - 1);
    const lit = /(?<![\w$])id\s*:\s*(?:`([^`]*)`|'([^'\n]*)'|"([^"\n]*)")/.exec(args);
    if (lit) out.push({ file, id: lit[1] ?? lit[2] ?? lit[3] });
    else out.push({ file, id: null, problem: 'writeStagedItem call carries no literal `id:`' });
  }
  return out;
}

// Throws naming the file when a fully dynamic id has no documented prefix.
function checkDynamicIds(producers) {
  for (const p of producers) {
    if (p.id === null) continue;
    if (staticHead(p.id) === '' && !(p.file in DYNAMIC_ID_PREFIXES)) {
      throw new Error(`${p.file}: --id ${JSON.stringify(p.id)} is fully dynamic — add its documented prefix to DYNAMIC_ID_PREFIXES`);
    }
  }
}

function headOf(p) {
  return staticHead(p.id) || DYNAMIC_ID_PREFIXES[p.file];
}

function collectProducers() {
  const producers = [];
  for (const f of walk(SKILLS_ROOT, '.md')) producers.push(...collectMdProducers(fs.readFileSync(f, 'utf8'), rel(f)));
  for (const f of walk(BIN_ROOT, '.js')) {
    if (BIN_SKIP(rel(f))) continue;
    producers.push(...collectBinProducers(fs.readFileSync(f, 'utf8'), rel(f)));
  }
  checkDynamicIds(producers);
  return producers;
}

function assertProducerDisposition(producers) {
  for (const p of producers) {
    if (p.id === null) throw new Error(`${p.file}: ${p.problem}`);
    const head = headOf(p);
    const probe = head.endsWith('-') ? head + '1' : head;
    const mapped = classifyStagedItem(probe + '.md').reason !== 'unmapped-prefix';
    if (!mapped && stagingExemption(probe) === null) {
      throw new Error(`${p.file}: --id ${p.id} (probe ${probe}) classifies unmapped-prefix and is not on STAGING_EXEMPTIONS — map it in resolve.js's SECTION_MAP or exempt it with a reason`);
    }
  }
}

test("Deliverable 4: every staging producer's id is mapped or exempt", () => {
  assertProducerDisposition(collectProducers());
});

test('the scan finds the known producers (matcher floor)', () => {
  const producers = collectProducers();
  assert.ok(producers.length >= 14, `found only ${producers.length} producers`);
  const heads = new Set(producers.map(headOf));
  for (const h of ['release-held', 'dispatch-target-missing-', 'shipped-close-', 'upstream-draft-',
    'premise-satisfied-', 'dream-proposal-', 'flaky-allowlist-']) {
    // dream-scan.js passes the literal 'dream-proposal-1', so match by prefix.
    assert.ok([...heads].some((x) => x.startsWith(h)), `producer head ${h} not found — the matcher lost a call shape`);
  }
});

test('go-red control: an unmapped, non-exempt producer id is reported', () => {
  assert.throws(() => assertProducerDisposition([{ file: 'x.md', id: 'review-13-record' }]),
    /x\.md.*review-13-record/);
  assert.doesNotThrow(() => assertProducerDisposition([{ file: 'x.md', id: 'tidy-1' }]));
});

test('matcher controls: --id= form, bare tokens, bin object-literal span, placeholders', () => {
  assert.deepEqual(collectMdProducers('run stage-item.js --run r --id=foo-{n} --file f', 'a.md'), [{ file: 'a.md', id: 'foo-{n}' }]);
  assert.deepEqual(collectMdProducers('x/stage-item.js --id bar-{n} --file f', 'a.md'), [{ file: 'a.md', id: 'bar-{n}' }]);
  assert.deepEqual(collectMdProducers('stage-item.js --run <run-dir> --id <kind>-<n> --file <path>', 'a.md'), []);
  const bin = [
    "const x = deps.writeStagedItem({",
    "  runDir, // id: 'in-a-comment-1'",
    "  sourcePath: 'n.md', id: `late-${n}`,",
    "});",
  ].join('\n');
  assert.deepEqual(collectBinProducers(bin, 'b.js'), [{ file: 'b.js', id: 'late-${n}' }]);
  assert.equal(collectBinProducers('writeStagedItem({ runDir, id: someVar });', 'b.js')[0].id, null);
  assert.equal(collectBinProducers("const s = '/*'; // ok\nwriteStagedItem({ id: 'z-1' });", 'b.js')[0].id, 'z-1');
});

test('control: a new fully dynamic --id call site outside DYNAMIC_ID_PREFIXES fails the dynamic-id check', () => {
  const fixture = 'node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id "{x}" --file "{p}"';
  assert.throws(() => checkDynamicIds(collectMdProducers(fixture, 'plugin/skills/new/step.md')),
    /plugin\/skills\/new\/step\.md/);
  assert.doesNotThrow(() => checkDynamicIds(collectMdProducers(fixture, 'plugin/skills/tidy/step-6-auto.md')));
});
