---
name: headless-worker-launch
description: Use when changing what a headless `claude -p` worker launched by `plugin/bin/lib/driver/` may do — adding a role or a tool, widening or narrowing an allow or deny rule, changing a sandbox key or a launch flag, supporting a new platform — or when writing the code that consumes the worker envelope. Covers probing what each allowed command can write or start (not only that denied commands are denied), re-probing per platform and CLI version, recording results in the module header, and the consumer's obligations. Keywords - driver, worker, roles.js, worker.js, claude -p, --restricted, --safe-mode, allow list, deny list, sandbox, autoAllowBashIfSandboxed, SANDBOX_PROBED_PLATFORMS, permission denial, envelope, live smoke test.
---

# Headless worker launch

## Overview

`plugin/bin/lib/driver/roles.js` holds the per-role tool lists, the argument list for a headless `claude -p` launch and the implementer's generated settings; `plugin/bin/lib/driver/worker.js`'s `launchWorker` writes the per-launch files, enforces the ceilings and returns one envelope. Every right a worker has rests on a probe recorded in those two headers, with its CLI version, platform, login kind and TTY state. This skill is the method for changing those rights without reopening a hole; the facts themselves stay in the headers, which are the one place they are kept.

## Key Patterns

### Probe what each allowed command can write or start, not only that denied ones are denied

An allow rule names a command; the command's own flags decide what it can do. #5217's implementer allowed `git log`, `git diff` and `git show` as read-only. Each writes a file of the worker's choosing through `--output=<path>`: with no sandbox, all six writes in the probe landed, `.git/config` among them, and an allowed `git status` would then run a program named in that configuration (`core.fsmonitor`). Three per-task reviews and the spec's probes passed the rules, because every check asked whether the refused commands were refused. The fix (`7f29d475b`) was no Bash at all where the sandbox was not probed (`SANDBOX_PROBED_PLATFORMS`, `toolsFor`).

For every command an allow rule admits, list its flags that write a file, read outside the working directory (`git diff --no-index`), run a program (a pager, a configured hook, `-c` config) or reach the network, and probe each one through this module's own launcher. Add a step for the worst one to the opt-in live smoke test in `tests/bin-lib/driver/worker.test.js` (`AC7`, run with `DRIVER_LIVE_SMOKE=1`), the way `.git/info`, `.git/config` and `.git/hooks/pre-commit` writes were added.

