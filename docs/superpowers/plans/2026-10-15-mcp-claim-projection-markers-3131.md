# MCP claim projection and marker read-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud (MCP-transport) claims and marker comments verify what actually landed. A missing `bot:in-progress` add is retried once and traced. Marker comments are never posted HTML-escaped, and a read-back traces any that were. The headless claim-contest self-report names whether the record carried the projection when dispatch selected it.

**Architecture:** This is prose-only: contract changes in five skill files, pinned by one new conformance suite. No new code path. Deliverable 1 reuses `mergeLabelNames` (`plugin/bin/lib/issues/label-write.js`), and every trace line goes through the existing `log-decision.js` CLI.

**Tech Stack:** Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T190744-spec-3131/work/3131-spec.md`

**Scope keywords:** bot:in-progress, read-back, mergeLabelNames, escaped marker, &lt;!--, claim-contest, projection

## Global Constraints

- The authoritative hold check stays the Step 2.8 claim read. No label becomes a gate. A failed label add never aborts the claim.
- Deliverable 1's retry goes through `mergeLabelNames` read-then-merge-then-write. Never pass a bare `labels: ['bot:in-progress']` to `issue_write`.
- Trace lines use status `SKIP` in `_shared/auto-decision-log.md`'s Degrade-trace shape: `SKIP {HH:MM:SS} — {step} (degraded): condition: {…} → fallback: {…}. Reversibility: n/a.` The spec's ACs say "STAGED", but auto-decision-log.md's Status Semantics reserve STAGED for an artifact under `staged/`, and neither trace has one. SKIP is therefore the status the contract requires. This deviation is deliberate and is reported at wrap-up.
- Commit style: `{Verb} {what} — {detail}`, using `refs #3131` (never `closes`/`fixes`).

## Root cause evidence for Deliverable 2 (gathered at plan time, 2026-10-15)

> **Correction (whole-branch review, 8ffe6465f):** the "composed from sanitized reads" conclusion below is refuted. The escaped bodies hold exactly one `&lt;` and one `&gt;`, both in the marker, with raw quotes elsewhere. #1350's escaped mirror also carries a fresh `claimPayload` runId. The escaping therefore happens on the MCP write leg, and its cause is not yet identified. The shipped prose says so, and the reproduction is staged as a follow-up record.

For every comment whose first line is an HTML marker, `performed_via_github_app.slug` was read. The scan covered 40 PRs carrying `run-comment` markers since 2026-09-20, plus #1350, via `gh api repos/thn-inc/claude-tweaks/issues/{n}/comments`:

| Writer | Raw `<!--` | Escaped `&lt;!--` |
|---|---|---|
| `gh` CLI (no app) | 53 | 0 |
| `claude` app (MCP transport) | 9 | 5 |

The escaped comments are the `run-comment: verdict` comments on PR #2819 (2026-09-29), #2879 (2026-10-01), #2897 (2026-10-02) and #3127 (2026-10-12), plus #1350's 2026-10-12 `agent-claim` mirror. In the same window, the same `claude` app wrote raw markers on #2845 (2026-09-30), #2911 (2026-10-02), #3006 (2026-10-06) and #3073 (2026-10-09), and the #1350 claim mirrors on 2026-09-07 and 2026-10-14. `add_issue_comment` therefore does not escape on write. The escaping is in the body the agent sent.

