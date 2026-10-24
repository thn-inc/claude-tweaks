// tests/staged-patch-contract.test.js — pins #674's single-statement rule: the staged-patch
// artifact format, the staging-time `git apply --check` gate, and the console apply-with-
// description-fallback procedure live once in skills/_shared/staged-patch.md, and every
// patch-staging site and console apply step cites it. Also runs the live `git apply --check`
// discrimination probe the contract's prose relies on (preamble accepted; malformed and stale
// rejected) so the mechanism is proven on this machine, not asserted.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');
const { gitEnv } = require('../plugin/bin/lib/staged-patch/stack-check');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const CONTRACT = path.join(SKILLS, '_shared', 'staged-patch.md');
const read = (...p) => readText(path.join(SKILLS, ...p));

test('contract file exists with its three named sections', () => {
  const text = readText(CONTRACT);
  for (const h of ['## Artifact format', '## Staging-time gate', '## Console apply with description fallback']) {
    assert.equal(text.split('\n').filter((l) => l === h).length, 1, `${h} stated exactly once`);
  }
  for (const field of ['Target:', 'Invariant:', 'Finding:', 'Staged-at:', 'Ledger:']) {
    assert.ok(text.includes(field), `contract names the ${field} preamble field`);
  }
  assert.match(text, /git apply --check/);
});

// #879: a staged review/reflect finding applied at the console must write its outcome back to
// the ledger file itself, not only to decisions.md — the drift a manual six-ledger audit found.
test('contract documents ledger write-back on apply, distinct from the decisions.md log', () => {
  const text = readText(CONTRACT);
  assert.equal(text.split('\n').filter((l) => l === '### Write-back to the ledger').length, 1, 'write-back subsection stated exactly once');
  const section = text.slice(text.indexOf('### Write-back to the ledger'));
  assert.match(section, /\|\s*1\.\s*Fast path applied\s*\|\s*`fixed`\s*\|/, 'fast-path apply maps to Status fixed');
  assert.match(section, /\|\s*2\.\s*Stale diff re-derived\s*\|\s*`fixed`\s*\|/, 'stale-diff re-derive maps to Status fixed');
  assert.match(section, /\|\s*4\.\s*Cannot re-derive\s*\|\s*`open`/, 'unresolved outcome leaves ledger Status open');
  assert.ok(section.includes('lived only in'), 'section names decisions.md-only as the gap this closes');
  assert.ok(section.includes("ledger file's own Status column"), 'section names the ledger file Status column as the fix');
});

// Every site that writes a `.patch` under staged/ must cite the contract; the console apply
// steps must cite it too. Anchored on the literal filenames each site already uses.
const STAGING_SITES = [
  ['review', 'step3-routing.md', /staged\/review-\{n\}\.patch/],
  ['test', 'SKILL.md', /staged\/test-fix-\{n\}\.patch/],
  ['deepen', 'SKILL.md', /staged\/deepen-collapse-\{n\}\.patch/],
];
for (const [dir, file, anchor] of STAGING_SITES) {
  test(`${dir}/${file} still stages a .patch and cites _shared/staged-patch.md`, () => {
    const text = read(dir, file);
    assert.match(text, anchor, 'staging site anchor present');
    assert.ok(text.includes('_shared/staged-patch.md'), `${dir}/${file} must cite the contract`);
    assert.match(text, /git apply --check/, `${dir}/${file} must name the staging-time gate`);
  });
}

test('wrap-up/curation-engine.md dispatch prompts inline the staged-patch artifact format', () => {
  const text = read('wrap-up', 'curation-engine.md');
  assert.match(text, /Staged-patch artifact format \(both branches\)/, 'names the paragraph');
  assert.match(text, /_shared\/staged-patch\.md.{0,40}Artifact format/, 'cites the contract file by its Artifact format section');
  for (const field of ['Target:', 'Invariant:', 'Finding:', 'Staged-at:']) {
    assert.ok(text.includes(field), `curation-engine.md names the ${field} preamble field`);
  }
  assert.match(text, /diff --git/, 'requires a literal diff --git block');
  assert.match(text, /staged-patch artifact format below/, 'the fan-out branch\'s inline-elements list references it');
});

