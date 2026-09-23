# Dispatch — Close-out Confirmation

Canonical procedure for `close-out.md`'s per-candidate confirmation gate (its Step 4) — a distinct
stop from `resume-confirmation.md`'s "Confirm before resuming" gate, never reachable for the same
PR at the same time. That gate decides whether to re-enter a **still-active** parked run's own
worktree/context so its Review Console can render again; this gate exists for exactly the case
that one does not cover — the dispatching session that would have rendered that console has
already exited, and a human has approved the PR directly on GitHub instead. Resuming re-enters a
console with its own separate merge decision; close-out is what a human uses once there is no
session left to resume at all.

**Confirm before merging.** Before running Step 5 of `close-out.md`, call `AskUserQuestion`:

- `question`: `"Merge {target}'s pending-review PR #{number} ({url})? CI: {status}, mergeable: {mergeable-summary}, approved by: {approver-or-unknown}. Declining leaves it pending-review."`, `header`: `"Close out PR"`, `multiSelect`: `false`
- Option 1 — `label`: `"Merge"` (append `" (Recommended)"` per the Recommended-derivation rule below), `description`: `"Run the merge now — _shared/pr-first-merge.md's Step 3, arms or merges immediately depending on repo auto-merge settings"`
- Option 2 — `label`: `"Skip"` (append `" (Recommended)"` instead when the rule below picks this option), `description`: `"Leave this PR pending-review; do nothing"`

**Recommended-derivation rule.** Modeled on `resume-confirmation.md`'s own rule (same shape — a
single-predicate Recommended pick, never both, never neither) but not identical, since this gate
answers a stricter question (merge now, not merely resume): Merge is Recommended when CI reads
`passing` and mergeability reads clean (not `DIRTY`). Skip is Recommended when CI reads `failing`
or mergeability reads `DIRTY` — in the ordinary flow `close-out.md`'s own steps 1-2 already
stopped before this gate is ever reached for either case, so this predicate matters only when the
gate is consulted directly against a PR this session has not itself just re-verified. The two
gates never disagree in practice because they never render for the same PR at the same time (see
above) — not because their predicates are the same expression. Exactly one option carries
`(Recommended)`, never both, never neither.

**No `autonomy`-ceiling carve-out.** This gate stays unconditional at every ceiling tier,
including `unattended`, for the same reason `resume-confirmation.md`'s own gate does — and, unlike
that gate's rare-case reasoning, this is close-out's *only* case: a `pending-review` PR reaching
this mode at all means a human either declined `assess-agent-autonomy`'s `merge-check` verdict or
was never asked (no `auto:merge` grant) — the GitHub-side approval a human just gave authorizes
the PR's *content*, not the act of this session performing the merge unattended. Nothing upstream
covers that act; a future automated caller of this gate would need to earn its own carve-out on
its own evidence, exactly as `resume-confirmation.md` states for its own gate.

**Source values live, never from a stale scan.** PR number/URL, CI status, and mergeability come
from `close-out.md`'s own steps 1-2, already re-read fresh for this candidate — never re-fetched a
third time here. `{approver-or-unknown}`: `gh pr view {number} --json reviews --jq '[.reviews[] |
select(.state == "APPROVED")] | last | .author.login'` (or the MCP equivalent when `gh` is
absent), `unknown` when no approved review is found. This gate does not itself enforce that an
approval exists — that is the repository's own branch-protection configuration, not this skill's
job to duplicate — it only reports who approved, when known, so the human answering has that
context.

Declining (Option 2) stops here — the PR stays `pending-review` exactly as it was, and
`close-out.md`'s steps 5-7 never run for this candidate. On the bare form, move to the next
candidate; on the `#N` form, this is the whole invocation's result.
