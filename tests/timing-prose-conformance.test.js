// tests/timing-prose-conformance.test.js — #1928 prose pins.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

test('#1928: multi-spec.md cites the run-dir layout sub-file and stays under its read budget', () => {
  const ms = read('plugin/skills/flow/multi-spec.md');
  assert.match(ms, /multispec-run-dir-layout\.md/);
  assert.ok(Buffer.byteLength(ms, 'utf8') < 20480, `multi-spec.md is ${Buffer.byteLength(ms, 'utf8')} B`);
  assert.match(ms, /\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-spec-\{N1\}-\{N2\}-\{N3\}\//, 'the anchoring diagram stays in multi-spec.md');
});

test('#1928: the layout sub-file documents manifest.yml phases[] and the latest phase', () => {
  const sub = read('plugin/skills/flow/multispec-run-dir-layout.md');
  assert.match(sub, /phases:\s*\n\s+- phase: /, 'the YAML example shows the phases[] list');
  assert.match(sub, /`phases\[\]`[^.]*append-only|append-only[^.]*`phases\[\]`/i);
  assert.match(sub, /spec-status/);
});

const CEILING = CEILING_BYTES;

test('#1928 AC6: both summary templates carry a ### Timing section rendered from phase-timing.js', () => {
  for (const f of ['plugin/skills/flow/summary-template.md', 'plugin/skills/wrap-up/summary-template.md']) {
    const t = read(f);
    assert.match(t, /^### Timing$/m, f);
    assert.match(t, /bin\/phase-timing\.js" --run "\$PIPELINE_RUN_DIR" --markdown/, f);
    assert.match(t, /\| Phase \| Minutes \| Verify \|/, f);
  }
});

test('#1928: the multi-spec summary also carries a ### Timing section, rendered at the parent level', () => {
  const t = read('plugin/skills/flow/multispec-summary.md');
  assert.match(t, /^### Timing$/m);
  assert.match(t, /bin\/phase-timing\.js" --run "(\$PIPELINE_RUN_DIR|\$MULTISPEC_PARENT_DIR)" --markdown/);
  assert.match(t, /\| Phase \| Minutes \| Verify \|/);
});

test('#1928 AC6: pr-run-comments.md has a timing comment kind with its producer', () => {
  const t = read('plugin/skills/_shared/pr-run-comments.md');
  assert.match(t, /^\| `timing` \| `\/claude-tweaks:wrap-up`[^|]*\| `<!-- run-comment: timing -->` \|$/m);
  assert.match(t, /^\| `\/claude-tweaks:wrap-up` \([^)]*verification-brief\.md[^)]*\) \| `timing` \|/m);
  assert.match(read('plugin/skills/wrap-up/verification-brief.md'), /run-comment: timing/);
});

test('#1928 AC6: reporting.md prints the per-group timing line from timing.json, and SKILL.md stays under the ceiling', () => {
  const t = read('plugin/skills/dispatch/reporting.md');
  assert.match(t, /`timing: call-1 \{m\}m · call-2 \{m\}m · verify \{n\} run\(s\) \(\{modes\}\)/, 'the #1929 token-clause extension keeps this literal as a prefix');
  assert.match(t, /timing\.json/);
  const skill = read('plugin/skills/dispatch/SKILL.md');
  assert.ok(Buffer.byteLength(skill, 'utf8') <= CEILING, `dispatch/SKILL.md is ${Buffer.byteLength(skill, 'utf8')} B`);
});

test('#1928: the canonical verify.js snippets pass --run "$PIPELINE_RUN_DIR"', () => {
  const v = read('plugin/skills/test/verification.md');
  const snippets = [...v.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('bin/verify.js') && b.includes('--cmd'));
  assert.ok(snippets.length >= 2, 'both the canonical and the --scope invocation');
  for (const s of snippets) assert.match(s, /--run "\$PIPELINE_RUN_DIR"/);
  assert.match(v, /empty[^.]*no `verify` event|no `verify` event[^.]*empty/i);
});

test('#1928: docs name the timing module, the CLI, and the flow/wrap-up table source', () => {
  const ps = read('docs/plugin-structure.md');
  assert.match(ps, /^plugin\/bin\/lib\/timing\/ /m);
  assert.match(ps, /^node plugin\/bin\/phase-timing\.js --run <dir> \[--json\] \[--markdown\]/m);
  assert.match(ps, /verify\.js[^\n]*\[--run <dir>\]/);
  const sg = read('docs/skill-graph.md');
  const flow = sg.slice(sg.indexOf('\n## flow\n'), sg.indexOf('\n## ', sg.indexOf('\n## flow\n') + 1));
  const wrap = sg.slice(sg.indexOf('\n## wrap-up\n'), sg.indexOf('\n## ', sg.indexOf('\n## wrap-up\n') + 1));
  const dispatch = sg.slice(sg.indexOf('\n## dispatch\n'), sg.indexOf('\n## ', sg.indexOf('\n## dispatch\n') + 1));
  assert.match(flow, /`bin\/phase-timing\.js`/);
  assert.match(wrap, /`bin\/phase-timing\.js`/);
  assert.match(dispatch, /`bin\/phase-timing\.js`/);
});

test('#1929 AC5: the three summary Timing blocks, the PR timing command, and pr-run-comments.md pass --auto-transcript after --markdown', () => {
  const noteExempt = new Set(['plugin/skills/_shared/pr-run-comments.md', 'docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md', 'docs/journeys/see-which-phase-spent-the-tokens-1929.md']);
  for (const f of ['plugin/skills/flow/summary-template.md', 'plugin/skills/wrap-up/summary-template.md', 'plugin/skills/flow/multispec-summary.md', 'plugin/skills/wrap-up/verification-brief.md', 'plugin/skills/_shared/pr-run-comments.md', 'docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md', 'docs/journeys/see-which-phase-spent-the-tokens-1929.md']) {
    const t = read(f);
    assert.match(t, /bin\/phase-timing\.js"? --run "(\$PIPELINE_RUN_DIR|\$MULTISPEC_PARENT_DIR)" --markdown --auto-transcript/, f);
    if (!noteExempt.has(f)) assert.match(t, /tokens: transcript not found/, `${f} must say the note line renders verbatim`);
  }
});

test('#1929 AC5: reporting.md carries the token clause on its timing line, and SKILL.md stays under the ceiling', () => {
  const t = read('plugin/skills/dispatch/reporting.md');
  assert.match(t, /`timing: call-1 \{m\}m · call-2 \{m\}m · verify \{n\} run\(s\) \(\{modes\}\) · \{k\} tokens in \/ \{m\} out`/);
  assert.match(t, /--transcript/, 'dispatch passes both agent transcripts explicitly');
  const skill = read('plugin/skills/dispatch/SKILL.md');
  assert.ok(Buffer.byteLength(skill, 'utf8') <= CEILING, `dispatch/SKILL.md is ${Buffer.byteLength(skill, 'utf8')} B`);
});

test('#1929: docs name the transcript reader, the new flags, and the guard counts', () => {
  const ps = read('docs/plugin-structure.md');
  assert.match(ps, /^plugin\/bin\/lib\/timing\/ [^\n]*transcript\.js/m);
  assert.match(ps, /^node plugin\/bin\/phase-timing\.js --run <dir> \[--json\] \[--markdown\] \[--transcript <path> \.\.\.\] \[--auto-transcript\]/m);
  assert.match(read('docs/hooks.md'), /timing\.json[^\n]*(gate-denial|guard)/);
});
