# Driver script-job launch line and opt-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document how to run `drive.js --budget` as a Dispatch script job (a launch line that needs no Claude session) and opt this repository into `express-driver-runner: script`.

**Architecture:** Docs plus committed config only. The launch line finds the installed plugin root by reading `installed_plugins.json` and calling the installed build's own `selectEntry` (`plugin/bin/lib/installed-plugins.js`), so the selection rule stays single-sourced and no version path is pinned. The Dispatch job, smoke firing and 20-record trial are post-merge operational steps (the record's own order: policy merge, then enable the job) and are carried in the open-items ledger, not in this plan: the controller writes them as `build`-phase `open` rows at Common Step 4 (`Defer-reason: blocked-dependency`, unblocked by this PR's merge and the release carrying it), one row each — confirm the job host's `installed_plugins.json` version carries `express-driver-runner`; create the Dispatch job (`list_repos`, `create_job`, confirming whether its `command` runs through a shell); the `--budget 1` smoke firing (AC5); the 20-record / 14-day trial and its report (AC2, AC3, AC4.1 guard 1); the abort/revert rule; the closing comment (AC1.2, the job's name, schedule and budget); the guard-3 addendum 14 days after the last merge (AC4).

**Tech Stack:** Markdown, YAML, POSIX `sh`, Node 18+.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T134150-record-6120/work/6120-spec.md`

## Global Constraints

- Never a pinned version path in the launch line (`~/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/{version}/` changes with every version).
- The launch line runs from the main checkout, sets `CC_HUB_RUN=1`, leaves stdin a pipe, and passes `--budget <n>`.
- Job environment needs: `gh` and `git` on `PATH`, a Claude login the worker env allow-list passes (`CLAUDE_CONFIG_DIR`), Node 18 or later.
- `express-driver-runner` stays `session` by default; only this repository's `.claude-tweaks/policy.yml` opts in.
- The installed release must carry `express-driver-runner` before the policy change merges. Probed: installed 6.180.0's `bin/lib/policy-schema.js:128` registers it.
- Governing-skill quote check: no `.claude/skills/` skill governs `docs/driver.md` prose or this policy row. `driver-step-addition` covers `STEPS` changes, `headless-worker-launch` covers worker launch rights, `policy-key-addition` covers schema changes; this plan makes none of those changes.

## Review Focus

- `CLAUDE_CONFIG_DIR` set on the job host: the launch line must read that config dir's `installed_plugins.json`, not `~/.claude`'s (the prototype reads `process.env.CLAUDE_CONFIG_DIR` first).
- Plugin not installed, or installed only for another project: the line must fail loud (stderr names the file, non-zero exit) and never run `drive.js` from an empty root (`&&` chaining).
- A main-checkout path with a space (this repo's own `Code Workspaces`): the `cd` argument is double-quoted.
- A job runner that gives stdin a terminal: `true |` makes stdin a pipe whatever the runner gives.
- A user-scope record listed before a project record: the first applicable entry in array order wins, which is what `selectEntry` implements.

---

### Task 1: Script-job section in `docs/driver.md`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `docs/driver.md` (new `## Running it as a script job` section after `## Build authority`, immediately before `## Picking records: \`--budget\``)
- Waived `plugin/bin/lib/installed-plugins.js`: read only, Step 1 calls its `selectEntry`
- Waived `tools/pipeline-cost-report.js`: read only, the trial's measures run after merge (ledger row), not in this build

**Interfaces:**
- Consumes: `selectEntry(entries, projectPath, { realpath, readFile })` from `{installPath}/bin/lib/installed-plugins.js`.
- Produces: the launch line the Dispatch job's `command` uses.

- [ ] **Step 1: Write the section.** It states why a script job needs its own launch line (no session, so no `CLAUDE_PLUGIN_ROOT`), gives the launch command below verbatim with `{main checkout}` and `{n}` as the two placeholders, says each part's reason (cwd is the main checkout; `CC_HUB_RUN=1` and the `true |` pipe keep a job runner from reading as a person, citing "Build authority"'s launcher paragraph by name; the root comes from the installed build's `selectEntry`, the rule Claude Code applies), states that the line needs a POSIX shell (`&&`, `$(…)`, a pipe, nested quotes) — when the job runner passes its `command` to a shell, the line is the command; when it does not, save the line to a file on the job host and make the command `sh {file}` — and lists the environment needs from Global Constraints, naming #5259 for the `ENV_ALLOW` limit on worker authentication. Launch command (verified by the prototype run recorded below):

```sh
cd "{main checkout}" && ROOT="$(node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "plugins", "installed_plugins.json");
const list = JSON.parse(fs.readFileSync(file, "utf8")).plugins["claude-tweaks@claude-tweaks-marketplace"] || [];
const lib = (e) => e && typeof e.installPath === "string" && path.join(e.installPath, "bin", "lib", "installed-plugins.js");
const boot = list.map(lib).find((p) => p && fs.existsSync(p));
const entry = boot && require(boot).selectEntry(list, process.cwd(), { realpath: fs.realpathSync.native, readFile: fs.readFileSync });
if (!entry) { console.error("claude-tweaks is not installed for " + process.cwd() + " in " + file); process.exit(1); }
process.stdout.write(entry.installPath);
')" && true | CC_HUB_RUN=1 node "$ROOT/bin/drive.js" --budget {n}
```

  Prototype run (Verbatim-command run-once check), with `--help` in place of `--budget {n}`, `{main checkout}` = this repo's main checkout, from `env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_PLUGIN_ROOT -u CLAUDE_CODE_SESSION_ATTENDED sh launch.sh`: printed `Usage: drive.js #N [#M…]` and the full usage, exit 0.

- [ ] **Step 2: Verify AC1.1** — run the section's command, copied out of the edited `docs/driver.md`, with `--budget {n}` replaced by `--help` and `{main checkout}` by this repo's main checkout, under `env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_CODE_REMOTE -u CC_HUB_RUN -u CC_POSTURE -u CC_LAUNCHED_BY -u CLAUDE_PLUGIN_ROOT sh {file}` (every session and launcher variable `docs/driver.md`'s Build authority names, `CLAUDE_CONFIG_DIR` kept). Expected: the usage text, exit 0. Write the output to `$PIPELINE_RUN_DIR/evidence/ac1-launch-help.txt` (`mkdir -p` first, Bash redirect) and log one `AC evidence` `decisions.md` entry via `log-decision.js --text-file` naming AC1.1, the command shape and the exit code.
- Waived AC1.2: pasting the output into the closing comment happens when the trial window ends (ledger row); the evidence file from Step 2 is its source.
- [ ] **Step 3: Commit** `docs/driver.md` only: `Document the drive.js script-job launch line — refs #6120`.

### Task 2: Opt this repository in

**Role:** transcription

**Files:**
- Modify: `.claude-tweaks/policy.yml` (append after the `express-driver: on` row)

- [ ] **Step 1: Add the row** with a comment in the file's existing style:

```yaml
# express-driver-runner (#6120): a Dispatch script job runs drive.js --budget here (docs/driver.md "Running it as a script job"), so the session drain leaves driver-routable records to it.
# Revert signal: guard 1 or guard 3 regresses against the design's baseline, or two firings in a row end worker-stop — disable the job and set this back to session.
express-driver-runner: script
```

- [ ] **Step 2: Verify** — run `node "{installed root}/bin/resolve-policy.js" --values express-driver-runner` from the worktree. Expected: `script`.
- [ ] **Step 3: Commit** `.claude-tweaks/policy.yml` only: `Opt this repository into the drive.js script job — refs #6120`.

## Acceptance-criteria coverage

- AC1.1: Task 1 Step 2. AC1.2: waived above.
- Waived AC2.1: the trial window's transcripts exist only after the job runs post-merge (ledger row).
- Waived AC2.2: the cost report over the trial window exists only after the job runs post-merge (ledger row).
- Waived AC3.1: job firings happen post-merge (ledger row).
- Waived AC3.2: job firings happen post-merge (ledger row).
- Waived AC4.1: guard numbers come from PRs the job drives and a read 14 days after the last merge (ledger row).
- Waived AC4.2: guard numbers come from PRs the job drives and a read 14 days after the last merge (ledger row).
- Waived AC5.1: the smoke firing runs after the job is created, post-merge (ledger row).
- Waived AC5.2: the smoke firing runs after the job is created, post-merge (ledger row).
