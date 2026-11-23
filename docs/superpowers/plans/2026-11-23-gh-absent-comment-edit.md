# gh-absent Issue-Comment Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map the issue-comment edit to the GitHub MCP `update_issue_comment` tool so `specify/planning-answer.md` and `specify/shaping-mode-stamping.md` resolve decision comments with `gh` absent.

**Architecture:** Docs-only change to three skill markdown files plus conformance pins. The transport file gains one CRUD-mapping row and a generalized unmapped-step rule; planning-answer.md narrows its unconditional gh-absent refusal to "no `update_issue_comment` tool in the session"; shaping-mode-stamping.md gains a gh-absent sentence for its live-comment resolution.

**Tech Stack:** Markdown skill prose; `node --test` conformance suites using `tests/helpers/read-skill.js` and `tests/helpers/conformance-asserts.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T052634-spec-6101/work/6101-spec.md`

Scope keywords: update_issue_comment, maps no MCP call, no MCP mapping for the hold-comment edit

## Global Constraints

- Probe facts (github/github-mcp-server main @9a72d8d38fec18c207cd924b33aa0eb3e186252c): `update_issue_comment` at `pkg/github/issues.go:1593`, params `owner`, `repo`, `comment_id` (integer — the REST numeric id, not a GraphQL node ID), `body`; registered `pkg/github/tools.go:268` in toolset `issues` (`Default: true`, `tools.go:51-54`); first released in v1.12.2 (2026-09-16).
- MCP `issue_read` get_comments returns `MinimalIssueComment` (`pkg/github/minimal_types.go:671`): numeric `id`, `body` through `sanitize.Content` (strips only invisible characters), `author_association`, no `node_id`.
- Every skill file stays under `RAIL_BYTES` (52500); largest touched file is 36111 bytes.
- Edit prose in place; do not reflow neighbouring lines.
- Behavioral claim source: the MCP path's comment id is numeric because `plugin/bin/lib/issues/planning-hold.js:94` `ref()` returns `comment.node_id ?? comment.id` and MCP `get_comments` carries no `node_id`.
- Headroom after edits (rail 52500): transport ~14.7 KB, planning-answer ~13.3 KB, shaping-mode-stamping ~36.7 KB — all far under the rail.
- Absence-grep control: `grep -c -F "maps no MCP call" plugin/skills/specify/planning-answer.md` prints 2 on the base (lines 7 and 47), so Task 2's absence assertion can go red. Sweep of `plugin/` for other "no MCP … comment" edit claims found none (backlog/refine-record.md, _shared/pr-run-comments.md, _shared/console-on-pr.md state no MCP claim about the edit) — out of scope, unchanged.
- AC "the record's PR quotes the probe's command and output" is the orchestrator's PR-body edit, not a task here.

## Review Focus

- A session on a GitHub MCP server older than v1.12.2 (or with the `issues` toolset trimmed) has `add_issue_comment` but no `update_issue_comment`: planning-answer must still refuse before its first write — pinned in Task 2.
- The MCP path hands a numeric comment id where the `gh` path hands a node ID: the row must name the numeric `id` source — pinned in Task 1.
- A body read through MCP and written back must keep the `<!-- needs-decision: -->` marker — the row states the read strips only invisible characters; pinned in Task 1.
- Shaping mode's untrusted-author filter must survive the gh-absent path — pinned in Task 3.
- The old "maps no MCP call" wording must not survive anywhere in the three files — Task 2 Step 1 asserts its absence.

---

### Task 1: Transport mapping row and generalized unmapped-step rule

**Files:**
- Modify: `plugin/skills/_shared/github-write-transport.md` (CRUD mapping table, after the `| Comment |` row; the **A write sequence with an unmapped step refuses before its first write.** paragraph)
- Create: `tests/github-write-transport-comment-edit-conformance.test.js`

**Interfaces:**
- Produces: the row heading literal `| Edit an existing comment |` and the tool name `update_issue_comment`, which Tasks 2 and 3 cite as "per `_shared/github-write-transport.md`".

