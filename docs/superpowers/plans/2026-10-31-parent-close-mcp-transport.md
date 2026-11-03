# Below-Floor Parent Close MCP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `gh` call the Parent-Gate Procedure makes a GitHub MCP mapping (or an explicit fail-open statement), so a gh-absent run that has the GitHub MCP server closes a due below-floor parent through `_shared/pr-first-merge-post-merge.md` Step 4.0b.

**Architecture:** Prose-only contract change across four skill markdown files. `_shared/github-write-transport.md`'s CRUD mapping table gains the missing rows; `wrap-up/verification-brief-parent-gate.md` gains one **Transport** paragraph that maps each of its calls onto those rows (plus the close section's MCP specifics); Step 4.0b cites the mapping; `dispatch/settle-and-merge.md`'s stale #205 paragraph lists the real calls. A conformance block in the existing `tests/below-floor-parent-close-conformance.test.js` pins all of it, including a ratchet that fails when a new `gh` call lands in the gate file without a mapping.

**Tech Stack:** Markdown skill files; `node --test` conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T075610-record-4602/work/4602-spec.md` (record #4602)

## Global Constraints

- The MCP tool names and parameters are the GitHub MCP server's, verified against its README and `pkg/github/minimal_types.go`: `issue_read` methods `get`, `get_comments`, `get_sub_issues`, `get_parent`, `get_labels` (paged by `page`/`perPage`, `perPage` max 100); `issue_read` `get` returns `state_reason` and `closed_by_pull_requests` (`total_count` plus up to 5 `references`); `issue_write` (`update`) takes `state` and `state_reason`; `get_me` returns `login`. GitHub's REST/MCP state values are lowercase (`closed`, `reopened`, `completed`, `not_planned`).
- There is no MCP tool that reads a repo's default branch. The default-branch read maps to `git remote show origin`'s `HEAD branch:` line, `_shared/integration-branch.md` rank 5's own fallback. Any file containing `defaultBranchRef`, `default_branch` or `remote show origin` must cite `_shared/integration-branch.md` (`tests/integration-branch-conformance.test.js`).
- Every literal the existing `tests/below-floor-parent-close-conformance.test.js` pins stays byte-identical — in particular the `**Fail open on every \`gh\` call` paragraph's Step 4.0b clause ("on any failing `gh` call it skips that parent — or the whole step, when the call is Step 4.0b's default-branch check — names each skipped parent in the closing summary"), every `gh ...` command line in the close and enumerate sections, and Step 4.0b's "and how it skips on a failing `gh` call — never a stop, and never a reason to report anything other than `merged`." Step 4.0b must not contain "A failing `gh` call skips that parent".
- `plugin/skills/dispatch/settle-and-merge.md` is at 47575 bytes against a 52500-byte rail (90.6%): the rewritten #205 paragraph must not grow the file by more than 150 bytes.
- Commit subjects: `{Verb} {what} — {detail}`, ending `refs #4602`; never `closes`/`fixes`.

## Review Focus

- An MCP close call that passes `labels` would wipe the parent's labels (`_shared/github-write-transport.md`'s Full-replace hazard) — the close-section text must say never pass `labels` on the close. Pinned in Task 2's test.
- `state_reason` case: `gh` prints `REOPENED`/`COMPLETED`, MCP returns lowercase — the idempotence and close-reason checks must read either case. Pinned in Task 2's test (`reopened` named in the close section).
- `_shared/label-bootstrap.md`'s loop has no MCP equivalent — Apply the gate's `demo:pending` path must say what happens on the MCP path rather than silently calling `gh label`. Pinned in Task 2's test.
- A future `gh` call added to the gate file with no mapping — the ratchet test in Task 2 fails on it.
- The default-branch read on a gh-absent run must not skip the whole step merely because `gh` is absent. Pinned in Task 1 (row) and Task 2 (Step 4.0b citation).

---

### Task 1: Add the missing MCP mapping rows

**Files:**
- Modify: `plugin/skills/_shared/github-write-transport.md` (CRUD mapping table, lines 20-28)
- Test: `tests/below-floor-parent-close-conformance.test.js` (append)

**Interfaces:**
- Produces: table rows whose operation cells read exactly `List an issue's native sub-issues`, `Get an issue's native parent`, `Read the current identity's login`, `Read the repo's default branch`; the `Close` row names `state_reason`, `completed` and `not_planned`; the `Get a single issue by number` row names `state_reason` and `closed_by_pull_requests`. Task 2's Transport paragraph cites these rows by these operation names.

