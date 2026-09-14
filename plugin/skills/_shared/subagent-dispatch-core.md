# Subagent Dispatch Core — Working Directory, Model Selection, Template A, Retrieval, Fan-Out

Extracted from `_shared/subagent-output-contract.md` (#2019) — the dispatch-facing sections a
review/test call site actually needs to compose under the 40 KB ceiling, without also paying for
that file's remaining content (Input Discipline, HARD-GATE Marker Convention, Waiting for
Dispatched Agents, Implementer Status Protocol, Templates B/C, the third-party exemption,
re-prompt-on-violation, and Anti-Patterns), none of which any of this file's call sites cite.
`subagent-output-contract.md` remains the canonical parent contract and single source of truth
for everything not reproduced here — cited from there, never restated independently; a change to
one of the five sections below lands here first, exactly as `subagent-output-contract.md` itself
states at its own top ("This file is the single source of truth").

## Working Directory Discipline

Agents do not inherit the dispatcher's CWD reliably. When a dispatch will run `git`, `node --test`, or any path-sensitive command, **anchor the working directory explicitly** in the prompt — and do it **without a preceding `cd`**:

- **`git` commands**: `git -C "/absolute/path/to/worktree" <subcommand>` for every invocation, never `cd "..." && git ...`.
- **Non-`git` commands** (`grep`, `node --test`, etc.): pass the absolute path as the command's own argument (e.g. `grep -rn "pattern" "/absolute/path/to/worktree/tests/"`) rather than `cd`-ing first.

**Never precede a path-sensitive command with `cd`, even in a `&&` chain.** The harness's Bash permission checker statically scans a command for paths it might read before running it; a `cd "<dir>" && <command>` shape asks it to resolve `<command>`'s target relative to a `cd` argument it cannot always evaluate (an interpolated variable, worktree-relative form, or platform path rewriting), and a git revision range like `origin/master...HEAD` gets misread as a path token on top of that because it contains a slash. When the checker cannot resolve where a command reads from, and any `Read()` deny rule is configured anywhere in the session's settings — common baseline hardening (`.env`, `.ssh/**`, `*.pem`, and similar), unrelated to the file actually being read — it cannot prove the read avoids that rule and escalates to the user instead of auto-approving, even under `--dangerously-skip-permissions` (a deny rule is a hard block that bypass mode does not lift). The `git -C` / absolute-path forms above are the actual fix: a self-contained command with no `cd` gives the checker a target it can resolve on the first line, so it clears without a prompt. See `docs/incident-log.md` `[IL-151]`.

**Substitute the path before dispatching.** The prompt must carry the resolved absolute path, never an unexpanded placeholder like `$WORKTREE` — the agent's shell does not share the dispatcher's variables. A brief that says "verify `cd "$WORKTREE"`" while also forbidding the agent from creating worktrees leaves it no legal move when the substitution didn't happen: `BLOCKED` is then the correct response, and the round-trip is pure waste. If the dispatch template interpolates a path, check one rendered prompt before sending the batch.

Before any commit step, the implementer must echo `pwd` and `git rev-parse --show-toplevel` and verify both match the expected worktree. A mismatch means the commit is about to land on the wrong branch — `BLOCKED` is the correct response.

**Why this matters:** When the dispatcher is itself inside a worktree (e.g., running from `.claude/worktrees/<name>/`), a dispatched agent can resolve a different CWD and commit to the parent repo's checked-out branch instead of the worktree branch. The branches diverge silently — the dispatcher's `git status` looks fine, but the commit went to `main`. The same risk applies to reviewer agents that run `node --test` from the parent repo where the new test files don't exist and report false failures.

When the dispatch is for a verification or test-running agent (no commits), the working directory still matters: results depend on which files are visible.

During worktree-mode pipeline runs this rule is mechanically enforced — the plugin's PreToolUse hook denies commits whose resolved checkout differs from the run's recorded worktree assignment.

**A denial is recoverable, and the dispatch prompt must say how.** E1 resolves the run's worktree assignment from `run-state.json`, and under concurrent sibling pipeline runs that lookup can read as stale or misattributed — so a correctly-placed implementer can still see its *first* commit denied. The fix is an idempotent re-stamp of the assignment onto this run, from either checkout: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "<resolved-run-dir>" "<worktree>"`, then retry the commit. Both values must be substituted as literal absolute paths before dispatch, per the substitution rule above — never `--run` omitted, which lets the command's fallback resolver pick some other session's run and corrupt its state. A denial that survives one re-stamp is a genuine wrong-checkout mismatch: report `BLOCKED`, do not keep retrying. Observed on record #315 — both dispatched implementers hit this denial on their first commit and both cleared it with one re-stamp, solely because the dispatch prompt had been pre-warned.