- [ ] **Step 1: Write the failing test** — new file, `'use strict'`, header comment `// #6101: pins the issue-comment edit row in _shared/github-write-transport.md and its two callers.` Use `readText` and the same `lit`/`f`/`pinned` helpers as `tests/specify-planning-answer-conformance.test.js:15-24`. Test `'row: the comment edit maps to update_issue_comment'` takes the one line starting `| Edit an existing comment |` and pins:
  - `` f('`update_issue_comment` (github-mcp-server v1.12.2+, default `issues` toolset)') ``
  - `` f("`comment_id` is the comment's numeric `id` from `issue_read` (get_comments mode), which carries no node ID") ``
  - `` f('it strips only invisible characters, so the marker survives the prepend') ``
  - `` f('A session whose tool list has no `update_issue_comment` treats the edit as unmapped') ``

  Test `'rule: a missing mapped tool refuses like an unmapped step'` takes the paragraph starting `**A write sequence with an unmapped step` and pins `` f('or one whose mapped tool the session lacks') `` and `` f("`specify/planning-answer.md`'s Inputs check is the standing example") ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/github-write-transport-comment-edit-conformance.test.js`
Expected: FAIL (row line not found / facts missing)

- [ ] **Step 3: Edit the transport file.** Insert after the `| Comment |` row:

  `` | Edit an existing comment | `gh api graphql` `updateIssueComment` by the comment's node ID (`specify/shaping-mode-stamping.md`'s live-comment mechanics) | `update_issue_comment` (github-mcp-server v1.12.2+, default `issues` toolset) — `comment_id` is the comment's numeric `id` from `issue_read` (get_comments mode), which carries no node ID; `body` is the whole new body, composed from that read (it strips only invisible characters, so the marker survives the prepend). A session whose tool list has no `update_issue_comment` treats the edit as unmapped (**A write sequence with an unmapped step** below) | ``

  In the rule paragraph, change "includes any operation this file maps to no MCP call," to "includes any operation this file maps to no MCP call, or one whose mapped tool the session lacks," and "checks for `gh` before the sequence's first write and, when it is absent, refuses" to "checks before the sequence's first write and, when the step's tool is missing, refuses"; replace the final sentence with: "`specify/planning-answer.md`'s Inputs check is the standing example: its Write step edits the hold comment, so a session with neither `gh` nor `update_issue_comment` refuses before storing the plan (#6059, #6101)."

- [ ] **Step 4: Run test to verify it passes** — same command, Expected: PASS.

- [ ] **Step 5: Commit** — `git add` both files; message `Map the issue-comment edit to update_issue_comment — gh-absent transport row (#6101)`.

### Task 2: planning-answer.md narrows its refusal and names the MCP edit

**Files:**
- Modify: `plugin/skills/specify/planning-answer.md:7` (gh-absent refusal), `:47` (Write (c) comment-edit clause)
- Modify: `tests/specify-planning-answer-conformance.test.js:242` (L11 write c pin), `:252-255` (gh-absent refusal pins)

**Interfaces:**
- Consumes: Task 1's row (`update_issue_comment`, numeric `id`).

- [ ] **Step 1: Update the pins first.** L11 write c: replace the `maps no MCP call` fact with `` f("gh absent: `update_issue_comment` with each comment's numeric `id` per `_shared/github-write-transport.md`") ``. The review test: rename to `'review: gh absent without update_issue_comment writes nothing, and a hold with no question re-plans'`; pins `` f('With `gh` absent and no `update_issue_comment` tool in the session, write nothing and stop here') `` and `` f('The outcome is `held — answering needs gh or the MCP update_issue_comment tool`') ``. Add an assertion in that test that `planning-answer.md`'s full text does not contain `maps no MCP call`.

- [ ] **Step 2: Run to verify red** — `node --test tests/specify-planning-answer-conformance.test.js` — Expected: FAIL on L11 and review.

- [ ] **Step 3: Edit planning-answer.md.** Line 7 becomes: "With `gh` absent and no `update_issue_comment` tool in the session, write nothing and stop here: `## Write` (c) and `## Re-hold` (d) edit the hold comment, which `_shared/github-write-transport.md` maps to that tool, so every run would store the plan and rewrite the body before failing. The outcome is `held — answering needs gh or the MCP update_issue_comment tool`." Line 47: replace "`_shared/github-write-transport.md` maps no MCP call for the comment edit: with `gh` absent it fails, and the label stays" with "gh absent: `update_issue_comment` with each comment's numeric `id` per `_shared/github-write-transport.md`" (the `Fail closed:` sentence after it stays).

- [ ] **Step 4: Run to verify green** — same command, Expected: PASS.

- [ ] **Step 5: Commit** — message `Answer a planning hold without gh — planning-answer edits the hold comment over MCP (#6101)`.

### Task 3: shaping-mode-stamping.md gh-absent comment resolution

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (section **Resolving live `needs:decision` comments**, between the `gh api graphql -F query=...` code block and the paragraph starting "Do this for every unresolved comment found")
- Modify: `tests/github-write-transport-comment-edit-conformance.test.js` (add one test)

**Interfaces:**
- Consumes: Task 1's row.

- [ ] **Step 1: Write the failing test** `'stamping: the live-comment resolution names its gh-absent path'` — region from `**Resolving live \`needs:decision\` comments` to `### Compose-then-write-once`; pins `` f("With `gh` absent, per `_shared/github-write-transport.md`: list the comments with `issue_read` (`get_comments`, paged)") ``, `` f('`author_association` `OWNER`, `MEMBER` or `COLLABORATOR`') ``, `` f('printing the skip line for every other marker comment') ``, `` f('edit each with `update_issue_comment`, passing its numeric `id` and the prepended body') ``, `` f('A session without that tool fails the edit, and the fail-closed rule below keeps the label') ``.

- [ ] **Step 2: Run to verify red** — `node --test tests/github-write-transport-comment-edit-conformance.test.js` — Expected: FAIL on the new test only.

- [ ] **Step 3: Insert the paragraph:** "With `gh` absent, per `_shared/github-write-transport.md`: list the comments with `issue_read` (`get_comments`, paged), keep the set the two commands above select — a `<!-- needs-decision: ` marker, no `**Resolved:**`, and `author_association` `OWNER`, `MEMBER` or `COLLABORATOR`, printing the skip line for every other marker comment — and edit each with `update_issue_comment`, passing its numeric `id` and the prepended body. A session without that tool fails the edit, and the fail-closed rule below keeps the label."

- [ ] **Step 4: Run to verify green** — same command, Expected: PASS; also `node --test tests/comment-trust-conformance.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/claim-mcp-projection-conformance.test.js tests/github-write-transport-label-merge-conformance.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — message `Resolve needs:decision comments without gh — shaping mode edits them over MCP (#6101)`.