- [ ] **Step 1: Append the failing test**

Append to `tests/below-floor-parent-close-conformance.test.js`:

```js
test('#4602: the transport mapping carries every row the parent close needs', () => {
  const t = read('_shared/github-write-transport.md');
  const row = (op) => t.split('\n').find((l) => l.startsWith(`| ${op} |`)) || '';
  assert.match(row('Close'), /`issue_write`/);
  for (const lit of ['state_reason', '`completed`', '`not_planned`']) assert.ok(row('Close').includes(lit), `Close row: ${lit}`);
  for (const lit of ['state_reason', 'closed_by_pull_requests']) assert.ok(row('Get a single issue by number').includes(lit), `Get row: ${lit}`);
  assert.ok(row("List an issue's native sub-issues").includes('`get_sub_issues`'));
  assert.ok(row("List an issue's native sub-issues").includes('sub_issues'));
  assert.ok(row("Get an issue's native parent").includes('`get_parent`'));
  assert.ok(row("Read the current identity's login").includes('gh api user') && row("Read the current identity's login").includes('`get_me`'));
  const db = row("Read the repo's default branch");
  assert.ok(db.includes('defaultBranchRef') && db.includes('git remote show origin') && db.includes('_shared/integration-branch.md'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#4602: the transport mapping" tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL (the `Close` row has no `state_reason`)

- [ ] **Step 3: Edit the CRUD mapping table**

In `plugin/skills/_shared/github-write-transport.md`:
- `Close` row MCP cell → `` `issue_write` (update mode, `state: closed` plus `state_reason` — `completed` for `--reason completed`, `not_planned` for `--reason "not planned"`; never pass `labels`, per **Full-replace hazard** below) ``.
- `Get a single issue by number` row MCP cell → append: its `state_reason`, `labels`, `title`, `body` and `closed_by_pull_requests` (`references[].number`, up to 5) fields stand in for `gh`'s `stateReason`, `labels`, `title`, `body` and `closedByPullRequestsReferences`; MCP spells state values lowercase.
- Add four rows after `List an issue's comments`:
  - `List an issue's native sub-issues` | `gh api --paginate "repos/{owner}/{repo}/issues/{n}/sub_issues"` | `issue_read` (`get_sub_issues` mode) — `perPage: 100`, then `page` 2, 3, … until a page returns fewer than 100.
  - `Get an issue's native parent` | the sub-issue relationship read from the child's side | `issue_read` (`get_parent` mode).
  - `Read the current identity's login` | `gh api user --jq .login` | `get_me` (its `login` field).
  - `Read the repo's default branch` | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` | no MCP tool — read `git remote show origin`'s `HEAD branch:` line, `_shared/integration-branch.md` rank 5's own fallback, which needs neither transport.

- [ ] **Step 4: Run the test and the integration-branch conformance**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/integration-branch-conformance.test.js tests/github-write-transport-label-merge-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-write-transport.md tests/below-floor-parent-close-conformance.test.js
git commit -m "Map the parent-close reads and close to MCP tools — sub-issues, parent, identity, default branch, state_reason, refs #4602"
```

### Task 2: Route the Parent-Gate Procedure and Step 4.0b through the mapping

**Review risk:** high

(Why: the MCP path feeds the gate's decision logic (`parentGateState`'s exact `'CLOSED'` match, the close-reason and idempotence branches, the trusted-author test) and a read-merge-write label update.)

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` (before the `**Fail open on every \`gh\` call` paragraph, line 60; close section steps 1 and 3, lines 312-391)
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (Step 4.0b, lines 41-46 and 85-96)
- Test: `tests/below-floor-parent-close-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's row names.
- Produces: a paragraph in the gate file beginning `**Transport (#4602).**`, which Task 3's settle-and-merge paragraph points at.

- [ ] **Step 1: Append the failing tests**

```js
// Every `gh` call shape the gate file and Step 4.0b issue, keyed to the MCP tool (or git read)
// its github-write-transport.md row names. A new gh call with no entry here fails the ratchet.
const GH_TO_MCP = [
  [/^gh api user\b/, '`get_me`'],
  [/^gh api\b.*sub_issues/, '`get_sub_issues`'],
  [/^gh issue view\b/, '`issue_read`'],
  [/^gh issue comment\b/, '`add_issue_comment`'],
  [/^gh issue close\b/, '`issue_write`'],
  [/^gh issue edit\b/, '`issue_write`'],
  [/^gh issue reopen\b/, '`issue_write`'], // Step 4.0b's restore hint in its log-decision reversibility text
  [/^gh repo view\b/, 'git remote show origin'],
];
const ghCalls = (text) => [...text.matchAll(/\bgh (?:api|issue|repo|label|pr)\b[^`\n]*/g)].map((m) => m[0]);