That matches the documented read-side sanitizer (`_shared/pr-early-run-lifecycle.md`'s "Root cause" section): the MCP server's read path runs bluemonday sanitization, which HTML-escapes. An agent that composes a comment body from text it read back through an MCP tool, such as a prior comment or a fetched template, posts `&lt;!-- … --&gt;` verbatim. So the fix lands at the comment write row, as a composition rule plus a read-back, not as a tool change.

## Review Focus

1. The label read-back itself fails (MCP `issue_read` errors). The claim must still stand, and the prose must say that a failed read counts as "absent" for the retry decision and is traced the same way.
2. The retry must not run more than once. A second absence is traced, never looped.
3. A read-back on the MCP path sees a sanitized body. A raw stored marker reads back stripped (marker absent). An escaped stored marker reads back starting `&lt;!--`. The check keys on "begins `&lt;!--`" only, so a raw marker that reads back without its `<!--` is never flagged.
4. `pr-run-comments.md`'s find step is `gh`-only. The MCP note must not imply that find-by-marker works through MCP reads.
5. The self-report line must name where the selection-time label state came from: the queue pull's own snapshot, not a fresh read taken after the contest.

---

### Task 1: Claim projection read-back and contest self-report line

**Files:**
- Modify: `plugin/skills/flow/claim-targets.md:183-189`. That is the MCP-branch paragraph that begins "This CLI is the `gh` transport only". Insert a new paragraph directly after it, before "**Confirming the manual MCP path actually landed (#1728).**".
- Modify: `plugin/skills/_shared/issue-claims.md:371-378`, the "**Added**" bullet of `## The bot:in-progress label`. Append to that bullet.
- Modify: `plugin/skills/dispatch/settle-and-merge.md:59-70` (hard ceiling: 430 bytes of headroom at plan time — the paragraph below is ~330 bytes; keep it to one paragraph and measure with `wc -c` after). Insert a new paragraph after the "**Open-linked-PR enrichment for the contested-claim shape (#2402).**" paragraph.
- Create: `tests/claim-mcp-projection-conformance.test.js`

**Interfaces:**
- Consumes: `mergeLabelNames` (`plugin/bin/lib/issues/label-write.js`), cited by name only; `log-decision.js --status SKIP`.
- Produces: the test file, which Task 2 extends, with helpers `read(rel)` and `paragraphStarting(md, boldLead)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/claim-mcp-projection-conformance.test.js`:

```js
'use strict';
// tests/claim-mcp-projection-conformance.test.js — pins #3131's three
// observability additions on the MCP (gh-absent) transport: the
// bot:in-progress read-back-and-retry, the marker-comment composition rule
// plus read-back, and the claim-contest self-report's projection line.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The paragraph (blank-line delimited) whose first line starts with boldLead.
function paragraphStarting(md, boldLead) {
  const start = md.indexOf(`\n${boldLead}`);
  assert.ok(start !== -1, `paragraph not found: ${boldLead}`);
  const end = md.indexOf('\n\n', start + 1);
  return md.slice(start + 1, end === -1 ? md.length : end);
}

const CLAIM_TARGETS = read('plugin/skills/flow/claim-targets.md');
const ISSUE_CLAIMS = read('plugin/skills/_shared/issue-claims.md');
const SETTLE = read('plugin/skills/dispatch/settle-and-merge.md');

test('claim-targets.md MCP branch reads back bot:in-progress, retries once via mergeLabelNames, traces with SKIP, keeps the claim', () => {
  const para = paragraphStarting(CLAIM_TARGETS, '**Read back the `bot:in-progress` add (MCP, #3131).**');
  assert.match(para, /issue_read/);
  assert.match(para, /mergeLabelNames/);
  assert.match(para, /once/);
  assert.match(para, /--status SKIP/);
  assert.match(para, /\(degraded\)/);
  assert.match(para, /never aborted/);
  const mcpBranch = CLAIM_TARGETS.indexOf('This CLI is the `gh` transport only');
  const confirm = CLAIM_TARGETS.indexOf('**Confirming the manual MCP path actually landed (#1728).**');
  const here = CLAIM_TARGETS.indexOf(para);
  assert.ok(mcpBranch < here && here < confirm, 'the read-back paragraph sits between the MCP branch and the #1728 confirmation');
});

test('issue-claims.md states the MCP read-back-and-retry obligation in the bot:in-progress label section', () => {
  const start = ISSUE_CLAIMS.indexOf('## The bot:in-progress label');
  const end = ISSUE_CLAIMS.indexOf('\n## ', start + 1);
  assert.ok(start !== -1 && end !== -1, 'label section anchors must exist');
  const section = ISSUE_CLAIMS.slice(start, end);
  assert.match(section, /read the labels back/i);
  assert.match(section, /retry the add once/i);
  assert.match(section, /flow\/claim-targets\.md/);
});

test('settle-and-merge.md claim-contest self-report names selection-time bot:in-progress presence from the queue snapshot', () => {
  const para = paragraphStarting(SETTLE, '**Selection-time projection line (contested-claim shape, #3131).**');
  assert.match(para, /queue pull/);
  assert.match(para, /snapshot/);
  assert.match(para, /Selection-time projection: #\{target\} \{carried\|did not carry\}/);
  const enrich = SETTLE.indexOf('**Open-linked-PR enrichment for the contested-claim shape (#2402).**');
  assert.ok(enrich !== -1 && enrich < SETTLE.indexOf(para), 'the projection line paragraph follows the #2402 enrichment paragraph');
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `node --test tests/claim-mcp-projection-conformance.test.js`
Expected: all 3 tests FAIL, because the paragraphs do not exist yet.

- [ ] **Step 3: Write the prose**

In `plugin/skills/flow/claim-targets.md`, insert this after the paragraph that begins "This CLI is the `gh` transport only", with one blank line on each side:

```markdown
**Read back the `bot:in-progress` add (MCP, #3131).** On the MCP path nothing reports a failed
label add the way the CLI's `labelFailures` does, and a hold whose label never landed is invisible
to `/dispatch`'s label pre-filter (#1350 was re-selected that way). So after each target's claim
write succeeds, read the labels back (`issue_read`, `get_labels`). A failed read counts as absent.
When `bot:in-progress` is absent, retry the add once through `mergeLabelNames`'s
read-then-merge-then-write (`bin/lib/issues/label-write.js`, `add: ['bot:in-progress']` — never a
bare one-label array, per `_shared/github-write-transport.md`'s Full-replace hazard), then read
back once more. Still absent: trace it and move on — the claim is never aborted, since the label
stays best-effort and the claim read stays the authoritative hold check:
`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 2.8 bot:in-progress projection (degraded)" --text "condition: label still absent on #{n} after one mergeLabelNames retry → fallback: claim kept; dispatch's label pre-filter will not see this hold" --reversibility n/a`.
```

In `plugin/skills/_shared/issue-claims.md`, append the following at the end of the "**Added**" bullet, after "never `labels: ['bot:in-progress']` alone." Indent it two spaces, like the bullet's other continuation lines:

```markdown
  Then read the labels back: the MCP path has no `labelFailures` output, so a silent no-op
  add would otherwise leave the hold invisible to `/dispatch`'s label pre-filter. Absent (or a
  failed read) → retry the add once through the same merge, read back again, and trace a second
  absence with a `SKIP` degrade line — never abort the claim. `flow/claim-targets.md`'s "Read
  back the `bot:in-progress` add" paragraph carries the exact procedure and log line (#3131).
```

In `plugin/skills/dispatch/settle-and-merge.md`, insert this after the "**Open-linked-PR enrichment for the contested-claim shape (#2402).**" paragraph:

```markdown
**Selection-time projection line (contested-claim shape, #3131).** Also append ``Selection-time projection: #{target} {carried|did not carry} `bot:in-progress` when dispatch selected it.``, read from the queue pull's own label snapshot, never a fresh read, so a missing projection is diagnosable from the report alone. Never gates the self-report.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/claim-mcp-projection-conformance.test.js`
Expected: PASS, 3/3. Then run every suite that reads an edited file: list them with `grep -rl "claim-targets.md\|issue-claims.md\|settle-and-merge.md" tests`, run each result file with `node --test`, and expect 0 failures.

- [ ] **Step 5: Prove discrimination**

Revert each of the three inserted blocks in turn: remove it with Edit, run the suite, then restore it. Expected: each time, only the matching test goes red. Report the three raw `# pass`/`# fail` lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/flow/claim-targets.md plugin/skills/_shared/issue-claims.md plugin/skills/dispatch/settle-and-merge.md tests/claim-mcp-projection-conformance.test.js
git commit -m "Read back the MCP bot:in-progress add and name projection in contest reports — refs #3131"
```

### Task 2: Marker comments are never posted escaped

**Files:**
- Modify: `plugin/skills/_shared/github-write-transport.md:25`, the `| Comment |` CRUD row. Also add a new `### Marker comments on the MCP path` subsection directly before `### Full-replace hazard`.
- Modify: `plugin/skills/_shared/pr-run-comments.md`. Add an MCP paragraph after step 3 ("**Not found → create**") and its code fence, before "**On failure of either the find or the write**".
- Modify: `plugin/skills/_shared/issue-claims.md:308-320` (`## The mirror`). Add one sentence directly before the `<!-- when: transport=gh -->` line.
- Test: `tests/claim-mcp-projection-conformance.test.js` (extend)

**Interfaces:**
- Consumes: `read`, `paragraphStarting` (Task 1).
- Produces: prose only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/claim-mcp-projection-conformance.test.js`:

```js
const TRANSPORT = read('plugin/skills/_shared/github-write-transport.md');
const RUN_COMMENTS = read('plugin/skills/_shared/pr-run-comments.md');

test('github-write-transport.md comment row and MCP marker subsection carry the composition rule, evidence and read-back', () => {
  const row = TRANSPORT.split('\n').find((l) => l.startsWith('| Comment |'));
  assert.ok(row, 'Comment CRUD row must exist');
  assert.match(row, /Marker comments on the MCP path/);
  const start = TRANSPORT.indexOf('### Marker comments on the MCP path');
  const end = TRANSPORT.indexOf('### Full-replace hazard');
  assert.ok(start !== -1 && end !== -1 && start < end, 'subsection sits before Full-replace hazard');
  const sub = TRANSPORT.slice(start, end);
  assert.match(sub, /&lt;!--/);
  assert.match(sub, /never from text read back through an MCP tool/);
  assert.match(sub, /performed_via_github_app/);
  assert.match(sub, /begins `&lt;!--`/);
  assert.match(sub, /--status SKIP/);
});

test('pr-run-comments.md post-or-update has an MCP read-back for the run-comment marker', () => {
  const para = paragraphStarting(RUN_COMMENTS, '**MCP transport (no `gh`, #3131).**');
  assert.match(para, /add_issue_comment/);
  assert.match(para, /Marker comments on the MCP path/);
  assert.match(para, /read back/i);
  assert.match(para, /begins `&lt;!--`/);
  const create = RUN_COMMENTS.indexOf('3. **Not found → create**');
  const failure = RUN_COMMENTS.indexOf('**On failure of either the find or the write**');
  const here = RUN_COMMENTS.indexOf(para);
  assert.ok(create < here && here < failure, 'the MCP paragraph sits between step 3 and the failure paragraph');
});

test('issue-claims.md mirror section points MCP posts at the marker composition rule', () => {
  const start = ISSUE_CLAIMS.indexOf('## The mirror');
  const end = ISSUE_CLAIMS.indexOf('\n## ', start + 1);
  assert.ok(start !== -1 && end !== -1, 'mirror section anchors must exist');
  const section = ISSUE_CLAIMS.slice(start, end);
  assert.match(section, /Marker comments on the MCP path/);
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `node --test tests/claim-mcp-projection-conformance.test.js`
Expected: the 3 new tests FAIL. Task 1's 3 tests still PASS.

- [ ] **Step 3: Write the prose**

In `plugin/skills/_shared/github-write-transport.md`, change the Comment row to:

```markdown
| Comment | `gh issue comment {n} --body-file` | `add_issue_comment` — a body that starts with a `<!-- … -->` marker follows **Marker comments on the MCP path** below |
```

Insert this directly before `### Full-replace hazard`:

```markdown
### Marker comments on the MCP path

**Compose a marker comment's body from the local source — the skill's literal template or a CLI's
stdout (`claims.js`'s `claimPayload`, a `bin/` composer) — never from text read back through an MCP
tool.** The MCP server's read path HTML-escapes (`_shared/pr-early-run-lifecycle.md`'s Root cause
section), so a body copied from an MCP read carries `&lt;!-- … --&gt;`, and `add_issue_comment`
stores whatever it is given byte for byte. An escaped marker renders as visible text and no
find-by-marker lookup ever matches it. Evidence (#3131): across the run-comment PRs since
2026-09-20 and #1350, `performed_via_github_app` shows the `gh` CLI wrote 53 raw markers and 0
escaped ones, while the `claude` app wrote 9 raw and 5 escaped, interleaved in time — the write
tool does not escape; the escaped bodies were composed from sanitized reads. Before posting, check
the composed body's first line: one that begins `&lt;!--` was built from a sanitized read —
recompose it from the local source.

**Read back after posting.** Read the new comment through `issue_read` (`get_comments`). A raw
stored marker comes back stripped by the same sanitizer (that is expected — never flag it); a body
that comes back starting with `&lt;!--` was stored escaped. On that signature only — the read-back
body begins `&lt;!--` — trace it:
`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --step "Marker comment read-back (degraded)" --text "condition: comment {id} on #{n} stored with an escaped marker → fallback: left as posted; invisible to find-by-marker until re-posted from the local source" --reversibility n/a`.
```

In `plugin/skills/_shared/pr-run-comments.md`, insert this after step 3's code fence, before "**On failure of either the find or the write**":

```markdown
**MCP transport (no `gh`, #3131).** The find step above is `gh`-only: MCP reads return sanitized
bodies, so a find-by-marker through `issue_read` cannot be trusted and there is no MCP comment-edit
mapping — post a new comment with `add_issue_comment` on the PR's number instead of updating. Compose
the body per `_shared/github-write-transport.md`'s **Marker comments on the MCP path**, then read
back the posted comment: when the read-back body begins `&lt;!--`, write that section's `SKIP` trace
line so the escaped verdict is visible in the run log.
```

In `plugin/skills/_shared/issue-claims.md`'s `## The mirror`, insert one line before the `<!-- when: transport=gh -->` line:

```markdown
On the MCP path, post that generated body exactly as the module printed it, per `_shared/github-write-transport.md`'s **Marker comments on the MCP path** (#3131: the 2026-10-12 #1350 mirror was stored escaped).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/claim-mcp-projection-conformance.test.js`
Expected: PASS, 6/6. Then run every suite that reads an edited file: list them with `grep -rl "github-write-transport.md\|pr-run-comments.md\|issue-claims.md" tests`, run each with `node --test`, and expect 0 failures.

- [ ] **Step 5: Prove discrimination**

Revert the transport subsection, the pr-run-comments paragraph, and the mirror sentence, one at a time. Expected: each revert turns only its own test red. Report the raw lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/github-write-transport.md plugin/skills/_shared/pr-run-comments.md plugin/skills/_shared/issue-claims.md tests/claim-mcp-projection-conformance.test.js
git commit -m "Compose MCP marker comments from local source and read them back — refs #3131"
```
