// tests/flow-mixed-execution-convention.test.js — #3033: pins the "Mixed
// execution (a spec built outside /flow)" convention in flow/multi-spec.md.
// A spec B built outside the pipeline rejoins through existing mechanics only:
// a tail /flow run stopping before wrap-up, a `not-run` manifest record, then
// the parent's consolidated pass, with `close-run` on the parent last. These
// tests read the live prose because the section is the declared contract.
// Go-red is proven two ways: the frozen pre-change excerpt (MULTI_SPEC_PRE)
// lacks the section, and each pinned token has a doctored control that must
// stop matching once the token is removed [IL-105].
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const { readManifest } = require('../plugin/bin/lib/flow/manifest');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const collapse = (s) => s.replace(/\s+/g, ' ');

function sectionBetween(text, startRe, endRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index);
  const e = endRe.exec(rest.slice(m[0].length));
  assert.ok(e, 'end anchor missing — slice would widen to the rest of the file');
  return rest.slice(0, m[0].length + e.index);
}

const mixedSection = (text) =>
  sectionBetween(text, /^## Mixed execution \(a spec built outside \/flow\)\r?$/m, /^## /m);

// Frozen pre-change bytes: multi-spec.md from "## Failure handling" through the
// "## Artifact-overwrite completion check (#786)" heading line, before #3033.
const MULTI_SPEC_PRE = `## Failure handling (default vs \`keep-going\`)

Default mode stops the remaining specs on a HARD-GATE failure (compounding-risk default). \`keep-going\` inverts that — opt-in, for genuinely independent specs, so the consolidated console can surface every outcome together instead of stopping at the first failure. Read \`multispec-failure-handling.md\` in this skill's directory for the full behavior: the default-vs-\`keep-going\` console output shapes, the dependency-conflict warning, and the shared-worktree interaction (a failed spec's commits stay in the shared branch either way; only whether later specs keep building atop them differs).

## Artifact-overwrite completion check (#786)
`;

const LIVE = read('plugin/skills/flow/multi-spec.md');
const SECTION = mixedSection(LIVE);

test('AC1.1 multi-spec.md has the Mixed execution section', () => {
  assert.ok(SECTION, 'multi-spec.md must have a "## Mixed execution (a spec built outside /flow)" section');
  assert.strictEqual(mixedSection(MULTI_SPEC_PRE), null, 'frozen pre-change excerpt must lack the section, or the presence check is vacuous');
});

const TOKENS = [
  { name: 'tail run call with PIPELINE_RUN_DIR, stopping before wrap-up', re: /PIPELINE_RUN_DIR="\{parent-run-dir\}" \/claude-tweaks:flow #\{B\} test,review,polish/ },
  { name: 'steps-and-gates.md citation', s: 'steps-and-gates.md' },
  { name: 'not-run status word', s: 'not-run' },
  { name: 'spec-status --status not-run call', re: /spec-status --run "\{parent-run-dir\}" --spec \{B\} --status not-run/ },
  { name: 'MULTISPEC_CURATION_DEFER variable', s: 'MULTISPEC_CURATION_DEFER' },
  { name: 'close-run on the parent', s: 'close-run' },
  { name: 'by-hand close of B record', re: /close it by hand/i },
];

for (const tok of TOKENS) {
  const label = tok.s ?? tok.re.source;
  test(`AC1.2 section pins ${tok.name}: ${label}`, () => {
    const c = collapse(SECTION);
    if (tok.s !== undefined) assert.ok(c.includes(tok.s), `section must contain ${label}`);
    else assert.match(c, tok.re);
  });
  test(`AC2.1 control: removing ${tok.name} from the section fails its pin`, () => {
    const doctored = tok.s !== undefined
      ? collapse(SECTION).split(tok.s).join('')
      : collapse(SECTION).replace(new RegExp(tok.re.source, 'g' + (tok.re.flags.includes('i') ? 'i' : '')), '');
    if (tok.s !== undefined) assert.ok(!doctored.includes(tok.s), 'doctored section must no longer contain the token');
    else assert.doesNotMatch(doctored, tok.re);
  });
}

test('AC3.1 section uses the fully qualified /claude-tweaks:flow form', () => {
  assert.doesNotMatch(SECTION, /(^|[^:\w-])\/flow #/m);
  assert.match('run `/flow #{B} test`', /(^|[^:\w-])\/flow #/m, 'control: a bare /flow # must match the detector');
});

test('AC1.2 section never calls close-without-wrapup a guard', () => {
  assert.ok(!collapse(SECTION).includes('close-without-wrapup'));
});

test('AC1.2 the documented spec-status call, extracted and run, records B not-run', () => {
  const span = SECTION.match(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" spec-status[^`]*)`/);
  assert.ok(span, 'extraction pattern is out of sync with the Mixed execution section');

  const repo = gitRepo();
  try {
    const run = path.join(repo, '.claude-tweaks', 'pipelines', '2026-10-17T000000-spec-157-160');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'decisions.md'), '');
    fs.writeFileSync(
      path.join(run, 'manifest.yml'),
      [
        'multispec:',
        '  parent: x/',
        '  specs:',
        '    - id: 157',
        '      status: running',
        '      subdir: spec-157/',
        '    - id: 160',
        '      status: pending',
        '      subdir: spec-160/',
        '',
      ].join('\n'),
    );

    const cmd = span[1].replace('{parent-run-dir}', run).replace('{B}', '160');
    const script = `CLAUDE_PLUGIN_ROOT=${JSON.stringify(path.join(ROOT, 'plugin'))}\n${cmd}`;
    execFileSync('bash', ['-c', script], { cwd: run, encoding: 'utf8' });

    const manifest = readManifest(run);
    assert.equal(manifest.multispec.specs.find((s) => String(s.id) === '160').status, 'not-run');
    assert.equal(manifest.multispec.specs.find((s) => String(s.id) === '157').status, 'running');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
