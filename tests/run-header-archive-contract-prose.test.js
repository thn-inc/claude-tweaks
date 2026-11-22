'use strict';
// tests/run-header-archive-contract-prose.test.js — #3976 AC6: the contract text for the spec
// header's life cycle. `flow/materialize.md` and `_shared/pipeline-run-dir.md` say the header is
// committed during the run and archived on the run branch at wrap-up (`bin/archive-run-header.js`),
// not "committed as audit trail" and not "reaches the main checkout by merge".
//
// The live files are the subject, and they are expected to change again, so every claim is proved
// twice [IL-105]: it holds on the live text, and it fails — with its own message — on a frozen
// pre-change excerpt. The frozen excerpts are the real bytes at commit ad293d193f (the commit
// before this change), copied from `git show ad293d193f:plugin/skills/flow/materialize.md`
// (line 98's closing sentence; the `## Committed as audit trail, never gitignored` heading and its
// first paragraph) and `git show ad293d193f:plugin/skills/_shared/pipeline-run-dir.md` (the
// `work/{n}-spec.md` bullet, lines 73-75). They are string literals, so they survive later edits to
// the live files [IL-80].
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const MATERIALIZE = readText(path.join(ROOT, 'plugin/skills/flow/materialize.md'));
const RUN_DIR = readText(path.join(ROOT, 'plugin/skills/_shared/pipeline-run-dir.md'));

// ad293d193f: materialize.md line 98 (last sentence is the pinned one) and lines 183-185.
const PRE_CHANGE_MATERIALIZE = `\`surface\`/\`design-intent\`/\`ui-stack\`/\`design-seed\` values are LIFTED from the record body's \`Surface:\`/\`Design-intent:\`/\`Ui-stack:\`/\`Design-seed:\` metadata lines (spec 17's wire format). Materialized files live under the run dir — committed as audit trail, never gitignored.

## Committed as audit trail, never gitignored

Materialized files are meant to survive as ordinary tracked history on the branch that builds them. Unlike the rest of the pipeline run directory (\`config.yml\`, \`decisions.md\`, \`staged/\`, \`run-state.json\`, \`events.jsonl\` — all gitignored, archived as plain files at wrap-up, never committed for a \`/flow\`/\`/build\` run; a \`*-tidy-standalone*\` or \`*-sweep-standalone*\` run's own \`decisions.md\`/\`report.md\`/\`staged/**\` are the one carve-out to "never committed" — \`_shared/auto-decision-log.md\`'s tidy-standalone/sweep-standalone clause, #1493/#1494; see \`_shared/auto-mode-contract.md\` for everything else), the \`work/\` subdirectory is a deliberate, narrow exception: \`.gitignore\` carves it out of the otherwise-blanket \`.claude-tweaks/pipelines/\` ignore so \`git add\`/\`git commit\` actually track it, at both the single-record depth (\`{run-id}/work/\`) and the multi-record depth (\`{run-id}/spec-{N}/work/\`).
`;

// ad293d193f: pipeline-run-dir.md lines 73-75, plus the next bullet's opening line as the boundary.
const PRE_CHANGE_RUN_DIR = `- **\`work/{n}-spec.md\` is the first of two exceptions** and stays inside the worktree. It is
  git-tracked and must be committed onto the feature branch; it reaches the main checkout by
  merge.
- **A \`*-tidy-standalone*\` run's own audit files are the second exception (#1493)** — under
`;

const collapse = (s) => s.replace(/\s+/g, ' ');

const NEW_HEADING = '## Committed during the run, archived on the branch at wrap-up';
const LINE_98_TAIL = 'committed during the run and archived on the branch at wrap-up, never gitignored.';
const SECTION_SENTENCES =
  'At wrap-up, before the merge, `bin/archive-run-header.js` `git mv`s every tracked file under `work/` and `spec-{N}/work/` to `archive/{run-id}/` in one commit on the run branch (#3976), so the merge lands the header already archived; reconcile\'s `archiveRunDir` moves it after the merge only for a run merged without that step. `.gitignore` tracks `*-spec.md` only under each `work/`.';
const BULLET_PHRASE =
  'it is committed on the feature branch during the run and, at wrap-up before the merge, `git mv`\'d to `archive/{run-id}/` on the branch (`bin/archive-run-header.js`, #3976), so it reaches the main checkout already archived.';
const INVARIANT_SENTENCE =
  'After wrap-up no consumer reads the header from the live path directly: every header reader resolves it through `bin/lib/run-header.js`\'s resolver (#3974) or, like `/tidy`\'s backstop `find`, matches both the live and the archived path — the one accepted exception is `flow/multispec-review-console.md`\'s Shared teardown header capture, which reads the live path and then the archived one itself, and falls back to the manifest id and a `SKIP` only when both miss.';

