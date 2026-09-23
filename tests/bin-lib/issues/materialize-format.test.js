'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  shapeGate, liftMetadata, composeHeader, composeFile, sectionText, stripCodeSpans,
} = require('../../../plugin/bin/lib/issues/materialize-format');
const wtDetect = require('../../../plugin/bin/lib/hooks/worktree-detect');

const SHAPED_BODY = [
  'Surface: backend',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
  '',
  '## Release Note',
  'Fixed the thing.',
].join('\n');

// ---- sectionText -------------------------------------------------------

test('sectionText: extracts a section body up to the next heading', () => {
  assert.equal(sectionText(SHAPED_BODY, 'Current State'), 'Some current state text.');
});

test('sectionText: last section runs to end of body', () => {
  assert.equal(sectionText(SHAPED_BODY, 'Acceptance Criteria'), '1. It works');
});

test('sectionText: missing heading returns null', () => {
  assert.equal(sectionText(SHAPED_BODY, 'Nonexistent'), null);
});

// ---- shapeGate -----------------------------------------------------------

test('shapeGate: a fully spec-shaped body passes', () => {
  assert.deepEqual(shapeGate(SHAPED_BODY), { ok: true, missing: [] });
});

test('shapeGate: missing Deliverables section fails, naming it', () => {
  const body = SHAPED_BODY.replace(/## Deliverables\n- \[ \] do a thing\n\n/, '');
  const gate = shapeGate(body);
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes('Deliverables'));
});

test('shapeGate: an empty section (heading present, no content) fails', () => {
  const body = SHAPED_BODY.replace('- [ ] do a thing', '');
  const gate = shapeGate(body);
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes('Deliverables'));
});

test('shapeGate: an unresolved TBD/TODO/ambiguity marker fails even with all sections present', () => {
  assert.equal(shapeGate(SHAPED_BODY + '\n\nTBD: fill this in later').ok, false);
  assert.equal(shapeGate(SHAPED_BODY + '\n\nTODO: revisit').ok, false);
  assert.equal(shapeGate(SHAPED_BODY + '\n\n<!-- ambiguity: which api? -->').ok, false);
});

test('shapeGate: multiple missing sections are all reported at once', () => {
  const gate = shapeGate('Just a title, no sections at all.');
  assert.deepEqual(gate.missing.sort(), ['Acceptance Criteria', 'Current State', 'Deliverables', 'Release Note']);
});

// #2603 — REQUIRED_SECTIONS now enforces the fourth canonical section too.
test('shapeGate: a body with all sections except Release Note fails, naming only Release Note', () => {
  const body = SHAPED_BODY.replace(/\n\n## Release Note\nFixed the thing\.$/, '');
  const gate = shapeGate(body);
  assert.deepEqual(gate, { ok: false, missing: ['Release Note'] });
});

test('shapeGate: placeholder markers inside a verbatim ## Original request section pass — even after nested ## headings (refs #1240)', () => {
  const body = SHAPED_BODY + '\n\n## Original request\n\nOld title\n\nOrigin: capture\n\n## Current State\n\nThe regex flags a three-letter marker: TBD.\n\n## Deliverables\n\n- [ ] exact set TBD at build time\n\nTODO: revisit\n\n<!-- ambiguity: which api? -->';
  assert.deepEqual(shapeGate(body), { ok: true, missing: [] });
});

test('shapeGate: a genuine marker in an authored section still fails when an Original request section is also present', () => {
  const body = SHAPED_BODY.replace('- [ ] do a thing', '- [ ] do a thing TBD') + '\n\n## Original request\n\nOld title\n\nclean original text';
  const gate = shapeGate(body);
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes('unresolved-placeholder'));
});

// ---- stripCodeSpans / #1839 (quoted markers in fenced/inline code) --------

test('stripCodeSpans: removes a fenced code block, any info string', () => {
  const text = 'before\n```md\nsome quoted content\n```\nafter';
  const stripped = stripCodeSpans(text);
  assert.ok(!stripped.includes('some quoted content'));
  assert.ok(stripped.includes('before'));
  assert.ok(stripped.includes('after'));
});

