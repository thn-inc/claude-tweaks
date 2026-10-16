# Dispatch MCP Transport: `list_issues` Label-Truncation Gotcha (#3137) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document, in `plugin/skills/dispatch/mcp-transport.md`, the live-observed gotcha where `mcp__github__list_issues` silently truncates the `labels` array when an explicit `fields` list is passed, and require a standing per-candidate cross-check mitigation before any eligibility/exclusion decision is made from an MCP-sourced queue pull.

**Architecture:** This is a documentation-only change — no code, no runtime behavior changes. One new subsection is added to `plugin/skills/dispatch/mcp-transport.md`, in the same style as that file's existing `#2523` "native blocked-by / linked-PR batching" subsection (evidence paragraph + required-workaround paragraph + re-open condition). A one-line cross-reference is added to `plugin/skills/dispatch/queue-pull-script.md`'s existing MCP-path note so a reader following that pointer lands on the gotcha too.

**Tech Stack:** Markdown (SKILL.md sub-file), this repo's skill-authoring conventions (`docs/skill-authoring.md`).

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3137/.claude-tweaks/pipelines/2026-10-15T184624-record-3137/work/3137-spec.md` (materialized from GitHub issue #3137)

## Global Constraints

- Documentation-only — do not touch any `.js` file or runtime behavior.
- Follow this file's established prose style: a `##`-level subsection per gotcha, confirmed evidence first, then a "Required workaround" paragraph, then a "Re-open this section if …" closing line — mirrors the existing `#2523` subsection immediately below where the new one is inserted.
- Do not assert that omitting `fields` from `list_issues` is confirmed safe — this plan has no live `gh`-absent MCP sandbox to verify that in. State it as unverified-but-plausible, with the per-candidate cross-check as the standing required mitigation until it is verified.
- Cite the issue number (`#3137`) in the new subsection heading, matching the file's existing `#2523` citation convention.

## Review Focus

- A reader skimming only `mcp-transport.md`'s Step 2 subsections must see the label-truncation gotcha without needing to open the original issue — the evidence paragraph must stand alone (issue number, exact label-count delta, confirmation method).
- The mitigation must be phrased as a standing requirement ("before any eligibility or exclusion decision"), not a one-off note — matching the Deliverables' explicit "promoted ... to a standing documented step" framing.
- `queue-pull-script.md`'s own MCP-path note must not be left silently stale once `mcp-transport.md` gains a gotcha its one-line pointer doesn't mention.
- The new subsection must not overclaim the fields-omission fix as verified — distinguishing "confirmed via live firing" (the truncation bug itself) from "unverified" (the omission fix) is the whole point of the Acceptance Criteria's conditional third bullet.
- No unresolved placeholder markers (`TBD`, `TODO`) introduced into either file — this project's own materialization hard gate treats those as a shape failure.

---

### Task 1: Document the `list_issues` label-truncation gotcha and its required mitigation

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (insert a new `##`-level subsection immediately after the existing "## Step 2 — queue pull and per-dependency open-state check" subsection, before "## Step 2 — cross-PR overlap report (#1579)")
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (append one clause to the existing "**MCP path**" line near the end of the file)

**Interfaces:**
- Consumes: nothing — this is prose only, no code interfaces.
- Produces: nothing — no code interfaces for a later task to consume. This is the plan's only task.

- [ ] **Step 1: Write the verification command (this is a docs change — "test" means the new text is present and correctly placed)**

```bash
grep -n "list_issues.*fields.*parameter silently truncates\|fields.*silently truncates labels" plugin/skills/dispatch/mcp-transport.md
```

