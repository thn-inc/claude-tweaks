# Specify — Record Creation: Linking (Step 4)

Continues from `record-creation.md` and `record-creation-subissues.md` (this skill's directory) —
Step 3's record creation there, Step 4's linking and design-doc-context absorption here. Loaded by
`/claude-tweaks:specify` Step 4, decomposition mode only — shaping mode never reaches this step.
Step numbering is unchanged across the split (#1346), so a cross-reference naming a step by number
still resolves regardless of which file it lands in.

---

## Step 4: Link and order

Every record this run is going to create now has a number (a parent's, under a kept parent; every unit's own, under collapse). This pass wires the relationships between them and absorbs the last of the design doc's context, before Step 7 deletes it.

### Linking

Branches on driver, then — for `github-issues` — on `work-links`.

**Independent 2-unit collapse (Step 2.6, `decomposition-mode.md`) — `**Related:**` cross-links, not parent/child.** When Step 2.6 collapsed two independent units, there is no parent to link either sub-issue to. Instead, each of the two records gets a line-anchored, greppable `**Related:** #N` body line pointing at the other — `work-backend: github-issues`, both `work-links` values (GitHub's own automatic `#N`-mention timeline cross-reference exists but is not greppable record-body text, which is why this explicit line is written even under `work-links: native`); `work-backend: local-files`, the identical `**Related:** {id}` body line, no new frontmatter facet. The **bolded** form is the repo-canonical cross-reference line (`capture/SKILL.md`'s body template), so `/backlog refine` replaces it in place instead of appending a competing second one. Each line names a number, and neither number exists until its record is created, so this is a **post-create edit inside this Step 4 pass**, exactly like every other link here: create both records in Step 3, then recompose each record's full body with its `**Related:**` line and write it once per record (`gh issue edit --body-file` / `writeRecord`) — compose-then-write-once, never an incremental append.

**`work-backend: github-issues`, `work-links: native`:**

- **One command links the whole batch.** Both native write endpoints take the target issue's
  integer database ID (`databaseId`) **in the request body**, never its issue number, and the
  dependency edge lives at `issues/{dependent}/dependencies/blocked_by` — `bin/link-records.js`
  (over `bin/lib/issues/link.js`) resolves every needed id in one GraphQL call and issues the
  writes, so no per-edge `gh api` assembly happens here. Pass any kept parent, every sub-issue,
  and every dependency edge as `dependent:blocker` — under collapse there is no parent, so
  leave `--parent`/`--subs` off and pass only edges (skip the call when there are none):

  ```bash
  # Step 3 captured $SUB_ISSUE_NUM per sub-issue — join them: SUB_ISSUE_NUMS="595,597,598".
  # DEP_EDGES is every dependency edge as dependent:blocker, comma-joined: "598:595,600:530"
  # (blockers may be pre-existing records; leave --blocked-by off when there are none, and leave
  # --parent/--subs off when only edges need wiring — at least one of the two is required).
  node "${CLAUDE_PLUGIN_ROOT}/bin/link-records.js" --parent $PARENT_NUM --subs $SUB_ISSUE_NUMS \
    --blocked-by "$DEP_EDGES"
  # Prints one JSON envelope to stdout (do not redirect it away — read it from the tool result).
  # Owner/repo resolve from `origin`; pass --repo owner/name to override.
  ```

  Read the envelope's `subIssues.failed` and `blockedBy.failed` — a non-empty `failed` list is the
  Write-path resilience case above (note the failed link, continue the pass; never abort the
  decomposition). Exit 1 means the id resolution itself failed (a number that resolves to no
  issue) — stop and check the numbers before retrying. A re-run is safe: an edge GitHub already
  holds lands in `ok` with `already: true`.

- **This command requires `gh`** — the sub-issues and issue-dependencies endpoints have no
  GitHub MCP equivalent, so `_shared/github-write-transport.md`'s MCP path does not cover them.
  When `command -v gh` fails, `bin/link-records.js` exits 2 naming the fallback: link under
  `work-links: body-text` instead (the branch below, which needs only `issue_write`). The
  endpoint family is the one `capabilities-probe.js`'s `probeSchema` checks for via the
  `blockedBy` GraphQL field — the sibling `issueDependenciesSummary` field is count-only and
  insufficient, see that file's header comment.

- No body edits needed for native linking — the relationships live in GitHub's own graph, not in text.

**`work-backend: github-issues`, `work-links: body-text`** (fallback when native isn't available):

- Parent ↔ sub-issue — append one task-list line per sub-issue to the parent's body, `- [ ] #{subIssueNum}`, then a single `gh issue edit $PARENT_NUM --body-file` with the recomposed body (design summary + Decision Rationale below + the task list).
- Sub-issue ↔ sub-issue / sub-issue ↔ pre-existing record — add one `Blocked by #N` line to the dependent sub-issue's body per dependency (line-anchored, matching `record-dependencies.js`'s `DEP_RE`: the literal text `Blocked by #` followed by the number, at the start of a line), then a single `gh issue edit $SUB_ISSUE_NUM --body-file` with the recomposed body. When the dependency is between two sub-issues of this same decomposition (not a pre-existing companion record) and this decomposition produced 4 or more sub-issues (the Cross-Spec Promises threshold — see item 3 below), write the extended form instead — `Blocked by #N: {one-line assumption}` — stating what the dependent sub-issue actually needs from #N (`record.js`'s `parseDependencyAssumptions` reads the trailing text; bare lines and pre-existing-record links are unaffected).
- **Authoring the assumption text — mechanical, not prose-shape.** The assumption text should assert a structural fact about #N's own deliverable — a function, symbol, API, file, or exported artifact existing — never a specific prose string, documentation wording, or a claim about what #N's own eventual `## Non-Goals` will or won't scope out. A sibling's `## Non-Goals` narrows *how something is described*, not *whether it structurally exists*, so a mechanical assertion survives that narrowing and a prose-shape one doesn't. Safe example: `Blocked by #211: exposes getStatus() on the queue module`. Fragile example (avoid): `Blocked by #211: documents the retry-window default as "5 minutes" in its README section` — #211's own scoping decision can legitimately drop that exact wording from its docs while still shipping the capability, stranding this check.
- Readers parse this back out with `record.js`'s `parseDependencies(body)` — it returns every `Blocked by #N` target as a deduped, ordered array; a mid-line mention doesn't count, only a line-starting one does.

**`work-backend: local-files`** (no native/body-text choice — frontmatter is the only mechanism):

- Parent ↔ sub-issue — `facets.parent = $PARENT_ID` on each sub-issue.
- Sub-issue ↔ sub-issue / sub-issue ↔ pre-existing record — `facets.blockedBy = [N1, N2, ...]` on the dependent sub-issue.
- Both are `writeRecord` calls — compose-then-write-once, recompose the full facets/body and write once per sub-issue that needs a link. No task-list or `Blocked by #N` text needed; `parent`/`blocked-by` frontmatter is already queryable via `queryRecords`.

There's no ordering step separate from linking — the dependency graph these links encode **is** the order. The old tier tables are gone; nothing replaces them. `priority:*` labels are optional, dispatch-ordering-only, and human-applied — per the permission matrix in `_shared/work-record.md`, no skill here, `/specify` included, ever adds one *autonomously*; `/claude-tweaks:backlog`'s `refine` mode is the sole exception, always gated on an explicit human batch-confirm.

### Decision Rationale and Assumptions

Before Step 7 deletes the design doc, absorb the last of its context into the records that survive:

1. **Decision Rationale** — from the design doc, extract the "why" behind major decisions (approach choices, technology selections, rejected alternatives). When a parent exists, add as a `## Decision Rationale` section in its body — recompose the parent's full body (design summary + this new section + the task list, under `body-text`) and write once. Under collapse, no parent exists to hold it: fold it into each produced record's own body wherever Assumptions goes (below), recomposed and written once per record.
2. **Assumptions** — from the design doc's own stated assumptions, surfaced blind spots, and hard constraints, extract what's relevant to each sub-issue. Fold them into that sub-issue's **existing `## Gotchas` section** as additional bullets — there's no separate `## Assumptions` section anymore. Recompose the affected sub-issue's body and write once.
3. **Cross-Spec Promises** (only when this decomposition produced 4 or more sub-issues — the threshold was the `promise-register-min-leaves` policy lever until its retirement in #331; removal trail: `_shared/policy-deprecations.md`; **unreachable under collapse by arithmetic** — Step 2.6 collapses at most 2 units and this threshold is 4, so a collapsed run never reaches this item and needs no no-parent branch here) — add a `## Cross-Spec Promises` section to the **parent** body, recomposed alongside Decision Rationale and the task list. This seeding step is `work-links: body-text`-specific — only that mode's Linking pass (above) writes `Blocked by #N: {assumption}` lines to seed rows from; `work-links: native` sub-issues have zero such lines at decomposition time (that pass writes no body text at all), so a native-mode decomposition's section still gets created here, just empty at first — `/claude-tweaks:review`'s Step 1.6 can populate it later regardless of `work-links` mode, its writes being plain `gh issue edit`/`gh issue comment` calls. The one permanent exclusion is `work-backend: local-files`: there's no GitHub issue to hold any of it, so a decomposition under that backend never gets a `## Cross-Spec Promises` section, regardless of sub-issue count. Seed one row per `Blocked by #{blocker}: {assumption}` line the Linking pass above just wrote between two sub-issues of this decomposition — `{blocker}` is the same number from that line (the record being depended on); `{owner}` is the dependent sub-issue whose body carries the line (pre-existing-record links don't get a row — the register tracks promises between this parent issue's own sub-issues, not every dependency):

   ```
   | # | Promise | Owner (#sub-issue) | Status |
   |---|---------|-----------------|--------|
   | F1 | sub-issue #{owner} assumes sub-issue #{blocker}: {assumption} | #{owner} | open |
   ```

   When no sub-issue-to-sub-issue assumption lines exist (the threshold is still met — this decomposition simply had no forward dependencies among its sub-issues), still create the section with just the header row — `/claude-tweaks:review`'s Step 1.6 (`skills/review/SKILL.md`) looks for this section by name on every parent-linked record it reviews, and an absent section means "nothing to track at all (below threshold)" while a present-but-empty one means "tracked, nothing found yet." Post one comment on the parent noting the seed: `gh issue comment $PARENT_NUM --body "Cross-Spec Promises seeded: {count} forward reference(s) at decomposition time."` (skip the comment, but still create the empty section, when count is 0).

Step 3's Rules already asked for design-doc absorption while each sub-issue was being drafted; this is the systematic completeness pass — the last chance to catch a sub-issue that missed something, before the design doc becomes unrecoverable.

This is what keeps the records self-contained: reading any record this run produced later explains *why* the approach was chosen without needing the deleted design doc.