test('stripCodeSpans: removes an inline code span, matching exact backtick-run length', () => {
  assert.equal(stripCodeSpans('a `T-O-D-O` b'), 'a  b');
  assert.equal(stripCodeSpans('a ``T-O-D-O`` b'), 'a  b');
});

test('stripCodeSpans: a single backtick inside a double-backtick span is not mis-cut', () => {
  const stripped = stripCodeSpans('x ``a`b`` y');
  assert.ok(!stripped.includes('a`b'), 'the whole double-backtick span must be removed as one unit');
});

test('stripCodeSpans: an unclosed fence runs to end of text (the safer direction)', () => {
  const text = 'before\n```\nunclosed content with TODO inside';
  const stripped = stripCodeSpans(text);
  assert.ok(!stripped.includes('unclosed content'));
  assert.ok(stripped.includes('before'));
});

test('stripCodeSpans: a code span under the 2000-char defensive cap still strips normally (#1837 review finding)', () => {
  const longSpan = 'x'.repeat(1999);
  const stripped = stripCodeSpans(`before \`${longSpan}\` after`);
  assert.equal(stripped, 'before  after');
});

test('stripCodeSpans: a span whose content exceeds the 2000-char defensive cap is left as literal text, the same safer direction an unclosed fence already takes', () => {
  const overCap = 'x'.repeat(2500);
  const stripped = stripCodeSpans(`before \`${overCap}\` after`);
  // The cap makes this look "unclosed" from the regex's point of view — content
  // is left in place rather than silently dropped. No real authored inline
  // code span is anywhere near this long, so this only affects a
  // pathological input, and it degrades to leaving text visible (safe),
  // never to hanging.
  assert.ok(stripped.includes(overCap));
});

test('shapeGate: a Deliverables fence quoting a marker word passes; a bare marker in the same section still fails', () => {
  const bodyWithFence = SHAPED_BODY.replace(
    '- [ ] do a thing',
    '- [ ] do a thing\n\nCurrent: "…leave a TODO comment without a corresponding record."\n\n```\nProposed: "…leave a TODO comment without a corresponding record."\n```',
  );
  const gate = shapeGate(bodyWithFence);
  assert.equal(gate.ok, false, 'the un-fenced "Current:" line above still carries a bare marker and must still fail');
  assert.ok(gate.missing.includes('unresolved-placeholder'));

  const bodyFencedOnly = SHAPED_BODY.replace(
    '- [ ] do a thing',
    '- [ ] do a thing\n\n```\nquoted line with a TODO word inside\n```',
  );
  assert.deepEqual(shapeGate(bodyFencedOnly), { ok: true, missing: [] });
});

test('shapeGate: an inline-code marker passes; the same bare marker fails', () => {
  const bodyInline = SHAPED_BODY.replace('- [ ] do a thing', '- [ ] mentions `TODO` in code');
  assert.deepEqual(shapeGate(bodyInline), { ok: true, missing: [] });
  const bodyBare = SHAPED_BODY.replace('- [ ] do a thing', '- [ ] mentions TODO bare');
  assert.equal(shapeGate(bodyBare).ok, false);
});

test('shapeGate: an unclosed fence containing a marker passes (runs to end of authored text)', () => {
  const body = SHAPED_BODY.replace(
    '- [ ] do a thing',
    '- [ ] do a thing\n\n```\nunterminated fence with a TODO marker inside',
  );
  assert.deepEqual(shapeGate(body), { ok: true, missing: [] });
});

test('shapeGate: a bare marker AFTER a closed fence still fails — a stray marker cannot hide behind an earlier fence', () => {
  const body = SHAPED_BODY.replace(
    '- [ ] do a thing',
    '- [ ] do a thing\n\n```\nfenced content\n```\n\nTODO: this one is real',
  );
  const gate = shapeGate(body);
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes('unresolved-placeholder'));
});

test('shapeGate: the reported record shape (Deliverables quoting the "No implicit deferrals" bullet) materializes with exit 0', () => {
  const body = SHAPED_BODY.replace(
    '- [ ] do a thing',
    [
      '- [ ] Update the Philosophy bullet.',
      '',
      '**Current:**',
      '```',
      '…leave a TODO comment without a corresponding record.',
      '```',
      '',
      '**Proposed:**',
      '```',
      '…leave a TODO comment without a corresponding record, per the new rule.',
      '```',
    ].join('\n'),
  );
  assert.deepEqual(shapeGate(body), { ok: true, missing: [] });
});

