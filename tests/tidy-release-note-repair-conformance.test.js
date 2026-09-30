'use strict';
// #2828: the Fill Release Note action's registration sites and its main-thread procedure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const SKILL = read('plugin/skills/tidy/SKILL.md');
const SUB = read('plugin/skills/tidy/release-note-repair.md');
const ROUTING = read('plugin/skills/tidy/collection-routing.md');
const STRUCTURE = read('docs/plugin-structure.md');

test('release-note-repair.md cites its contracts instead of restating them', () => {
  for (const cite of ['_shared/reverify-before-write.md', '_shared/auto-decision-log.md', 'specify/spec-template.md',
    '_shared/github-write-transport.md', '_shared/record-queue-fetch.md', '_shared/session-tmp-root.md', '_shared/pipeline-run-dir.md']) {
    assert.ok(SUB.includes(cite), `missing citation: ${cite}`);
  }
});

test('release-note-repair.md drives the CLI and branches on every exit', () => {
  const f = flat(SUB);
  assert.ok(f.includes('release-note-repair.js" repair --driver github-issues'));
  assert.ok(f.includes('release-note-repair.js" repair --driver local-files'));
  assert.ok(f.includes('release-note-repair.js" verify'));
  // Anchored to the list-item form the prose actually uses, so a stray "10:" or a time of day
  // can't satisfy these the way an unanchored substring check would.
  for (const exit of ['- 0:', '- 4:', '- 5:', '- 6:', '- 3:', '- 2:']) assert.ok(f.includes(exit), `missing exit branch ${exit}`);
  assert.ok(f.includes('Exit 7'), 'missing the github verify exit 7 branch');
  assert.ok(f.includes('- 7 (`local-files` only):'), 'missing the local-files repair exit 7 branch');
  assert.ok(f.includes('never a weaker line'));
  assert.ok(f.includes('`/claude-tweaks:specify {ref}`'));
});

test('release-note-repair.md handles a failed gh issue edit call by re-reading before treating it as a repair failure', () => {
  const f = flat(SUB);
  assert.ok(f.includes('A failed edit call itself'), 'missing the edit-failure branch');
  assert.ok(f.includes("Unchanged from `{live-json}`'s body"));
});

test('release-note-repair.md truncates the Applied sub-line to fit the report lint\'s 100-char cap', () => {
  assert.ok(SUB.includes('truncated to 96 characters'));
});

test('the Stage-tier command\'s first line carries a bounded ref, never a local-files file path', () => {
  const text = flat(SUB);
  assert.ok(text.includes('"command": "insert into {short-ref} — release-note-repair.md'));
  assert.ok(text.includes('`{short-ref}` is `#{n}` on `github-issues` and `record {id}` on `local-files` — never the record\'s file path'));
  assert.ok(!text.includes('"insert into {ref} —'));
});

test('step-6-interactive.md names release-note-repair.md for [release-note] rows, never recomposing the line', () => {
  const interactive = read('plugin/skills/tidy/step-6-interactive.md');
  assert.ok(interactive.includes('`[release-note]` rows are staged and rendered exactly as `release-note-repair.md` describes'));
  assert.ok(interactive.includes('never recomposed here'));
});

test('the undo snapshot is under snapshots/, never staged/', () => {
  assert.ok(SUB.includes('{run-dir}/snapshots/tidy-release-note-{id}.original.md'));
  assert.ok(!/staged\/tidy-release-note-[^\s`]*\.original/.test(SUB));
  assert.ok(!/staged\/tidy-release-note-[^\s`]*\.original/.test(read('plugin/bin/release-note-repair.js')));
});

test('SKILL.md registers the tag, the action, the backend probe count, and the Step 7.5 line', () => {
  const f = flat(SKILL);
  assert.ok(f.includes('`[release-note]` (Shape 4.5'));
  assert.match(SKILL, /^\| \*\*Fill Release Note\*\* \| .*release-note-repair\.md.* \| No — one body section added, labels unchanged \|$/m);
  assert.ok(f.includes('Six actions read `work-backend` first'));
  assert.ok(!f.includes('Five actions read'));
  assert.ok(f.includes('`Fill Release Note` writes one body section and never a label.'));
  assert.ok(f.includes('- [x] Filled Release Note: "{title}"'));
  assert.ok(f.includes('- [x] Skipped Release Note: {ref} — stale premise'));
});

