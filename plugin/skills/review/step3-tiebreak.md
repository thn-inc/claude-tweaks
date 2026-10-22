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

Each entry is `{lens, path, line, claim, reporterSeverity, kind, positions?}` where `kind` is `unconfirmed` or `contested` — the shape is `plugin/bin/lib/tiebreak.js`'s. A non-zero exit stops this step: log `STAGED {HH:MM:SS} — Tiebreak: findings artifact not written ({exit}). Reversibility: high.` and run no dispatch; the unresolved STAGED line holds the run open at the Wrap-Up Review Console.

## Dispatch

One agent per entry, in parallel waves of **8**: dispatch a wave in one batch, wait for every agent of the wave to return, then start the next. Never reuse the reporting lens's agent or its reproduction partner — the tiebreak agent is a fresh run.

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
Evidence is required for confirmed and refuted: cite the finding's own path and a line within 5 of Location, and quote the whole cited source line verbatim — a token or fragment of the line is not a quote. cant-tell needs no Evidence line.
Recommendation file means the finding is worth a fix or a work record; drop means it is not worth acting on.
Produce your response first; the last non-empty line of your reply must then read exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, labeled `STATUS: {WORD}`.

[... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]

SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify this finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule). If this path lies outside your own worktree (`worktree-always`, or any `EnterWorktree`-isolated dispatch), create and delete it via Bash, one plain command per call — `mkdir -p` as its own call, the file written by one plain `printf` redirect or `node -e` call, `rm` as its own call; never a heredoc or an `&&` chain, which the harness Bash guard refuses by shape — never `Write`/`Edit`, which the worktree-pinning guard refuses for a path outside your worktree.

[Use: Capable — tiebreak agent. Independent run; fresh file read, not the reporting lens's context. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"` (contract § Model Selection).]
```

## Resolve and act

For each entry, once its agent has returned:

1. Resolve two paths with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-{n}.json R=review-{ctx-id}-tiebreak-{n}-reply.txt` (`{n}` the entry's position in the set). `Write` the entry (as written to the artifact, `positions` included for a contested one) to `F` and the agent's reply to `R`. An empty, failed, timed-out, or non-`DONE` dispatch is passed as an empty reply file — the resolver turns it into the can't-tell result, so every entry still gets exactly one verdict line.
2. Run, with `{checkout under review}` the worktree or checkout the review reads (not the run dir):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-tiebreak "{path-F}" "{path-R}" --root "{checkout under review}"
   ```

   It prints JSON with `outcome`, `severity`, `recommendation`, `logStatus`, `logStep`, `logText`, and `listInConsole`.
3. Log one line, passing the JSON values through unchanged (a pipeline run only):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status "{logStatus}" --step "{logStep}" --text "{logText}" --reversibility high --section "/review"
   ```

4. Act on `outcome`:
   - `confirmed`: the finding enters Step 3 Routing at the returned `severity`, as an input `step3-routing.md`'s routing table lists.
   - `drop`: logged only.
   - `digest`: one materiality-digest entry with `Defer-reason: tiebreak-cant-tell` and area `review`, written through the digest path `step3-routing.md`'s Defer bullet uses (`_shared/materiality-floor.md`'s Entry format, Dedup, and Digest URL and count surfacing sections). The count goes in the Step 7 summary.
   - `console`: the logged STAGED line is the decision item, and its `Recommendation:` travels in the line.

The earlier STAGED low-confidence or contested line for the finding is not rewritten. A `confirmed` verdict supersedes it through `console/resolve.js`'s `#3772` matcher; under the other outcomes the Review Console shows what it shows today, until the console sub-issue lands.

Any reviewer-read verdict — a Direct-verification override, or an inline fallback below — goes through the same resolver, with ` Mode: inline.` appended to `logText` before step 3 logs it.

## Standalone review

With no `$PIPELINE_RUN_DIR`, there is no `review-findings.json` and no `decisions.md` line. The verdict lines (`logLine`) go in the review report under `### Tiebreak`.

Can't-tell findings of severity medium or higher are listed in the closing output with the tiebreak's recommendation; low can't-tell findings are listed in the report only, and nothing is staged.

## Dispatched reviewer

When the reviewer is itself a dispatched agent (`/claude-tweaks:dispatch`'s second Task call, or any other orchestrator), it dispatches the tiebreak agents itself, under `_shared/subagent-dispatch-core.md`'s nested-children rule — the same rule `step3-lens-dispatch.md`'s Foreground note gives lens dispatches.

Fallback ladder, per finding:

1. Nested dispatch, collected with the keep-alive waits that rule bounds.
2. For a finding whose agent is unavailable (no `Agent` tool) or times out at that rule's bound, the reviewer reads the live code, fills the same template, feeds its own reply to the resolver, and logs with ` Mode: inline.` — a documented loss of independence, named in a Step 7 `Tiebreak caveat:` line.

An unavailable agent changes who judges, never whether a verdict exists, so marking every finding can't-tell is not an allowed fallback. The invariant is that every listed finding has its verdict line before the run's Review Console resolves.

This agrees with `step3-lens-dispatch.md`'s #3817 degrade, which governs lens dispatch only: the `unconfirmed` findings that degrade produces are entries this step receives.
