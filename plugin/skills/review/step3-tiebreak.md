# Step 3.7 Tiebreak — /claude-tweaks:review

Read from `code-mode-steps.md`'s Step 3.7 and run at every effort tier (`low`, `medium`, `high`, `xhigh`, `max`) and in every mode (`auto`, `confirm`, `hybrid`, `interactive`), standalone or dispatched. Every finding still `unconfirmed` or `contested` after the earlier passes gets one independent agent verdict; `plugin/bin/lib/tiebreak.js` settles that verdict (outcome vocabulary, evidence checks, log line, finding identity) through `review-coordination.js`'s `resolve-tiebreak`, `write-findings`, and `check-coverage` subcommands. This file cites the resolver and never restates it.

## Placement

Runs after every earlier pass has settled a finding's bucket, in this order:

1. `step3-lens-dispatch.md`'s reproduction categorisation and absence-claim ground-truth check.
2. `step3-lens-dispatch.md`'s lens 3f vacuity downgrade.
3. `step3-cross-lens-corroboration.md` (`medium` only).
4. `step3-debate-and-refutation.md`'s Step 3.5 debate (`high` and above) and Per-Candidate Refutation (`xhigh`/`max`).
5. The Step 3.6 gap sweep (`xhigh`/`max`).

Entry status: every finding still `unconfirmed` or `contested` after that sequence, including both sides of a `nearLocation` pair — each is judged on its own, with its own agent and its own verdict line. A finding already `confirmed` does not enter.

## Findings artifact

In a pipeline run (`$PIPELINE_RUN_DIR` set), write the entry set to the run's `review-findings.json` before any dispatch. Resolve the input path with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-findings.json` (`_shared/session-tmp-root.md`; `{ctx-id}` as defined in `step3-lens-dispatch.md`), `Write` the entry array to the printed path, then call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" write-findings "$PIPELINE_RUN_DIR" "{path-F}"
```

Each entry is `{lens, path, line, claim, reporterSeverity, kind, positions?}` where `kind` is `unconfirmed` or `contested` — the shape is `plugin/bin/lib/tiebreak.js`'s. `lens` is the lens the finding's earlier STAGED line names, so the `#3772` key matches: `gap-sweep` for a gap-sweep finding, a contested entry's first position's lens, a multi-lens refutation candidate's first listed lens. Collapse each claim's whitespace and line breaks to single spaces first — one multi-line claim fails the whole set. Exit 2 means one malformed entry, and stderr names its index: fix that entry against `buildFindingsArtifact`'s checks (`plugin/bin/lib/tiebreak.js`) and re-run once. Exit 3, or a second failure, stops this step: log, with its text written to a session-tmp file and passed through `log-decision.js --text-file` (never a `--text` argument), `STAGED {HH:MM:SS} — Tiebreak: findings artifact not written ({exit}); {N} findings stay unconfirmed with no tiebreak verdict. Reversibility: high.` and run no dispatch. The line lists under the Review Console's Low-confidence section, and the earlier per-finding STAGED lines stay as written. With no artifact the archive gate has nothing to enforce, so this line is the only signal.

## Dispatch

One agent per entry, in parallel waves of **8**: dispatch a wave in one batch, wait for every agent of the wave to return, then start the next. Outside a dispatched reviewer, that wait follows `step3-lens-dispatch.md`'s hung single-read agent rule (its bounded wait and one `SendMessage` nudge); an agent still silent after that is a failed dispatch (`## Resolve and act` step 1). Never reuse the reporting lens's agent or its reproduction partner — the tiebreak agent is a fresh run.

> **Parallel execution:** Dispatch each wave's tiebreak agents as parallel Task agents — each runs independently, sees only its own finding's allowlist, and returns the template's `Verdict:`/`Evidence:`/`Severity:`/`Recommendation:` reply, settled by `resolve-tiebreak`. Assemble results after all agents complete.

After the last wave, re-run `step3-lens-dispatch.md`'s Post-fan-out untracked-file sweep against the same pre-dispatch listing — report-only, as there, logging only what the earlier sweep did not already report. Skip it when this step dispatched no agent (no entries, or every verdict read inline).

Model: `[Use: Capable]`, resolved with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"` (drop `--run-dir` when no run directory exists).

