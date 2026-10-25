'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { readText } = require('./helpers/read-skill');
// #410: PR as run surface — verdict/brief/failure comments on the PR, the
// failure tombstone, and PR-state reads in /help and /tidy. Prose-as-
// implementation, same convention as pr-early-run-lifecycle.test.js — pin
// the key claims against the actual file text so the doc can't silently
// drift from what it promises.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const COMMENTS = read('plugin', 'skills', '_shared', 'pr-run-comments.md');
const LIFECYCLE = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const SETTLE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md');
const BRIEF = read('plugin', 'skills', 'wrap-up', 'verification-brief.md');
const DEMO = read('plugin', 'skills', 'demo', 'entry-paths.md');
// /review's Step 7 (verdict comment) lives in the code-mode-steps.md sub-file since the
// #887 dispatcher split — concatenate so this asserts against the documented text wherever
// it currently lives, same pattern as multi-agent-coordination.test.js's REVIEW_SKILL.
const REVIEW_SKILL =
  read('plugin', 'skills', 'review', 'SKILL.md') +
  '\n' +
  read('plugin', 'skills', 'review', 'code-mode-steps.md');
const STATUS_SCAN = read('plugin', 'skills', 'help', 'status-scan.md');
const SCAN_PROCEDURES = read('plugin', 'skills', 'tidy', 'scan-procedures.md');
// #2736: the stale-run PR-suffix logic this suite pins below moved out of
// session-start.js into session-residue.js (shared with `hooks.js
// check-session-residue`) — session-start.js now only renders the banner
// from that module's returned lines.
const SESSION_RESIDUE = read('plugin', 'bin', 'lib', 'hooks', 'session-residue.js');

test('the pr-first gate is one condition, stated once, in pr-run-comments.md', () => {
  assert.match(COMMENTS, /run-state\.json.*carries a `pr` object/);
  assert.match(COMMENTS, /retryable failure.*never conflated with "no PR"/);
});

test('all three comment kinds carry a distinct marker as the first line', () => {
  for (const marker of ['<!-- run-comment: verdict -->', '<!-- run-comment: brief -->', '<!-- run-comment: failure -->']) {
    assert.ok(COMMENTS.includes(marker), `pr-run-comments.md missing kind marker: ${marker}`);
  }
});

test('the post-or-update procedure finds by marker via GraphQL node id, never a REST numeric id', () => {
  assert.match(COMMENTS, /gh pr view \{pr-number\} --repo \{host\}\/\{owner\}\/\{repo\} --json comments/);
  assert.match(COMMENTS, /updateIssueComment\(input:\{id:\$id,body:\$body\}\)/);
  assert.match(
    COMMENTS,
    /not a REST numeric ID/,
    'this is the reason the update step is a GraphQL mutation instead of a REST PATCH to issues/comments/{id}',
  );
});

test('the find/update/create steps are host-qualified — --repo carries {host} and the GraphQL update passes --hostname (#2021)', () => {
  assert.match(COMMENTS, /gh repo view --json nameWithOwner,url/);
  assert.match(COMMENTS, /gh pr view \{pr-number\} --repo \{host\}\/\{owner\}\/\{repo\} --json comments/);
  assert.match(COMMENTS, /gh api graphql --hostname \{host\} -F query=@/);
  assert.match(COMMENTS, /gh pr comment \{pr-number\} --repo \{host\}\/\{owner\}\/\{repo\} --body-file/);
});

test('one comment per kind per run — re-runs edit in place, never append a duplicate', () => {
  assert.match(COMMENTS, /One comment per kind per run/);
  assert.match(COMMENTS, /it never appends a duplicate/);
});

test('retry-ceiling counting is called out as merging the issue with every linked PR, not one source alone', () => {
  assert.match(
    COMMENTS,
    /Retry-ceiling \*\*counting\*\*.*merges the issue's comments with every PR ever linked to the record, open or closed/s,
  );
});

