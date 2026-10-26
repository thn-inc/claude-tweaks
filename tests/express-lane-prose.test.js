'use strict';
// tests/express-lane-prose.test.js — #4025: pins the decisions plugin/skills/_shared/express-lane.md
// states (the express agent's procedure, which /dispatch and /flow cite by section name), the
// file's roster entry in _shared/ceremony-profile.md, and the express-review kind, gate exception
// and Consumer row in _shared/pr-run-comments.md. All of it is new prose in this change, so every
// go-red control mutates the live text in memory (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SHARED = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
const EXPRESS = readText(path.join(SHARED, 'express-lane.md'));
const CEREMONY = readText(path.join(SHARED, 'ceremony-profile.md'));
const COMMENTS = readText(path.join(SHARED, 'pr-run-comments.md'));

const [ELIG, PROC, ESC, OUT, SAMP] = ['## Eligibility', '## Procedure', '## Escalation', '## Outcomes', '## Post-merge sampling'];
const SECTIONS = [ELIG, PROC, ESC, OUT, SAMP];
const PREAMBLE = null;
const headingRe = (h) => new RegExp(`^${h}$`, 'm');

// The text under heading `h` (up to the next `## `), the text before the first `## ` for
// PREAMBLE, or '' when the heading is gone.
function sectionOf(text, h) {
  if (h === PREAMBLE) return text.split(/\n(?=## )/)[0];
  const start = text.indexOf(`\n${h}\n`);
  if (start === -1) return '';
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

// One fact per pattern, each matched only inside its own section, so a fact moved to the wrong
// section is reported missing. `section: 'whole'` facts are the headings themselves.
const FACTS = [
  ...SECTIONS.map((h) => ({ section: 'whole', re: headingRe(h), name: `heading ${h}` })),
  { section: PREAMBLE, re: /`\{branch\}` is what `git -C "\{wt\}" branch --show-current` prints/, name: 'branch from the worktree, not run-state.json' },
  { section: PREAMBLE, re: /`\$PIPELINE_RUN_DIR`, wherever a procedure this file cites reads it, is `\{run-dir\}`/, name: 'M4: $PIPELINE_RUN_DIR is bound to {run-dir}' },
  { section: ELIG, re: /express-lane\.js" gate --issue \{n\} --run "\{run-dir\}"/, name: 'gate verb' },
  { section: ELIG, re: /The lane requires `gh`: with `gh` absent the express path is never taken/, name: 'the lane requires gh' },
  { section: PROC, re: /express-lane\.js" check --run "\{run-dir\}" --issue \{n\} --integration-branch \{ref\}/, name: 'check verb' },
  { section: PROC, re: /merge-verification [^\n.]*never `off`/, name: 'AC4.1 prose: merge-verification never off' },
  { section: PROC, re: /Express merges require CI green/, name: 'AC4.1 prose: express merges require CI green' },
  { section: PROC, re: /\*\*Commit the edit\*\*[^\n]*before any test/, name: 'commit before any test' },
  { section: PROC, re: /record-pr --run "\{run-dir\}" \{number\} \{url\}`, then `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/set-config\.js" --run "\{run-dir\}" --set \{configSet\}`/, name: 'set-config.js configSet right after record-pr' },
  { section: PROC, re: /A non-zero exit → outcome `blocked` \(Escalation's failed-call rule\)/, name: 'check non-zero exit is blocked' },
  { section: PROC, re: /--step "Express lane check" --text '#\{n\} proceed — /, name: 'logged:false proceed hand-log shape' },
  { section: PROC, re: /`escalated #\{n\} to \/flow \(reason: \{reason\}\) — \{detail\}`[^\n]*--step "Express lane" --reversibility "high \(worktree and branch kept\)" --text-file/, name: 'logged:false escalation hand-log shape' },
  { section: PROC, re: /A failed call in this step → outcome `blocked`: the branch is pushed, so it cannot escalate/, name: 'step-7 failure is blocked' },
  { section: PROC, re: /except a working-directory denial that repeats after the one `record-worktree` re-stamp, which is outcome `blocked`/, name: 'a repeated working-directory denial is blocked, not gate-denial' },
  { section: PROC, re: /A push the remote rejects[^\n]*never forced or retried with other flags: escalate with reason `express-error`/, name: 'a rejected push escalates as express-error, never forced' },
  { section: PROC, re: /carries the express merge-verification and the `integration-model` pin/, name: 'step 7 config.yml carries the integration-model pin' },
  { section: PROC, re: /transient-looking \(5xx or timeout\) signature is retried once after a 15-second wait/, name: 'step 7 retries a transient gh pr create failure once' },
  { section: PROC, re: /A non-zero exit is outcome `pending-review` with no merge: the lane never merges without its summary entry/, name: 'step 8: a failed summary entry parks, never merges' },
  { section: PROC, re: /only when `git -C "\{wt\}" rev-parse HEAD` prints step 5's `head`; otherwise [^\n]*re-run steps 4–5/, name: 'M7: push only the HEAD check verified' },
  { section: PROC, re: /`wrap-up\/manifesto-authorized-merge\.md`'s Applicability check passes for `\{run-dir\}`/, name: 'M11: merge per the resolved merge-authorization' },
  { section: PROC, re: /closing-links\.js" --run "\{run-dir\}" --mode pre-merge`/, name: 'M5: stray closing-link check before merge' },
  { section: PROC, re: /A repo with no PR CI parks every express merge/, name: 'M2: the lane needs PR CI' },
  { section: ESC, re: /express-lane\.js" escalate --run "\{run-dir\}" --issue \{n\} --reason \{reason\} --detail-file "\{detail-file\}"/, name: 'escalate verb' },
  { section: ESC, re: /`failing-test`, `out-of-bounds`, `gate-denial`, `express-error`/, name: 'the four escalation reasons' },
  { section: ESC, re: /only before the push/, name: 'escalation only before the push' },
  { section: ESC, re: /A non-zero exit from `check` or `escalate` is outcome `blocked`, never `express-escalated` and never retried/, name: 'a failed CLI call is blocked, never escalated' },
  { section: ESC, re: /log it as the caller's rule-\(a\) entry/, name: 'rule-(a) entry for a failed CLI call' },
  { section: OUT, re: /`merged` \| `armed` \| `pending-review` \| `express-escalated` \| `blocked`/, name: 'outcome vocabulary' },
  { section: OUT, re: /`blocked` — the claim failed \(step 1\), a `check` or `escalate` call exited non-zero, or a step-7 call failed after the push/, name: 'blocked definition' },
  { section: OUT, re: /the express agent tears nothing down/, name: 'blocked: the express agent tears nothing down' },
  { section: OUT, re: /From `\/claude-tweaks:dispatch`, Settle releases and labels/, name: 'blocked from /dispatch: Settle releases and labels' },
  { section: OUT, re: /the dispatcher's `two-call-gate\.md` §5 removes the local worktree only/, name: 'blocked from /dispatch: §5 removes the local worktree only' },
  { section: OUT, re: /a pushed branch and draft PR stay open/, name: 'blocked from /dispatch: branch and draft PR stay open' },
  { section: OUT, re: /From `\/claude-tweaks:flow`, whatever already exists — worktree, branch, claim, run dir — stays for a human/, name: 'blocked from /flow: everything stays' },
  { section: OUT, re: /express-lane\.js" verify --run "\{run-dir\}" --issue \{n\}/, name: 'verify verb' },
  { section: OUT, re: /it reads the `archive\/\{run-id\}` copy/, name: 'C1: verify reads an archived run dir' },
  { section: SAMP, re: /Every git call runs in the main checkout, `git -C "\$RUN_ROOT" …`/, name: 'sampling git runs in the main checkout' },
  { section: SAMP, re: /It runs only at the end of a bare `\/claude-tweaks:dispatch` drain/, name: 'I4: sampling runs only at a drain\'s end' },
  { section: SAMP, re: /express-lane\.js" samples`/, name: 'samples verb' },
  { section: SAMP, re: /merged within the last 30 days[^\n]*at most 3 per firing, oldest first/, name: 'I3: lookback and per-firing cap' },
  { section: SAMP, re: /or 2 \(`gh` absent\) → no sweep this time: report it and do not retry/, name: 'samples exit 1 or 2: no sweep, no retry' },
  { section: SAMP, re: /A `mergeSha` of `null` → mint nothing/, name: 'null mergeSha mints nothing' },
  { section: SAMP, re: /`mkdir -p "\{run-dir\}\/context"`/, name: 'M8: context/ is created before the writes' },
  { section: SAMP, re: /does not list as deleted \(`D`\)/, name: 'no git show for a deleted path' },
  { section: SAMP, re: /Step 2\.5, raised to at least `medium`/, name: 'the sampled review runs at medium tier or above' },
  { section: SAMP, re: /The `-z` listing is NUL-split[^\n]*the object name is double-quoted/, name: 'sampled paths are NUL-listed (-z) and the object name is quoted' },
  { section: SAMP, re: /never after an explicit `\/claude-tweaks:dispatch #N` or an express merge made from `\/claude-tweaks:flow`/, name: 'sampling is drain-only, stated for #N and flow merges' },
  { section: SAMP, re: /Each body names its origin as `express-review of PR #\{pr\}`[^\n]*already appears in one of those bodies is cited in the comment by that record and not filed again/, name: 'a retried sweep does not re-file a finding' },
  { section: SAMP, re: /at every `autonomy` ceiling[^\n]*`_shared\/auto-mode-contract\.md`'s Work-record creation row/, name: 'I2: every finding is filed, at every ceiling' },
  { section: SAMP, re: /still unreviewed 30 days after its merge is never sampled[^\n]*name `capped: true` in the drain report/, name: 'lookback age-out is stated, and a capped backlog is reported' },
  { section: SAMP, re: /a failed capture/, name: 'I2: a failed capture is an incomplete review' },
  { section: SAMP, re: /only after every dispatched lens returned `DONE` or `DONE_WITH_CONCERNS`/, name: 'marker only after every lens finished' },
  { section: SAMP, re: /`<!-- run-comment: express-review -->`/, name: 'express-review marker' },
  { section: SAMP, re: /`gh pr comment \{pr\} --body-file "\{body-file\}"`/, name: 'the posting command' },
  { section: SAMP, re: /Every `SKIP` goes to that PR's sampling run dir/, name: 'where SKIP lines go' },
  { section: SAMP, re: /every sampling run dir carries the `decisions\.md` that `close-run` needs/, name: 'a posted review logs before close-run' },
  { section: SAMP, re: /hooks\.js" close-run --run "\{run-dir\}"/, name: 'close-run closes each sampling run dir' },
];

const scopeOf = (text, f) => (f.section === 'whole' ? text : sectionOf(text, f.section));
const missingFacts = (text) => FACTS.filter((f) => !f.re.test(scopeOf(text, f))).map((f) => f.name);

function assertSectionOrder(text, headings) {
  let last = -1;
  for (const h of headings) {
    const m = headingRe(h).exec(text);
    assert.ok(m, `missing ${h}`);
    assert.ok(m.index > last, `${h} is out of order`);
    last = m.index;
  }
}

// The text with the block under heading `a` moved above the block under heading `b`.
function moveAbove(text, a, b) {
  const blocks = text.split(/\n(?=## )/);
  const ia = blocks.findIndex((x) => x.startsWith(`${a}\n`));
  const ib = blocks.findIndex((x) => x.startsWith(`${b}\n`));
  assert.ok(ia !== -1 && ib !== -1, `${a} and ${b} must both head a block`);
  const [moved] = blocks.splice(ia, 1);
  blocks.splice(ib, 0, moved);
  return blocks.join('\n');
}

test('express-lane.md states every fact the express lane relies on, each in its own section', () => {
  assert.deepEqual(missingFacts(EXPRESS), []);
});

test('go-red control: stripping one fact reports exactly that fact (a heading also takes its section\'s facts)', () => {
  for (const f of FACTS) {
    const stripped = EXPRESS.replace(f.re, '');
    assert.notEqual(stripped, EXPRESS, `anchor for "${f.name}" not found`);
    const expected = f.section === 'whole'
      ? FACTS.filter((g) => g === f || g.section === f.name.replace('heading ', '')).map((g) => g.name)
      : [f.name];
    assert.deepEqual(missingFacts(stripped), expected, `removing only "${f.name}" must turn exactly ${JSON.stringify(expected)} red`);
  }
});

test('go-red control: a fact moved into another section is reported missing', () => {
  for (const f of FACTS.filter((g) => g.section !== 'whole')) {
    const m = f.re.exec(scopeOf(EXPRESS, f));
    assert.ok(m, `"${f.name}" not found in its section`);
    const without = EXPRESS.replace(m[0], '');
    assert.notEqual(without, EXPRESS);
    const moved = f.section === SAMP
      ? without.replace(`${ELIG}\n\n`, `${ELIG}\n\n${m[0]} `)
      : `${without}\n${m[0]}\n`;
    assert.notEqual(moved, without);
    assert.deepEqual(missingFacts(moved), [f.name], `"${f.name}" moved out of its section must be reported`);
  }
});

test('express-lane.md carries its five sections in the order /dispatch and /flow cite them', () => {
  assertSectionOrder(EXPRESS, SECTIONS);
});

test('go-red control: each adjacent pair of sections swapped fails the order check', () => {
  for (let i = 0; i + 1 < SECTIONS.length; i++) {
    const permuted = moveAbove(EXPRESS, SECTIONS[i + 1], SECTIONS[i]);
    assert.notEqual(permuted, EXPRESS);
    assert.throws(() => assertSectionOrder(permuted, SECTIONS), { message: `${SECTIONS[i + 1]} is out of order` });
  }
});

const CEREMONY_ORDER = ['## Never skipped', '## Express lane', '## Mentions that are not skips'];

test('ceremony-profile.md carries ## Express lane right after ## Never skipped', () => {
  assertSectionOrder(CEREMONY, CEREMONY_ORDER);
});

test('go-red control: a missing or misplaced ## Express lane fails the roster check', () => {
  const removed = CEREMONY.replace(/^## Express lane$/m, '');
  assert.notEqual(removed, CEREMONY);
  assert.throws(() => assertSectionOrder(removed, CEREMONY_ORDER), { message: 'missing ## Express lane' });
  const permuted = moveAbove(CEREMONY, '## Express lane', '## Never skipped');
  assert.notEqual(permuted, CEREMONY);
  assert.throws(() => assertSectionOrder(permuted, CEREMONY_ORDER), { message: '## Express lane is out of order' });
});

// pr-run-comments.md: the kind row, the gate exception, and the Consumer row — each in its own section.
const COMMENT_PINS = [
  { section: '## Comment kinds', re: /^\| `express-review` \|[^\n]*`_shared\/express-lane\.md`[^\n]*\| `<!-- run-comment: express-review -->`[^\n]*\|$/m, name: 'Comment kinds row' },
  { section: '## The gate — one condition, everywhere', re: /^`_shared\/express-lane\.md`'s Post-merge sampling posts `express-review` on a merged PR it holds by number[^\n]*so it skips this gate too, and a failed post leaves that PR unreviewed instead of falling back to the issue\.$/m, name: 'gate exception' },
  { section: '## Consumer table', re: /^\| `_shared\/express-lane\.md` \(Post-merge sampling\) \| `express-review` \|[^\n]*`gh pr comment \{pr\} --body-file "\{body-file\}"`[^\n]*no issue fallback[^\n]*\|$/m, name: 'Consumer row' },
];
const missingPins = (text) => COMMENT_PINS.filter((p) => !p.re.test(sectionOf(text, p.section))).map((p) => p.name);

test('pr-run-comments.md registers express-review as a kind, a gate exception and a consumer', () => {
  assert.deepEqual(missingPins(COMMENTS), []);
});

test('go-red control: removing one express-review pin reports exactly that pin', () => {
  for (const p of COMMENT_PINS) {
    const removed = COMMENTS.replace(p.re, '');
    assert.notEqual(removed, COMMENTS, `anchor for "${p.name}" not found`);
    assert.deepEqual(missingPins(removed), [p.name]);
  }
});

// I1: an escalation hands the normal path a worktree whose HEAD already holds the express
// edit commit, so build's Already-shipped assessment judges such a run against
// origin/{integration-branch} too, naming the CLI's own escalation detector.
const SHIPPED = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'already-shipped-assessment.md'));
const SHIPPED_PINS = [
  [/After a `prior-attempt` adoption \(`build\/adopted-branch-collision-check\.md`\), or in a run whose `decisions\.md` carries an express escalation line \(`Express lane: escalated #\{n\} to \/flow`, the line `bin\/lib\/express\/cli\.js`'s `hasEscalation` matches[^\n]*judge "already shipped" against `origin\/\{integration-branch\}` only/, 'an express escalation shares the origin-only guard'],
  [/the adopted attempt's or the express edit's commits are this run's own unmerged work, never evidence the record shipped/, 'the express edit is never evidence the record shipped'],
];
const missingShipped = (text) => SHIPPED_PINS.filter(([re]) => !re.test(text)).map(([, name]) => name);

test('already-shipped-assessment.md judges an express-escalated run against origin only', () => {
  assert.deepEqual(missingShipped(SHIPPED), []);
});

test('go-red control: removing one already-shipped pin reports exactly that pin', () => {
  for (const [re, name] of SHIPPED_PINS) {
    const removed = SHIPPED.replace(re, '');
    assert.notEqual(removed, SHIPPED, `anchor for "${name}" not found`);
    assert.deepEqual(missingShipped(removed), [name]);
  }
});