The Working Directory, Read-only Reviewer, and Foreground disciplines are the composed review-dispatch bundle's (standalone, `_shared/subagent-dispatch-core.md`'s), applied to these dispatches exactly as `step3-lens-dispatch.md`'s notes state for lens dispatches.

The agent receives the allowlist and nothing else: the claim text, the severity, the `path:line`, the diff scope (Step 2's — the own-work scope when the Merge-Provenance Check found merge commits), and, for a contested finding only, each position as a one-line claim plus a severity label. Never pass the reporting agent's evidence or reasoning. Inline this template literally in each `Task()` prompt, per the Subagent Contract:

```
Finding: {claim text}
Severity: {severity label — for a contested finding, the higher of the two positions' severities}
Location: {path}:{line}
Diff scope: {base}...{branch}, or the own-work file list path when the Merge-Provenance Check found merge commits
Positions: {contested finding only — omit this line and the two lines below otherwise}
- {one-line claim} ({severity})
- {one-line claim} ({severity})

Reply with exactly these lines, then your status line:
Verdict: confirmed | refuted | cant-tell
Evidence: {path}:{line} `{the whole cited source line, verbatim}`
Severity: critical | high | medium | low | info
Recommendation: file | drop — {one-line reason}

You are the independent tiebreak judge for this one finding. Re-read the live file at Location and decide from the code itself whether the finding holds; you were deliberately given no account of how it was reported.
Evidence is required for confirmed and refuted: cite the Location path exactly as given (the full repo-relative path, never a bare filename or another file) and a line within 5 of Location, and quote the whole cited source line verbatim — a token or fragment of the line is not a quote. cant-tell needs no Evidence line.
Recommendation file means the finding is worth a fix or a work record; drop means it is not worth acting on.
A vacuity claim — that a test cannot fail, or that its cases are vacuous — cannot be confirmed by reading code: never reply confirmed for one.
Produce your response first; the last non-empty line of your reply must then read exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, labeled `STATUS: {WORD}`.

[... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]

SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify this finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule). If this path lies outside your own worktree (`worktree-always`, or any `EnterWorktree`-isolated dispatch), create and delete it via Bash, one plain command per call — `mkdir -p` as its own call, the file written by one plain `printf` redirect or `node -e` call, `rm` as its own call; never a heredoc or an `&&` chain, which the harness Bash guard refuses by shape — never `Write`/`Edit`, which the worktree-pinning guard refuses for a path outside your worktree.

[Use: Capable — tiebreak agent. Independent run; fresh file read, not the reporting lens's context. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"` (contract § Model Selection).]
```

## Resolve and act

For each entry, once its agent has returned:

1. Resolve three paths with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-{n}.json R=review-{ctx-id}-tiebreak-{n}-reply.txt T=review-{ctx-id}-tiebreak-{n}-text.txt` (`{n}` the entry's position in the set). `Write` the entry (as written to the artifact, `positions` included for a contested one) to `F` and the agent's reply to `R`; `T` is written in step 3. An empty, failed, timed-out, or non-`DONE` dispatch (`BLOCKED`, `NEEDS_CONTEXT`, a session limit) is re-dispatched once as a fresh agent — except a dispatched reviewer's timed-out agent, which has already spent its keep-alive bound and goes straight to the inline rung; only if that one fails too is it passed as an empty reply file (a dispatched reviewer takes the inline rung instead, see `## Dispatched reviewer`) — the resolver turns it into the can't-tell result, so every entry still gets exactly one verdict line. On a lens 3f vacuity finding, write a `confirmed` reply to `R` with its `Verdict: confirmed` line replaced by `Verdict: cant-tell`: a vacuity claim needs an executed run (`step3-lens-dispatch.md`'s lens 3f vacuity bullet), so it resolves can't-tell with its one verdict line, reason `verdict:cant-tell`; a `refuted` reply resolves as written.
2. Run, with `{checkout under review}` the worktree or checkout the review reads (not the run dir):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-tiebreak "{path-F}" "{path-R}" --root "{checkout under review}"
   ```

   It prints JSON with `outcome`, `severity`, `recommendation`, `logLine`, `logStatus`, `logStep`, `logText`, `listInConsole`, and `reason`. When `resolve-tiebreak` exits non-zero for an entry, never invent a verdict: log, through `--text-file` as step 3 does (the text written to `T`), `STAGED {HH:MM:SS} — Tiebreak: lens "{lens}" finding {path}:{line} unconfirmed; resolve-tiebreak exited {exit}, no verdict. Reversibility: high.` That finding has no verdict line, so the archive gate refuses the run and surfaces it.
3. Log one line (a pipeline run only). `logText` can carry a verbatim source line — quotes, `$()`, backticks, backslashes — so it never goes on the command line: `Write` it, unchanged, to `T`, then pass `T`. `logStatus` and `logStep` are safe inline.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status "{logStatus}" --step "{logStep}" --text-file "{path-T}" --reversibility high --section "/review"
   ```

   A non-zero `log-decision.js` exit is retried once; if it still fails, do not act on `outcome`, and name the finding in the summary as having no verdict line, since the archive gate will refuse the run.

4. Act on `outcome`:
   - `confirmed`: the finding enters Step 3 Routing at the returned `severity`, as an input `step3-routing.md`'s routing table lists.
   - `drop`: logged only.
   - `digest` (a pipeline run only; `## Standalone review` covers the no-run-dir case): one materiality-digest entry with `Defer-reason: tiebreak-cant-tell` and area `review`, written through the digest path `step3-routing.md`'s Defer bullet uses, including that bullet's interactive batch-table approval (`_shared/materiality-floor.md`'s Entry format, Dedup, and Digest URL and count surfacing sections). The count goes in `review-summary-template.md`'s `### Tiebreak` section.
   - `console` (a pipeline run only; `## Standalone review` covers the no-run-dir case): the finding surfaces at the Review Console as a Low-confidence or Contested row carrying the logged line's `Severity:` and `Recommendation:` — `console/resolve.js` reads the verdict line itself (`wrap-up/console-template.md`'s Low-confidence findings section).

The earlier STAGED line for the finding is not rewritten. Every verdict line supersedes it through `console/resolve.js`'s `#3772` matcher only when that line carries `lens "{lens}"` and `{path}:{line}` (the gap sweep's does, under lens `gap-sweep`) and the verdict is logged after it. A staged `review-unconfirmed-*`, `review-contested-*` or `review-debate-*` file that line names is superseded with it, taking the verdict's final outcome (`wrap-up/review-console-appendix.md`'s Resolution-to-step mapping). A STAGED line no verdict settles stays at the console, `keep-staged`.