**When the implementer's own isolation is `EnterWorktree`-based, its shell is restricted too.** A dispatched implementer that enters its assigned worktree via the native `EnterWorktree` tool (rather than merely `cd`-ing into a path a Bash call already sees) runs the rest of its session under a harder constraint than anything above: `&&` chains and heredocs are refused by shape, not just discouraged by convention. The dispatch prompt must say so explicitly — one plain command per Bash call, `Edit`/`Write` instead of a heredoc append, and no reliance on a shell variable surviving between calls. The mechanical detail and its rationale are documented once, canonically, in `skills/_shared/scratch-worktree.md`'s "## 7. Shell constraint" — cite it rather than restating it here. Observed across five implementer dispatches on the skill-invocation-ledger build: every dispatch that baked this constraint into its prompt up front avoided the failure; none that omitted it did.

**Never run `git stash` in any form.** A dispatched agent shares its worktree with the dispatcher and possibly sibling agents, and `git stash` (worse, `--include-untracked`) sweeps *their* in-flight state — staged edits, untracked files it never saw created — into a stash entry nothing else knows exists; an agent that finishes without restoring it has silently deleted sibling work, and the loss surfaces only when the dispatcher next looks for those files. The stash stack is also shared repo-wide across every worktree, so even a restore can collide with another session's entries. To compare against a clean baseline, read it without mutating the tree: `git show HEAD:<path>` for file contents, `git diff HEAD -- <path>` for what changed. To set your own work aside, make a WIP commit on the branch instead.

## Model Selection

Match the profile to the work. A **work profile** names the kind of work; this table — the single canonical resolution — says what runs it:

| Profile | Model | Effort | Constraints |
|---|---|---|---|
| Fast | haiku | — | No effort dial (Haiku ignores effort) |
| Standard | sonnet | high | — |
| Capable | opus | high | — |
| Frontier | fable | high | Singleton-only; degrades to Capable |

This table is pinned to `bin/lib/model-profiles/profiles.js` by test — change them together. Models are family aliases, never versioned IDs. The effort scale is ordered `low < medium < high < xhigh < max`.

**Dispatching.** Name the profile in the prompt as `[Use: {Profile}]`, and resolve it mechanically: run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {profile}` (profile lowercase; add `--run-dir "$PIPELINE_RUN_DIR"` inside a pipeline, `--unattended` in any headless context) and copy the returned `model` into the Agent tool's `model` parameter. The `${CLAUDE_PLUGIN_ROOT}` spelling is a model-resolved placeholder, not a shell contract — the harness does not set it in Bash tool calls (#170) — the executing agent substitutes the absolute plugin root itself, per `docs/skill-authoring.md`'s Plugin-root references section, which owns this convention for every `skills/**/*.md` file. The two flag families answer different questions: `--frontier-used N` / `--run-dir` express the Frontier singleton tally (how many Frontier dispatches this run has already spent), while `--unattended` expresses "no human is present" and unconditionally degrades a Frontier resolution — so a Frontier singleton call site must never hard-code `--unattended` unconditionally — write the interactive form (or, for a command that only ever runs headless, state the headless context beside it) and append the flag only when the invocation is genuinely headless, resolved from session state. Append the returned `effortLine` to the dispatch prompt. Its shape is `[Effort: {level} — apply {level}-level reasoning depth to this task.]`. When a dispatched agent's own failure is specifically a credit/usage-exhaustion error (not a reasoning failure, not a timeout), run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" record-failure {model}` — `{model}` is the family alias this dispatch resolved to (`haiku`/`sonnet`/`opus`/`fable`) — before any retry or re-dispatch this session. The same call also covers a harness usage-limit warning hit inline, on the main thread rather than by a dispatched agent — there `{model}` is simply the session's own currently-active model family alias, the one that just hit the credit error, since there is no dispatch resolution to read it from. The resolver reads this session-scoped blacklist on every later resolution and steps down to the next viable tier rather than re-resolving the same failed model (#763); the blacklist lives under `os.tmpdir()`, keyed by `CLAUDE_CODE_SESSION_ID`, and is never consulted across sessions. Effort binds mechanically only where an agent definition carries `effort:` frontmatter — the Agent tool has no per-dispatch effort parameter, so `effortLine` is a best-effort prompt instruction. Upstream watch item: adopt a per-dispatch effort parameter the release it exists.

