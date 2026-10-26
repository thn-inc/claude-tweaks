'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyStagedItem, stagingExemption, STAGING_EXEMPTIONS } = require('../../../plugin/bin/lib/console/resolve');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');

// Every id a producer hands `stage-item.js` / `writeStagedItem` either maps in
// the Review Console's SECTION_MAP (classifyStagedItem names a reason other than
// `unmapped-prefix`) or sits on its documented staging exemption list. A producer
// that does neither lands in Pending review as `unmapped-prefix`, which
// stage-item.js refuses (#3488, #3946). The scan reads the producers from the
// skills' command lines and the bin modules' in-process calls, so a new producer
// with an unmapped prefix fails here instead of at a Review Console.
const REPO = path.join(__dirname, '..', '..', '..');
const SKILLS_ROOT = path.join(REPO, 'plugin', 'skills');
const BIN_ROOT = path.join(REPO, 'plugin', 'bin');

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

// -> [{ file, id }] for every `--id <token>` (quoted or bare, `--id x` or `--id=x`) in a
// paragraph of one skill file's text that mentions `stage-item.js`. A paragraph is a
// blank-line-separated block, with `\`+newline continuations joined first, so an id on a
// later line of the paragraph (or a wrapped command line) is still a producer; a paragraph
// that never names stage-item.js (`winget install --id …`) is not scanned.
function collectMdProducers(text, file) {
  if (SYNOPSIS_FILES.has(file)) return [];
  const out = [];
  const re = /--id(?![\w-])[= ]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`]+))/g;
  for (const para of text.replace(/\\\r?\n/g, ' ').split(/\r?\n[ \t]*\r?\n/)) {
    if (!/stage-item\.js\b/.test(para)) continue;
    for (const m of para.matchAll(re)) {
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

// Throws naming the file for any id with an empty static head: a producer's literal head is
// what the console maps, so a fully dynamic id is fixed at the producer, never exempted here.
function checkDynamicIds(producers) {
  for (const p of producers) {
    if (p.id === null) continue;
    if (staticHead(p.id) !== '') continue;
    throw new Error(`${p.file}: --id ${JSON.stringify(p.id)} is fully dynamic — give the producer a literal head (fix it at the producer, never exempt it)`);
  }
}

function headOf(p) {
  return staticHead(p.id);
}

function collectProducers() {
  const producers = [];
  for (const f of walk(SKILLS_ROOT, '.md')) producers.push(...collectMdProducers(readText(f), rel(f)));
  for (const f of walk(BIN_ROOT, '.js')) {
    if (BIN_SKIP(rel(f))) continue;
    producers.push(...collectBinProducers(readText(f), rel(f)));
  }
  checkDynamicIds(producers);
  return producers;
}

// Skill prose that names a staged file rather than a `stage-item.js --id` command line:
// a backticked `staged/<literal head>{placeholder}….md` path (`staged/plan-citation-{n}.md`),
// or the concrete numbered form a console-template example uses (`staged/translation-85.md`).
// Only `.md` names are checked: a `.patch` name always classifies (the `.patch$` row), and a
// name with an empty static head (`staged/{id}.md`) names no prefix at all — both are skipped
// here on purpose. Glob forms (`staged/wrap-up-upstream-*.md`) are not placeholders and stay out
// of scope. -> [{ file, id }] with id = head + '{n}', one per distinct head in the file.
const PROSE_PLACEHOLDER_RE = /`[^`\n]*?staged\/([A-Za-z0-9._-]*)\{[^}`\n]*\}[^`\n]*?\.(md|patch)\b[^`\n]*`/g;
const PROSE_NUMBERED_RE = /`[^`\n]*?staged\/([A-Za-z0-9._-]*-)\d+\.(md|patch)\b[^`\n]*`/g;

function collectProseProducers(text, file) {
  const heads = new Set();
  for (const re of [PROSE_PLACEHOLDER_RE, PROSE_NUMBERED_RE]) {
    for (const m of text.matchAll(re)) {
      if (m[2] === 'patch' || m[1] === '') continue;
      heads.add(m[1]);
    }
  }
  return [...heads].map((head) => ({ file, id: `${head}{n}` }));
}

function collectProseProducersFromSkills() {
  const out = [];
  for (const f of walk(SKILLS_ROOT, '.md')) out.push(...collectProseProducers(readText(f), rel(f)));
  return out;
}

function probeOf(p) {
  const head = headOf(p);
  return head.endsWith('-') ? head + '1' : head;
}

function isMapped(probe) {
  return classifyStagedItem(probe + '.md').reason !== 'unmapped-prefix';
}

// A mapped id that is also exempt would hide a real mapping behind an exemption (and
// stage-item.js would skip a refusal the console never needed to skip). `exemptionOf` is
// injectable so the go-red control can pass a stub that exempts everything.
function assertExemptionsDisjointFromMapped(producers, exemptionOf = stagingExemption) {
  for (const p of producers) {
    if (p.id === null) continue;
    const probe = probeOf(p);
    if (exemptionOf(probe) !== null && isMapped(probe)) {
      throw new Error(`${p.file}: --id ${p.id} (probe ${probe}) is on STAGING_EXEMPTIONS but also classifies mapped — drop the exemption or the mapping`);
    }
  }
}

// A STAGING_EXEMPTIONS entry no scanned producer matches is stale: delete it.
function assertNoStaleExemptions(producers, exemptions = STAGING_EXEMPTIONS) {
  const probes = producers.filter((p) => p.id !== null).map(probeOf);
  for (const [re] of exemptions) {
    if (!probes.some((probe) => re.test(probe))) {
      throw new Error(`STAGING_EXEMPTIONS entry ${re} matches no scanned producer — remove the stale exemption`);
    }
  }
}

function assertProducerDisposition(producers) {
  for (const p of producers) {
    if (p.id === null) throw new Error(`${p.file}: ${p.problem}`);
    const probe = probeOf(p);
    if (!isMapped(probe) && stagingExemption(probe) === null) {
      throw new Error(`${p.file}: --id ${p.id} (probe ${probe}) classifies unmapped-prefix and is not on STAGING_EXEMPTIONS — map it in resolve.js's SECTION_MAP or exempt it with a reason`);
    }
  }
}

