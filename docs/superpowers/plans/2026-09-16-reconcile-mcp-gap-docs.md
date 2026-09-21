# Reconcile gh-absent MCP Gap — Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the accepted-gap posture for reconcile's `gh`-absent preflight skip (no MCP bridge for `reap`/`release`/`archive`/`archive-branches`/`remote-prune`/`console`), correct `dispatch/mcp-transport.md`'s stale #1224 claim about `issue_read`'s `closed_by_pull_requests` capability, and promote the manual per-candidate blocked-by/open-PR verification workaround to a documented step — all doc-only changes, no code behavior change.

**Architecture:** Three independent markdown edits. No code paths change: `plugin/bin/lib/reconcile/index.js` already documents (in its own header comment) that it is gh-CLI-only by design; this plan moves that same architectural decision into the canonical `docs/reconcile-checks.md` procedural doc, corrects one stale claim in `plugin/skills/dispatch/mcp-transport.md`, and adds a documented workaround step to the same file.

**Tech Stack:** Markdown documentation only (no JS).

**Spec:** `.claude-tweaks/pipelines/2026-09-16T201730-record-2523/work/2523-spec.md`

## Global Constraints

- Record #2523's Acceptance Criteria: (1) reconcile's gh-absent preflight gains a real MCP-bridged path for reap/archive, OR the accepted-gap posture is documented in `docs/reconcile-checks.md` with the residue-accumulation consequence stated plainly; (2) `dispatch/mcp-transport.md`'s #1224 section is corrected to reflect `issue_read`'s actual `closed_by_pull_requests` capability, or explains precisely why it still doesn't close the gap; (3) `npm test` passes.
- Investigation finding (this build): the GitHub MCP server exposes no generic GraphQL passthrough tool, so `bin/lib/issues/native-dependencies.js`'s batched, aliased `blockedBy`/`subIssues` GraphQL queries (used by `bin/resolve-blockers.js`) have no MCP equivalent at all — confirmed accepted-gap, not merely undocumented.
- Investigation finding (this build): `mcp__github__issue_read`'s `get` method's `closed_by_pull_requests.references[].state` field DOES answer "issue number → its open closing PR" for a single already-known issue (live-confirmed against #2523 itself, which returned `closed_by_pull_requests: {total_count: 0, references: []}`) — contrary to `mcp-transport.md`'s current "there is no MCP tool that answers the direction this check needs" claim. The real remaining gap is batching N queue-pull candidates into that check without N individual `issue_read` calls — `bin/resolve-linked-prs.js`'s one batched aliased GraphQL call has no MCP equivalent for the same reason as the blocked-by case above.
- Do not modify any `.js` file — this plan is documentation-only, matching the two Acceptance-Criteria "or document" branches.

---

### Task 1: Document reconcile's gh-absent accepted-gap posture

**Files:**
- Modify: `docs/reconcile-checks.md` (append a new section before `## Referenced by`)

**Interfaces:**
- Consumes: nothing (pure doc read of `plugin/bin/lib/reconcile/index.js`'s existing header comment, lines 46-49, which already states the architectural decision this task documents in the canonical doc).
- Produces: nothing code-facing — a new `## gh-absent preflight: accepted MCP gap (#2523)` section other docs/skills can cite.

- [ ] **Step 1: Add the new section**

Insert immediately before the `## Referenced by` heading in `docs/reconcile-checks.md`:

```markdown
## gh-absent preflight: accepted MCP gap (#2523)

`reconcile()` (`plugin/bin/lib/reconcile/index.js`) is a plain Node subprocess, not an agent-session
skill — it cannot reach an agent session's MCP tools, only `gh`. When `gh` is absent (a cloud
Routine sandbox with GitHub MCP tools instead of the CLI), every GitHub-dependent check —
`red-tip`, `reap`, `release`, `archive`, `archive-branches`, `remote-prune`, `console` — is skipped
via the preflight gate (`ghHealthCheck`/`ghHealthCheckAsync`, `preflight.js`), reported as
`{"skipped":[{"check":"red-tip,reap,release,archive,archive-branches,remote-prune,console","reason":"preflight-gh-absent"}]}`.
`mirror` is the one exception — pure git, no `gh` call — and keeps running.

This is an **accepted gap, not a bug to fix here**: unlike `/claude-tweaks:dispatch`'s own queue-pull
(`dispatch/mcp-transport.md`), which runs inside an agent-session skill and therefore *can* call
MCP tools directly, `reconcile()` runs as a detached background child process
(`bin/hooks.js`'s `reconcile-background`) with no agent session attached to hand it MCP access —
bridging it would mean either giving a bare Node subprocess its own MCP client (a much larger
architectural change, out of scope here) or moving these checks into an agent-session skill
entirely (changing when/how they run, not just how they reach GitHub).

**Consequence:** in a `gh`-absent sandbox, merged-PR residue (a group's worktree under
`.claude/worktrees/`, its run directory under `.claude-tweaks/pipelines/`) is never reaped or
archived automatically — it accumulates indefinitely across every `gh`-absent firing until either
`gh` becomes available in that sandbox, or a human runs `bin/hooks.js reconcile` manually from an
environment with `gh`. This is harmless (stale local state, not a correctness bug — the merged PR
and closed issue are still the source of truth on GitHub), but it is unbounded, so a project running
its scheduled Routines exclusively in `gh`-absent sandboxes should periodically reconcile from a
`gh`-present environment to bound the residue.
```

- [ ] **Step 2: Verify the insertion point**

Run: `grep -n "^## Referenced by" docs/reconcile-checks.md`
Expected: one match, with the new section's `## gh-absent preflight: accepted MCP gap (#2523)` heading appearing directly above it (`grep -n "^## " docs/reconcile-checks.md | tail -5` to confirm ordering).

- [ ] **Step 3: Commit**

```bash
git add docs/reconcile-checks.md
git commit -m "Document reconcile's gh-absent MCP gap as an accepted architectural gap

refs #2523"
```

---

### Task 2: Correct the #1224 section's stale MCP-capability claim

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (the existing `## Step 2 — open-linked-PR exclusion (#1224)` section)

**Interfaces:**
- Consumes: nothing code-facing — a prose correction only.
- Produces: nothing code-facing.

- [ ] **Step 1: Replace the stale claim**

In `plugin/skills/dispatch/mcp-transport.md`, the `## Step 2 — open-linked-PR exclusion (#1224)`
section currently reads (in full):

```
`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Investigated and confirmed infeasible for now (#2402):** unlike the confirmed rows above (`list_issues` for the label-scoped queue pull, `issue_read` for the per-dependency open-state check), there is no MCP tool that answers the direction this check needs — issue number → its open closing PR. `_shared/github-write-transport.md`'s CRUD mapping deliberately carries no PR-listing tool ("Pull requests are not covered by this mapping"), and its one documented PR-read exception (`pull_request_read`, `get` method — used by `_shared/issue-claims.md`'s in-flight check and `_shared/pr-checklist-refresh.md`) takes a PR *number* as input, which is exactly the value this check doesn't have yet: it can confirm an already-known PR is still open, not discover an unknown one from an issue number. No batched or per-candidate MCP path closes this gap without a tool the GitHub MCP server doesn't expose today. On the MCP transport, `queue-pull-script.md`'s linked-PR query is skipped and `dispatch-linked-prs.json` stays `{}`, so every candidate reads as having no open linked PR — the same fail-open posture the cross-PR overlap report above already accepts, but with a real cost this time: unlike that report (informational only), this check is the actual re-dispatch exclusion #1224 exists to add, so a `gh`-absent firing degrades to the pre-#1224 behavior (the bug this record fixes) rather than losing only a warning. Mitigated, not closed: a contested-claim headless self-report now enriches its diagnostic body with this same lookup on the `gh` transport when it succeeds (`settle-and-merge.md`'s Claim-contest special case, #2402) — the fail-open window still exists on the MCP transport, but no longer costs a human a manual PR lookup to discover it after the fact once a self-report has already been filed. Re-open if the GitHub MCP server ever adds an issue-linked-PRs or a PR-listing tool.
```

Replace the whole paragraph with (correcting the "no MCP tool answers this direction" claim per
#2523's live verification, while preserving the still-real batching-cost gap):

```
`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Correction (#2523):** the claim below that "there is no MCP tool that answers the direction this check needs" was wrong for the *single-issue* case — `mcp__github__issue_read`'s `get` method returns a `closed_by_pull_requests` field (`{total_count, references: [{number, state, ...}]}`) that directly answers "does this issue have an open closing PR" for one already-known issue number, live-confirmed against a real issue (#2523 itself, `total_count: 0` when no closing PR exists). `_shared/github-write-transport.md`'s CRUD mapping still carries no dedicated PR-listing tool, and its one documented PR-read exception (`pull_request_read`, `get` method) still needs a PR *number* as input — but `issue_read`'s hierarchy field sidesteps that entirely by answering the issue-number-in direction directly, which the original investigation missed. **What's still an open gap:** batching. `bin/resolve-linked-prs.js` makes ONE batched, aliased GraphQL call across every queue-pull candidate (`record.js`'s `buildLinkedPRQuery` + `linked-prs.js`'s `fetchLinkedPRs`); the GitHub MCP server exposes no generic GraphQL passthrough tool, so the same N-candidate check via `issue_read` costs N individual tool calls instead of one — real at queue-pull scale (a `dispatch --budget` drain routinely screens dozens of candidates per firing), the same cost concern the Blocked-exclusion check documents for `resolve-blockers.js`'s native GraphQL query. On the MCP transport, `queue-pull-script.md`'s linked-PR query is still skipped and `dispatch-linked-prs.json` stays `{}` for a full drain — the fail-open posture is unchanged for that path. What changes is the narrower, already-adopted mitigation: `settle-and-merge.md`'s Claim-contest special case (#2402) already calls `issue_read` per-candidate at contest time, where the cost is one call for one already-known issue, not N — that mitigation's own doc no longer needs the "not covered by any MCP tool" framing, since it was always just calling a tool that answers the question, not working around a true gap. Re-open the batching gap specifically if the GitHub MCP server ever adds a batched issue-linked-PRs query or a generic GraphQL passthrough tool.
```

- [ ] **Step 2: Verify no other file references the old wording**

Run: `grep -rn "no MCP tool that answers the direction this check needs" plugin/ docs/`
Expected: no matches (the corrected paragraph above rewords this exact phrase).

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/mcp-transport.md
git commit -m "Correct mcp-transport.md's stale #1224 claim about issue_read's closed_by_pull_requests

refs #2523"
```

---

### Task 3: Document the native blocked-by/linked-PR MCP-bridge investigation and per-candidate workaround

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (append a new subsection after the corrected #1224 section from Task 2)

**Interfaces:**
- Consumes: Task 2's corrected #1224 section (this task's new subsection is appended directly after it).
- Produces: nothing code-facing.

- [ ] **Step 1: Append the new subsection**

Append this new section at the end of `plugin/skills/dispatch/mcp-transport.md` (after the #1224
section Task 2 corrected):

```markdown
## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)

`bin/resolve-blockers.js` (`work-links: native`'s blocked-by check) and `bin/resolve-linked-prs.js`
(the #1224 open-PR exclusion, corrected above) both hard-require `gh` — `bin/lib/issues/
native-dependencies.js`'s `fetchNativeDependencies`/`fetchNativeSubIssues` and `linked-prs.js`'s
`fetchLinkedPRs` each issue one hand-built, batched, aliased `gh api graphql` query across every
candidate in a single call. **Investigated (#2523): no MCP bridge exists for either.** The GitHub
MCP server's tool surface (`_shared/github-write-transport.md`'s CRUD mapping) exposes no generic
GraphQL passthrough tool, so there is no way to submit these hand-built aliased queries through MCP
at all — this is a structural gap in the MCP server's tool surface, not a missing mapping this
codebase could add on its own side.

On a `gh`-absent transport, `queue-pull-script.md`'s calls to both scripts fail (the "Warning:
native dependency query failed" / "Warning: linked-PR query failed" lines that file's Step 2
already emits) and dispatch degrades to "no native filtering" / "no open-PR exclusion" for the
whole firing — every queue-pull candidate is treated as unblocked and PR-free regardless of its
real state. **Documented, required workaround** — promoting #2051's own recommendation from a
one-off firing improvisation to a standing step: before finalizing group selection on a `gh`-absent
firing, manually verify each surviving top-ranked candidate (not the whole queue — just the
candidate(s) about to be dispatched) via a per-candidate `mcp__github__issue_read` (`get` method)
call, reading `closed_by_pull_requests.references[].state` for the open-PR check (per the #1224
correction above) and — for `work-links: native` blocked-by — reading the candidate's own body text
for any `blocked-by:`/dependency mentions as a best-effort substitute (native GraphQL `blockedBy`
has no MCP equivalent at all, so this is a degrade, not a full replacement: a native-only dependency
relationship with no matching body-text mention is invisible on this path). This is exactly what
this record's own filing session did live (2026-09-16T14:19Z firing): the automated top-ranked pick
(#2259) already had an open PR (#2450), and #2051, #2329, #1135, plus the #2267/#2268/#2269 family
(natively blocked by open #2265) were all falsely eligible until this manual check caught them.

Re-open this section if the GitHub MCP server ever adds a generic GraphQL passthrough tool or
batched equivalents of `buildNativeDependencyQuery`/`buildLinkedPRQuery`.
```

- [ ] **Step 2: Verify the file still parses as valid markdown (heading structure)**

Run: `grep -n "^## " plugin/skills/dispatch/mcp-transport.md`
Expected: the new `## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)` heading appears once, after the #1224 heading, with no duplicate headings.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/mcp-transport.md
git commit -m "Document native blocked-by/linked-PR MCP-bridge investigation and workaround

refs #2523"
```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS (no test asserts on the specific prose this plan changes beyond the negative
`doesNotMatch` assertions in `tests/flow-claim-preflight.test.js`, which this plan's edits do not
touch — see Global Constraints).