**Overrides.** The resolver merges *values* in precedence order: per-invocation override > project policy (`model-profiles` rows in `.claude-tweaks/policy.yml`) > the table. The run stance (`--stance`, else the policy's `model-stance`) is a run-level *posture*, not a value source: it applies after the merge, shifting the resolved effort one notch (`economy` down, `max-rigor` up, capped at the scale's ends), and `economy` resolves a still-Frontier result as Capable. Stance applies even to per-invocation choices, and Frontier's own gates (below) apply last regardless of how Frontier was selected. `model-ceiling` clamps any resolution whose per-invocation override named no field. The per-invocation override is the resolver's `cliOverride` API argument — deliberately not exposed as CLI flags; a dispatch site's per-invocation lever is normally which profile it names. Stances shift effort, never the model upward. `CLAUDE_CODE_SUBAGENT_MODEL` and the session's `/model`/`/effort` are harness-level and always win — the plugin defers to them **only when a dispatch omits the Agent tool's `model` parameter entirely**. Probed 2026-08-17 (one throwaway Agent dispatch, explicit `model: 'haiku'`, from a session running Sonnet 5 with no `CLAUDE_CODE_SUBAGENT_MODEL` set: the dispatched agent self-reported running as Haiku 4.5, not Sonnet): an explicit per-invocation `model` value **does** override the session's own ambient model — "the plugin defers to them" describes a choice not to pass `model`, not a structural limit on passing it. Single-observation confidence (the agent's own self-report was the only signal available; not independently re-verified against an interactively-changed `/model`, though the same tool parameter governs both cases). This is what licenses `build/SKILL.md`'s whole-branch-review model-resolution step — see there for the one site that acts on it.

**Selection and upgrade.** Default to the cheapest profile that can do the job. Upgrade one profile when the agent comes back `BLOCKED` for reasoning reasons (not for context reasons). Capable→Frontier upgrades are valid only at the singleton slots enumerated in this section.

**Frontier is singleton-only.** Profiles govern *dispatches*; inline steps ride the session model by design. Frontier is never valid in a parallel fan-out — one agent whose judgment is the bottleneck, at an enumerated slot only. Preconditions (all enforced by the resolver): interactive context, stance at `default` or above, and the per-run cap (`frontier-run-cap`, default 3, tallied in the run dir's `frontier-tally.log`; standalone skill invocations get 1 per invocation, enforced by the calling skill). Any miss degrades to Capable with the reason in the resolution's `source`. A harness usage-limit warning observed in-session, or a dispatched agent's own credit/usage-exhaustion failure, is recorded via `record-failure` (see Dispatching above) and degrades that specific model to the next viable tier for the remainder of the session — the *avoidance* is a real mechanism (#763); noticing the failure and recording it remains a best-effort agent step.

**The enumerated slots.** Two categories, each a deliberate, singleton-shaped dispatch site — degradation to Capable via the preconditions above is always the fallback, never a separate code path:

| Category | Slot | Shape |
|---|---|---|
| Verdict gate (#220) | `/review`'s gap-sweep (`step3-debate-and-refutation.md` Step 3.6) | Single agent, no reproduction pair — deliberately fresh-eyes. |
| Verdict gate (#220) | `/review`'s cross-lens debate agent (`step3-debate-and-refutation.md` Step 3.5, `multi-agent-coordination.md` Mode 2) | The one contract-enumerated exception to strict single-agent shape: a fixed 2-agent, 1-round pair per contradiction — bounded by the contradiction count, not a variable-N fan-out over a candidate set, which is what the no-fan-out rule actually guards against. |
| Verdict gate (#220) | `/specify`'s red-team synthesis/write-back (`specify/red-team.md`) | Single agent, dispatched only when interactive and the resolver returns `frontier`; otherwise runs main-thread exactly as today — never a Capable dispatch of this step. |
| Self-improvement (#221) | `/wrap-up`'s Phase 2 curation-engine row-judgment, when fewer than 3 rows are open (`wrap-up/curation-engine.md` section 4) | Single agent judging every open row in one pass. The existing 3+-row branch is a genuine parallel fan-out and stays Capable unconditionally. |
| Self-improvement (#221) | `/reflect`'s lens procedure, standalone invocations only (`reflect/SKILL.md` Step 2) | Single agent running every lens. Component-invoked runs (a `/review`- or `/wrap-up`-owned run dir, or an explicit `--source`) never dispatch this — main-thread only. |
| Self-improvement (#221) | `/feedback`'s session-evaluation judge (`feedback/session-evaluation.md`) | Single agent per invocation — the standalone-invocation cap (no `--run-dir` in the common case). The Step 6 scrub this slot previously named now resolves Capable (record #221's entry knowingly superseded). |
| Self-improvement (#221) | `/init`'s CLAUDE.md generation/patch synthesis (`init/claude-md-template.md`) | Single agent; `--unattended` in headless (scheduled Routine) contexts. |

**`/challenge` is excluded from the verdict-gate category.** Its `framing-check` mode is inline-only by that skill's own Component-Skill Contract — dispatching it as a Task agent is a named anti-pattern there. Profiles govern dispatches only; an inline step rides the session model by design and has no profile to carry, so `framing-check` is never a candidate for this enumeration regardless of how singleton-shaped its judgment is.

**Session-inherit protection.** No fresh-agent dispatch omits `model` — inheriting the session model is only ever an explicit, stated choice (`[Use: inherit — {reason}]`), never a silent default; this is what makes running a session on Fable or Opus safe. Fork dispatches are exempt (the Agent tool ignores a fork's `model` override structurally; fork usage is already restricted — see the incident-log rule on forks). Every agent definition under `agents/` must declare `model:` in its frontmatter.

## Template A — Review-style (returns findings)

Use when an agent audits code, designs, or specs and returns findings to be acted on.

```
OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Path:Line | Finding | Evidence |
|---|---|---|---|
| critical | src/auth.ts:42 | Missing token expiry check | uses `<` not `<=` |
| medium | src/api.ts:180 | Unhandled rejection | line 184: `await fetch(...)` no try/catch |

Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.
```

**Used by:** `/review` (review angles), `/visual-review` (per-page review agents), `/specify` (per-persona red-team findings).

## Failed-agent retrieval

A dispatched agent that dies mid-flight (session-limit interruption, tool crash) is a
different case from one that finished — do not treat both the same way when collecting
results.

**Check the task-notification's `<status>` first.** `completed` → read the result as
documented above. `failed` → the full envelope is not worth blocking on: retrieve only the
tail — either a non-blocking `TaskOutput` call read for its trailing `<error>` block, or
`tail -n 50` on the notification's own `<output-file>` path — never a blocking full-envelope
`TaskOutput {block:true}`. The trailing error is the only actionable content; the rest is
raw transcript internals (measured at ~6% of one run's total tool-result characters for zero
net information when read in full).

**The session-limit signature is a terminal, non-retryable-now failure class, distinct from a
transient 5xx.** An agent whose trailing `<error>` block reads `Agent terminated early due to an
API error: You've hit your session limit` will not succeed on an immediate retry the way a
transient 5xx/timeout might — the caller's account-level limit, not the agent's own work, caused
the termination. A dispatch site handling a reproduction-pair partner's death this way retries
once (to rule out a spurious one-off) and, on a second failure, degrades rather than retrying
again in a loop — see `review/step3-lens-dispatch.md`'s reproduction-pair section for the
degrade procedure this classification feeds.

## How to integrate at a dispatch site

**Fan-out dispatch shape.** Emit all N `Agent`/`Task` calls of a fan-out as tool_use blocks in a single assistant message; a call per message is a serialized dispatch even when the prose says parallel — the harness only runs tool calls concurrently when they arrive as multiple `tool_use` blocks in one message. When a fan-out spans multiple independent units of work (e.g. several records, each needing its own persona set), batch by unit: one message per record's persona set, never one message per individual agent.

In a Form B blockquote:

```
> **Parallel execution:** Dispatch {scope} as parallel Task agents — each runs independently and returns findings in Template A format. Assemble results after all agents complete.
> **Contract:** Each agent follows the Subagent Contract — minimal input (scope + path + output template, no conversation), Template A, then one of {DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED} as a labeled trailing line — `STATUS: {WORD}`, the reply's last non-empty line, after the output template (WRONG: "Based on my review, DONE" as the first line). Pick the cheapest work profile that fits ({Fast | Standard | Capable} — Frontier never rides a fan-out; singleton slots only, §Model Selection) and resolve it per §Model Selection. Inline the template literally; reject and re-prompt on format violations.
```

In the actual `Task()` call, the prompt body must contain the literal template — not a reference to it. Concrete example:

```
Task scope: Review src/auth.ts and src/api.ts for security issues.

Status line (required): after the output format below, on its own trailing line — the reply's last non-empty line — write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. WRONG: putting the status word first, before the table.

OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Path:Line | Finding | Evidence |
|---|---|---|---|
| critical | src/auth.ts:42 | Missing token expiry check | uses `<` not `<=` |

Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

[Use: Standard]
```

The blockquote above is the dispatch-site directive; the fenced block is what each `Task()` call's prompt actually contains.