test('pr-early-run-lifecycle.md reopens a closed-unmerged PR on retry before falling back to recreate', () => {
  assert.match(LIFECYCLE, /gh pr reopen \{number\} --repo \{host\}\/\{owner\}\/\{repo\}/);
  assert.match(LIFECYCLE, /Reopen fails.*fall through to creation below/s);
  assert.match(
    LIFECYCLE,
    /A match with `state: MERGED`.*Treat\s*\n?\s*as no match and fall through to creation/s,
  );
});

test('settle-and-merge.md fetches every PR ever linked to the issue, open or closed, before counting', () => {
  assert.match(SETTLE, /Comment sources: the issue, plus every PR ever linked to it, open or closed/);
  assert.match(SETTLE, /gh pr list --repo \{owner\}\/\{repo\} --state all --json number,closingIssuesReferences/);
});

test('settle-and-merge.md posts the failure tombstone (a pointer, not the full comment) to the PR and closes it', () => {
  assert.match(SETTLE, /this is the failure tombstone/);
  assert.match(SETTLE, /gh pr close \{pr-number\} --repo \{owner\}\/\{repo\}/);
  assert.match(SETTLE, /Leave the branch and worktree in place/);
});

test('settle-and-merge.md posts the full comment, trust-negative-evidence marker included, to the issue always', () => {
  assert.match(SETTLE, /Post the full comment to the issue, always/);
  assert.match(SETTLE, /bin\/lib\/issues\/trust\.js.*reads only the record issue's comments and is not modified/s);
});

test('verification-brief.md routes the full brief to the PR and leaves a one-line pointer on the issue', () => {
  assert.match(BRIEF, /the full brief moves to the PR; the issue keeps a one-line pointer/);
  assert.match(BRIEF, /Verification Brief posted to PR #\{pr-number\}: \{pr-url\}/);
  assert.match(
    BRIEF,
    /Acceptance labeling\s*\nstays on the issue either way/,
    'demo:pending must still land on the issue regardless of where the brief content lives',
  );
});

// The pointer-plus-PR-brief hand-run check formerly pinned here moved into
// engine-verify.js's `acceptance-labeling` check (record #900, Task 6 —
// see plugin/skills/wrap-up/execution-and-verification.md's Verify
// execution section, now a verb invocation rather than hand-run prose).
// Task 6's initial cut only reproduced the label + full-brief-on-the-issue
// path; a post-review fix (same task) added the actual pointer+PR-brief
// handling — pointer found on the issue → fetch `gh pr view --json
// comments` → require a comment carrying both `<!-- run-comment: brief -->`
// and `### Confirmed` — plus parent redirection for decomposed sub-issues.
// tests/bin-lib/wrap-up/engine-verify.test.js owns that check's coverage,
// including the pr-first pointer+brief pass/fail cases and the parent-
// redirect/dedup cases.

test('review/SKILL.md posts a verdict comment reusing the findings-table shape, gated on the pr object', () => {
  assert.match(REVIEW_SKILL, /run-comment: verdict/);
  assert.match(REVIEW_SKILL, /top findings by severity \(max 5\)/);
  assert.match(REVIEW_SKILL, /Category \| Finding \| Severity \| Action/);
});

test("help/status-scan.md's PR-state join never uses the search index, only a plain bounded list", () => {
  const section = STATUS_SCAN.split('### PR-state join')[1].split('### Conflict detection')[0];
  assert.match(section, /gh pr list --repo \{owner\}\/\{repo\} --state all --limit 100/);
  const fencedCommands = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(
    fencedCommands,
    /--search/,
    'the PR-state join section\'s actual commands (not its explanatory prose) must never issue a real --search invocation',
  );
});

test("help/status-scan.md distinguishes a closed run from open/merged and flags it in Needs Attention", () => {
  assert.match(STATUS_SCAN, /state: CLOSED.*unmerged/);
  assert.match(STATUS_SCAN, /likely tombstoned/);
});

test("tidy/scan-procedures.md's PR-state override distinguishes tombstoned from abandoned by the failure marker", () => {
  assert.match(SCAN_PROCEDURES, /Non-empty result → tombstoned/);
  assert.match(SCAN_PROCEDURES, /Empty result → abandoned/);
  assert.match(
    SCAN_PROCEDURES,
    /Never auto-remove either case/,
    '/tidy must never escalate a manual-review row to a destructive delete on its own',
  );
});

test("tidy's tombstone row explicitly agrees with the reconciler's own never-reap rule instead of contradicting it", () => {
  assert.match(SCAN_PROCEDURES, /same as `bin\/lib\/reconcile\/reap-merged\.js`'s own `pr-closed-unmerged` skip decision/);
});

test('session-residue.js appends the recorded PR URL to a stale-run line only when run-state carries one', () => {
  assert.match(SESSION_RESIDUE, /state && state\.pr && state\.pr\.url/);
  assert.match(SESSION_RESIDUE, /\$\{prSuffix\}/);
});

// #2592: a multi-spec /flow run shares one PR, and each spec's own review posted the same
// `<!-- run-comment: verdict -->` marker, so spec B's post-or-update silently overwrote spec
// A's verdict content (observed live on PR #2586, records #2580/#2581). Fixed by
// spec-qualifying the marker under multi-spec: `<!-- run-comment: verdict:{spec} -->`.

test('pr-run-comments.md documents the multi-spec verdict marker shape and that single-spec is unchanged', () => {
  assert.match(COMMENTS, /Multi-spec verdict comments/);
  assert.match(COMMENTS, /run-comment: verdict:\{spec\}/);
  assert.ok(
    COMMENTS.includes('<!-- run-comment: verdict -->'),
    'the plain single-spec marker must still be documented, unchanged',
  );
  assert.match(
    COMMENTS,
    /one\s+`verdict`\s+comment per spec/,
    'the multi-spec section must state the chosen shape (one comment per spec), not silently imply the old single-comment framing',
  );
});

test('review/code-mode-steps.md composes the spec-qualified verdict marker under a multi-spec run', () => {
  assert.match(REVIEW_SKILL, /MULTISPEC_PARENT_DIR/);
  assert.match(REVIEW_SKILL, /run-comment: verdict:\{spec\}/);
  assert.match(
    REVIEW_SKILL,
    /basename\(\$PIPELINE_RUN_DIR\)/,
    'the spec identifier must be derived from this spec\'s own run-dir subdirectory, not a separately threaded value',
  );
});

test('regression: a second spec\'s verdict post no longer collides with the first spec\'s marker (two-spec-same-PR sequence)', () => {
  // Minimal reimplementation of pr-run-comments.md's find-by-marker `startsWith` check
  // (the actual procedure shells out to `gh`; this exercises the same matching logic that
  // determines whether two specs' comments collide).
  const markerFor = (kind) => `<!-- run-comment: ${kind} -->`;
  const findByKind = (comments, kind) =>
    comments.find((c) => c.body.startsWith(markerFor(kind)));
  const postOrUpdate = (comments, kind, body) => {
    const existing = findByKind(comments, kind);
    if (existing) {
      existing.body = `${markerFor(kind)}\n${body}`;
    } else {
      comments.push({ body: `${markerFor(kind)}\n${body}` });
    }
    return comments;
  };

  const prComments = [];
  postOrUpdate(prComments, 'verdict:2589', 'PASS — #2589 findings: none');
  postOrUpdate(prComments, 'verdict:2592', 'PASS — #2592 findings: none');

  assert.strictEqual(prComments.length, 2, 'each spec must get its own comment, not one shared/overwritten comment');
  const c2589 = findByKind(prComments, 'verdict:2589');
  const c2592 = findByKind(prComments, 'verdict:2592');
  assert.ok(c2589, '#2589\'s verdict comment must still be findable after #2592 posts');
  assert.ok(c2592, '#2592\'s verdict comment must still be findable');
  assert.match(c2589.body, /#2589/);
  assert.match(c2592.body, /#2592/);
  assert.notStrictEqual(c2589.body, c2592.body, 'the two specs\' verdict content must not have collapsed into one');

  // A same-spec re-run (a re-triggered review) still updates in place, never appends a duplicate.
  postOrUpdate(prComments, 'verdict:2589', 'BLOCKED — #2589 findings: 1 severity:high');
  assert.strictEqual(prComments.length, 2, 're-posting the same spec\'s verdict must edit in place, not append a third comment');
  assert.match(findByKind(prComments, 'verdict:2589').body, /BLOCKED/);
  assert.match(findByKind(prComments, 'verdict:2592').body, /PASS/, '#2592\'s comment must be untouched by #2589\'s re-post');
});

// #2970: the same multi-spec overwrite hazard #2592 fixed for `verdict` was still open for
// `brief` and `timing` — each spec's wrap-up composed the bare, unqualified marker, so spec
// B's post-or-update silently overwrote spec A's Verification Brief / timing comment on the
// shared PR. Fixed by spec-qualifying both markers the same way: `brief:{spec}` / `timing:{spec}`.

test('pr-run-comments.md documents the multi-spec brief and timing marker shape and that single-spec is unchanged', () => {
  assert.match(COMMENTS, /Multi-spec brief and timing comments/);
  assert.match(COMMENTS, /run-comment: brief:\{spec\}/);
  assert.match(COMMENTS, /run-comment: timing:\{spec\}/);
  assert.ok(
    COMMENTS.includes('<!-- run-comment: brief -->'),
    'the plain single-spec brief marker must still be documented, unchanged',
  );
  assert.ok(
    COMMENTS.includes('<!-- run-comment: timing -->'),
    'the plain single-spec timing marker must still be documented, unchanged',
  );
  assert.match(
    COMMENTS,
    /one\s+`brief`\s+comment\s+per\s+spec/,
    'the multi-spec section must state the chosen shape for brief (one comment per spec)',
  );
  assert.match(
    COMMENTS,
    /one\s+`timing`\s+comment\s+per\s+spec/,
    'the multi-spec section must state the chosen shape for timing (one comment per spec)',
  );
});

test("pr-run-comments.md's Comment kinds table shows both the single-spec and multi-spec brief/timing marker forms", () => {
  assert.match(COMMENTS, /`brief`.*run-comment: brief:\{spec\}/);
  assert.match(COMMENTS, /`timing`.*run-comment: timing:\{spec\}/);
});

test('verification-brief.md composes the spec-qualified brief and timing markers under a multi-spec run', () => {
  assert.match(BRIEF, /MULTISPEC_PARENT_DIR/);
  assert.match(BRIEF, /run-comment: brief:\{spec\}/);
  assert.match(BRIEF, /run-comment: timing:\{spec\}/);
  assert.match(
    BRIEF,
    /basename\(\$PIPELINE_RUN_DIR\)/,
    'the spec identifier must be derived from this spec\'s own run-dir subdirectory, not a separately threaded value',
  );
  assert.ok(
    BRIEF.includes('<!-- run-comment: brief -->'),
    'the single-spec brief marker must still be composed unchanged when $MULTISPEC_PARENT_DIR is unset',
  );
  assert.ok(
    BRIEF.includes('<!-- run-comment: timing -->'),
    'the single-spec timing marker must still be composed unchanged when $MULTISPEC_PARENT_DIR is unset',
  );
});

test('regression: a second spec\'s brief/timing post no longer collides with the first spec\'s marker (two-spec-same-PR sequence)', () => {
  const markerFor = (kind) => `<!-- run-comment: ${kind} -->`;
  const findByKind = (comments, kind) =>
    comments.find((c) => c.body.startsWith(markerFor(kind)));
  const postOrUpdate = (comments, kind, body) => {
    const existing = findByKind(comments, kind);
    if (existing) {
      existing.body = `${markerFor(kind)}\n${body}`;
    } else {
      comments.push({ body: `${markerFor(kind)}\n${body}` });
    }
    return comments;
  };

  for (const base of ['brief', 'timing']) {
    const prComments = [];
    postOrUpdate(prComments, `${base}:2589`, `#2589 ${base} content`);
    postOrUpdate(prComments, `${base}:2592`, `#2592 ${base} content`);

    assert.strictEqual(prComments.length, 2, `each spec must get its own ${base} comment`);
    assert.match(findByKind(prComments, `${base}:2589`).body, /#2589/);
    assert.match(findByKind(prComments, `${base}:2592`).body, /#2592/);

    postOrUpdate(prComments, `${base}:2589`, `#2589 ${base} content (updated)`);
    assert.strictEqual(prComments.length, 2, `re-posting #2589's ${base} must edit in place, not append a third comment`);
    assert.match(findByKind(prComments, `${base}:2589`).body, /updated/);
    assert.match(
      findByKind(prComments, `${base}:2592`).body,
      /#2592/,
      `#2592's ${base} comment must be untouched by #2589's re-post`,
    );
  }
});

// #3333: the write side posts `brief:{n}` under a multi-spec run; the two readers (engine-verify.js's
// acceptance-labeling check, /demo's PR run-comment lookup) must read the record's own qualified
// marker first and fall back to the plain one, and the contract must state that order.
// `between` fails loudly when either heading anchor is gone: a bare `split(start)[1].split(end)[0]`
// turns a missing end anchor into "the rest of the file", which widens the region instead of emptying it.
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = from === -1 ? -1 : text.indexOf(end, from + start.length);
  assert.ok(from !== -1 && to !== -1, `section anchors present: ${start} ... ${end}`);
  return text.slice(from + start.length, to);
};
const DEMO_LOOKUP = between(DEMO, '### PR run-comment lookup', '### Full verification pointer');

test("AC2.1: demo's PR lookup reads the record's own brief:{n} before the plain brief marker", () => {
  const brief = DEMO_LOOKUP.slice(DEMO_LOOKUP.indexOf('- **Brief**'));
  const q = brief.indexOf('<!-- run-comment: brief:{n} -->');
  const plain = brief.indexOf('<!-- run-comment: brief -->');
  assert.ok(q >= 0 && plain > q, 'Brief bullet names brief:{n} first, plain brief second');
  const tryIt = DEMO_LOOKUP.slice(DEMO_LOOKUP.indexOf('- **Try it**'), DEMO_LOOKUP.indexOf('- **Brief**'));
  const tq = tryIt.indexOf('<!-- run-comment: brief:{n} -->');
  const tp = tryIt.indexOf('<!-- run-comment: brief -->');
  assert.ok(tq >= 0 && tp > tq, 'Try it bullet itself names brief:{n} before the plain brief marker');
  assert.doesNotMatch(tryIt, /else the `<!-- run-comment: brief -->` comment's/, 'Try it no longer names only the bare brief marker');
});

test('AC3.1: pr-run-comments.md states the qualified-first brief read with a plain fallback', () => {
  const section = between(COMMENTS, '## Multi-spec brief and timing comments', '## Trusted authors');
  assert.match(section, /engine-verify\.js/);
  assert.match(section, /entry-paths\.md/);
  assert.match(section, /`<!-- run-comment: brief:\{n\} -->`[\s\S]*first[\s\S]*plain `<!-- run-comment: brief -->`/);
  assert.match(section, /sibling[\s\S]*`brief:\{m\}`/);
});

// #3936: the Find step's worktree-safe form is a plain `gh pr view --json comments > file`, then
// bin/find-run-comment.js on that file. The two frozen consts are the HEAD text before the change,
// generated from `git show HEAD:...` (escaped for a template literal); each new test must fail on them.
const PRE_CHANGE_FIND_STEP = `1. **Find.** Resolve \`{host}\`/\`{owner}\`/\`{repo}\` once (\`gh repo view --json nameWithOwner,url\` —
   \`{owner}/{repo}\` from \`nameWithOwner\`, \`{host}\` from the returned \`url\`'s authority; a bare
   \`OWNER/REPO\` handed to \`--repo\` is resolved by \`gh\` against its default host, \`github.com\`,
   unless the value carries the host as \`HOST/OWNER/REPO\` — so every \`--repo\` below is the
   host-qualified form), then:

   \`\`\`bash
   gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments \\
     --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | select((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | .id'
   \`\`\`

   Only a trusted author's comment is found (**Trusted authors** above); an untrusted marker comment
   reads as not found. Run the skip-notice filter over the same comments and keep its lines in the
   output:

   \`\`\`bash
   gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments \\
     --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | select(((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | not) | "skipped marker comment \\(.url // .html_url // .id // "unknown") by \\(.author.login // .user.login // "unknown") (\\(.authorAssociation // .author_association // "no association")) — not an owner, member, or collaborator"'
   \`\`\`

   \`.id\` here is the GraphQL node ID (e.g. \`IC_kwDO...\`), not a REST numeric ID — \`gh pr view
   --json comments\` exposes only the former. This is exactly why the update step below is a
   GraphQL mutation rather than a REST PATCH to \`issues/comments/{id}\`, which would need the
   numeric ID this command doesn't return.

   Zero or one result is the expected case. More than one (a race between two concurrent
   posts of the same kind) is a hedge, not the normal path — take the **first** and log the
   anomaly; do not attempt to reconcile or delete the extra here.

`;

// #4065: the two Find fences as they stood at HEAD, before the session-scoped payload path.
const PRE_CHANGE_FIND_FENCES = `\`\`\`bash
gh pr view {pr-number} --repo {owner}/{repo} --json comments > /tmp/{kind}-comments-{n}.json
\`\`\`

\`\`\`bash
node "\${CLAUDE_PLUGIN_ROOT}/bin/find-run-comment.js" --comments-file /tmp/{kind}-comments-{n}.json --kind {kind}
\`\`\`
`;

const PRE_CHANGE_TOMBSTONE_ROW = `| \`CLOSED\` (unmerged) — check for the tombstone marker: \`gh pr view {pr-number} --json comments --jq '.comments[] \\| select(.body \\| startswith("<!-- run-comment: failure -->")) \\| select((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR")'\` (trusted authors only; name each skipped one per \`_shared/pr-run-comments.md\`'s skip notice) | **Non-empty result → tombstoned.** Keep — same as \`bin/lib/reconcile/reap-merged.js\`'s own \`pr-closed-unmerged\` skip decision. Recommendation: \`Keep (tombstoned — retry via /claude-tweaks:dispatch or /claude-tweaks:flow, PR #{number})\`. **Empty result → abandoned**, not tombstoned — a human closed the draft without the run ever reaching the failure path. Recommendation: \`Keep (abandoned — closed PR #{number} carries no failure marker; manual review before removing worktree)\`. Never auto-remove either case — \`/tidy\` never escalates a "manual review" row to a destructive delete on its own. |`;

const findStep = () => between(COMMENTS, '1. **Find.**', '2. **Found');
const collapse = (s) => s.replace(/\s+/g, ' ');

test("AC1.1: the Find step's worktree-safe form is a plain fetch plus bin/find-run-comment.js, session-scoped", () => {
  const find = findStep();
  assert.ok(
    find.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" COMMENTS={kind}-comments-{n}.json BODY={kind}-comment-{n}.md'),
    'the Find step resolves both basenames through bin/session-tmp-resolve.js in one call',
  );
  assert.ok(!find.includes('/tmp/'), 'the Find step names no literal /tmp/ path');
  assert.ok(!COMMENTS.includes('/tmp/{kind}-comment'), 'no fixed /tmp/{kind}-comment name remains in the file (payload or body)');
  assert.ok(
    find.includes('gh pr view {pr-number} --repo {owner}/{repo} --json comments > "{comments-path}"'),
    'the plain fetch line writes to the session-resolved {comments-path}',
  );
  assert.ok(
    find.includes('bin/find-run-comment.js" --comments-file "{comments-path}" --kind {kind}'),
    'the find-run-comment.js line reads the session-resolved {comments-path}',
  );
  const fetchLine = find.split('\n').find((l) => l.includes('> "{comments-path}"')) ?? '';
  for (const bad of ['--jq', 'github.com', '$?', ';', '&&']) {
    assert.ok(!fetchLine.includes(bad), `the fetch line must not contain ${bad}`);
  }
  const resolveAt = find.indexOf('session-tmp-resolve.js');
  assert.ok(
    resolveAt >= 0 && resolveAt < find.indexOf('In a worktree-isolated session') && resolveAt < find.indexOf('Outside a worktree-isolated session'),
    'the resolver call precedes both the worktree-safe route and the jq-shortcut route',
  );
  assert.ok(COMMENTS.includes('-F body=@"{body-path}"'), 'the step 2 update writes its body from {body-path}');
  assert.ok(COMMENTS.includes('--body-file "{body-path}"'), 'the step 3 create writes its body from {body-path}');
  assert.ok(fs.existsSync(path.join(ROOT, 'plugin', 'bin', 'find-run-comment.js')));
  assert.ok(!PRE_CHANGE_FIND_FENCES.includes('session-tmp-resolve.js'), 'go-red: the pre-change fences do not resolve through session-tmp-resolve.js');
  assert.ok(!PRE_CHANGE_FIND_FENCES.includes('{comments-path}'), 'go-red: the pre-change fences carry no {comments-path} placeholder');
  assert.ok(PRE_CHANGE_FIND_FENCES.includes('> /tmp/{kind}-comments-{n}.json'), 'go-red: the frozen pre-change fetch line is the fixed /tmp path');
});

test('AC2.1: the worktree-safe form says it applies the same marker and Trusted authors test and relays skipped', () => {
  const find = collapse(findStep());
  assert.match(find, /comment-trust\.js/);
  const sameRule = /applies the same first-line marker `startswith` test and \*\*Trusted authors\*\* rule/;
  assert.match(find, sameRule);
  assert.match(find, /`skipped`/);
  assert.match(find, /exit 1/);
  assert.match(find, /exit 2/);
  const pre = collapse(PRE_CHANGE_FIND_STEP);
  assert.doesNotMatch(pre, /comment-trust\.js/, 'go-red: the pre-change step does not name comment-trust.js');
  assert.doesNotMatch(pre, sameRule, 'go-red: the pre-change step does not state the same-rule claim');
  assert.ok(!pre.includes('`skipped`'), 'go-red: the pre-change step does not name the skipped output');
  assert.doesNotMatch(pre, /exit 1/, 'go-red: the pre-change step names no exit 1');
  assert.doesNotMatch(pre, /exit 2/, 'go-red: the pre-change step names no exit 2');
});

test('the Find step forbids chaining an unquoted $? onto the jq shortcut and cites scratch-worktree.md §7', () => {
  const find = findStep();
  assert.ok(find.includes('`$?`'), 'the Find step names the unquoted $? chain it forbids');
  assert.ok(find.includes('_shared/scratch-worktree.md'), 'the Find step cites scratch-worktree.md');
  assert.ok(!PRE_CHANGE_FIND_STEP.includes('`$?`'), 'go-red: the pre-change step does not name $?');
  assert.ok(!PRE_CHANGE_FIND_STEP.includes('_shared/scratch-worktree.md'), 'go-red: the pre-change step does not cite scratch-worktree.md');
});

test("tidy's tombstone row points at the worktree-safe form", () => {
  const rows = SCAN_PROCEDURES.split('\n').filter((l) => l.includes('run-comment: failure'));
  assert.strictEqual(rows.length, 1, 'exactly one line carries the run-comment: failure marker');
  assert.ok(rows[0].includes('find-run-comment.js'), 'the tombstone row names bin/find-run-comment.js');
  assert.ok(rows[0].includes('--kind failure'), 'the tombstone row passes --kind failure');
  assert.ok(!PRE_CHANGE_TOMBSTONE_ROW.includes('find-run-comment.js'), 'go-red: the pre-change tombstone row does not name find-run-comment.js');
});