An inline fallback verdict (`## Dispatched reviewer`) goes through the same resolver, with ` Mode: inline.` appended to the content of `T` (never to a shell argument) before step 3 logs it.

## Standalone review

With no `$PIPELINE_RUN_DIR`, there is no `review-findings.json` and no `decisions.md` line. The verdict lines (`logLine`) go in the review report, in `review-summary-template.md`'s `### Tiebreak` section; an inline verdict's line also carries ` Mode: inline.`. A finding whose `resolve-tiebreak` exited non-zero is listed there as `no verdict (resolve-tiebreak exited {exit})`.

Can't-tell findings of severity medium or higher are listed in the closing output with the tiebreak's recommendation, in that same section; low can't-tell findings are listed in the report only, and nothing is staged.

## Dispatched reviewer

When the reviewer is itself a dispatched agent (`/claude-tweaks:dispatch`'s second Task call, or any other orchestrator), it dispatches the tiebreak agents itself, under `_shared/subagent-dispatch-core.md`'s nested-children rule — the same rule `step3-lens-dispatch.md`'s Foreground note gives lens dispatches.

Fallback ladder, per finding:

1. Nested dispatch, collected with the keep-alive waits that rule bounds.
2. For a finding whose agent is unavailable (no `Agent` tool), times out at that rule's bound, or fails again after `## Resolve and act` step 1's re-dispatch, the reviewer reads the live code, fills the same template, feeds its own reply to the resolver, and logs with ` Mode: inline.` — a documented loss of independence, named in a `Tiebreak caveat:` line (`review-summary-template.md`'s `### Tiebreak` section).

An unavailable agent changes who judges, never whether a verdict exists, so marking every finding can't-tell is not an allowed fallback. The invariant is that every listed finding has its verdict line before the run's Review Console resolves.

This agrees with `step3-lens-dispatch.md`'s #3817 degrade, which governs lens dispatch only: the `unconfirmed` findings that degrade produces are entries this step receives.
