# Step 3.7 Tiebreak — /claude-tweaks:review

Read from `code-mode-steps.md`'s Step 3.7 and run at every effort tier (`low`, `medium`, `high`, `xhigh`, `max`) and in every mode (`auto`, `confirm`, `hybrid`, `interactive`), standalone or dispatched. Every finding still `unconfirmed` or `contested` after the earlier passes gets one independent agent verdict; `plugin/bin/lib/tiebreak.js` settles that verdict (outcome vocabulary, evidence checks, log line, finding identity) through `review-coordination.js`'s `resolve-tiebreak`, `write-findings`, `check-coverage`, and `finding-ids` subcommands. This file cites the resolver and never restates it.

## Placement

Runs after every earlier pass has settled a finding's bucket, in this order:

1. `step3-lens-dispatch.md`'s reproduction categorisation and absence-claim ground-truth check.
2. `step3-lens-dispatch.md`'s lens 3f vacuity downgrade.
3. `step3-cross-lens-corroboration.md` (`medium` only).
4. `step3-debate-and-refutation.md`'s Step 3.5 debate (`high` and above) and Per-Candidate Refutation (`xhigh`/`max`).
5. The Step 3.6 gap sweep (`xhigh`/`max`).

Entry status: every finding still `unconfirmed` or `contested` after that sequence, including both sides of a `nearLocation` pair — each is judged on its own, with its own verdict line, sharing a chunk agent with up to seven others. A finding already `confirmed` does not enter.

## Findings artifact

In a pipeline run (`$PIPELINE_RUN_DIR` set), write the entry set to the run's `review-findings.json` before any dispatch. Resolve the input path with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-findings.json` (`_shared/session-tmp-root.md`; `{ctx-id}` as defined in `step3-lens-dispatch.md`), `Write` the entry array to the printed path, then call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" write-findings "$PIPELINE_RUN_DIR" "{path-F}"
```

Each entry is `{lens, path, line, claim, reporterSeverity, kind, positions?}` where `kind` is `unconfirmed` or `contested` — the shape is `plugin/bin/lib/tiebreak.js`'s. `lens` is the lens the finding's earlier STAGED line names, so the `#3772` key matches: `gap-sweep` for a gap-sweep finding, a contested entry's first position's lens, a multi-lens refutation candidate's first listed lens. Collapse each claim's whitespace and line breaks to single spaces first — one multi-line claim fails the whole set. Exit 2 means one malformed entry, and stderr names its index: fix that entry against `buildFindingsArtifact`'s checks (`plugin/bin/lib/tiebreak.js`) and re-run once. Exit 3, or a second failure, stops this step: log, with its text written to a session-tmp file and passed through `log-decision.js --text-file` (never a `--text` argument), `STAGED {HH:MM:SS} — Tiebreak: findings artifact not written ({exit}); {N} findings stay unconfirmed with no tiebreak verdict. Reversibility: high.` and run no dispatch. The line lists under the Review Console's Low-confidence section, and the earlier per-finding STAGED lines stay as written. With no artifact the archive gate has nothing to enforce, so this line is the only signal.

## Dispatch

Plan the chunks in code: `Write` the entry set (as written to the artifact, `positions` included for a contested one) to `E=review-{ctx-id}-tiebreak-entries.json` — resolved with one plain `session-tmp-resolve.js` call of its own, before `plan-chunks` runs, in a pipeline run and standalone alike — and run `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" plan-chunks "{path-E}"`. It groups the entry set's distinct ids into chunks of at most **8** findings, in entry order within each tier — never by lens or file; a repeated entry goes in once — and a chunk never mixes tiers: `info` findings take the `standard` tier and every other severity, a null or unknown one included, the `capable` tier (`tiebreak.js`'s `judgeTier`). Dispatch one fresh agent per chunk, in parallel waves of **8** chunk agents: dispatch a wave in one batch, wait for every agent of the wave to return, then start the next. Outside a dispatched reviewer, that wait follows `step3-lens-dispatch.md`'s hung single-read agent rule (its bounded wait and one `SendMessage` nudge); an agent still silent after that is a failed dispatch (`## Resolve and act`). Single-finding follow-ups (`## Resolve and act`'s `unsettled`-id re-dispatches and per-finding fallbacks) go out the same way: in parallel waves of **8**, each wave under that same wait rule. Never reuse the reporting lens's agent or its reproduction partner — the tiebreak agent is a fresh run. On a `plan-chunks` exit 2, fix the entry stderr names and re-run it once; a second failure sends every finding to the per-finding path (`## Resolve and act`) at the `capable` tier, with no chunk agent.

