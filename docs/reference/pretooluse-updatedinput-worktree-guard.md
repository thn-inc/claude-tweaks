# PreToolUse `updatedInput` against Claude Code's worktree-isolation guard

Record #4028 (stop worktree-isolation refusals by making skill prose emit only guard-accepted command forms), Deliverable 4. The question: can the plugin's own `PreToolUse` hook rewrite a Bash command the harness's worktree-isolation guard would refuse, so the guard never sees the refused shape? This file is the measured answer and what the plugin does with it.

- **Claude Code version:** 2.1.302
- **Date measured:** 2026-10-24
- **Surface:** `claude -p -w <name>`, model `haiku`, a scratch `PreToolUse` hook for the first probe and the plugin's own hook for the second.

## What the guard is

The harness refuses a Bash call it cannot cheaply prove stays inside the worktree ("This session is isolated in the worktree … Refusing to run it …"). It is Claude Code code, not a module in `plugin/bin/lib/hooks/`; `plugin/skills/_shared/scratch-worktree.md`'s "## 7. Shell constraint" table records which shapes it refuses and passes, and `docs/skill-authoring.md`'s "Harness-level worktree Bash guard vs. the plugin's PreToolUse gate" tells it apart from the plugin's own `worktree-always` gate. The plugin cannot change what the guard accepts. The open question was whether a hook can change what the guard is *shown*.

## Probe 1: ordering, measured with a scratch hook

- **Setup (as recorded):** Claude Code 2.1.302, `claude -p -w`, model `haiku`, a scratch `PreToolUse` hook, 2026-10-24.

Three findings, worded as the two sources word them (the plan's Global Constraints "Premise probe result", and the decision log's "Deliverable 4 premise probe" entry):

- **(a) Applied before the guard:** `updatedInput` is applied **before** the isolation guard: a refused `echo complete PROBE_MARKER` rewritten to `echo REWRITTEN_BY_HOOK` ran.
- **(b) The guard re-checks the rewritten command:** the guard re-checks the **rewritten** command: a plain `echo hello …` rewritten into `echo complete …` was refused.
- **(c) No `permissionDecision`:** `updatedInput` applies with **no** `permissionDecision` field.

Readings:

- **Ordering:** a PreToolUse `updatedInput` is applied before the isolation guard, and the guard re-checks the rewritten command.
- **Consequence:** a rewrite can normalize, never bypass. The plugin never emits `permissionDecision: 'allow'` alongside a rewrite.

What the record does not say:

- **Not recorded:** a separate no-hook control run. The "refused" in (a) is the guard's documented refusal of `echo complete` (`plugin/skills/_shared/scratch-worktree.md` §7, the `complete` row: "runs a string through complete, which can't be verified to stay inside the worktree").
- Nothing else about the setup is recorded: neither a scratch repo nor hook settings are named, the scratch hook and the transcript were not kept, and the permission mode was not recorded.
- The decision-log entry and the Probe 2 evidence files live in a pipeline run directory, which is ephemeral and gets archived. The quoted findings above are the durable record.

## Probe 2: the plugin's own normalizer, measured live

After `plugin/bin/lib/hooks/guard-rewrite.js` existed (Task 8 of the plan), the same ordering was re-measured with the real hook:

```
claude -p -w probe-4028-t8 --plugin-dir "<worktree>/plugin" --model haiku --dangerously-skip-permissions --setting-sources local --output-format stream-json --verbose --include-hook-events --max-budget-usd 1 < probe-prompt.txt
```

The prompt asked the model to run two commands verbatim. A control ran the same prompt in a second worktree (`probe-4028-t8-ctl`) without `--plugin-dir`. Raw lines (stream-json, Claude Code 2.1.302):

```
TOOL_USE toolu_01BLBA1US8HeJuhdCGZpHmSz: {"command":"P=/bin; $P/echo ok","description":"Run hook test command 1"}
HOOK hook_response: ..."hook_name":"PreToolUse:Bash",..."stdout":"{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"updatedInput\":{\"command\":\"P=/bin; /bin/echo ok\",\"description\":\"Run hook test command 1\"}}}","stderr":"","exit_code":0,"outcome":"success"
TOOL_RESULT toolu_01BLBA1US8HeJuhdCGZpHmSz is_error=false: "ok"
TOOL_USE toolu_018yyBsMmWJX2fFKc3TTZems: {"command":"node -e 'console.log(process.argv[1])' \"$HOME\"","description":"Run hook test command 2"}
HOOK hook_response: ..."stdout":"{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"updatedInput\":{\"command\":\"node -e 'console.log(process.argv[1])' -- \\\"$HOME\\\"\",\"description\":\"Run hook test command 2\"}}}","exit_code":0,"outcome":"success"
TOOL_RESULT toolu_018yyBsMmWJX2fFKc3TTZems is_error=false: "/Users/thomasholknielsen"
RESULT subtype=success is_error=false cost=0.0070953 turns=3
```