test('#4602 AC2.1: every gh call in the Parent-Gate Procedure and Step 4.0b has a mapping the Transport paragraph names', () => {
  const gate = read(GATE_REL);
  const transport = collapse(paragraph(gate, '**Transport (#4602).**'));
  const step40b = section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1');
  const calls = [...ghCalls(gate), ...ghCalls(step40b)];
  assert.ok(calls.length >= 10, `found ${calls.length} gh calls — the extractor still sees the file`);
  for (const call of calls) {
    const hit = GH_TO_MCP.find(([re]) => re.test(call));
    assert.ok(hit, `unmapped gh call: ${call}`);
    if (!/^gh repo view/.test(call)) assert.ok(transport.includes(hit[1]), `Transport paragraph names ${hit[1]} for: ${call}`);
  }
  assert.ok(transport.includes('`_shared/github-write-transport.md`'));
  assert.ok(transport.includes('`get_parent`'), 'native parent resolution');
  assert.ok(transport.includes('`_shared/label-bootstrap.md`'), 'the label bootstrap states its MCP-path behavior');
  for (const lit of ['uppercase', '`CLOSED`', '`COMPLETED`', 'label names', 'the last of the references']) assert.ok(transport.includes(lit), `Transport paragraph normalizes the MCP shape: ${lit}`);
  const failOpen = collapse(paragraph(gate, '**Fail open on every `gh` call'));
  assert.ok(failOpen.includes('neither `gh` nor the GitHub MCP server is available'), 'fail open only when neither transport is available');
  assert.ok(!failOpen.includes('If `gh` is unavailable'), 'a gh-absent run with MCP no longer skips');
});