A finding's `{n}`, everywhere in this step, is `(c − 1) × 8 + i + 1` for index `i` (from 0) in chunk `c` (from 1) of the `plan-chunks` output — one number per finding, since no chunk holds more than 8. On the `plan-chunks` double-failure path there is no output, so `{n}` is the finding's 1-based position in E.

Before dispatching a chunk, resolve its two files with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-chunk-{c}.json R=review-{ctx-id}-tiebreak-chunk-{c}-reply.txt`, and `Write` the chunk's entries as one JSON array to `F` — the entries of E at the chunk's `indexes` from `plan-chunks`, in that order, as written to the artifact, `positions` included for a contested one; a lens 3f vacuity finding's entry carries `vacuity: true`. Then take the chunk's ids with one plain call, in a pipeline run and standalone alike: `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" finding-ids "{path-F}"`. It prints `{"ids": [{"index": 0, "id": "…"}, …]}`, one 12-hex id per entry, writing nothing. On exit 2, fix the entry stderr names and re-run it once; a second failure sends the chunk's findings straight to the per-finding path (`## Resolve and act`), with no chunk agent.

> **Parallel execution:** Dispatch each wave's tiebreak agents as parallel Task agents — each runs independently, sees only its own chunk's allowlist, and returns one `Id:`-headed `Verdict:`/`Evidence:`/`Severity:`/`Recommendation:` block per finding, settled by `resolve-tiebreak`. Assemble results after all agents complete.

After the last wave, re-run `step3-lens-dispatch.md`'s Post-fan-out untracked-file sweep against the same pre-dispatch listing, once the last single-finding follow-up (`## Resolve and act`) has returned too — report-only, as there, logging only what the earlier sweep did not already report. Skip it when this step dispatched no agent (no entries, or every verdict read inline).

Model: each chunk's `tier` from `plan-chunks` — `[Use: Capable]` for `capable`, resolved with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable --run-dir "$PIPELINE_RUN_DIR"`; `[Use: Standard]` for `standard`, resolved with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard --run-dir "$PIPELINE_RUN_DIR"` (drop `--run-dir` when no run directory exists). A single-finding follow-up takes its chunk's tier; an escalation re-judge (`## Resolve and act`) is always `capable`.

The Working Directory, Read-only Reviewer, and Foreground disciplines are the composed review-dispatch bundle's (standalone, `_shared/subagent-dispatch-core.md`'s), applied to these dispatches exactly as `step3-lens-dispatch.md`'s notes state for lens dispatches.