const CONSOLE_SITES = [
  ['wrap-up', 'review-console.md'],
  ['flow', 'multispec-review-console.md'],
];
for (const [dir, file] of CONSOLE_SITES) {
  test(`${dir}/${file} apply step cites the contract and names the staleness case`, () => {
    const text = read(dir, file);
    assert.ok(text.includes('_shared/staged-patch.md'), `${dir}/${file} must cite the contract`);
    assert.match(text, /stale/i, 'must document the staleness case');
    assert.match(text, /Invariant:/, 'must name the description fallback field');
  });
}

test('review/step3-routing.md assigns the ledger row before staging the patch and cites the Ledger: field', () => {
  const text = read('review', 'step3-routing.md');
  assert.ok(text.includes('Ledger first, then the patch'), 'ordering rule present');
  assert.ok(text.includes('`Ledger:`'), 'cites the Ledger: preamble field');
});

test('_shared/ledger-format.md states the write-back contract and the Phase 1 external-resolution re-check', () => {
  const text = read('_shared', 'ledger-format.md');
  assert.ok(text.includes('Write-back contract'), 'write-back contract paragraph present');
  assert.ok(text.includes('Re-check before attempting a fresh fix'), 'Phase 1 re-check step present');
  assert.ok(text.includes('misdiagnosis'), 'misdiagnosis-correction pattern named');
});

test('ledger/SKILL.md mentions the Phase 1 re-check in its Resolve Gate summary', () => {
  const text = read('ledger', 'SKILL.md');
  assert.ok(text.includes('re-check'), 'Resolve Gate summary names the re-check step');
});

test('the fallback procedure heading is stated once — only in the contract', () => {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (e.name.endsWith('.md')) acc.push(full);
    }
    return acc;
  };
  for (const file of walk(SKILLS)) {
    if (file === CONTRACT) continue;
    assert.ok(!/^## Console apply with description fallback$/m.test(readText(file)), `${path.relative(SKILLS, file)} restates the fallback heading`);
  }
});

// #737: the anchored-staged-path invariant is owned by pipeline-run-dir.md's Anchoring
// section — stated once there, cited (not restated) by staged-patch.md and curation-engine.md.
// Both consumer sites word their citation naturally for their own sentence, not as one reused
// literal phrase (a single literal phrase pasted into two grammatically different slots reads as
// a category error — #737 review finding). `citesStagedFileInvariant` therefore checks for a set
// of short, independent keywords rather than one long contiguous string: each is unlikely to
// straddle a hard-wrapped line on its own, and normalizing whitespace before matching removes
// that risk entirely even if a future re-wrap moves a line break mid-keyword.
const RUN_DIR_DOC = path.join(SKILLS, '_shared', 'pipeline-run-dir.md');
const INVARIANT_MARKER = '**The staged-file invariant.**';
const normWS = (s) => s.replace(/\s+/g, ' ');
function citesStagedFileInvariant(text) {
  const n = normWS(text);
  return n.includes('staged-file invariant')
    && n.includes('_shared/pipeline-run-dir.md')
    && n.includes('Anchoring section')
    && n.includes('single owner');
}

test('pipeline-run-dir.md Anchoring section states the staged-file invariant exactly once, repo-wide', () => {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (e.name.endsWith('.md')) acc.push(full);
    }
    return acc;
  };
  let ownerHits = 0;
  for (const file of walk(SKILLS)) {
    const text = normWS(readText(file));
    const count = text.split(INVARIANT_MARKER).length - 1;
    if (file === RUN_DIR_DOC) { ownerHits = count; continue; }
    assert.equal(count, 0, `${path.relative(SKILLS, file)} restates the staged-file invariant marker`);
  }
  assert.equal(ownerHits, 1, 'pipeline-run-dir.md states the staged-file invariant marker exactly once');
  const anchoring = readText(RUN_DIR_DOC);
  const anchoringStart = anchoring.indexOf('## Anchoring');
  const nextHeadingRel = anchoring.slice(anchoringStart + 1).search(/^## /m);
  const anchoringEnd = nextHeadingRel === -1 ? anchoring.length : anchoringStart + 1 + nextHeadingRel;
  const section = normWS(anchoring.slice(anchoringStart, anchoringEnd));
  assert.ok(section.includes(INVARIANT_MARKER), 'marker lives inside the Anchoring section (bounded to its own heading, not merely after it)');
  assert.match(section, /worktree-relative shadow/, 'names the shadow failure mode');
  assert.ok(section.includes('curation-engine.md'), 'names curation-engine.md as the remedy owner');
  assert.ok(section.includes('§4'), 'names §4 as the remedy location');
  assert.ok(section.includes('post-fan-out shadow sweep'), 'names the shadow-sweep remedy by name');
});