// The line on materialize.md that names how materialized files are committed (line 98 pre-change).
function line98(text) {
  const lines = text.split('\n').filter((l) => l.includes('Materialized files live under the run dir'));
  assert.equal(lines.length, 1, 'expected exactly one "Materialized files live under the run dir" line');
  return collapse(lines[0]);
}

// The section that opens with `## Committed `, whichever way its heading is worded: the claim
// about the heading is separate from the claim about the body, so each fails for its own reason.
function committedSection(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## Committed '));
  assert.notEqual(start, -1, 'no `## Committed ` section found');
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  return { heading: lines[start], body: lines.slice(start + 1, end).join('\n') };
}

// The `work/{n}-spec.md` bullet: from its opening line to the next top-level bullet.
function specBullet(text) {
  const open = '- **`work/{n}-spec.md` is the first of two exceptions**';
  const start = text.indexOf(open);
  assert.notEqual(start, -1, 'the work/{n}-spec.md exceptions bullet is missing');
  const next = text.indexOf('\n- ', start + 1);
  assert.notEqual(next, -1, 'the bullet after the work/{n}-spec.md bullet is missing');
  return collapse(text.slice(start, next));
}

// Each claim is { message, holds(text) }; the message is the claim's own failure text.
const MATERIALIZE_CLAIMS = {
  'AC6.1 line 98 does not say "as audit trail"': {
    message: 'materialize.md line 98 still says "committed as audit trail"',
    holds: (t) => !/committed as audit trail/i.test(line98(t)),
  },
  'AC6.1 the section heading is not "Committed as audit trail"': {
    message: 'materialize.md still has the "Committed as audit trail" heading',
    holds: (t) => !/^## Committed as audit trail/m.test(t),
  },
  'AC6.2 line 98 says committed during the run and archived at wrap-up': {
    message: 'materialize.md line 98 lacks the "committed during the run and archived" tail',
    holds: (t) => line98(t).includes(LINE_98_TAIL),
  },
  'AC6.2 the section heading states commit during the run, archive at wrap-up': {
    message: 'materialize.md section heading is not the archive-at-wrap-up heading',
    holds: (t) => committedSection(t).heading === NEW_HEADING,
  },
  'AC6.2 the section states the wrap-up move and the .gitignore scope': {
    message: 'materialize.md section lacks the wrap-up move sentences',
    holds: (t) => collapse(committedSection(t).body).includes(SECTION_SENTENCES),
  },
};

const RUN_DIR_CLAIMS = {
  'AC6.3 the bullet says the header is archived on the branch before the merge': {
    message: 'pipeline-run-dir.md bullet lacks the archived-on-the-branch phrase',
    holds: (t) => specBullet(t).includes(BULLET_PHRASE),
  },
  'AC6.3 the bullet states the resolver invariant': {
    message: 'pipeline-run-dir.md bullet lacks the resolver invariant sentence',
    holds: (t) => specBullet(t).includes(INVARIANT_SENTENCE),
  },
  'AC6.3 the bullet no longer says it reaches the main checkout by merge': {
    message: 'pipeline-run-dir.md bullet still says "reaches the main checkout by merge"',
    holds: (t) => !specBullet(t).includes('it reaches the main checkout by merge.'),
  },
};

// One claim per call: it holds on the live text AND fails, with its own message, on the frozen
// pre-change text — so a green result proves the claim can go red for the reason it names [IL-105].
function pinned(claims, name, live, frozen) {
  const { message, holds } = claims[name];
  assert.ok(holds(live), message);
  assert.throws(() => assert.ok(holds(frozen), message), (e) => e instanceof assert.AssertionError && e.message === message,
    `"${name}" must fail on the pre-change text with its own message`);
}

for (const name of Object.keys(MATERIALIZE_CLAIMS)) {
  test(`materialize.md: ${name}`, () => {
    pinned(MATERIALIZE_CLAIMS, name, MATERIALIZE, PRE_CHANGE_MATERIALIZE);
  });
}

for (const name of Object.keys(RUN_DIR_CLAIMS)) {
  test(`pipeline-run-dir.md: ${name}`, () => {
    pinned(RUN_DIR_CLAIMS, name, RUN_DIR, PRE_CHANGE_RUN_DIR);
  });
}

test('the frozen excerpts are real: each carries the pre-change phrase the claims retire', () => {
  assert.ok(collapse(PRE_CHANGE_MATERIALIZE).includes('Materialized files live under the run dir — committed as audit trail, never gitignored.'));
  assert.ok(PRE_CHANGE_MATERIALIZE.includes('\n## Committed as audit trail, never gitignored\n'));
  assert.ok(specBullet(PRE_CHANGE_RUN_DIR).includes('it reaches the main checkout by merge.'));
});