The agent receives the allowlist and nothing else: the claim text, the severity, the `path:line`, the diff scope (Step 2's — the own-work scope when the Merge-Provenance Check found merge commits), and, for a contested finding only, each position as a one-line claim plus a severity label. Never pass the reporting agent's evidence or reasoning. The single-finding template comes first — a single-finding follow-up (`## Resolve and act`) and an inline verdict (`## Dispatched reviewer`) use it; inline it literally in each such `Task()` prompt, per the Subagent Contract:

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
Evidence is required for confirmed and refuted: cite the Location path exactly as given (the full repo-relative path, never a bare filename or another file) and a line within 5 of Location, and quote the whole cited source line verbatim — a token or fragment of the line is not a quote. The cited line must carry a run of at least 3 letters, digits or underscores (an identifier or keyword that long): a line with none, such as `});` or `if (fd === 2) {`, is rejected as unverified however exact the quote, so cite a neighbouring line within that range that has one. cant-tell needs no Evidence line.
Recommendation file means the finding is worth a fix or a work record; drop means it is not worth acting on.
A vacuity claim — that a test cannot fail, or that its cases are vacuous — cannot be confirmed by reading code: never reply confirmed for one.
Produce your response first; the last non-empty line of your reply must then read exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, labeled `STATUS: {WORD}`.

[... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]
[... SHELL DISCIPLINE line, verbatim from the review-dispatch bundle's Working Directory Discipline section ...]

SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify this finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule). Never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path. If this path lies outside your own worktree (`worktree-always`, or any `EnterWorktree`-isolated dispatch), create and delete it via Bash, one plain command per call — `mkdir -p` as its own call, the file written by one plain `printf` redirect or `node -e` call, `rm` as its own call; never a heredoc or an `&&` chain, which the harness Bash guard refuses by shape — never `Write`/`Edit`, which the worktree-pinning guard refuses for a path outside your worktree.

[Use: {Capable | Standard} — tiebreak agent, at the tier the Model line gives this agent. Independent run; fresh file read, not the reporting lens's context. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {capable | standard} --run-dir "$PIPELINE_RUN_DIR"` (contract § Model Selection).]
```

The chunk template follows, inlined literally the same way in each chunk agent's `Task()` prompt: the `Diff scope:` line once, then one block per finding headed `Id: {id}`, with `{id}` the entry's `id` from that chunk's `finding-ids` call:

```
Diff scope: {base}...{branch}, or the own-work file list path when the Merge-Provenance Check found merge commits

Id: {id}
Finding: {claim text}
Severity: {severity label — for a contested finding, the higher of the two positions' severities}
Location: {path}:{line}
Positions: {contested finding only — omit this line and the two lines below otherwise}
- {one-line claim} ({severity})
- {one-line claim} ({severity})

{… one such block per finding in the chunk, each headed by its own Id: line …}

Reply with one block per finding, each opening with its own Id: line copied exactly, then exactly these lines; one status line ends the whole reply:
Id: {id}
Verdict: confirmed | refuted | cant-tell
Evidence: {path}:{line} `{the whole cited source line, verbatim}`
Severity: critical | high | medium | low | info
Recommendation: file | drop — {one-line reason}

You are the independent tiebreak judge for each finding above. Judge each finding on its own: one being right or wrong says nothing about the next. For each, re-read the live file at its Location and decide from the code itself whether the finding holds; you were deliberately given no account of how any of them was reported.
Evidence is required for confirmed and refuted: cite the Location path exactly as given (the full repo-relative path, never a bare filename or another file) and a line within 5 of Location, and quote the whole cited source line verbatim — a token or fragment of the line is not a quote. The cited line must carry a run of at least 3 letters, digits or underscores (an identifier or keyword that long): a line with none, such as `});` or `if (fd === 2) {`, is rejected as unverified however exact the quote, so cite a neighbouring line within that range that has one. cant-tell needs no Evidence line.
Recommendation file means the finding is worth a fix or a work record; drop means it is not worth acting on.
A vacuity claim — that a test cannot fail, or that its cases are vacuous — cannot be confirmed by reading code: never reply confirmed for one.
Produce your response first; the last non-empty line of your reply must then read exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, labeled `STATUS: {WORD}`.

[... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]
[... SHELL DISCIPLINE line, verbatim from the review-dispatch bundle's Working Directory Discipline section ...]

SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify these findings goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule). Never delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path. If this path lies outside your own worktree (`worktree-always`, or any `EnterWorktree`-isolated dispatch), create and delete it via Bash, one plain command per call — `mkdir -p` as its own call, the file written by one plain `printf` redirect or `node -e` call, `rm` as its own call; never a heredoc or an `&&` chain, which the harness Bash guard refuses by shape — never `Write`/`Edit`, which the worktree-pinning guard refuses for a path outside your worktree.

[Use: {Capable | Standard} — tiebreak agent, at the tier the Model line gives this agent. Independent run; fresh file read, not the reporting lens's context. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {capable | standard} --run-dir "$PIPELINE_RUN_DIR"` (contract § Model Selection).]
```

## Resolve and act

For each chunk, once its agent has returned:

- `Write` the agent's reply to the chunk's `R` (`## Dispatch` wrote its `F`). A reply read from a task notification can arrive HTML-escaped (`=>` as `=&gt;`), so decode `&gt;`, `&lt;`, `&amp;` and `&quot;` back to the characters the agent wrote first; an escaped evidence quote fails as `evidence-unverified`. For an entry carrying `vacuity: true` the code rewrites its block's `Verdict: confirmed` line to `Verdict: cant-tell`, so the dispatcher never edits a chunk reply.
- An empty, failed, timed-out, or non-`DONE` chunk reply (`BLOCKED`, `NEEDS_CONTEXT`, a session limit) is re-dispatched once as a fresh chunk agent, and its valid blocks are discarded, not settled — except a dispatched reviewer's timed-out chunk agent, which has already spent its keep-alive bound, so each of its findings goes straight to the inline rung, with no chunk re-dispatch. If that one fails too, each of its findings goes down the per-finding path: one fresh single-finding agent, the finding's third and last judge attempt, settled by steps 1–4 below — a dispatched reviewer takes the inline rung instead.
- Otherwise, run the chunk call once (with `--run` in a pipeline run): step 2's command with the chunk's `F` and `R` and `--tier {tier}` (the chunk's `tier` from `plan-chunks`). It prints `{"chunk": true, "results": [...], "unsettled": [...], "escalated": [...]}`. Each result is the one-finding output plus `id` and `index` (`i`); act on it by steps 3 and 4 under its finding's `{n}` (`## Dispatch`), so a `logged: false` result's `T`, resolved as step 1 resolves it, never collides across chunks. Every id in its `unsettled` list (reason `missing` or `duplicated`) gets one single-finding re-dispatch after that call, settled with the one-finding call form by steps 1–4; a re-dispatch that fails too resolves as an empty reply does today — passed as an empty reply to the one-finding call, except that a dispatched reviewer takes the inline rung (` Mode: inline.`). Every id in its `escalated` list (reason `raised`: a `standard` judge gave it severity `medium` or higher) gets one `capable` single-finding re-judge after that call, in waves of **8** as single-finding follow-ups go, settled by steps 1–4 with `--tier capable`: that verdict is the one settled, and the `standard` judge's reply is never logged. A one-finding call at `--tier standard` that prints `escalated: true` is re-judged the same way. The re-judge's entry is the finding's entry from E plus `"severityFloor": "{severity}"`, with `{severity}` from its `escalated` item (or the one-finding form's `severity`), so a failed or can't-tell re-judge still settles at the raised severity. Only code splits a reply: never cut one by hand. A non-zero chunk-call exit settles nothing. On exit 2, fix the chunk file against stderr and re-run the chunk call once, as `## Findings artifact` does for `write-findings`; any other exit, or a second failure, gives each of the chunk's findings step 2's no-verdict line.

A finding gets at most three judge attempts — its chunk agent, that chunk's one re-dispatch, one single-finding agent — plus one `capable` re-judge when a `standard` judge raised it, and `check-coverage` stays the backstop for an unsettled finding nobody followed up.

For each single-finding follow-up, once its agent has returned, and for each inline verdict:

1. Resolve three paths with one plain call, `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" F=review-{ctx-id}-tiebreak-{n}.json R=review-{ctx-id}-tiebreak-{n}-reply.txt T=review-{ctx-id}-tiebreak-{n}-text.txt` (`{n}` as `## Dispatch` defines it). `Write` the entry (as written to the artifact, `positions` included for a contested one) to `F` and the agent's reply to `R`; `T` is written in step 3. A single-finding agent is never re-dispatched: if it fails (an empty, failed, timed-out, or non-`DONE` reply), its reply is passed as an empty reply file (a dispatched reviewer takes the inline rung instead, see `## Dispatched reviewer`) — the resolver turns it into the can't-tell result, so every entry still gets exactly one verdict line. On a lens 3f vacuity finding, write a `confirmed` reply to `R` with its `Verdict: confirmed` line replaced by `Verdict: cant-tell`: a vacuity claim needs an executed run (`step3-lens-dispatch.md`'s lens 3f vacuity bullet), so it resolves can't-tell with its one verdict line, reason `verdict:cant-tell`; a `refuted` reply resolves as written.
2. Run, with `{checkout under review}` the worktree or checkout the review reads (not the run dir) and `{tier}` the agent's tier (its chunk's, or `capable` for an escalation re-judge). A pipeline run, for an agent's reply:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-tiebreak "{path-F}" "{path-R}" --root "{checkout under review}" --tier {tier} --run "$PIPELINE_RUN_DIR"
   ```

   Standalone (no run dir), and for an inline verdict in either — no `--run`:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-tiebreak "{path-F}" "{path-R}" --root "{checkout under review}" --tier {tier}
   ```

   It prints JSON with `outcome`, `severity`, `recommendation`, `logLine`, `logStatus`, `logStep`, `logText`, `listInConsole`, and `reason`, plus `logged` under `--run` — which logs step 3's line itself (a blank `--run` exits 2). At `--tier standard` the one-finding call may print `{"escalated": true, …}` in place of a result: nothing is logged, and the finding is re-judged as the `escalated` sentence above says. When `resolve-tiebreak` exits non-zero for an entry, never invent a verdict: log, through `--text-file` as step 3 does (the text written to `T`), `STAGED {HH:MM:SS} — Tiebreak: lens "{lens}" finding {path}:{line} unconfirmed; resolve-tiebreak exited {exit}, no verdict. Reversibility: high.` That finding has no verdict line, so the archive gate refuses the run and surfaces it.
3. Log one line (a pipeline run only). `--run` wrote it already; log it here only on `logged: false` or for an inline verdict. `logText` can carry a verbatim source line — quotes, `$()`, backticks, backslashes — so it never goes on the command line: `Write` it, unchanged, to `T`, then pass `T`. `logStatus` and `logStep` are safe inline.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status "{logStatus}" --step "{logStep}" --text-file "{path-T}" --reversibility high --section "/review"
   ```

   A non-zero `log-decision.js` exit is retried once; if it still fails, do not act on `outcome`, and name the finding in the summary as having no verdict line, since the archive gate will refuse the run.

4. Act on `outcome`:
   - `confirmed`: the finding enters Step 3 Routing at the returned `severity`, as an input `step3-routing.md`'s routing table lists.
   - `drop`: logged only.
   - `digest` (a pipeline run only; `## Standalone review` covers the no-run-dir case): one materiality-digest entry with `Defer-reason: tiebreak-cant-tell` and area `review`, written through the digest path `step3-routing.md`'s Defer bullet uses, including that bullet's interactive batch-table approval (`_shared/materiality-floor.md`'s Entry format, Dedup, and Digest URL and count surfacing sections). The count goes in `review-summary-template.md`'s `### Tiebreak` section.
   - `console` (a pipeline run only; `## Standalone review` covers the no-run-dir case): the finding surfaces at the Review Console as a Low-confidence or Contested row carrying the logged line's `Severity:` and `Recommendation:` — `console/resolve.js` reads the verdict line itself (`wrap-up/console-template.md`'s Low-confidence findings section).

The earlier STAGED line for the finding is not rewritten. Every verdict line supersedes it through `console/resolve.js`'s `#3772` matcher only when that line carries `lens "{lens}"` and `{path}:{line}` (the gap sweep's does, under lens `gap-sweep`) and the verdict is logged after it. A staged `review-unconfirmed-*`, `review-contested-*` or `review-debate-*` file that line names is superseded with it, taking the verdict's final outcome (`wrap-up/review-console-appendix.md`'s Resolution-to-step mapping). A converged-positive debate line (Step 3.5) supersedes every finding it names, and a verdict settling a `review-contested-*` file supersedes the partner finding listed in that file's `## Positions` section. A STAGED line no verdict settles stays at the console, `keep-staged`.

An inline fallback verdict (`## Dispatched reviewer`) goes through the same resolver, with ` Mode: inline.` appended to the content of `T` (never to a shell argument) before step 3 logs it. An inline verdict always resolves with `--tier capable` (it never escalates).

## Standalone review

With no `$PIPELINE_RUN_DIR`, there is no `review-findings.json` and no `decisions.md` line. The verdict lines (`logLine`) go in the review report, in `review-summary-template.md`'s `### Tiebreak` section; an inline verdict's line also carries ` Mode: inline.`. A finding whose `resolve-tiebreak` exited non-zero is listed there as `no verdict (resolve-tiebreak exited {exit})`.

Can't-tell findings of severity medium or higher are listed in the closing output with the tiebreak's recommendation, in that same section; low can't-tell findings are listed in the report only, and nothing is staged.

## Dispatched reviewer

When the reviewer is itself a dispatched agent (`/claude-tweaks:dispatch`'s second Task call, or any other orchestrator), it dispatches the tiebreak agents itself, under `_shared/subagent-dispatch-core.md`'s nested-children rule — the same rule `step3-lens-dispatch.md`'s Foreground note gives lens dispatches.

Fallback ladder, per chunk first, then per finding:

1. Nested dispatch of each chunk agent, and of each single-finding follow-up an `unsettled` or `escalated` id gets, collected with the keep-alive waits that rule bounds.
2. For a finding whose agent is unavailable (no `Agent` tool), times out at that rule's bound as a chunk agent (it has spent its keep-alive bound, so its chunk is not re-dispatched), or fails again after its chunk's re-dispatch or its single-finding re-dispatch (`## Resolve and act`; a timeout at that rule's bound is a failure), or whose escalation re-judge (`## Resolve and act`) fails or times out, the reviewer reads the live code, fills the single-finding template, feeds its own reply to the resolver, and logs with ` Mode: inline.` — a documented loss of independence, named in a `Tiebreak caveat:` line (`review-summary-template.md`'s `### Tiebreak` section).

An unavailable agent changes who judges, never whether a verdict exists, so marking every finding can't-tell is not an allowed fallback. The invariant is that every listed finding has its verdict line before the run's Review Console resolves.

This agrees with `step3-lens-dispatch.md`'s #3817 degrade, which governs lens dispatch only: the `unconfirmed` findings that degrade produces are entries this step receives.
