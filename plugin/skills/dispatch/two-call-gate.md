# Dispatch Step 5 — The Gate Between a Group's Two Task Calls

Referenced by `skills/dispatch/SKILL.md` Step 5. Each group is dispatched as two sequential `Task()` calls (the literal prompts live in `task-prompt.md` in this directory); this file owns what the **dispatching session** does *between* them — the pass/fail gate and where each terminal path ends. Section numbers below are kept as originally assigned (2 and 5) even though 1, 3, and 4 no longer exist — those covered the `MANIFEST:`-derived run-directory handoff, retired now that Step 4 mints the group's run directory once, before either call, and passes the identical `PIPELINE_RUN_DIR` value to both.

## 2. The gate

Dispatch the second call only if the first call's status line was `DONE` or `DONE_WITH_CONCERNS` **and** its `OUTCOME` was `build-test-ok`. Anything else — a `NEEDS_CONTEXT`/`BLOCKED` status, an `OUTCOME` of `build-test-failed`/`build-test-blocked`, or no parseable report at all — means the second call is never dispatched for that group this firing; go to section 5. An `OUTCOME` of `already-shipped` (#2502) is never dispatched to the second call either, but is not a failure — go to section 7 instead of section 5. An `OUTCOME` of `handoff` (#4027) is neither a pass nor a failure: go to section 8, which continues the call and then judges this gate on the last continuation's report. A dispatched agent that fails mid-flight is a different case from one that completes — see `_shared/subagent-dispatch-core.md`'s "Failed-agent retrieval" section for how to read its result cheaply, without blocking on the full envelope.