test('#4602 AC1.1: the close section and Step 4.0b cite the MCP path', () => {
  const close = section(read(GATE_REL), '## Close the parent below the floor', '## Compose the parent brief');
  for (const lit of ['`_shared/github-write-transport.md`', '`get_me`', '`get_comments`', '`state_reason`', '`not_planned`', 'reopened', 'never pass `labels`']) {
    assert.ok(close.includes(lit), `close section names ${lit}`);
  }
  const step40b = collapse(section(read(POST_MERGE_REL), STEP_40B, '### Step 4.1'));
  assert.ok(step40b.includes('`_shared/github-write-transport.md`'), 'Step 4.0b cites the mapping');
  assert.ok(step40b.includes('git remote show origin'), 'Step 4.0b default-branch read on a gh-absent run');
});
```

(`GATE_REL`, `POST_MERGE_REL`, `STEP_40B`, `section`, `paragraph` and `collapse` already exist in the file — reuse them.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4602 AC" tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL after Step 1 (`paragraph not found` / no Transport paragraph)

- [ ] **Step 3: Add the Transport paragraph to the gate file**

Insert a paragraph immediately before `**Fail open on every \`gh\` call in this section.**`, starting `**Transport (#4602).**`. It says: `gh` present → every call runs as written; `gh` absent → each runs through the GitHub MCP tool its `_shared/github-write-transport.md` row names (that file's Detection rule), namely: **Resolve the parent**'s native read → `issue_read` (`get_parent`), its body-text read → `issue_read` (`get`); **Enumerate**'s native list → `issue_read` (`get_sub_issues`, paged per its row), every `gh issue view` read (parent body, each sub-issue, parent labels, the close section's and **Apply the gate**'s comment reads) → `issue_read` (`get`, plus `get_comments` for comments); `gh api user` → `get_me`; `gh issue comment` → `add_issue_comment`; `gh issue close` → `issue_write` (state change); `gh issue edit --add-label` → `issue_write` under the Full-replace hazard's read-merge-write. `_shared/label-bootstrap.md`'s check-then-create loop has no MCP row: on the MCP path skip it, and a label write that then fails is a failing call under the paragraph below. Normalize the MCP shape before any rule below reads it: uppercase `state` and `state_reason` (`closed` → `CLOSED`, `completed` → `COMPLETED`, `not_planned` → `NOT_PLANNED`, `reopened` → `REOPENED`) before building `subIssues` for `parentGateState` (which matches `CLOSED` exactly), before the close-reason test and before the idempotence check; pass `parentLabels` as label names; and take `{pr}` from the last of the references `closed_by_pull_requests` returns (at most 5 — a deterministic truncation). On the MCP path a "`gh` call" in the paragraph below means the tool its row names. **Mandatory:** in the Fail-open paragraph replace "If `gh` is unavailable, unauthenticated," with "If neither `gh` nor the GitHub MCP server is available, `gh` is unauthenticated," — every other word of that paragraph, including its pinned Step 4.0b clause, stays byte-identical.

- [ ] **Step 4: Cite the mapping in the close section**

- Step 1 (idempotence): after the two `gh` fences, one sentence — with `gh` absent these are `issue_read` (`get`, then `get_comments`) and `get_me`, per `_shared/github-write-transport.md`; the **Transport (#4602)** paragraph's uppercase normalization applies (`reopened` → `REOPENED`); the Trusted-authors test reads `author_association` on that shape.
- Step 3 (write, comment, close): after the `"not planned"` fence, one sentence — with `gh` absent, post the same file's text with `add_issue_comment` and close with `issue_write` (`update`, `state: closed`, `state_reason` `completed` or `not_planned`), per that file's Comment and Close rows; never pass `labels` on the close call.

- [ ] **Step 5: Cite the mapping in Step 4.0b**

In `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0b:
- Default-branch paragraph: after the `gh repo view ...` parenthetical, add that with `gh` absent the read is `git remote show origin`'s `HEAD branch:` line (`_shared/github-write-transport.md`'s default-branch row).
- After "For each record in `$CLOSING_SUB_ISSUES`, run that procedure …" paragraph's first sentence group, add one sentence: with `gh` absent, every call the procedure makes runs through `_shared/github-write-transport.md`'s MCP rows (the procedure's **Transport** paragraph), so a gh-absent run with the GitHub MCP server closes the parent the same way. Keep every pinned literal (Global Constraints) intact.

- [ ] **Step 6: Run the whole conformance file**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/integration-branch-conformance.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief-parent-gate.md plugin/skills/_shared/pr-first-merge-post-merge.md tests/below-floor-parent-close-conformance.test.js
git commit -m "Route the Parent-Gate Procedure through the MCP mapping — Transport paragraph, close and Step 4.0b citations, refs #4602"
```

### Task 3: Correct settle-and-merge's #205 paragraph

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md:22-29`
- Test: `tests/below-floor-parent-close-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's `**Transport (#4602).**` paragraph in `wrap-up/verification-brief-parent-gate.md`.

- [ ] **Step 1: Append the failing test**

```js
test('#4602: settle-and-merge\'s #205 paragraph lists the calls the Parent-Gate Procedure makes', () => {
  const p = collapse(paragraph(read('dispatch/settle-and-merge.md'), 'This blanket mapping also covers'));
  for (const lit of ['`gh issue close`', 'sub_issues', '`gh api user`', 'verification-brief-parent-gate.md', 'Transport (#4602)']) assert.ok(p.includes(lit), `names ${lit}`);
  assert.ok(!p.includes('No separate mapping table entry is needed'), 'the stale no-row claim is gone');
  assert.ok(!p.includes('is one of the three standard shapes'), 'the stale three-shapes claim is gone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#205 paragraph lists" tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL after Step 1 (`names \`gh issue close\``)

- [ ] **Step 3: Rewrite the paragraph**

Keep its opening ("This blanket mapping also covers the `gh` calls the Auto-merge gate's acceptance-labeling step delegates to per member (… `#205`"). Replace the rest: `verification-brief.md`'s own calls (`gh issue comment`, `gh issue edit --add-label`) are standard shapes; the Parent-Gate Procedure additionally makes `gh api .../sub_issues`, `gh issue view` (body, state, labels, comments), `gh api user`, `gh issue comment`, `gh issue close` and `gh issue edit --add-label`, each mapped by a `_shared/github-write-transport.md` row and listed in `wrap-up/verification-brief-parent-gate.md`'s **Transport (#4602)** paragraph, which also states the label bootstrap's MCP-path behavior. Net growth ≤ 150 bytes (`wc -c` before/after).

- [ ] **Step 4: Run tests**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/dispatch-settle-and-merge-lazy-read.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md tests/below-floor-parent-close-conformance.test.js
git commit -m "Correct settle-and-merge's #205 transport paragraph — list the parent-gate calls, refs #4602"
```