test('staged-patch.md Staging-time gate cites the pipeline-run-dir.md staged-file invariant instead of restating it', () => {
  const text = readText(CONTRACT);
  const gate = text.slice(text.indexOf('## Staging-time gate'), text.indexOf('## Console apply with description fallback'));
  assert.ok(citesStagedFileInvariant(gate), 'Staging-time gate cites the staged-file invariant');
  assert.ok(!normWS(gate).includes('worktree-relative shadow'), 'Staging-time gate no longer restates the shadow phrase');
  assert.match(gate, /\*\*absolute\*\*/, 'still names the path as absolute (kept, not part of the restatement being removed)');
});

// ---- Live discrimination probe: the mechanism the contract's prose relies on ----
// Spawn env hardened against a global commit.gpgsign=true or template hook affecting the
// fixture; every spawn (setup and probes) is bounded so a hang fails fast and names itself.
const FIXTURE_ENV = gitEnv();
function gitFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-patch-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS, env: FIXTURE_ENV });
  const runOk = (...args) => {
    const r = git(...args);
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  runOk('init', '-q');
  runOk('config', 'user.email', 'probe@example.invalid');
  runOk('config', 'user.name', 'probe');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n');
  runOk('add', 'a.txt');
  runOk('commit', '-q', '-m', 'base');
  return { dir, git };
}

const PREAMBLE_PATCH = [
  'Target: a.txt',
  'Invariant: the second line reads "line2-fixed"',
  'Finding: medium correctness — example',
  'Staged-at: 0000000',
  '',
  'diff --git a/a.txt b/a.txt',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,3 +1,3 @@',
  ' line1',
  '-line2',
  '+line2-fixed',
  ' line3',
  '',
].join('\n');

test('probe: git apply --check accepts a patch carrying the Target:/Invariant: preamble', (t) => {
  const { dir, git } = gitFixture(t);
  fs.writeFileSync(path.join(dir, 'p.patch'), PREAMBLE_PATCH);
  const r = git('apply', '--check', 'p.patch');
  assert.equal(r.status, 0, r.stderr);
});

test('probe: git apply --check rejects a malformed hunk and a description-only file (no diff)', (t) => {
  const { dir, git } = gitFixture(t);
  fs.writeFileSync(path.join(dir, 'bad.patch'), PREAMBLE_PATCH.replace('@@ -1,3 +1,3 @@', '@@ broken @@'));
  const bad = git('apply', '--check', 'bad.patch');
  assert.notEqual(bad.status, 0, 'malformed hunk must be rejected');
  fs.writeFileSync(path.join(dir, 'nodiff.patch'), 'Target: a.txt\nInvariant: something\n');
  const nodiff = git('apply', '--check', 'nodiff.patch');
  assert.notEqual(nodiff.status, 0, 'description-only file must be rejected as a patch');
  assert.match(nodiff.stderr, /No valid patches in input/);
});

test('probe: a patch staged before the target moved is rejected as stale, distinguishable from malformed', (t) => {
  const { dir, git } = gitFixture(t);
  fs.writeFileSync(path.join(dir, 'p.patch'), PREAMBLE_PATCH);
  assert.equal(git('apply', '--check', 'p.patch').status, 0);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line0\nline1\nlineX\nline2\nline3\n');
  git('commit', '-qam', 'restructure');
  const stale = git('apply', '--check', 'p.patch');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /patch does not apply/);
});