// ---- liftMetadata ----------------------------------------------------------

test('liftMetadata: reads Surface/Design-intent/Design-seed from the leading metadata block', () => {
  const body = 'Surface: web\nDesign-intent: quiet\nDesign-seed: abc123\n\n## Current State\nx';
  assert.deepEqual(liftMetadata(body), { surface: 'web', designIntent: 'quiet', designSeed: 'abc123' });
});

test('liftMetadata: reads Ui-stack alongside Surface/Design-intent/Design-seed', () => {
  const body = 'Surface: web\nDesign-intent: quiet\nUi-stack: shadcn/ui + Tailwind\nDesign-seed: abc123\n\n## Current State\nx';
  assert.deepEqual(liftMetadata(body), {
    surface: 'web', designIntent: 'quiet', uiStack: 'shadcn/ui + Tailwind', designSeed: 'abc123',
  });
});

test('liftMetadata: Ui-stack omitted when the line is absent', () => {
  const lifted = liftMetadata('Surface: web\nDesign-intent: none\n\n## Current State\nx');
  assert.equal('uiStack' in lifted, false);
});

test('liftMetadata: a bare Design-intent: line (no value) does not swallow the next metadata line (refs #357)', () => {
  const body = 'Surface: web\nDesign-intent:\nUi-stack: shadcn/ui + Tailwind\n\n## Current State\nx';
  assert.deepEqual(liftMetadata(body), { surface: 'web', uiStack: 'shadcn/ui + Tailwind' });
});

test('liftMetadata: a bare Ui-stack: line (no value) does not swallow the next metadata line (refs #357)', () => {
  const body = 'Surface: web\nDesign-intent: quiet\nUi-stack:\nDesign-seed: abc123\n\n## Current State\nx';
  assert.deepEqual(liftMetadata(body), { surface: 'web', designIntent: 'quiet', designSeed: 'abc123' });
});

test('liftMetadata: legacy Surface: frontend reads as web', () => {
  assert.deepEqual(liftMetadata('Surface: frontend\n\n## Current State\nx'), { surface: 'web' });
});

test('liftMetadata: no metadata block at all — every field omitted', () => {
  assert.deepEqual(liftMetadata(SHAPED_BODY.replace('Surface: backend\n\n', '')), {});
});

test('liftMetadata: only Surface present — design-intent/design-seed omitted, never emitted as empty strings', () => {
  const lifted = liftMetadata('Surface: infra\n\n## Current State\nx');
  assert.deepEqual(lifted, { surface: 'infra' });
  assert.equal('designIntent' in lifted, false);
});

// ---- composeHeader ----------------------------------------------------------

test('composeHeader: ceremony and grants are always emitted, even an empty grants list', () => {
  const header = composeHeader({ record: 5, origin: 'human', ceremony: 'standard', grants: { build: false, merge: false } });
  assert.match(header, /^ceremony: standard$/m);
  assert.match(header, /^grants: \[\]$/m);
});

test('composeHeader: risk/size/fingerprint/blocked-by/surface/design-intent/ui-stack/design-seed/parked-at-shaping omitted when absent', () => {
  const header = composeHeader({ record: 5, origin: 'human', ceremony: 'standard', grants: { build: true, merge: false } });
  for (const key of ['risk:', 'size:', 'fingerprint:', 'blocked-by:', 'surface:', 'design-intent:', 'ui-stack:', 'design-seed:', 'parked-at-shaping:']) {
    assert.doesNotMatch(header, new RegExp('^' + key, 'm'), `${key} should be omitted when its value is absent`);
  }
  assert.match(header, /^grants: \[build\]$/m);
});

test('composeHeader: a ui-stack value containing ":" or "#" is double-quoted, not emitted as unsafe bare YAML (refs #357)', () => {
  const header = composeHeader({
    record: 5, origin: 'human', ceremony: 'standard', grants: {}, uiStack: 'Tailwind: v4 # beta',
  });
  assert.match(header, /^ui-stack: "Tailwind: v4 # beta"$/m);
});