test("Deliverable 4: every staging producer's id is mapped or exempt", () => {
  assertProducerDisposition(collectProducers());
});

test('the scan finds the known producers (matcher floor)', () => {
  const producers = collectProducers();
  assert.ok(producers.length >= 19, `found only ${producers.length} producers`);
  const heads = new Set(producers.map(headOf));
  for (const h of ['release-held', 'dispatch-target-missing-', 'shipped-close-', 'upstream-draft-',
    'premise-satisfied-', 'dream-proposal-', 'flaky-allowlist-', 'tidy-release-note-', 'digest-promotion-']) {
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

test('AC2.1: a producer whose --id sits on a later line of the stage-item.js paragraph is collected', () => {
  assert.deepEqual(
    collectMdProducers('Stage one item with `stage-item.js` (see X),\n`--id tidy-release-note-{id}`. The .md holds it.', 'a.md'),
    [{ file: 'a.md', id: 'tidy-release-note-{id}' }]);
  assert.deepEqual(collectMdProducers('winget install --id GitHub.cli', 'b.md'), []);
});

test('AC2.1 go-red: a deliberately unmapped fixture producer, read through the matcher, fails the disposition check', () => {
  assert.throws(() => assertProducerDisposition(collectMdProducers(
    'node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run r --id "zz-unmapped-{n}" --file f', 'plugin/skills/new/step.md')),
  /plugin\/skills\/new\/step\.md.*zz-unmapped-/);
});

test('control: any fully dynamic --id fails the dynamic-id check, in every file', () => {
  const fixture = 'node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id "{x}" --file "{p}"';
  for (const file of ['plugin/skills/new/step.md', 'plugin/skills/tidy/step-6-auto.md']) {
    assert.throws(() => checkDynamicIds(collectMdProducers(fixture, file)), /fully dynamic/);
    assert.throws(() => checkDynamicIds(collectMdProducers(fixture, file)), new RegExp(file.replace(/[/.]/g, '\\$&')));
  }
});

test('prose-named staged files: every static head is mapped or exempt', () => {
  assertProducerDisposition(collectProseProducersFromSkills());
});

test('the prose scan finds the known prose-named producers (matcher floor)', () => {
  const heads = new Set(collectProseProducersFromSkills().map(headOf));
  for (const h of ['plan-citation-', 'translation-', 'premise-satisfied-', 'upstream-draft-', 'wrap-up-claude-md-', 'plan-retention-']) {
    assert.ok(heads.has(h), `prose head ${h} not found — the prose matcher lost a call shape`);
  }
});

test('go-red control: a prose-named staged file with an unmapped head is reported', () => {
  const fixture = 'Stage a `staged/zz-unmapped-{n}.md` proposal for the console.';
  assert.throws(() => assertProducerDisposition(collectProseProducers(fixture, 'plugin/skills/new/step.md')),
    /plugin\/skills\/new\/step\.md.*zz-unmapped-/);
  assert.doesNotThrow(() => assertProducerDisposition(collectProseProducers('stage a `staged/plan-citation-{n}.md`', 'a.md')));
});

test('prose matcher controls: .patch, empty heads, globs and the numbered form', () => {
  assert.deepEqual(collectProseProducers('`staged/zz-{n}.patch` `staged/{id}.md` `staged/wrap-up-upstream-*.md`', 'a.md'), []);
  assert.deepEqual(collectProseProducers('| `staged/translation-85.md` — brief', 'a.md'), [{ file: 'a.md', id: 'translation-{n}' }]);
  assert.deepEqual(collectProseProducers('`staged/a-{x}.md` and `staged/a-{y}.md`', 'a.md'), [{ file: 'a.md', id: 'a-{n}' }]);
});

test('exempt and mapped are disjoint across every scanned producer (#3488)', () => {
  assertExemptionsDisjointFromMapped([...collectProducers(), ...collectProseProducersFromSkills()]);
});

test('go-red control: a mapped id that is also exempt fails the disjointness assertion', () => {
  const mapped = [{ file: 'x.md', id: 'docs-1' }];
  assert.doesNotThrow(() => assertExemptionsDisjointFromMapped(mapped));
  assert.throws(() => assertExemptionsDisjointFromMapped(mapped, () => 'x'), /x\.md.*docs-1.*also classifies mapped/);
});

test('every STAGING_EXEMPTIONS entry matches at least one scanned producer (no stale exemption)', () => {
  assertNoStaleExemptions([...collectProducers(), ...collectProseProducersFromSkills()]);
});

test('go-red control: an exemption no producer matches is reported as stale', () => {
  const stale = [...STAGING_EXEMPTIONS, [/^never-produced-/, 'a reason for an exemption that no producer needs']];
  assert.throws(() => assertNoStaleExemptions(collectProducers(), stale), /never-produced-/);
});
