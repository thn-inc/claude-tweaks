# Console on PR — render the Review Console as a PR comment with a checkbox answer protocol

Canonical for `integration-model: pr-first` (`_shared/integration-model.md`) runs: renders
`wrap-up/review-console-interactive.md`'s and `flow/multispec-review-console.md`'s console content — same
sections, same rows, same data, per `console-template.md` / the multi-spec console's own template
— as **one PR comment** with a GitHub-native task-list checkbox per item, instead of the chat-based
`AskUserQuestion` gate. Any later session, not just the one that built the run, can read the
human's answers directly off the PR. This file only renders and persists state — it never reads a
tick back or acts on one; that is `console-execution`'s job (a separate sub-issue). `local-merge`
runs never reach this file — they keep the session-only `AskUserQuestion` console unchanged.

## When this runs

Immediately in place of "Present the console" (`review-console-interactive.md`) / "Present the consolidated
console" (`multispec-review-console.md`)'s own `AskUserQuestion` gate, when **both**:

1. `run-state.json` carries a `pr` object (`_shared/pr-run-comments.md`'s gate).
2. The Auto-resolution short-circuit (`consoleAutoResolve`) above did **not** already resolve and
   return — that section is untouched by this file (#347's own scope, Related not merged) and
   takes priority when granted, at every integration model.

Otherwise (no `pr` object, or `consoleAutoResolve` already resolved everything): proceed to
"Present the console" / "Present the consolidated console" exactly as written there — unchanged.

**No `AskUserQuestion` call is issued at the top-level Review Console gate on this path, live
session or headless.** This is what retires "headless-parked-forever" as a resting state: today, a
headless firing calls `AskUserQuestion` and has nobody to answer it, so the run just sits
unresolved. Under this file, every pr-first run instead renders the comment, writes
`console.json`, and reports `pending-review` with the PR URL — a clean, immediate terminal state
regardless of who (if anyone) is watching. A live human who happens to be present sees that
report instead of a prompt, and answers by ticking boxes on the PR the same way a headless firing's
eventual human reviewer would. This does not remove `AskUserQuestion` from any *other* call site in
the pipeline (build-option prompts, interactive merge-conflict resolution, etc.) — only this one
gate.

## Item ID scheme

Every renderable row gets a stable id: `{kind}-{n}` where `{kind}` is one of `staged` (every batch
section from Auto-applied through Cleanup actions — reusing the console's own global `#` sequence
as `{n}`), `q` (Queue writes, `{n}` = the `Q#` number), `m` (Memory updates, `{n}` = the `M#`
number), or `u` (Upstream feedback, `{n}` = the `U#` number). The multi-spec console qualifies
every id with its spec slug — `{spec-slug}-{kind}-{n}` — so ids stay unique across every spec's
rows sharing one comment set. One further id, always present, always last: `resolve`.

**Auto-applied rows are never checkboxes** — they already happened (see `console-template.md`);
render them as the same plain table the chat console already uses, informational only, no id, no
tick.

## Row shape

One HTML marker line immediately above its task-list row — never inside the checkbox label text,
so toggling the box (which rewrites the visible label markdown, not the marker) never disturbs the
id:

```markdown
<!-- console-item: {id} -->
- [ ] **{number}** {skill/destination} — {one-line summary} — {source/patch reference}
```

The summary text is the same content `console-template.md`'s own row already carries for that
item — this file changes the row's *shape* (a checkbox line instead of a table row), never its
*content*. Reuse the existing `staged/` classifier (`Title:`/`Type:`/`Labels:` header = queue
write) for Queue writes — do not re-derive it.

**The Cleanup-actions row for the Git-worktree/branch-finish step** (`cleanup-procedures.md`'s
canonical item 4 — the row `pr-first` routes to `_shared/pr-first-merge.md`'s procedure on
"Approve all + merge") additionally carries `"isMergeRow": true` on its `console.json` item
object (#1294) — the one item `_shared/console-execution.md`'s `consoleAutoResolve` wiring must
single out when `mergeCheckVerdict` (below) is `needs-human`. Every other item's object omits
this field entirely; it is never `false`.

**An `sdd-ruling-*` row** (Pending review, #3401 — its staged file is `staged/sdd-ruling-{N}.md`)
carries its two dispositions in its label, appended after the source reference:
`— tick = ratify · untick = reverse`. Unticked at Resolve time it means reverse, never a bare
decline (Legend below). It carries `"isRulingRow": true` on its `console.json` item object (#3636) —
like `isMergeRow` above, omitted on every other item, never `false` — the flag `resolve-console`
reads to record an unticked or `--decline`d ruling as `reversed`, not `declined`, and the
reconciler's detection forwards it to the executing session.

## Legend (verbatim — AC4)

Render this block, unmodified, immediately before the final Resolve checkbox:

```markdown
### Answering this console

- **Ticked** = approved (applies that item's action).
- **Unticked when Resolve console is ticked** = declined.
- **Exception — an SDD ruling row** (`sdd-ruling-*`): ticked = ratify; unticked when Resolve
  console is ticked = **reverse** (a reversal record is filed), never a bare decline.
- Tick every item you approve, then tick **Resolve console** last to confirm — a half-ticked
  list is never read as an answer on its own.
- **The PR itself needs no checkbox**: mark it ready and merge it = "merge"; close it =
  "discard"; leave it as-is = "keep parked".
```

The SDD-ruling bullet is the one exception to the declined rule: the executing session performs the
ratify or reverse write-back per `wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet
(`_shared/console-execution.md`'s Execution routing).

## Resolve checkbox

```markdown
<!-- console-item: resolve -->
- [ ] **Resolve console** — tick this last, once every box above reflects your decision
```

**Resolve-box semantics across re-renders:**

- **Resolved** (the `resolve` marker's row was ticked as of the last time this file read the
  comment): never re-render. A resolved console is terminal — `console-execution`'s job to act on
  it, not this file's to keep touching it.
- **Unresolved, item set unchanged**: re-rendering (a resumed run) preserves every tick, Resolve
  included — read-modify-write per "Edit-idempotence" below.
- **Unresolved, item set changed** (a resumed run whose `decisions.md`/`staged/` gained or lost
  rows since the last render): preserve ticks on items whose id survives; drop ticks whose item is
  gone; new items arrive unticked; **un-tick Resolve** even if it was ticked, and append directly
  below the Resolve row: `_(items changed since your Resolve tick — re-tick to confirm)_`.
  Approval always refers to the list as it is currently rendered — a Resolve tick made against a
  stale item set must never be read as approving items the human never saw.

## Comment-edit permission surface

**Verified against GitHub's documented behavior** (not live-tested against a second collaborator
account in this environment — stated here rather than silently assumed): toggling a task-list
checkbox through GitHub's own UI is available to anyone who can comment on the issue/PR at all —
it is not gated on repo write access, and is a materially *lower* bar than editing the comment
body outright. **Editing the comment body via the API** (`updateIssueComment`, what this file's
own render/re-render write path uses) requires either being the comment's original author or
holding repo write access. State this precisely in the legend rather than the stronger claim the
issue's own Technical Approach flagged as unverified ("approximately merge-equivalent"): checkbox
ticking is available more broadly than the render/re-render write path itself is. If a future
verification finds this wrong for some GitHub plan/permission tier, surface it on the parent
record rather than silently trusting this note.

## `{run-dir}/console.json`

```json
{
  "commentIds": ["IC_kwDO...primary", "IC_kwDO...overflow1"],
  "prNumber": 42,
  "items": [
    { "id": "staged-5", "kind": "staged", "summary": "2 severity:medium findings", "stagedHash": "a1b2c3..." }
  ],
  "renderedAt": "2026-08-14T15:00:00Z",
  "mergeCheckVerdict": "needs-human"
}
```

`commentIds[0]` is the primary comment — the one carrying the Resolve checkbox and legend, and the
one this file's find-by-marker lookup (`<!-- claude-tweaks-console: {run-id} -->` as its first
line) always locates first. Any further entries are overflow comments (below), linked from the
primary. `stagedHash` is each item's staged-file content hash at render time — `console-execution`'s
own drift check (not this file's concern) compares it against the file's hash at act-time to
detect a staged proposal that changed underneath an already-rendered tick.

**`mergeCheckVerdict` (#1294).** Written at first-render time (Post-or-update procedure step 1
below), never re-derived on a later re-render: when this run's group had an
`assess-agent-autonomy` `merge-check` verdict already computed this session before the console
renders (`dispatch/settle-and-merge.md`'s Auto-merge gate, Layer 2 — the same verdict
`wrap-up/review-console.md`'s Auto-resolution short-circuit reads as "a verdict exists for this
run"), carry it into `console.json` as `"mergeCheckVerdict": "needs-human"`. Omit the field
entirely when no merge-check ran this session (the group never carried `auto:merge`/
`auto:merge-pending`, so nothing was computed) — omission means "unknown," never "cleared for
auto-merge"; only a literal `"needs-human"` value is ever written, since an `auto-merge` verdict
carries no carve-out to persist. This is what makes the verdict readable by a **foreign session**:
`_shared/console-execution.md`'s reconciler-side executor runs with no access to the session that
rendered the console, so the render-time short-circuit's session-scoped knowledge (line above)
would otherwise be invisible to it — this field is the durable copy. See
`_shared/console-execution.md`'s "consoleAutoResolve wiring" section for the read side.

Two further optional fields arrive only after execution, never at render time: `executedAt` (ISO
timestamp) and `resolved: true`, both written by `console-execution.md`'s Write order — see that
file for the write order and what reads them.

A stale or deleted comment id (the human deleted it, or it's simply gone) — recreate the comment
fresh and update `console.json` with the new id; do not treat a missing comment as "already
resolved."

## Post-or-update procedure

Extends `_shared/pr-run-comments.md`'s find-by-marker + GraphQL-update-in-place mechanism with a
fourth kind, `console`, and one addition that mechanism's other three kinds don't need:
tick-preservation across the read-modify-write.

1. **No existing `console.json` for this run** (first render): compose the full comment body
   (all sections, all rows unticked, legend, Resolve checkbox unticked), post via
   `gh pr comment`, write `console.json` with the new comment id, every item's `stagedHash`, and
   — when this run's group had a merge-check verdict already computed this session (see
   `mergeCheckVerdict` above) — that field.
2. **`console.json` exists, resolved marker not yet observed**: fetch the current comment body
   (`gh pr view {pr-number} --json comments`, matched by the recorded comment id — never
   re-search by marker once an id is known, to avoid a race with a concurrently-created comment of
   the same kind), parse each `<!-- console-item: {id} -->` row's tick state by regex against the
   line immediately following the marker (`- \[x\]` vs `- \[ \]`), then recompose: matching ids
   keep their parsed tick, ids no longer in the current item set are dropped, new ids from the
   current item set arrive unticked, `resolve`'s tick is preserved unless the item set changed
   (see "Resolve checkbox" above). **Re-fetch immediately before writing** and re-merge if the
   body changed underneath since the first fetch — the residual fetch-to-write race window past
   that second fetch is accepted and documented, not eliminated; a human ticking a box in the
   handful of seconds between this procedure's own re-fetch and its write is the one case this
   does not protect, and there is no lock to take on a GitHub comment body. Update via the same
   GraphQL `updateIssueComment` mutation `_shared/pr-run-comments.md` already uses.
3. **Resolved marker observed** (Resolve was ticked on the last read): do not render at all —
   this run's console is terminal. Return without writing.
4. **Overflow** (composed body would exceed 65,536 characters): split at a section boundary —
   never mid-row — into a primary comment (intro, legend, Resolve checkbox, and as many leading
   sections as fit) plus one or more follow-up comments (the remaining sections), each follow-up
   linked from the primary (`_(continued in the next comment)_`) and from the one before it.
   `commentIds` in `console.json` lists them in render order, primary first. The tick-preservation
   read in step 2 applies per-comment — an item's id determines which comment it lives in, and
   that assignment stays stable across re-renders unless the overflow split point itself moves
   (a section growing or shrinking enough to cross a comment boundary) — when it does, treat every
   item in the comments from the first affected one onward as if the item set changed for the
   purpose of tick preservation, since their physical location changed even though their ids
   didn't.

## Headless conclusion

After the post-or-update procedure completes (steps 1, 2, or 4 above — step 3 already means
nothing was rendered this time), report outcome `pending-review` with the PR URL, and end this
run cleanly. No blocking wait, no `AskUserQuestion`. Log to `decisions.md`:

`AUTO {time} — Console-on-PR: rendered {N} items ({M} sections) to PR #{number}, comment
{comment-id}. Reversibility: high (comment is editable/re-renderable).`