test('composeHeader: a ui-stack value with no special characters stays bare, unquoted', () => {
  const header = composeHeader({
    record: 5, origin: 'human', ceremony: 'standard', grants: {}, uiStack: 'shadcn/ui + Tailwind',
  });
  assert.match(header, /^ui-stack: shadcn\/ui \+ Tailwind$/m);
});

test('composeHeader: every optional field present renders in the documented order', () => {
  const header = composeHeader({
    record: 711, origin: 'capture', risk: 'low', size: 'high', ceremony: 'standard',
    grants: { build: true, merge: true }, fingerprint: 'fp123', blockedBy: [1, 2],
    surface: 'backend', designIntent: 'none', uiStack: 'none — defer to reference codebase', designSeed: 'seedabc', parkedAtShaping: true,
  });
  const lines = header.split('\n');
  assert.deepEqual(lines, [
    '---', 'record: 711', 'origin: capture', 'risk: low', 'size: high', 'ceremony: standard',
    'grants: [build, merge]', 'fingerprint: fp123', 'blocked-by: [1, 2]', 'surface: backend',
    'design-intent: none', 'ui-stack: none — defer to reference codebase', 'design-seed: seedabc', 'parked-at-shaping: true', '---',
  ]);
});

// ---- composeFile -----------------------------------------------------------

test('composeFile: header, then "# {n}: {title}", then the body verbatim', () => {
  const header = composeHeader({ record: 5, origin: 'human', ceremony: 'standard', grants: { build: false, merge: false } });
  const file = composeFile({ header, n: 5, title: 'Fix the thing', body: SHAPED_BODY });
  assert.ok(file.startsWith(header + '\n# 5: Fix the thing\n\n'));
  assert.ok(file.includes(SHAPED_BODY));
});

// ---- materialize.js CLI -----------------------------------------------------

const { run: cliRun } = require('../../../plugin/bin/materialize');

// #790/[IL-127]: materialize.js's run() now rejects a --run-dir that doesn't
// resolve under the main checkout (bin/lib/hooks/worktree-detect.js's
// isAnchoredUnderRoot), read through deps.cwd()/deps.mainRoot() (#790
// Finding 1) rather than process.cwd()/wtDetect directly. repoRoot below is
// that main checkout; every CLI test below runs with cwd chdir'd into it and
// a run-dir nested under it — a bare os.tmpdir() literal like the old
// '/tmp/run-1' no longer anchors. worktree-detect.js's checks are purely
// structural (`fs.statSync(...).isDirectory()`), not real git plumbing, so a
// bare `.git` directory — no `git init` subprocess — is enough, mirroring
// tests/bin-lib/release-claim/cli.test.js's `mkRun()` fixture.
let repoRoot;
before(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-materialize-cli-'));
  fs.mkdirSync(path.join(repoRoot, '.git'));
});
after(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function mkRunDir(name = 'run-1') {
  return path.join(repoRoot, '.claude-tweaks', 'pipelines', name);
}

function cliDeps({ ghView, ghAvailable = true, remoteUrl = 'https://github.com/acme/w.git' } = {}) {
  const out = []; const err = []; const written = {};
  return {
    deps: {
      ghView, ghAvailable: () => ghAvailable, remoteUrl: () => remoteUrl,
      cwd: () => process.cwd(), mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
      isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
      isInsideLinkedWorktree: (resolvedPath) => wtDetect.repoInfo(resolvedPath).isLinkedWorktree,
      cwdWorktreeRoot: (cwd) => {
        const info = wtDetect.repoInfo(cwd);
        return info.isLinkedWorktree ? info.repoRoot : null;
      },
      mkdirp: () => {}, writeFile: (p, c) => { written[p] = c; },
      stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    },
    out, err, written,
  };
}

function ghJson({ n = 1, title = 'A record', body = SHAPED_BODY, labels = ['ready', 'by:capture', 'risk:low', 'size:high', 'ceremony:standard', 'auto:build'] } = {}) {
  return JSON.stringify({ number: n, title, body, labels, url: `https://github.com/acme/w/issues/${n}` });
}

test('materialize CLI: --help exits 0', () => {
  const { deps, out } = cliDeps({ ghView: () => { throw new Error('must not call gh'); } });
  assert.equal(cliRun(['--help'], deps), 0);
  assert.match(out.join(''), /usage: materialize\.js/);
});

test('materialize CLI: happy path writes {run-dir}/work/{n}-spec.md with the composed header', () => {
  const runDir = mkRunDir();
  const { deps, out, written } = cliDeps({ ghView: () => ghJson() });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  const expectedFile = path.join(runDir, 'work', '1-spec.md');
  assert.equal(env.file, expectedFile);
  const content = written[expectedFile];
  assert.match(content, /^---\nrecord: 1\norigin: capture\nrisk: low\nsize: high\nceremony: standard\ngrants: \[build\]/);
  assert.match(content, /^# 1: A record$/m);
});

test('materialize CLI: happy path lifts a Ui-stack: line into the header and JSON envelope', () => {
  const runDir = mkRunDir('run-ui-stack');
  const body = SHAPED_BODY.replace('Surface: backend', 'Surface: web\nUi-stack: shadcn/ui + Tailwind');
  const { deps, out, written } = cliDeps({ ghView: () => ghJson({ body }) });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.uiStack, 'shadcn/ui + Tailwind');
  const content = written[path.join(runDir, 'work', '1-spec.md')];
  assert.match(content, /^ui-stack: shadcn\/ui \+ Tailwind$/m);
});

test('materialize CLI: an unshaped record fails the gate (exit 1), pointing at /specify', () => {
  const runDir = mkRunDir();
  const { deps, err } = cliDeps({ ghView: () => ghJson({ body: 'no sections here' }) });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 1);
  assert.match(err.join(''), /run `\/claude-tweaks:specify #1` first/);
});

