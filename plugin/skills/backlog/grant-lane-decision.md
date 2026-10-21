# Backlog Refine/Grant — Grant-lane Decision (RECOMMEND_BUILD: false branch)

Referenced by `refine-mode.md`'s Step 3 (the branch this file documents) and Step 3.5 (which of the
two outcomes below also needs body-shape re-verification) and Step 5 (the write mechanics), by
`refine-lanes.md`'s Needs-decision lane (the rendered row + annotation template), and by
`refine-headless.md`'s Step 4 (the headless gate-4 refusal that reaches the identical `needs:decision`
outcome). Split out to keep `refine-mode.md` lean rather than duplicating this branch and its
bash snippets inline at every call site.

## The branch

`grant-check` (`/claude-tweaks:assess-agent-autonomy` in `grant-check` mode) returns
`RECOMMEND_BUILD: false` for a record. Two outcomes, mutually exclusive:

- **`risk:*` or `size:*` is missing** — a genuine scoring gap, not a content refusal — flag back
  exactly as before this record existed: remove `ready`, post the flag-back comment
  (`refine-mode.md` Step 5's Flag-back-rows mechanics, unchanged by this file).
- **Both `risk:*` and `size:*` are already present, and the record passes Step 3.5's body-shape
  re-verification** — a content-based denial (risk:high merge-authority work, a body naming a
  human-present-only deliverable, a record already resolved live), not a scoring gap. This is the
  outcome this file documents: stamp `needs:decision`, keep `ready`, add no `auto:*`.

`refine-mode.md` Step 1's fetch already carries `facets.risk`/`facets.size` for every selected
record — this check reads already-fetched facts, no new API call.

**`refine`'s headless posture's identical outcome (`refine-headless.md` Step 4):** Phase C's `evaluateGrantGate`
returns `grant: false, failedKey: 'grant-check'` — gate 4 denied a candidate that already cleared
gates 1-3. Unlike `refine`'s human-present path, no risk/size precondition applies here — every
other `failedKey` at any phase stays a silent Skip row (`refine-headless.md` Step 4, unchanged).

## Idempotence check (before laning/applying)

Query whether this record already carries an *unresolved* decision comment from this unit:

```bash
gh issue view "$ISSUE" --json comments -q '.comments[] | select(.body | contains("<!-- needs-decision: {unit} -->")) | select(.body | contains("**Resolved:**") | not) | select((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | .id'
gh issue view "$ISSUE" --json comments -q '.comments[] | select(.body | contains("<!-- needs-decision: {unit} -->")) | select(.body | contains("**Resolved:**") | not) | select(((.authorAssociation // .author_association) == "OWNER" or (.authorAssociation // .author_association) == "MEMBER" or (.authorAssociation // .author_association) == "COLLABORATOR") | not) | "skipped marker comment \(.url // .html_url // .id // "unknown") by \(.author.login // .user.login // "unknown") (\(.authorAssociation // .author_association // "no association")) — not an owner, member, or collaborator"'
```

Only a trusted author's comment counts (`_shared/pr-run-comments.md`'s Trusted authors); the second
command names each skipped lookalike — keep its lines in this step's output.