test('SKILL.md dispatcher block resolves a fresh session-scoped candidates path per run', () => {
  const start = SKILL.indexOf('**Before dispatching the Work Records agent,**');
  assert.notEqual(start, -1, 'dispatcher note missing');
  const m = /```bash\n([\s\S]*?)\n```/.exec(SKILL.slice(start));
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  const script = m[1].split('${CLAUDE_PLUGIN_ROOT}').join(path.join(ROOT, 'plugin'));
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: `rn-dispatch-${process.pid}` };
  const a = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }).trim();
  const b = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }).trim();
  assert.match(a, /ct-session-rn-dispatch-\d+\/tidy-release-note-\d+\.json$/);
  assert.notEqual(a, b, 'each run must get a fresh name');
  fs.rmSync(path.dirname(a), { recursive: true, force: true });
});

test('collection-routing.md routes [release-note] with the Approve/Applied tags and names its Yours outcomes', () => {
  const row = ROUTING.split('\n').find((l) => l.startsWith('| `[backlog]`'));
  assert.ok(row.includes('`[release-note]`'));
  assert.ok(row.includes('`[release-note]` scan errors and repair failures land in **Yours ({N})**'));
});

test('docs/plugin-structure.md lists the sub-file, the module, and the CLI', () => {
  assert.match(STRUCTURE, /^\| tidy \| [^|]*release-note-repair\.md/m);
  assert.ok(STRUCTURE.includes('plugin/bin/lib/release-note-repair/ → detect.js'));
  assert.ok(STRUCTURE.includes('node plugin/bin/release-note-repair.js scan|repair|verify'));
});

const STEP6 = read('plugin/skills/tidy/step-6-auto.md');
const CONTRACT = read('plugin/skills/_shared/auto-mode-contract.md');

test('step-6-auto.md: Fill Release Note is Stage / Auto-apply / Auto-apply with its stated exemption', () => {
  const row = STEP6.split('\n').find((l) => l.startsWith('| **Fill Release Note** ('));
  assert.ok(row, 'routing row missing');
  assert.match(row, /\| Stage \| Auto-apply \| Auto-apply — /);
  assert.ok(row.includes('exemption from the reversibility floor'));
  assert.ok(row.includes('`{run-dir}/snapshots/`'));
  assert.ok(row.includes('Open parent gate row above'));
  const parentGate = STEP6.indexOf('| **Open parent gate** (');
  assert.ok(parentGate !== -1 && STEP6.indexOf(row) > parentGate, 'row must follow the Open parent gate row');
});

test('step-6-auto.md: the preamble names the carve-out and Column shape allows the sub-line', () => {
  assert.ok(flat(STEP6).includes('bar that contract\'s one named carve-out, the **Fill Release Note** row below'));
  assert.ok(flat(STEP6).includes('An Applied row may carry one three-space-indented detail sub-line'));
});

test('auto-mode-contract.md names the carve-out inside the Never-reversible section', () => {
  const start = CONTRACT.indexOf('### Never-reversible (auto-FORBIDDEN, regardless of mode)');
  const section = CONTRACT.slice(start, CONTRACT.indexOf('## What `auto` silences', start));
  assert.match(section, /Network calls beyond reads \(no API writes, no message sends\) — except `\/claude-tweaks:tidy`'s Release Note repair/);
  assert.ok(section.includes('**Fill Release Note**'));
});

test('sweep, the tidy journey, and the skill graph restate the new tier truthfully', () => {
  assert.ok(read('plugin/skills/sweep/SKILL.md').includes('Arm-ready-PR, and Fill-Release-Note'));
  const journey = read('docs/journeys/tidy-standalone-auto-report.md');
  assert.ok(journey.includes('the additive Release Note repair (`[release-note]`, snapshot first) auto-apply'));
  assert.ok(journey.includes('  - plugin/skills/tidy/release-note-repair.md'));
  assert.ok(journey.includes('Updated during build of #2828'));
  const graphRow = read('docs/skill-graph.md').split('\n').find((l) => l.startsWith('| `/tidy` | Folds `unsynced: true`'));
  assert.ok(graphRow.includes('Shape 4.5'));
});