Control, without the plugin:

```
TOOL_RESULT toolu_015G79hfkmua7Ao9gvXbQzz9 is_error=false: "ok"
TOOL_RESULT toolu_01LPvynCFKzWh79UBeWJjY34 is_error=true: "This session is isolated in the worktree .../probe-4028-t8-ctl, but this command runs node with a value computed at runtime (the variable HOME) (a computed argument goes after the script or --) ... Refusing to run it ..."
```

- **Plugin probe (Task 8, 2026-10-24):** with the plugin, `P=/bin; $P/echo ok` and `node -e 'console.log(process.argv[1])' "$HOME"` both ran, and no hook output carried a `permissionDecision`.
- **The control confirms the cause:** without the plugin the `node -e … "$HOME"` call is refused, so the rewrite is what lets it through.
- **Command 1 needed no rewrite:** `P=/bin; $P/echo ok` passes the guard natively, so for that shape the rewrite is correct but not load-bearing.

Evidence (the maintainer's run directory, not shipped): `evidence/guard-rewrite-live-probe.jsonl` and `evidence/guard-rewrite-live-probe-control.jsonl` under `.claude-tweaks/pipelines/2026-10-24T193452-record-4028/`.

## How the guard resolves variables (controller probes, 2026-10-25)

Measured in a guard-isolated worktree session, to decide which shapes the inline-literal-assignment rule actually helps:

- A quoted reference to a literally assigned variable passes: `P="/a b"` then `node "$P/x.js"`.
- An unquoted `node $Q/…` is refused, even when `Q` is assigned a literal (`Q=/abs/nospace && node $Q/hello.js`).
- `L=1` then `gh … --limit $L` passes.

So the one measured refused shape inline-literal-assignment turns into an accepted one is the unquoted variable as `node`'s script operand; for the shapes the guard already resolves it is an equivalence-preserving no-op. The shipped rewrite for that shape is pinned by the equivalence tests in `tests/bin-lib/hooks/guard-rewrite.test.js`; the Task 8 live probe ran the `$P/echo` and `node -e` forms, not an unquoted `node $Q/…` call. The live-verified rows are in §7.

## What the plugin does with it

`plugin/bin/lib/hooks/guard-rewrite.js` rewrites five shapes, only inside a linked worktree, and returns the rewrite as `hookSpecificOutput.updatedInput` from both PreToolUse paths (the prefilter fast path and `pre-tool-use.js`'s `run()`). Rule ids: `inline-literal-assignment`, `plugin-root-placeholder`, `node-eval-separator`, `quote-escaped-space`, `drop-redundant-cd`. Rules 1 and 2 apply only when every command-position word is a plain literal outside the runner, reserved-word and computed-name-assigning builtin sets and the command has no arithmetic context; rule 2 inlines only files under `bin/`. It never emits `permissionDecision`, and it never throws (any failure is a silent skip). `docs/hooks.md` carries the dispatcher-side contract; the module header carries the residuals.

Two things the rewrites are *not*:

- **Not a bypass.** The guard re-checks the rewritten text (finding (b)), so a rewrite into a refused form is refused. A rewrite cannot launder a command the guard would reject.
- **Not always argv-identical.** `node-eval-separator` inserts `--`; for a runtime value that starts with `-`, the original hands it to node as an option and the rewrite hands it to the script. Accepted by ruling (it closes the option injection the guard refuses over); measured on node 22 (`node -e '<s>' --flag a` exits 9 with `bad option: --flag`; `node -e '<s>' -- --flag a` prints `["--flag","a"]`).

## Not measured

- **Not measured:** interactive mode, how a prompt in a non-bypass permission mode evaluates the rewritten input, and other Claude Code versions.
- Probe 2 ran under `--dangerously-skip-permissions`; the permission mode of probe 1 was not recorded. In a mode that prompts, whether the prompt shows the original or the rewritten command is unknown.
- A Claude Code release that reorders the hook and the guard would turn every rewrite into a no-op (the guard would see the original). Re-run probe 2 after a Claude Code upgrade that touches hooks or the guard.
