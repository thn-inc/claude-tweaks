'use strict';
// Conformance suite for spec-template.md's generated-file grep (record #1321).
// Live-corpus read is deliberate: the paragraph IS the declared contract being
// pinned, and catching future drift in it is the point (skill-prose-conformance-tests
// Decision Framework, live-corpus convention row). Go-red proofs per [IL-105] run
// every pattern against the frozen pre-change excerpt below.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const specTemplate = readText(path.join(ROOT, 'plugin/skills/specify/spec-template.md'));
const shapingMode = readText(path.join(ROOT, 'plugin/skills/specify/shaping-mode.md'));

// The exact snippet the paragraph pins (copied from the edit's replacement text).
const SNIPPET = 'grep -rln "{basename}" plugin/bin plugin/hooks scripts tools 2>/dev/null';
// Structural anchor: the bash fence whose first line is the {basename} grep —
// never a prose sentence (skill-prose-conformance-tests: anchor on structure).
const EXTRACT_RE = /```bash\n(grep -rln "\{basename\}"[^\n]*)\n```/;

// Frozen pre-change excerpt — the Key Files guidance tail before #1321's paragraph
// landed. It carries the section anchor and the rename-grep opening and lacks only
// the new content, so doesNotMatch proves each pattern can go red [IL-105]. A string
// literal, not a read of history, so it survives every later edit to the live file.
const PRE_CHANGE_KEY_FILES_TAIL = `### Key Files

- \`{path}\` — {what changes or new file purpose}
- \`{path}\` — {what changes}

When this work **renames** a contract surface — a report section heading, a check name, an exported symbol, or any other name other files reference by literal text — grep the repo for the surface's exact old literal text.

### Package Dependencies
`;

const PRE_CHANGE_SHAPING_MODE_TAIL = 'every consumer file the rename-grep in `spec-template.md`\'s `### Key Files` guidance turns up. One bullet per path,';

function assertPinned(haystack, pattern, msg) {
  assert.match(haystack, pattern, msg);
  assert.doesNotMatch(PRE_CHANGE_KEY_FILES_TAIL, pattern, 'pattern must NOT match the pre-change excerpt (proves it can go red)');
}

// Shared by the live-probe tests: extract the pinned snippet, substitute
// {basename}, and run it as the grep the paragraph describes.
function runProbeGrep(basename) {
  const m = EXTRACT_RE.exec(specTemplate);
  assert.ok(m, 'extraction failed — cannot probe');
  const cmd = m[1].replace('{basename}', basename);
  return spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
}

test('spec-template.md pins the generated-file grep paragraph', () => {
  assertPinned(specTemplate, /generated-file grep/, 'paragraph anchor missing');
  assertPinned(specTemplate, /edit the generator, not this file/, 'generated-entry annotation rule missing');
  assertPinned(specTemplate, /both reads and writes/, 'read-and-write producer classification missing');
  assertPinned(specTemplate, /git ls-files \| grep -c "\/\{basename\}\$"/, 'concrete path-fallback trigger missing');
});

test('the byte-pinned snippet is present and extractable by structural anchor', () => {
  const m = EXTRACT_RE.exec(specTemplate);
  assert.ok(m, 'extraction pattern is out of sync — bash fence opening with the {basename} grep not found');
  assert.strictEqual(m[1], SNIPPET, 'snippet drifted from the pinned literal');
  assert.strictEqual(EXTRACT_RE.exec(PRE_CHANGE_KEY_FILES_TAIL), null, 'extractor must find nothing in the pre-change excerpt (proves it discriminates)');
});

test('shaping-mode.md cites the generated-file grep alongside the rename-grep', () => {
  assert.match(shapingMode, /generator module the generated-file grep/, 'shaping-mode citation clause missing');
  assert.doesNotMatch(PRE_CHANGE_SHAPING_MODE_TAIL, /generator module the generated-file grep/, 'citation pattern must not match the pre-change excerpt');
  assert.match(shapingMode, /rename-grep/, 'rename-grep citation must survive the clause insertion');
});

test('live probe: the snippet finds the real generator from its generated file', () => {
  const r = runProbeGrep('track-issue-fixes.yml');
  assert.strictEqual(r.status, 0, 'probe grep failed: ' + r.stderr);
  const hits = r.stdout.trim().split('\n');
  assert.ok(hits.includes('plugin/bin/lib/issue-branch-tracking.js'), 'generator not surfaced; got: ' + r.stdout);
});

test('negative control: a producer-less basename yields zero executable-code hits', () => {
  // A nonsense token structurally unlikely to ever match (spec Gotcha: never a
  // plausible module name); a future hit here means re-pick the control, not a
  // product regression.
  const r = runProbeGrep('zzz-no-such-generator-1321.md');
  // grep -l exits 1 on zero matches — that IS the expected outcome here.
  assert.ok(r.status === 0 || r.status === 1, 'probe errored: ' + r.stderr);
  assert.strictEqual(r.stdout.trim(), '', 'expected zero hits, got: ' + r.stdout);
});