test('materialize CLI: no ceremony label and no --ceremony override is a malformed invocation (exit 2)', () => {
  const runDir = mkRunDir();
  const { deps, err } = cliDeps({ ghView: () => ghJson({ labels: ['ready', 'risk:low'] }) });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 2);
  assert.match(err.join(''), /ceremony-check/);
});

test('materialize CLI: --ceremony override is honored when the record carries no ceremony label', () => {
  const runDir = mkRunDir();
  const { deps, out, written } = cliDeps({ ghView: () => ghJson({ labels: ['ready'] }) });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir, '--ceremony', 'fast-lane'], deps));
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.ceremonySource, 'override');
  assert.match(written[path.join(runDir, 'work', '1-spec.md')], /^ceremony: fast-lane$/m);
});

test('materialize CLI: an unresolvable issue number is a malformed invocation (exit 2)', () => {
  const runDir = mkRunDir();
  const { deps, err } = cliDeps({ ghView: () => { throw new Error('gh: issue not found'); } });
  const code = withCwd(repoRoot, () => cliRun(['999', '--run-dir', runDir], deps));
  assert.equal(code, 2);
  assert.match(err.join(''), /could not be resolved/);
});

test('materialize CLI: --multi-record-slug writes under spec-{slug}/work/', () => {
  const runDir = mkRunDir('run-parent');
  const { deps, out } = cliDeps({ ghView: () => ghJson() });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir, '--multi-record-slug', '1'], deps));
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.file, path.join(runDir, 'spec-1', 'work', '1-spec.md'));
});

test('materialize CLI: gh absent exits 2', () => {
  const runDir = mkRunDir();
  const { deps, err } = cliDeps({ ghView: () => { throw new Error('must not call gh'); }, ghAvailable: false });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 2);
  assert.match(err.join(''), /`gh` is required/);
});

test('materialize CLI: a record whose only markers sit in ## Original request materializes successfully (refs #1240)', () => {
  const runDir = mkRunDir('run-1240');
  const { deps, out, written } = cliDeps({ ghView: () => ghJson({ body: SHAPED_BODY + '\n\n## Original request\n\nOld title\n\n## Deliverables\n\n- [ ] exact set TBD at build time' }) });
  const code = withCwd(repoRoot, () => cliRun(['1', '--run-dir', runDir], deps));
  assert.equal(code, 0);
  const expectedFile = path.join(runDir, 'work', '1-spec.md');
  assert.ok(written[expectedFile].includes('## Original request'));
});