// #3290: the staging gate stacks each staged patch on the patches that sort before it, and one
// apply order (byte-wise staged/ filename sort) governs both the gate and the console apply loop.
const GATE_HEADING = '## Staging-time gate';
const CONSOLE_HEADING = '## Console apply with description fallback';
const STACKED_HEADING = '### Stacked check';
const CONSOLE_END = '### Write-back to the ledger';
const normBody = (s) => s.replace(/\s+/g, ' ').trim();
function assertStackedGate(text) {
  const gate = text.slice(text.indexOf(GATE_HEADING), text.indexOf(CONSOLE_HEADING));
  const stacked = gate.slice(gate.indexOf(STACKED_HEADING));
  const consoleSlice = text.slice(text.indexOf(CONSOLE_HEADING), text.indexOf(CONSOLE_END));
  // AC1.1: the gate runs the stacked check and names both patches on a conflict
  assert.ok(gate.includes(STACKED_HEADING), 'gate names the Stacked check subsection');
  assert.ok(gate.includes('bin/check-staged-stack.js'), 'gate names the stacked-check CLI');
  assert.ok(gate.includes('--rederive-out'), 'gate passes --rederive-out');
  assert.ok(gate.includes('staged/{targetConflict.patch}') && gate.includes('staged/{targetConflict.conflictsWith}') && gate.includes('staged/{slug}-{n}.patch'), 'conflict STAGED line names both patches from targetConflict, plus the stage path');
  // AC2.1: a clean stack writes only the normal STAGED entry
  const exit0 = stacked.match(/- \*\*exit 0\*\*([\s\S]*?)(?=\n- |\n\n|$)/);
  assert.ok(exit0, 'stacked subsection has an exit-0 bullet');
  assert.match(normBody(exit0[1]), /normal[\s\S]*nothing else/, 'exit-0 bullet says normal entry and nothing else');
  // AC3.1: apply order is defined once and both the gate and the console apply section use it
  const orderLines = text.split('\n').filter((l) => /^\*\*Apply order\./.test(l));
  assert.equal(orderLines.length, 1, 'exactly one Apply order paragraph');
  const orderStart = text.indexOf(orderLines[0]);
  const orderPara = text.slice(orderStart, text.indexOf('\n\n', orderStart));
  assert.ok(orderPara.includes('byte-wise'), 'apply order paragraph names the byte-wise sort');
  assert.ok(orderPara.includes('bin/lib/console/resolve.js'), 'apply order paragraph names the console resolver');
  const stackedStart = text.indexOf(GATE_HEADING) + gate.indexOf(STACKED_HEADING);
  assert.ok(orderStart > stackedStart && orderStart < text.indexOf(CONSOLE_HEADING), 'the Apply order paragraph lives in the gate\'s Stacked check subsection');
  assert.ok(consoleSlice.includes('apply order'), 'console apply slice uses apply order');
  assert.ok(!consoleSlice.includes('in the order the console lists them'), 'console apply slice no longer uses the console display order');
  // The re-run is bounded to once, and a re-anchor has a stated condition
  const bullet = (lead) => {
    const m = stacked.match(new RegExp(`${lead}([\\s\\S]*?)(?=\\n- |\\n\\n|$)`));
    return m ? normBody(m[1]) : null;
  };
  const rederived = bullet('- \\*\\*exit 1 with `rederived`\\*\\*');
  assert.ok(rederived, 'stacked subsection has an exit-1-rederived bullet');
  assert.ok(rederived.includes('re-run only the stacked check, once') && rederived.includes('never re-derives again'), 'exit-1-rederived bullet bounds the re-run to once');
  const rederivedNull = bullet('- \\*\\*exit 1, `rederived` null\\*\\*');
  assert.ok(rederivedNull, 'stacked subsection has an exit-1-null bullet');
  assert.ok(rederivedNull.includes('Re-anchor only when `targetConflict.patch` is this patch and the edit admits another anchor') && rederivedNull.includes('re-run both checks once'), 'exit-1-null bullet states the re-anchor condition');
}

test('AC1.1, AC2.1, AC3.1: the staging gate stacks staged patches and one apply order governs gate and console', () => {
  assertStackedGate(readText(CONTRACT));
});

// One go-red control per assertion: each runs the same assertStackedGate on a text mutated inside
// only the slice that assertion reads, so every earlier assertion still passes and the named one fires.
function mutateSpan(text, startMarker, endMarker, fn) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, `span start present: ${startMarker}`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `span end present: ${endMarker}`);
  return text.slice(0, s) + fn(text.slice(s, e)) + text.slice(e);
}
const inGate = (text, fn) => mutateSpan(text, GATE_HEADING, CONSOLE_HEADING, fn);
const inConsole = (text, fn) => mutateSpan(text, CONSOLE_HEADING, CONSOLE_END, fn);
const inExit0 = (text, fn) => mutateSpan(text, '- **exit 0**', '\n- **exit 1 with', fn);
const inOrderPara = (text, fn) => mutateSpan(text, '**Apply order.**', '\n\n', fn);
const inRederived = (text, fn) => mutateSpan(text, '- **exit 1 with `rederived`**', '\n- **exit 1, `rederived` null**', fn);
const inRederivedNull = (text, fn) => mutateSpan(text, '- **exit 1, `rederived` null**', '\n- **exit 2, 3 or 4**', fn);
const swap = (from, to) => (s) => s.split(from).join(to);

