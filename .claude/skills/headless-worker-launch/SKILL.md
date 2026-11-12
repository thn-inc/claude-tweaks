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

## Decision Framework

| Situation | Do this |
|---|---|
| Adding a command to the implementer's allow list | List its write, read, exec and network flags; probe each through the launcher with the sandbox on and off; add the worst case to the live smoke test; record the results in the `roles.js` header |
| Adding a tool to a role (for example Grep or Glob off macOS) | Probe that the tool stays inside the working directory under that role's flags on each platform it ships to, before adding it to `ROLES` |
| Turning on `permissions.blockReadsOutsideWorkingDirectories` | It blocks the home directory, including a toolchain installed there (a different `node` ran); it needs a per-project list of readable paths, which is a project decision |
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

## Reference

- Code: `plugin/bin/lib/driver/roles.js` (`ROLES`, `SANDBOX_PROBED_PLATFORMS`, `implementerSettings`, `toolsFor`, `composeArgs`), `plugin/bin/lib/driver/worker.js` (`launchWorker`, `ENVELOPE_FIELDS`, `ENV_ALLOW`)
- Tests: `tests/bin-lib/driver/roles.test.js`, `tests/bin-lib/driver/worker.test.js` (the opt-in `AC7` live smoke test)
- Journey: `docs/journeys/launch-a-rights-limited-headless-worker-5217.md`
- Related skills: `transcript-payload-verification` (measuring harness behavior per launch mode and version), `bin-source-scan-conformance` (the source scans a new `plugin/bin` module must pass)