An allow rule whose operand is a file the worker writes (`Bash(node tools/run-tests.js --files-from *)`, #5915) bounds the command's shape, never the file's contents: a list naming every test file runs the whole suite. State what the rule bounds separately from what it cannot, and name the gate that enforces the rest (there, the driver's own test step), rather than claiming a ceiling the rule cannot hold.

### How to probe a tool through the launcher

Drive `launchWorker` from `worker.js` with the real `defaultRunner`, wrapped through the `runner` dependency so that it changes only what the probe tests (for a tool, its name in `--tools`). Every other flag, the environment and the generated settings stay the module's own; anything else measures a launch the driver never makes. Pass the `platform` whose generated settings you mean to test, and record the host it ran on, since settings generated for one platform on a host of another speak for that host only.

- Run an allow-listed variant (the tool appended to `permissions.allow` in the generated settings file) and a tool-only variant (no allow rule) as separate runs, and report them separately: a bare allow rule may admit what the tool-only form confines.
- Take the evidence from each launch's session transcript, found by the result's `session_id` (see `transcript-payload-verification`): every `tool_use` input and its `tool_result`, plus the envelope's `denials`. The worker's own summary is its account of what happened, not evidence.
- A case whose transcript holds no `tool_use` of the tool is not-called, never contained: re-run it once, and report it as unsettled if it is still not called. A launch whose transcript cannot be found stops the probe. A tool error that is not a refusal is its own outcome, and a refusal matcher must fit the wording the launch actually emits — a pattern written for ordinary permission errors misses a `--restricted` refusal.
- Give each outside route its own case (a path argument, an absolute pattern, a symlink given as the path, a recursion that reaches a symlink, a directory that is not a temporary one), and record both the results and the routes left unprobed in the `roles.js` header.

### A probe speaks for one CLI version, one platform and one launch context

Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off. The sandbox block and every Bash rule exist only on `darwin`; elsewhere the implementer has Read, Write and Edit and nothing that runs a command. Supporting a new platform means running the sandbox probes there first, then adding it to `SANDBOX_PROBED_PLATFORMS`, never the other way round. A result measured with a scratch configuration directory says nothing about a subscription login, which is why the user-level leakage probe is a stated residual rather than a pass.

### Settings sources: `--restricted`, not `--setting-sources project`

Under `--setting-sources project`, an allow rule in the working directory's own `.claude/settings.json` widened the worker's rights once that directory sat under a trusted checkout. Every role launches with `--restricted`, which ignores user, project and local settings files while the generated `--settings` file still applies. A change that drops `--restricted` reopens that path.

### The deny list is a second layer

With `defaultMode: dontAsk`, a closed allow list and `sandbox.autoAllowBashIfSandboxed: false`, the denied commands are already refused. `autoAllowBashIfSandboxed` defaults to true and then lets any sandboxed Bash command run with no allow rule, so it must stay false. Keep the deny rules when widening anything else.

### Denials are data

No code path composes wider rights after a permission denial: a denial goes into the envelope's `denials` for the driver's event line. A retry-with-more-rights loop would turn every denial into a request the worker can make.

### What the consumer owes

The run loop that consumes the envelope must treat every string in `result`, `detail` when it carries the worker's own text, and `denials[].tool_input` as untrusted, and neutralize it before it reaches a command, a commit message, a comment or a log line. On POSIX the worker is detached into its own process group, so the consumer must forward termination to it. Envelope `ok` means only that conforming structured output arrived; the worker's verdict is `result.status`, which may be `cannot-complete`.

Any step that executes worker-authored content (its tests, a `verify-scope.json` command, a build or lint script it can edit) runs outside the worker's sandbox. Give that child an allow-listed environment with no forge credentials, or run it under the worker's sandbox profile, or run `check`'s bounds first. Never inherit the driver's own environment (#5218 review). A worker-editable file the child reads (a `verify-scope.json`, say) must be compared with its base by raw bytes, tolerating CRLF-only differences: not `git diff` or `cat-file`, which the worker defeats with `git update-index --assume-unchanged`/`--skip-worktree`, and not a filter-applying hash, which a worker-set `.gitattributes` filter plus the shared `.git/config` defeats. Treat the worker's index flags and git config as untrusted (#5267).

The launcher checks a result only within its schema subset (`worker.js`'s header). A `type: 'array'` property is checked as an array, and its elements not at all, since the subset has no `items`. A role whose result holds an array validates each element itself and discards one that does not conform, as `review.js`'s `findingShapeViolation` does for each finding in the reviewer's `REVIEW_RESULT_SCHEMA` result (#5222). Termination forwarding goes through `plugin/bin/lib/driver/launch.js`'s `launchTracked`, which every driver launch site calls (`steps.js`'s `runImplementer`, `review.js`'s reviewer launch, and `judgment-io.js`'s `launchJudge` for the merge-check and acceptance workers, #5228). It makes only the first runner call `shared.activeWorker`, because on win32 the ceiling kill runs `taskkill` through the same runner, and that handle must not replace the worker's. A new launch site calls `launchTracked` rather than wrapping the runner itself.

The input side owes the same care: a record body, a parent body and a diff are forge-written text the worker reads as part of its prompt. A title and body go through `judgment-prompts.js`'s `wrapUntrusted`, which NFKC-normalises them, drops `\p{Cf}` format characters and replaces every run of three or more angle-like characters (`ANGLE_RUN`) before wrapping. A diff, or any other worker-written input, goes in a fence from `markdown-blocks.js`'s `fenceFor`, longer than any backtick run inside it. Worker-written text bound for a forge post passes `findCredentialInText` first, and a hit stops the post (`acceptance.js`). #5228's first wrap replaced only the exact END line, and review forged it with format characters, look-alike brackets and a diff that closed its own fence (01ff10008). The structural defang still leaves look-alikes outside `ANGLE_RUN` and space-separated `< < <` markers; #5487 tracks a per-launch nonce in the marker lines, so do not claim a body cannot end the wrap until that lands.

The index flags named untrusted above are checked against a baseline by set difference, never by a single read (#5415: `steps.js`'s `ignoreStatStop`, `readIndexFlags` and `newIndexFlagStop`, with the residuals in its header). First refuse a worktree whose `core.ignoreStat` is true, since git would then mark every path the driver stages assume-unchanged and every later check would fire. A failed config read passes only on git's not-set exit (1). Then read the flagged paths once when the worktree is created (`git --no-optional-locks ls-files -v -z`: tag `S` is skip-worktree, a lowercase tag assume-unchanged; never trim the output, because a path may end in whitespace) and keep that set on `ctx`. After each point where worker-written code has run (every implementer launch, the test step's `verify.js` call, every evidence run), read again and stop with `fail` on any path flagged now that the baseline lacks. A path flagged at creation, such as a sparse checkout's, never counts, and a cleared flag is no stop. A failed or malformed read stops the record too. Each named path goes through `neutralize`. A new step that runs worker-written code adds one more check point. CI on push stays the backstop for what this cannot see: a `.gitattributes` filter, `core.fsmonitor`, and a path already flagged when the worktree is created.

A verdict over worker-written code is about the commit only while the tree still matches HEAD. The commit step runs before the tests, so a test can rewrite a tracked file the commit never holds while a green run reads it (#5454: `steps.js`'s `testTreeStop`, with the residuals in its header). After the flag check, read `git status` with untracked files and stop with `fail` on any path outside the run artifacts, naming each path through `neutralize`. A newly set flag outranks this stop, because `git status` cannot see a flagged path. A new step that runs worker-written code and then trusts its verdict adds this read as well as the flag read; `driver-step-addition` gives the order and the helpers to reuse.

A file the driver tells the worker to write goes under `.claude-tweaks/pipelines/`, which `steps.js`'s `isRunArtifact` keeps out of the commit and out of the test step's tree check, and the driver removes it after every launch, a launcher throw included: #5915's test list (`WORKER_TEST_LIST`, removed by `removeWorkerTestList`). An untracked leftover makes merge.js's unforced `git worktree remove` fail where `.gitignore` does not cover that directory. The worker can replace either parent with a symlink, so the removal `lstat`s `.claude-tweaks` and `.claude-tweaks/pipelines` and unlinks only when both are real directories; an unlink through a symlinked parent lands outside the worktree. A symlink leaf is safe, since unlink removes the link, never its target. A removal that cannot be made becomes a note on the step's detail, never a throw. A new worker-written file takes the same path and the same guard, with a test per parent leg (`listIs` in `tests/bin-lib/driver/run.test.js`).

## Decision Framework

| Situation | Do this |
|---|---|
| Adding a command to the implementer's allow list | List its write, read, exec and network flags; probe each through the launcher with the sandbox on and off; add the worst case to the live smoke test; record the results in the `roles.js` header |
| Adding a tool to a role (for example Grep or Glob off macOS) | Probe that the tool stays inside the working directory under that role's flags on each platform it ships to, before adding it to `ROLES` |
| Giving a role the `Workflow` tool | On 2.1.325 no driver launch had it: both `roles.js` argvs (reviewer and implementer tool lists) started with no `Workflow`, and a plain `--restricted` launch dropped it even with `--allowedTools "Workflow(...)"` (`docs/reference/workflow-tool-probe.md`, rows `init-driver-worker` and `init-restricted`). A `--tools` entry brought `Bash` back under `--restricted`, but no capture tried `Workflow` that way; probe it through the launcher first, and never drop `--restricted` to get it |
| Changing which paths the implementer may read | The read block is on; the readable set is the derived toolchain roots (`toolchainReadPaths` in `roles.js`). Never re-open a path through `additionalDirectories` or `--add-dir` — those also become writable. Re-run the `AC7` live smoke test's canary step after any change |
| Changing the form of a rule the `AC7` live smoke test exercises (a `testCommand`, an allow pattern) | Move the smoke test's launch to the shipped form in the same task, run it with `DRIVER_LIVE_SMOKE=1`, and confirm it goes red on the old form: a smoke test still launching the old form passes while probing nothing new (#5915, fixed only at wrap-up in f16c3709a0) |
| Changing the model a role launches with (`DRIVER_ROLE_PROFILES`, the `express-driver-models` defaults, or a profile's model) | For a judgment role (`merge-check`, `acceptance`), make `node tools/driver-merge-check-eval.js evaluate` a plan task and quote its agreement and `falseAutoMerge` in the PR, per `docs/driver.md`'s Re-run rule (#5917 missed it until the whole-branch review) |
| Adding a value-taking launch flag (`--effort`, #5942) | Probe it through the launcher under `--safe-mode --restricted` with values that differ from the no-flag default, since a value equal to the default cannot show the flag took effect (`medium` on sonnet; `worker.js`'s `Launch effort` bullet). Also probe a value the CLI does not know: if the CLI only warns and runs the default, refuse the value in `roles.js` before any process starts, with one check shared by `composeArgs` and `launchWorker` (`assertEffort`). Record the results in `worker.js`'s header, not here, and add an opt-in live probe beside `AC7` (`AC7.1 (#5942)`) |
| A new platform | Run the sandbox probes there, then add it to `SANDBOX_PROBED_PLATFORMS`; until then the implementer has no Bash there |
| A new CLI version changes a flag's behavior | Re-run the probes the header names for that flag and update the version and date beside each result |

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---|---|
| Testing only that denied commands are denied | It cannot see what an allowed command does; the `git log --output=.git/config` write passed three reviews that way |
| Calling a git subcommand read-only because its name sounds like a read | `log`, `diff` and `show` take `--output`; `diff --no-index` reads any file; `status` runs `core.fsmonitor` from a configuration the worker may have written |
| Copying the probed facts into this skill or another document | They drift from the headers they came from; point at `roles.js` and `worker.js` instead |
| Widening rights after reading a permission denial | There is no such path by design; a denial is reported, never retried with more rights |
| Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list; derive the list instead (see `bin-source-scan-conformance`) |
| A live smoke or probe prompt that leaves the worker to phrase its own Bash commands | The model rewrites them (haiku appended an exit-status echo to each, #5268), so an exact allow rule stops matching and an allowed step is denied unrun; tell it to run each command exactly as written, as the `AC7` prompt does |
| Defanging only the exact closing marker of an untrusted wrap | Format characters and look-alike brackets forge it (#5228); neutralise the punctuation runs structurally, and fence diffs with `fenceFor` |
| A second home-or-ancestor check for a new source of read paths | `reopensHome` in `roles.js` is the one rule for derived roots and caller `readPaths`, home real paths included; a hand-written copy (#5268's first review fix) drifts from it. Call it |

## Reference

- Code: `plugin/bin/lib/driver/roles.js` (`ROLES`, `SANDBOX_PROBED_PLATFORMS`, `implementerSettings`, `toolsFor`, `composeArgs`), `plugin/bin/lib/driver/worker.js` (`launchWorker`, `ENVELOPE_FIELDS`, `ENV_ALLOW`)
- Tests: `tests/bin-lib/driver/roles.test.js`, `tests/bin-lib/driver/worker.test.js` (the opt-in `AC7` live smoke test)
- Journey: `docs/journeys/launch-a-rights-limited-headless-worker-5217.md`
- Related skills: `transcript-payload-verification` (measuring harness behavior per launch mode and version), `bin-source-scan-conformance` (the source scans a new `plugin/bin` module must pass)
