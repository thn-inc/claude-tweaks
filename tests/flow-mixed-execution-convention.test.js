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
  { name: 'already-closed record-scoped wrap-up fallback', s: '/claude-tweaks:wrap-up #{n}' },
  { name: 'close-run ordering: parent comes last', s: '`close-run` on the parent comes last' },
  { name: 'never-close-parent-first rule', s: '**Never close the parent first.**' },
];

for (const tok of TOKENS) {
  const label = tok.s ?? tok.re.source;
  test(`AC1.2 section pins ${tok.name}: ${label}`, () => {
    const c = collapse(SECTION);
    if (tok.s !== undefined) assert.ok(c.includes(tok.s), `section must contain ${label}`);
    else assert.match(c, tok.re);
  });
  test(`AC2.1 control: removing ${tok.name} from the section fails its pin`, () => {
    const c = collapse(SECTION);
    if (tok.s !== undefined) {
      const doctored = c.split(tok.s).join('');
      assert.ok(!doctored.includes(tok.s), 'doctored section must no longer contain the token');
    } else {
      const doctored = c.replace(new RegExp(tok.re.source, 'g' + (tok.re.flags.includes('i') ? 'i' : '')), '');
      assert.doesNotMatch(doctored, tok.re);
    }
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

// Task 2 (#3033): the wrap-up detect-from-context block and the skill-graph
// wrap-up → /flow row point at the Mixed execution convention. The frozen
// pre-change bytes (473afed84) back each live pin with a control.
const WRAPUP_LIVE = read('plugin/skills/wrap-up/SKILL.md');
const GRAPH_LIVE = read('docs/skill-graph.md');

const detectBlock = (text) =>
  sectionBetween(text, /^#### If no arguments, detect from context:\r?$/m, /^\| Type \|/m);

const flowRow = (text) => {
  const sec = sectionBetween(text, /^## wrap-up\r?$/m, /^## Provenance\r?$/m);
  const row = sec.split(/\r?\n/).find((l) => l.startsWith('| `/flow` |'));
  assert.ok(row, 'wrap-up section must have a /flow row');
  return row;
};

const WRAPUP_PRE = `#### If no arguments, detect from context:

1. Check recent git commits and the current branch name for record references
2. Review conversation for references to records or features
3. Check for a materialized header (\`work/*-spec.md\` in the run dir or its worktree mirror) — record mode

| Type | Characteristics | Primary Focus |
`;

const GRAPH_PRE = '## wrap-up\n\n' + `| \`/flow\` | Invoked BY \`/flow\` as the pipeline's final step; flow waits for \`/wrap-up\`'s Phase 4 Review Console before archiving the run directory. Multi-spec runs set \`MULTISPEC_REVIEW_DEFER=1\` so per-spec wrap-ups defer to flow's consolidated console, and \`MULTISPEC_CURATION_DEFER=1\` so per-spec Phase 1 Reflect and Phase 2 registry curation defer to flow's batch-scope pass (\`flow/multispec-batch-curation.md\`). |` + '\n\n## Provenance\n';

test('AC1.3 wrap-up detect-from-context block points at the Mixed execution section', () => {
  assert.match(collapse(detectBlock(WRAPUP_LIVE)), /multi-spec\.md`?'s "Mixed execution" section/);
});

test('AC2.1 control: the pre-change detect-from-context block does not point at it', () => {
  assert.doesNotMatch(collapse(detectBlock(WRAPUP_PRE)), /multi-spec\.md`?'s "Mixed execution" section/);
});

test('AC1.4 skill-graph wrap-up → /flow edge names the mixed-execution convention', () => {
  assert.match(flowRow(GRAPH_LIVE), /Mixed execution convention/);
});

test('AC2.1 control: the pre-change wrap-up → /flow edge does not name it', () => {
  assert.doesNotMatch(flowRow(GRAPH_PRE), /Mixed execution convention/);
});