`{unit}` is `backlog-refine` or `backlog-grant`, per caller. A resolved comment's `**Resolved:**`
line is prepended above the marker (`_shared/work-record.md`'s resolution rule), so a resolved
comment never matches this query even though the marker text is still present in its body — that's
deliberate: a resolved comment must never gate a fresh one.

- **Non-empty** — an earlier run already marked this record for this unit. Render one annotation
  line only, never a fresh row, and write nothing this run — as its own bare line under the
  caller's own Needs-decision lane heading (`refine-lanes.md`'s Needs-decision lane, or
  `refine-headless.md`'s Needs-decision rows), since a record on this branch has no higher-precedence
  lane row to attach beneath.
- **Empty** — run the `resolved-refusal` check below; lane/apply a fresh row only when it does not
  suppress.
- **Query failed** (network error, non-zero `gh` exit) — fail closed, the same as a mismatch in
  `refine-mode.md`'s own pre-write reverify: never treat an unreadable result as "no unresolved
  comment exists." Skip this record this run, log `AUTO … skipped …` with `{what changed}` =
  `live-state fetch failed: {error}`, and report it.

### Resolved-refusal check (#3597)

Run only when the Idempotence query above came back empty. A human who resolved this refusal as
`keep` or `build it myself` has settled it, so re-asking is suppressed while nothing has changed
since:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolved-refusal.js" "$ISSUE"
```

It prints one JSON line: `{number, suppress, reason, choice, date, resolvedAt, changes, annotation,
skipped}`. Both `backlog-refine` and `backlog-grant` count, because both post the identical
grant-decision question and the same resolver (`refine-record.md`) resolves either one.

- **`suppress: true`** (`reason: unchanged`) — render its `annotation`
  (`#{n} — refusal resolved {choice} on {date}; not re-asked`) as a bare line under the caller's
  Needs-decision heading, the same placement as the Non-empty bullet. Write nothing this run.
- **`suppress: false`** — lane/apply a fresh row, as the Empty bullet did before this check. The
  `reason` says why: `no-decision-comment`, `latest-unresolved`, `resolved-unparseable` (the latest
  comment carries a `**Resolved:**` line that does not parse), `choice-not-suppressing`,
  `changed-since-resolution` (a body or label change after the resolution instant, which is the earlier
  of the `**Resolved:**` date's UTC start of day and the decision comment's last edit), or
  `evidence-unavailable`.
- **Non-zero exit** (`1`: gh or GraphQL failed, or no such issue; `2`: malformed invocation, gh absent,
  or repo unresolvable) — the **Query failed** bullet above, fail closed. Gh-absent has no MCP
  fallback for this read (`_shared/forge-detection.md` check 2; `backlog/mcp-transport.md` covers no
  needs-decision path).
- Keep the `skipped` lines in this step's output, as the second command above does.

## Write mechanics (`needs:decision` outcome only)

Keep `ready`, add no `auto:*` grant, add `needs:decision` (bootstrap per
`_shared/label-bootstrap.md`), post one marker comment:

```
<!-- needs-decision: {unit} -->
## Decision needed
**Proposed:** grant despite the flag, or build it yourself
**Why:** {grant-check RATIONALE, verbatim}
**Command:** `/claude-tweaks:backlog refine #{n}`
```

`{unit}` is `backlog-refine` or `backlog-grant` — the literal skill/mode name that wrote it, per
`_shared/work-record.md`'s decision-comment template. `**Command:**` is always
`/claude-tweaks:backlog refine #{n}`, regardless of which unit wrote the comment — `refine-headless.md`
is a headless posture with no human-facing apply step of its own, so a record it stamps
`needs:decision` is resolved the same way as one `refine` stamped directly: through
`refine-record.md`'s `#N` per-record resolver (Step 1(a)'s unresolved-decision-comment read),
not through `refine-mode.md`'s own whole-queue Needs-decision lane — the two are separate
resolution paths (this file's own header names both callers).

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" "BACKLOG_NEEDS_DECISION=backlog-needs-decision-${ISSUE}.md")"
if gh issue edit "$ISSUE" --add-label needs:decision; then
  gh issue comment "$ISSUE" --body-file "$BACKLOG_NEEDS_DECISION" || echo "label applied but comment post failed for #$ISSUE — retry the comment write"
else
  echo "label add failed for #$ISSUE — retry from scratch, no comment attempted"
fi
```

Treat the label edit and the comment post as two independently-reportable steps, never a single
unguarded pair — mirroring `apply-refine-labels.js`'s own edit/comment split (#1073). This matters
most on `refine-headless.md`'s headless path (no human present): a comment-post failure after a
successful label write must never be silently indistinguishable from full success, since a
`needs:decision` label with no comment leaves a human with nothing to resolve while the record
stays excluded from every headless worklist.

`refine-mode.md`'s batched application (`refine-lanes.md`'s Needs-decision lane): write
`{issue, addLabels: ["needs:decision"], commentFile}` per row to
`$ST_BACKLOG_REFINE_ACTIONS_NEEDSDECISION`, then one `bin/apply-refine-labels.js` call applies the
whole lane — same batching every other lane uses (`apply-refine-labels.js` already accepts
`addLabels` + `commentFile` together in one action, the identical shape Flag-back already uses with
`removeLabels` + `commentFile`). `refine-headless.md`'s Step 4 applies its own single-record write
inline — that posture has no batched-lane apply step at all.
