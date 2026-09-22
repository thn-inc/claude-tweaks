# Feedback Step 0 — Bare-Invocation Umbrella

Referenced by `skills/feedback/SKILL.md` Step 0. Read only on bare invocation — `$ARGUMENTS`
carries no free-text learning, or `--queue` was passed. A free-text invocation runs the
single-learning path (Steps 1-9) and never reads this file; a `--pre-confirmed` invocation never
reads it either — it processes only its caller-supplied staged item(s). Step 0's two gathers, the
merge rule, and the interaction budget, verbatim.

**Gather 1 — local upstream-candidate queue (unchanged).** This project may already hold
headless-filed candidates waiting for a human — the health sweeps' Subject check
(`_shared/learning-routing.md`) files these locally with `upstream-candidate` plus the sweep's own
`by:` label, deliberately without `ready`, precisely because nothing else in the plugin queries them
(#239). Check for them:

```bash
gh issue list --label upstream-candidate --state open --json number,title,body,labels --limit 100
```

(matching the label's expected low cardinality — a handful of headless-filed candidates, not the
full backlog — while still bounding the read per `[IL-67]`; if the count returned equals the
limit, state this in the summary rather than silently treating it as complete.)

**Gather 2 — session evaluation.** Read `session-evaluation.md` in this skill's directory. Before
dispatch, its **Skip check** runs first (on the transcript-resolved branch, `--full` not passed):
when the resolved transcript hasn't grown since the last stamped evaluation, skip the judge
dispatch entirely and report the prior stamp's `issueUrls` instead of re-evaluating — see that
section for the full check and its self-assessment exemption. Otherwise, run the judge dispatch
(or its self-assessment degradation) against `_shared/feedback-objectives.md`'s rubric. Each
returned finding becomes one merged-batch item; a `NOT EVALUATED` block is not a finding —
session-evaluation.md's own rule — and never enters the batch. The two gathers are
failure-isolated in both directions: a judge dispatch that errors or returns nothing usable
degrades to `session-evaluation.md`'s self-assessment path (noted in the run summary) and never
aborts the run — Gather 1's queue candidates proceed through the batch regardless — and a Gather
1 `gh` failure likewise never blocks the evaluation; the failed gather is reported in the run
summary while the other proceeds.

**Merging.** The two gathers feed **one merged batch by concatenation, no reconciliation** — each
item keeps its own draft shape; nothing here reconciles a queue candidate against an evaluation
finding even when they describe the same underlying issue. Run Steps 1-6 non-interactively for
every item in the merged batch (gather from the queue issue's own body, or from the finding's
symptom/evidence/proposed fix — deriving the affected component from the skill, contract, or CLI
the evidence names, falling back to "unclear / general" per Step 1 — classify,
confirm self-reference doesn't apply, dedup search, draft, scrub), then call
`_shared/upstream-feedback-batch.md`'s shared batch contract once — chunked per that file's own
rule — instead of looping Step 7 individually per item. Step 4's dedup fingerprint basis stays the
affected component plus the core symptom, exactly as today — the draft template's
`**Objective:**`/`**Measurement:**`/`**Cost this session:**` fields (Step 5) never join that basis.

Inside this loop, "stop" in Steps 2, 3, or 6 scopes to the one item that triggered it — drop that
item from the batch (report why, alongside the others' results) and continue the loop for the
rest; it never aborts the whole bare-invocation run, matching Step 7's own per-item isolation for
the drift-check fallback. A judge finding that Step 2 classifies as not D5 drops from the batch the
same way. A dedup match in Step 4 does not stop the item or ask interactively — see Step 4's own
batch-mode text. On a checked queue-derived item filing successfully (Step 8), close the local
`upstream-candidate` issue with a comment linking the new upstream issue — an evaluation finding has
no local issue to close. An unchecked item is handled per the shared contract's decline rule
(comment + leave the local issue open, where one exists).

**Interaction budget.** The whole bare-invocation run — both gathers, however many items each
produces — costs exactly one Step 7 batch confirmation plus one `## Next Actions` call; the
evaluation gather itself adds zero mid-flow `AskUserQuestion` calls. Under `--dry-run`, findings
from both gathers render and the run stops — Step 7's existing `--dry-run` precedence, extended
here to evaluation findings without change.

**Neither gather produced anything:** proceed to Step 1 as usual (gather from the conversation, or
ask).

This is what resolves `upstream-candidate`'s dead-write state (#239): the label's own consumer
was always meant to be a human eyeball plus a manual `/claude-tweaks:feedback` invocation
(`_shared/learning-routing.md`'s Headless-runs paragraph says exactly this), and this step is what
makes that eyeball's job a single command instead of a `gh issue list` a human has to remember to
run.
