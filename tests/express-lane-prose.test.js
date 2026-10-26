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
  { section: SAMP, re: /Every git call runs in the main checkout, `git -C "\$RUN_ROOT" …`/, name: 'sampling git runs in the main checkout' },
  { section: SAMP, re: /express-lane\.js" samples`/, name: 'samples verb' },
  { section: SAMP, re: /or 2 \(`gh` absent\) → no sweep this time: report it and do not retry/, name: 'samples exit 1 or 2: no sweep, no retry' },
  { section: SAMP, re: /A `mergeSha` of `null` → mint nothing/, name: 'null mergeSha mints nothing' },
  { section: SAMP, re: /does not list as deleted \(`D`\)/, name: 'no git show for a deleted path' },
  { section: SAMP, re: /`bookkeepingPermissions\(ceiling\)\.consoleAutoResolve`/, name: 'consoleAutoResolve gates filing' },
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