const STACKED_CONTROLS = [
  ['the Stacked check heading is deleted', (t) => t.replace(`${STACKED_HEADING}\n`, ''), /gate names the Stacked check subsection/],
  ['the stacked-check CLI is renamed in the gate', (t) => inGate(t, swap('bin/check-staged-stack.js', 'bin/x.js')), /gate names the stacked-check CLI/],
  ['--rederive-out is dropped from the gate', (t) => inGate(t, swap('--rederive-out', '')), /gate passes --rederive-out/],
  ['the conflict STAGED line stops naming conflictsWith', (t) => inGate(t, swap('staged/{targetConflict.conflictsWith}', 'staged/{x}')), /conflict STAGED line names both patches/],
  ['the conflict STAGED line stops naming targetConflict.patch', (t) => inGate(t, swap('staged/{targetConflict.patch}', 'staged/{x}')), /conflict STAGED line names both patches/],
  ['the conflict STAGED line stops naming the stage path', (t) => inGate(t, swap('staged/{slug}-{n}.patch', 'staged/{x}')), /conflict STAGED line names both patches/],
  ['the exit-0 bullet loses its bold lead', (t) => inGate(t, swap('- **exit 0**', '- **exit zero**')), /stacked subsection has an exit-0 bullet/],
  ['the exit-0 bullet stops saying nothing else', (t) => inExit0(t, swap('nothing else', 'more')), /exit-0 bullet says normal entry and nothing else/],
  ['a second Apply order paragraph is appended', (t) => `${t}\n\n**Apply order.** x\n`, /exactly one Apply order paragraph/],
  ['the Apply order paragraph stops naming the byte-wise sort', (t) => inOrderPara(t, swap('byte-wise', 'natural')), /names the byte-wise sort/],
  ['the Apply order paragraph stops naming the console resolver', (t) => inOrderPara(t, swap('bin/lib/console/resolve.js', 'bin/x.js')), /names the console resolver/],
  ['the Apply order paragraph moves to the end of the file', (t) => {
    const s = t.indexOf('**Apply order.**');
    const para = t.slice(s, t.indexOf('\n\n', s));
    return `${(t.slice(0, s) + t.slice(s + para.length)).trimEnd()}\n\n${para}\n\n`;
  }, /lives in the gate's Stacked check subsection/],
  ['the console apply slice stops saying apply order', (t) => inConsole(t, swap('apply order', 'listed order')), /console apply slice uses apply order/],
  ['the console apply slice regains the display order', (t) => inConsole(t, (s) => s.replace('\n', '\nin the order the console lists them\n')), /no longer uses the console display order/],
  ['the exit-1-rederived bullet loses its bold lead', (t) => inGate(t, swap('- **exit 1 with `rederived`**', '- **exit 1 rederived**')), /stacked subsection has an exit-1-rederived bullet/],
  ['the exit-1-rederived bullet loses its once', (t) => inRederived(t, swap('stacked check, once', 'stacked check')), /bounds the re-run to once/],
  ['the exit-1-rederived bullet loses its no-second-re-derive', (t) => inRederived(t, swap('never re-derives again', '')), /bounds the re-run to once/],
  ['the exit-1-null bullet loses its bold lead', (t) => inGate(t, swap('- **exit 1, `rederived` null**', '- **exit 1 null**')), /stacked subsection has an exit-1-null bullet/],
  ['the exit-1-null bullet loses its re-anchor condition', (t) => inRederivedNull(t, swap('admits another anchor', 'allows it')), /states the re-anchor condition/],
  ['the exit-1-null bullet loses its re-run-once', (t) => inRederivedNull(t, swap('re-run both checks once', 're-run both checks')), /states the re-anchor condition/],
];

for (const [name, mutate, messageRe] of STACKED_CONTROLS) {
  test(`go-red control: assertStackedGate throws when ${name}`, () => {
    const text = readText(CONTRACT);
    const mutated = mutate(text);
    assert.notEqual(mutated, text, 'the mutation changed the text');
    assert.throws(() => assertStackedGate(mutated), { message: messageRe });
  });
}

test('staged-patch contract: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = CONTRACT;
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  assert.doesNotThrow(() => assertStackedGate(text));
});