- [ ] **Step 2: Run it to confirm it currently fails (the subsection doesn't exist yet)**

Run: `grep -n "silently truncates labels" plugin/skills/dispatch/mcp-transport.md`
Expected: FAIL (no match, exit code 1)

- [ ] **Step 3: Insert the new subsection into `mcp-transport.md`**

Insert immediately after the existing line (currently line 39):

```
## Step 2 — queue pull and per-dependency open-state check

The queue pull uses the confirmed "list issues by label" mapping; the per-dependency open-state check (the `gh issue view "$DEP" --json state` loop) uses the confirmed "get single issue by number" mapping, checking the returned state field for `OPEN`. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched.
```

and before the existing line `## Step 2 — cross-PR overlap report (#1579)`, add:

```markdown
## Step 2 — `list_issues` `fields` parameter silently truncates labels (#3137)

**Confirmed live** (`gh`-absent firing, 2026-10-14): calling `list_issues` with an explicit `fields`
array that included `"labels"` returned a **silently truncated** labels array for every one of 11
candidates checked — e.g. issue #2807 actually carries `ready, risk:low, size:medium, type:task,
auto:build, bot:in-progress, priority:low` (7 labels, confirmed via `mcp__github__issue_read`'s
`get_labels` method), but the same issue came back from `list_issues` with only
`["ready","risk:low","size:medium","type:task"]` — missing `auto:build`, `bot:in-progress`, and
`priority:low` entirely, with no error or truncation flag.

Feeding a truncated labels array into `parseRecordFacets` (`bin/lib/issues/record.js`) can misjudge
`grants.build` / `bot.inProgress` / `bot.blocked` / `bot.parked` / `grants.merge` — a record whose
`bot:in-progress` label is dropped by the truncation looks falsely eligible to a headless firing,
risking a double-claim of a record another session already owns.

**Required workaround** — promoted the same way #2523's native blocked-by workaround (above) was
promoted in this file: before trusting any MCP-sourced `list_issues` result's labels for an
eligibility or exclusion decision, cross-check each surviving candidate's labels individually via
`mcp__github__issue_read` (`get` method's `labels` field, or the `get_labels` method) before parsing
facets from it — never trust the bulk `list_issues` labels array alone when `fields` was passed.
Whether omitting `fields` entirely from the `list_issues` call avoids the truncation (the bulk,
unprojected response may return full labels) is **unverified** — plausible, but not confirmed
against a live sandbox — so it is not yet the recommended default; the per-candidate cross-check
above is the standing required mitigation until a live run confirms the omission fix is safe.

Re-open this section once a live run confirms whether omitting `fields` from `list_issues` avoids
the truncation — at that point, promote fields-omission to the default and update
`queue-pull-script.md`'s MCP-path note accordingly.
```

- [ ] **Step 4: Run the verification command again to confirm it now passes**

Run: `grep -n "silently truncates labels" plugin/skills/dispatch/mcp-transport.md`
Expected: PASS (one match)

- [ ] **Step 5: Add the cross-reference clause to `queue-pull-script.md`'s MCP-path note**

Find the existing line near the end of `plugin/skills/dispatch/queue-pull-script.md`:

```
**MCP path** (`gh` unavailable): see `mcp-transport.md` in this skill's directory for the queue pull and the per-dependency open-state check. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched.
```

Replace it with (appends one sentence, changes nothing else):

```
**MCP path** (`gh` unavailable): see `mcp-transport.md` in this skill's directory for the queue pull and the per-dependency open-state check. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched. **That file's own `#3137` subsection documents a `list_issues` `fields`-triggered label-truncation gotcha and its required per-candidate cross-check mitigation — read it before trusting this pull's labels for any eligibility/exclusion decision.**
```

- [ ] **Step 6: Verify the cross-reference landed**

Run: `grep -n "label-truncation gotcha" plugin/skills/dispatch/queue-pull-script.md`
Expected: PASS (one match)

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/dispatch/mcp-transport.md plugin/skills/dispatch/queue-pull-script.md
git commit -m "docs: dispatch MCP transport — list_issues fields silently truncates labels (#3137)

refs #3137"
```

---

## Self-review

- **Spec coverage:** Deliverables bullet 1 (document the gotcha + require a standing mitigation) → Step 3. Deliverables bullet 2 (update `queue-pull-script.md`'s note if it needs it) → Step 5. AC1 (names the truncation with evidence) → Step 3's evidence paragraph. AC2 (standing required mitigation documented) → Step 3's "Required workaround" paragraph. AC3 (conditional fields-omission recommendation) → deliberately not applied in this task, since this plan has no live `gh`-absent sandbox to verify it in; the new subsection's closing line names the re-open condition instead of asserting an unverified default.
- **Placeholders:** none — every step shows exact before/after text, no "TBD"/"TODO".
- **Type consistency:** n/a — no code, no types.
- **Review Focus:** all five lines above map onto Step 3 (evidence + mitigation framing) and Step 5/6 (cross-reference landed, not left stale); no gaps found.