**A prompt that does not render, or is denied twice (#4589).** When `dispatch-prompt.js` exits non-zero for a call, or the prompt hook denies that call's one unchanged resend, the call is never dispatched and its template is never filled by hand. Log `Prompt render failed: exit {code}: {stderr}` (or `Prompt denied twice: {reason}`) via `log-decision.js --status REFUSED --text-file "{text-file}"` (`_shared/auto-decision-log.md`'s Text from git or a user paragraph), then treat it as that call returning no parseable report: a first call or its continuation goes to section 5, a second call or its continuation to section 6. A first call that never dispatched (not its continuation, and not an escalated express run's first call, both of which hold a claim) appends section 5's `(prompt-not-dispatched: skip the claim release)` to that cleanup call.

**Artifact check, gated alongside STATUS/OUTCOME (#2837).** A well-formed `DONE`/`build-test-ok` pair is a self-report — a first call that implemented the record directly instead of invoking `/claude-tweaks:flow`, or that backgrounded the pipeline mid-run, can still produce one. STATUS/OUTCOME clearing the gate above is necessary but not sufficient: the moment they do, also run `plugin/bin/lib/dispatch/first-call-artifact-check.js`'s `checkFirstCallArtifacts({ runDir, issueNumbers, repoSlug })` against this group's minted run directory and member list, before dispatching the second call. It checks that `run-state.json` and `config.yml` exist in that run directory, that every member's `claims/issue-{n}.json` blob on `claims-registry` is live with `runId === basename(runDir)`, and — under `integration-model: pr-first` — that `run-state.json` records a `pr.number` whose head branch exists on `origin`. It also checks (#2775) that every member has a materialized header — `work/{n}-spec.md` or `spec-{n}/work/{n}-spec.md`, in the run directory or its worktree mirror, the same shapes `/wrap-up`'s record-resolution ladder reads — so a group whose first call never materialized (a hand-rolled build) is stopped here rather than reaching the second call with its records unresolved. It also checks (#3577) that the run directory's `decisions.md` carries the canonical `Step 2.8: claimed #{n}` line for every member (`hasCanonicalClaimLogFor`, `plugin/bin/lib/log-decision/claim-log.js`), the same canonical line `verify-run-bookends.js` enforces, so a first call that skipped that self-check is stopped here rather than reaching call 2, whose first push the stamps gate in `pre-tool-use.js` denies when no claim line is logged. A `{ ok: false, reason, message }` result is gated exactly like a missing/malformed status line (`sequential-execution.md`'s "The loop" section, #2429): never dispatch the second call — go to section 5 — and log one `decisions.md` line naming the `message` the check returned, via `log-decision.js --status REFUSED --text-file "{text-file}"`, where `{text-file}` holds `Artifact check failed: {message}` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (the `{message}` names paths and refs). Only `{ ok: true }` — or the repair branch below — together with a clean STATUS/OUTCOME pair clears this gate. A `first-call-artifact-check: degraded —` stderr line (the run's `config.yml` carries no valid `integration-model` pin, per `_shared/integration-model.md`) is logged as a `SKIP` decision via `log-decision.js --status SKIP --text-file "{text-file}"`, where `{text-file}` holds `condition: {stderr line} → fallback: PR-bookend check not run` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (the stderr line interpolates the config path), never treated as a failure.

**Repair branch: `missing-config` with `repairable: true` (#3226).** The one exception: this failed result is not routed to section 5. When the check returns `reason: 'missing-config'` with `repairable: true` — `config.yml` is the only artifact missing, every member's claim is still live under `basename(runDir)`, and, when `integration-model` (read from `policy.yml`, since the run's own `config.yml` is the missing file) is `pr-first`, the recorded PR's head branch is on `origin` — log

`AUTO {time} — Artifact check: config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption. Reversibility: high.`

via `log-decision.js --status AUTO --step "Artifact check" --text "config.yml missing, claim/PR intact — repairing via call 2's /flow case-3 adoption" --reversibility high`, then dispatch the second call unchanged: byte-identical to the normal second-call invocation, with no repair flag or hint. `/flow` detects the repair from on-disk state alone — no `config.yml`, other run content present, and a recorded `pr` land call 2 in adoption case 3 (`flow/steps-and-gates.md`'s "Adopting an inherited run directory"; `bin/lib/flow/preflight.js`'s `computeAdoption`), which rewrites `config.yml` through `set-config.js` from `decisions.md`'s config snapshot when one was logged, else recomputed from the precedence chain. Under `local-merge` no `pr` is recorded, so the same run lands in case 2 when `run-state.json` carries the `dispatched: true` bind stamp, else case 3 — both rebuild `config.yml`. An unset `integration-model` key in `policy.yml` requires the same PR evidence as `pr-first`; an invalid value never repairs. Every other failed result, and `missing-config` with `repairable: false`, keeps section 5's teardown. The repair branch is reachable only after the status-line check (#2429) and a clean STATUS/OUTCOME pair: a malformed status line is `BLOCKED` regardless of what the artifact check would return. `resolveFirstCallGate` in the same module is this ordering as code.

**Stamp read, a note never a gate (#3661).** Whenever call 2 is about to be dispatched — a `{ ok: true }` artifact check or the repair branch above — also run `checkFirstCallStamp({ runDir })` from the same module first. It reads `run-state.json`'s `worktree` and runs `verify.js --stamp-status` there, returning `{ verified, reason, status }`. `verified: true` (a stamp whose `verifiedHead` is true and whose `report.json` exists, or a complete `suiteComposed` verdict with no single stamp or `report.json`) logs nothing and changes nothing. Any other result means no runner pass stamp verifies the first call's HEAD (most often a test phase that bypassed `/claude-tweaks:test`): log the line below via `log-decision.js --status SKIP --step "Artifact check stamp read (degraded)" --text "condition: no runner pass stamp verifies the first call's HEAD ({reason}) → fallback: call 2 dispatched unchanged; its review Step 1.5 re-verifies through the runner (#3661)" --reversibility n/a`, then dispatch the second call unchanged. Blocking on it would discard a build that call 2's review Step 1.5 re-verifies through the runner anyway, and repairing it would re-run the suite here, moving that cost rather than saving it, so the stamp is a note, never a gate. A `stamp-read-failed` result takes the same note and is never treated as a failed artifact check. The logged line:

`SKIP {time} — Artifact check stamp read (degraded): condition: no runner pass stamp verifies the first call's HEAD ({reason}) → fallback: call 2 dispatched unchanged; its review Step 1.5 re-verifies through the runner (#3661). Reversibility: n/a.`

## 5. Terminal path when the first call fails

*(A second terminal path exists alongside this one, `integration-model: local-merge` only: the second call succeeds and reports `OUTCOME: ready-to-merge`. That path is owned entirely by `settle-and-merge.md`'s **Dispatching-session merge execution (local-merge fallback)** section, not this file — it needs the run-dir and worktree/branch values that section already resolves, but its own procedure (merge, push, then the cleanup this call deliberately deferred) is specified there. Under `integration-model: pr-first` (`_shared/integration-model.md`), this path doesn't exist at all — the second call merges itself via `_shared/pr-first-merge.md` and reports `merged`/`armed`/`pending-review` directly, so there is nothing left for the dispatching session's own thread to do on a success path.)*

1. **Settle runs inside the first call's own agent, not in this thread.** `settle-and-merge.md`'s Settle procedure states its own ownership: it "runs inside whichever of them handles the outcome being settled — the first call (`build,test`) when that call hits a HARD-GATE, the second (`review,polish,wrap-up`) on any path that reaches wrap-up — against that call's own record(s), never in dispatch's main thread." The first call's template in `task-prompt.md` instructs it accordingly, since a `build,test` HARD-GATE failure is that call's own failure to settle — claim release, `assess-agent-autonomy` failure classification, retry counting, `auto:merge` revocation, and the failure comment all happen there. The dispatching session does **not** run Settle itself; it only observes that the first call reported a failure. The one gap: a first call that produced no parseable report at all may never have run Settle, in which case that group's claims lapse via their TTL and a later firing re-pulls the records — the same resting state as any agent that died mid-run.

2. **Worktree teardown still routes through wrap-up.** `[IL-116]` forbids calling `ExitWorktree` / raw `git worktree remove` on a pipeline-run worktree: it skips `wrap-up/cleanup-procedures-execution.md` Section C's teardown sequence — step 3.6's close-run, the sanctioned exit the teardown gate checks for, and step 4's ordered removal — leaving the run non-terminal with its worktree assignment still recorded. But wrap-up lives only in the second call, which on this path was never dispatched. So the dispatching session makes one further call, from inside the group's worktree, purely to reach that cleanup route — **`/claude-tweaks:wrap-up` directly, not `/claude-tweaks:flow`:**

   ```
   PIPELINE_RUN_DIR="{run-dir}" CLAIM_RUN_ID="{RUN_ID}" /claude-tweaks:wrap-up {target} cleanup-only
   ```

   **Direct, not routed through `/flow` (#1766).** `/flow`'s Step 1.5 resolves and shape-gates every target record via `materialize.md`'s Resolution + Materialization hard gate *unconditionally, before any other Step 2 check* — there is no `cleanup-only` exception on that gate. When the first call's own HARD-GATE failure was itself the materialize shape-gate (record not spec-shaped), routing the teardown call through `/claude-tweaks:flow {target} wrap-up cleanup-only` re-resolves and re-gates the same still-unshaped record and reproduces the identical STOP — never reaching wrap-up's cleanup route at all. Calling `/claude-tweaks:wrap-up` directly never touches `/flow`'s Step 1.5 (or any other Step 2 pre-flight check — branch-divergence, shape-coupling, claim-contest), so this is not specific to the materialize-gate failure mode: it covers every first-call HARD-GATE shape uniformly, by construction, since none of `/flow`'s pre-flight runs at all on this path. `wrap-up`'s own Flags section documents `cleanup-only` as parsed the same way whether threaded down from `/flow` or typed directly — this is the sanctioned direct form, not a workaround.

   `{run-dir}` here is the same value this session minted for the group in Step 4 and already passed to the first call — anchored under `$RUN_ROOT/.claude-tweaks/pipelines/` by construction, since Step 4 built it directly from `_shared/pipeline-run-dir.md`'s Anchoring section rather than deriving it from an agent's report. There is nothing to re-derive or re-validate here.

   **`cleanup-only` still does what #298 shipped it to do.** Skips Phase 1 (ESTABLISH/reflection), Phase 2 (ROUTE), Phase 3 (SETTLE), and Phase 4's decide/execute/hand-off logic entirely — runs only `cleanup-procedures.md`'s cleanup items (A-E). `[IL-116]`'s constraint (Section C's teardown sequence) is unaffected — `cleanup-only` never relaxes it, only the reflection/routing/settle/close content and (when reached via `/flow`) `/flow` Step 5's ledger gate that this teardown call never needed. A materialize-gate failure means no `work/{n}-spec.md` was ever written for this record; `cleanup-procedures.md`'s worktree/carrier-commit check (item 4) already handles that — under `pr-first` it is skipped outright, and otherwise it resolves the run's records (`wrap-up-pack.json`'s `inputs.closingRecords` — Section E produces the pack before item 4 on a `cleanup-only` run — or the worktree mirror's `work/*-spec.md` when the pack could not be produced) and treats an empty result as the no-commits case, no carrier commit, nothing to stamp.

   **Claim permission stop (#4899).** When the first call reported `ISSUE #{n}: failed:claim-permission-denied`, Settle ran no release (`settle-and-merge.md`'s special case: skip steps 1-7), so the paragraph below does not apply, and the firing ends after this call (`SKILL.md`'s Claim permission stop). Append the parenthetical `(claim-permission-denied: skip the claim release)` to the cleanup-only invocation above; `wrap-up/cleanup-procedures-execution.md` Section E skips its release when the invocation names that, because `release-claim.js` would post a false release comment on an absent blob or tombstone for a record this run never claimed.

   Settle has already released this group's claim and adjusted its labels by this point, so `cleanup-only`'s Section E release step may run against an already-released claim. That overlap is accepted and recorded here so a duplicate release comment is not later read as a defect — the alternative is the `[IL-116]` hazard above.

   **Blocker-landing stop (#4792).** When the first call, or its last handoff continuation (section 8), reported `ISSUE #{n}: failed:blocker-landing`, Settle released a claim only when an earlier call of this run had taken one (`settle-and-merge.md`'s Blocker-landing special case), so the paragraph above, on Settle's already-released claim, does not apply. Append the parenthetical `(blocker-landing: skip the claim release)` to the cleanup-only invocation above, in both cases; `wrap-up/cleanup-procedures-execution.md` Section E skips its release when the invocation names that, because `release-claim.js` posts a release comment on an absent blob or a tombstone too (`bin/lib/release-claim/release.js`): a false one when this run never claimed the record, a duplicate when Settle already released it. Unlike a Claim permission stop, the firing goes on to the next group.

   **Prompt not dispatched (#4589).** When the first call itself never dispatched (section 2's render-failure or denied-twice paragraph; not its continuation, not an escalated express run's first call, whose claim the express lane took, not a second call), its `/flow` Step 2.8 never ran, so this run never claimed the record and Settle ran no release: the overlap paragraph above does not apply. Append the parenthetical `(prompt-not-dispatched: skip the claim release)` to the cleanup-only invocation above; `wrap-up/cleanup-procedures-execution.md` Section E skips its release when the invocation names that, because `release-claim.js` would post a false release comment on an absent blob or a tombstone. The firing goes on to the next group.

Only once that cleanup call returns does this session enter the next group's worktree (none after a Claim permission stop: the firing ends).

## 6. Terminal path when the second call's status line is missing or malformed

Same detection as `sequential-execution.md`'s mechanical status-line check, above — but firing on
the **second** (`review,polish,wrap-up`) call instead of the first. Treated exactly like the
second call reporting `BLOCKED`.

This needs its own remedy, not simply "same as section 5 above." Settle's own ownership note
(`settle-and-merge.md`) states it "runs inside whichever of them handles the outcome being
settled … the second (`review,polish,wrap-up`) on any path that reaches wrap-up." A second call
whose status line is missing or malformed is, by the same evidence section 2's check relies on,
one that backgrounded `/flow` or yielded outside the Foreground execution clause — exactly the
shape of a call that may never have reached wrap-up, and therefore may never have run Settle
either. Unlike the first-call case in section 5 (where Settle's non-run is certain — a `build,test`
HARD-GATE is always settled inside that same call, so a first call producing no report also never
ran Settle), a second call's silence is ambiguous: it may have run Settle and then hung, or died
before ever reaching it. There is no cheap way to distinguish the two from the dispatching
session's own thread, so treat it as the worse case (Settle did not run) — running cleanup-only
against a group whose claim was already released costs nothing (step 2 below), while assuming
Settle ran when it didn't leaves the claim, worktree, and run directory stranded.

1. **Make the same direct-`/claude-tweaks:wrap-up`-cleanup-only call section 5 item 2 specifies,
   unchanged in form.** This group already cleared the first gate, so there is no
   materialize-shape-gate concern to route around, but the same reasoning still applies — call
   `/claude-tweaks:wrap-up` directly, never through `/claude-tweaks:flow`, for the identical
   reason section 5 gives (re-running `/flow`'s Step 1.5/Step 2 pre-flight buys nothing here
   either):

   ```
   PIPELINE_RUN_DIR="{run-dir}" CLAIM_RUN_ID="{RUN_ID}" /claude-tweaks:wrap-up {target} cleanup-only
   ```

2. **Claim release is idempotent either way.** If the second call's own Settle procedure did in
   fact run before it yielded (the ambiguous case above), this group's claim is already released
   and its labels already adjusted — `cleanup-only`'s Section E release step finds an
   already-released claim and no-ops, the identical overlap section 5's own note already accepts
   for the first-call path. If Settle never ran, this call performs the release for the first
   time. Either way, the dispatching session never needs to determine which case it is before
   making this call.

3. **Worktree teardown is unaffected by which call reached it.** `[IL-116]`'s constraint on raw
   `ExitWorktree`/`git worktree remove` applies identically regardless of which Task call's
   failure triggered this path — `cleanup-only`'s `cleanup-procedures.md` Section C teardown sequence is
   what performs it correctly either way.

**Blocker-landing stop (#4792).** A second call's handoff continuation (section 8) whose step list includes `test` re-runs `/flow`'s pre-claim checks, and when Step 2.7b stops it, the continuation reports `OUTCOME: blocked` with `ISSUE #{n}: failed:blocker-landing` before reaching wrap-up, so the group's worktree is still up. Make item 1's call for it too, with the parenthetical `(blocker-landing: skip the claim release)` appended, the same phrase section 5's Blocker-landing stop paragraph appends. The first call claimed the record, so the continuation's own Settle already released the claim and closed the draft PR (`settle-and-merge.md`'s Blocker-landing special case, claimed case), and item 2 does not apply: `wrap-up/cleanup-procedures-execution.md` Section E skips its release on that phrase, because `release-claim.js` would post a duplicate release comment on the tombstone (`bin/lib/release-claim/release.js`).

## 7. Terminal path when the first call reports `already-shipped`

`build/SKILL.md`'s Spec Step 2 "Already-shipped assessment" (#2502): when every Deliverable and
Acceptance Criterion in the materialized spec is already satisfied on the base branch with zero
implementation diff needed, the first call stops there and reports `OUTCOME: already-shipped`
instead of proceeding to a normal build. This is **not** a failure — do not route it through
section 5's fail-loud reporting or Settle's failure classification/retry-counting/failure-comment
machinery, all of which assume something went wrong. Nothing did; the record was simply already
done.

By the time this outcome reaches the dispatching session, the first call has already:

- staged a Close proposal for the record (reusing `bin/lib/issues/shipped-candidate.js`'s shape),
- closed any draft PR the pr-early lifecycle opened for this run,
- released the record's claim.

**The only thing left for the dispatching session to do is tear the worktree down** — the first
call inherited it without entering it and, per the outcome-independent constraint at the top of
this file, can never tear it down itself, on any outcome including this one. Make the same direct
`/claude-tweaks:wrap-up {target} cleanup-only` call section 5 item 2 and section 6 item 1 both
specify, unchanged in form:

```
PIPELINE_RUN_DIR="{run-dir}" CLAIM_RUN_ID="{RUN_ID}" /claude-tweaks:wrap-up {target} cleanup-only
```

`cleanup-only`'s Section E release step finds an already-released claim and no-ops, the same
idempotent overlap section 6 item 2 already describes. This dispatching session's own report for
the group is a **no-op**, never `pending-review` — the record is closed via the staged Close
proposal, not shipped via a merge this firing performed. Only once that cleanup call returns does
this session enter the next group's worktree (none after a Claim permission stop: the firing ends, `SKILL.md`).

## 8. Continuing a handed-off call (#4027)

A first or second call whose report carries `OUTCOME: handoff` crossed `/flow`'s context cap at a
phase boundary (`flow/context-handoff.md`'s Dispatched call). It pushed its branch, kept its claim,
worktree and run directory as they are, and stopped with the steps still to run on its
`NEXT_STEPS:` line. That is not a failure: no Settle, no `cleanup-only` teardown, no claim release,
and no `firing` exclusion (`firing-exclusion.md`). This session continues the call, in the same
worktree, before anything else in this file runs for it.

1. **Read `NEXT_STEPS`.** Use `parseNextSteps` in `plugin/bin/lib/dispatch/first-call-artifact-check.js`.
   For the first call that is `parseNextSteps(reply, FIRST_CALL_STEPS)`, the parse
   `resolveFirstCallGate` runs before it returns `handoff`. For the second call it is
   `parseNextSteps(reply, SECOND_CALL_STEPS)`, the steps a second call can still run (`test`,
   `review`, `polish`, `re-verify`, `wrap-up`). Every group passes its records as
   `{ targets }`, `#N` strings (`['#12','#34']`), never bare numbers, a single-record group too
   (`['#12']` stays on the flat path), so no agent judges whether its group is a bundle and a flat
   `NEXT_STEPS` from a bundle fails closed; `resolveFirstCallGate` also takes `{ targets }`, in the same form, and
   forwards them to this parse. An `{ ok: true, steps }` result is the continuation's step
   list. A `{ ok: false, reason, message }` result fails closed. That covers
   NEXT_STEPS missing or empty, a step the call does not run, a step named twice, and a per-record
   value whose records differ from the targets. Log
   `Handoff refused: {message}` via `log-decision.js --status REFUSED --text-file "{text-file}"`
   (`_shared/auto-decision-log.md`'s Text from git or a user paragraph, since `{message}` quotes the
   agent's own text). Then treat the call as `build-test-blocked` (first call, section 5) or
   `blocked` (second call, section 6).
2. **Continue.** Dispatch `task-prompt.md`'s Continuation call, rendered by `dispatch-prompt.js --next-steps` (`continuation-call.md`): the same call's template, its step
   list replaced by `NEXT_STEPS`, with the same `{minted-run-dir}` and the same model profile. A
   per-record result's `stepArg` is the replacement. Log it
   first via `log-decision.js --status AUTO --step "Dispatch group {group}" --text "call {1|2} handed off ({n} of 3 this run); continuing {NEXT_STEPS} in a fresh call" --reversibility n/a`,
   `{n}` counting this run's handoffs across both calls.
   A continuation that reports `handoff` again comes back to item 1 with its own report.
3. **Bound: at most three handoffs per run.** The gauge enforces the real bound before any
   handoff is reported. `context-gauge.js` writes no handoff once the run has made `HANDOFF_BOUND`
   (3, `plugin/bin/lib/timing/context-gauge.js`) handoffs, counted in `handoff.json`'s
   `handoffCount`. The count is per run, not per call: both calls share one minted run dir, so they
   share the three. Past it the agent continues in place, and its call ends as it would without
   the gauge, completing or settling its own HARD-GATE (`flow/context-handoff.md`'s Reading the
   result). This session's own count, by the same per-run `{n}`, is a backstop for a misbehaving
   agent and never fires on a well-behaved one. A fourth handoff in the run is not continued:
   report the call as `build-test-blocked` (first call, section 5) or `blocked` (second call,
   section 6), naming the bound as the reason.
   Log `Handoff bound: call {1|2} is the run's fourth handoff; {NEXT_STEPS} not run` first, the same
   way as item 1's refusal.
4. **Gate on the last continuation's report.** It stands as the call's report. For the first call,
   section 2 runs on it as if the first call had returned it: status line, `OUTCOME`, the artifact
   check, the repair branch, the stamp read. For the second call, its `OUTCOME` routes like any
   second call's (`SKILL.md` Step 6; section 6 for a missing or malformed status line, or for a blocker-landing stop's `blocked`, per its Blocker-landing stop paragraph). A handoff
   report runs neither the artifact check nor the stamp read, because the steps that leave those
   artifacts have not all run yet.

A handoff refused for a malformed `NEXT_STEPS` (item 1) never ran Settle, since a handoff never
settles. That is the same accepted gap as section 5 item 1's report that cannot be parsed: the
claim is freed by the `cleanup-only` call's Section E release, or lapses via its TTL. No retry is
counted.
