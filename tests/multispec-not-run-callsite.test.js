// tests/multispec-not-run-callsite.test.js — #818: multispec-console-template.md's
// footer rule and multispec-review-console.md's claim-release step both key off
// manifest.yml's specs[].status === 'not-run', but before this fix no traced call
// site in multi-spec.md / multispec-failure-handling.md / claim-targets.md ever
// invoked `spec-status --status not-run` for a spec skipped after an earlier
// HARD-GATE failure (default non-keep-going mode) — those specs' issue claims were
// never released. This test extracts the newly-added call site verbatim from
// skills/flow/multispec-failure-handling.md and runs it against a real fixture
// manifest.yml, proving the documented command actually performs the transition
// the footer and claim-release step expect.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readManifest } = require('../plugin/bin/lib/flow/manifest');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'plugin', 'bin', 'hooks.js');
const FAILURE_HANDLING = readText(
  path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-failure-handling.md'),
);

// Frozen bytes of the file's "Default — stop on first HARD-GATE" section before
// this fix added the call site (verbatim through the pre-fix final line) — proves
// the extraction/assertions below can actually go red, per skill-prose-conformance
// convention [IL-105].
const PRE_FIX_SECTION = `## Default — stop on first HARD-GATE

A gate failure in one spec stops the remaining specs. This is the compounding-risk default: spec N+1 may build on spec N's correctness, so continuing past a known failure is risky.

\`\`\`
spec 157 — passed
spec 159 — FAILED at test (3 type errors)
spec 160 — not run (previous spec failed)
\`\`\`

The consolidated Review Console still runs with whatever was accumulated up to the failure; specs 158-160 appear in the **Not run** footer with status \`not-run\`, reason \`previous spec failed (159)\`.
`;

function extractNotRunSnippet(doc = FAILURE_HANDLING) {
  const section = doc.match(
    /\*\*Call site\.\*\*[\s\S]*?```bash\n([\s\S]*?)\n```/,
  );
  assert.ok(
    section,
    'skills/flow/multispec-failure-handling.md must have a "**Call site.**" paragraph with a fenced bash block calling spec-status --status not-run — extraction pattern is out of sync with the doc',
  );
  return section[1];
}

test('the pre-fix fixture actually lacks the call site (proves the extraction can go red)', () => {
  assert.doesNotMatch(PRE_FIX_SECTION, /\*\*Call site\.\*\*/, 'pre-fix fixture must not carry the Call site paragraph, or the live presence check below is vacuous');
  assert.doesNotMatch(PRE_FIX_SECTION, /--status not-run/, 'pre-fix fixture must not carry a not-run status call');
});

test('multispec-failure-handling.md documents the not-run call site with the correct flag shape', () => {
  const snippet = extractNotRunSnippet();
  assert.match(snippet, /spec-status/, 'call site must invoke the spec-status subcommand');
  assert.match(snippet, /--run "\$MULTISPEC_PARENT_DIR"/, 'must target the parent run dir, never a per-spec PIPELINE_RUN_DIR, per multi-spec.md\'s Run directory layout');
  assert.match(snippet, /--status not-run/, 'must transition to not-run, the status the footer and claim-release step read');
});

function runDirWithManifest(specs) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-notrun-callsite-'));
  execFileSync('git', ['-C', project, 'init', '-q']);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-08-22T011331-spec-157-159-160');
  fs.mkdirSync(run, { recursive: true });
  // #1566: resolveRunArg now requires an initialized run dir (a real
  // multi-spec parent already carries this from the Manifesto, before
  // manifest.yml itself is ever written) — spec-status has no first-write
  // exception of its own, so this fixture needs a marker too.
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  const lines = ['multispec:', '  parent: x/', '  specs:'];
  for (const s of specs) {
    lines.push(`    - id: ${s.id}`, `      status: ${s.status}`, `      subdir: spec-${s.id}/`);
  }
  fs.writeFileSync(path.join(run, 'manifest.yml'), lines.join('\n') + '\n');
  return run;
}

test('the documented not-run call site, executed verbatim, transitions a skipped spec to not-run in manifest.yml', () => {
  // spec 157 passed (already complete), 159 failed the HARD-GATE, 160 was never
  // reached — exactly multi-spec.md's default (non-keep-going) failure scenario.
  const run = runDirWithManifest([
    { id: 157, status: 'complete' },
    { id: 159, status: 'failed' },
    { id: 160, status: 'pending' },
  ]);

  const snippet = extractNotRunSnippet().replace('{n}', '160');
  const script = `CLAUDE_PLUGIN_ROOT=${JSON.stringify(toPosix(path.join(ROOT, 'plugin')))} MULTISPEC_PARENT_DIR=${JSON.stringify(run)}\n${snippet}`;
  const stdout = execFileSync('bash', ['-c', script], { cwd: run, encoding: 'utf8' });

  // not-run emits no summaryLine (transitionSpec only emits one for
  // complete/failed) — only the phase-progress banner.
  assert.match(stdout, /^## Flow: Running build \(3\/3\) — spec #160\n$/);

  const manifest = readManifest(run);
  assert.equal(manifest.multispec.specs.find((s) => String(s.id) === '160').status, 'not-run');
  // Untouched siblings prove this call site targets exactly the named spec.
  assert.equal(manifest.multispec.specs.find((s) => String(s.id) === '157').status, 'complete');
  assert.equal(manifest.multispec.specs.find((s) => String(s.id) === '159').status, 'failed');
});

test('multispec-review-console.md\'s claim-release step already documents the not-run branch this call site feeds', () => {
  const consoleDoc = readText(
    path.join(ROOT, 'plugin', 'skills', 'flow', 'multispec-review-console.md'),
  );
  assert.match(consoleDoc, /status: not-run/, 'multispec-review-console.md must still document reading status: not-run off manifest.yml — the consumer side of this call site');
});

test('CRLF control (#3670): multispec-not-run-callsite extracts the same result after a CRLF round-trip through readText()', (t) => {
  const DOC_PATH = path.join(ROOT, 'plugin/skills/flow/multispec-failure-handling.md');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multispec-not-run-crlf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const lf = readText(DOC_PATH);
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'), 'CRLF build must contain \\r\\n');
  assert.ok(!crlf.includes('\r\r\n'), 'CRLF build must not contain \\r\\r\\n');
  const file = path.join(tmp, path.basename(DOC_PATH));
  fs.writeFileSync(file, crlf);
  assert.deepStrictEqual(extractNotRunSnippet(readText(file)), extractNotRunSnippet(lf));
});
