---
files:
  - plugin/bin/lib/issues/build-authority.js
  - plugin/bin/lib/issues/typed-command.js
  - plugin/bin/lib/hooks/user-prompt-submit.js
  - plugin/bin/lib/dispatch/queue-pull.js
  - plugin/bin/queue-pull.js
  - plugin/bin/dispatch-resume.js
  - plugin/bin/lib/dispatch/resume-eligibility.js
  - plugin/bin/lib/driver/steps.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/merge.js
  - plugin/bin/lib/issues/grant-maturation.js
  - plugin/bin/lib/console/resolve.js
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/queue-pull-notes.md
  - tools/typed-command-probe.js
---

# Build a Record by Typing Its Dispatch Command

**Persona:** a maintainer at their own terminal who has just shaped a record to `ready`, has not granted it `auto:build`, and wants it built now without a trip through `/claude-tweaks:backlog refine`.
**Goal:** type `/claude-tweaks:dispatch #N` and have that one firing build the record, with no label written, while a scheduled prompt, a message from another session or a headless run naming the same record still cannot.
**Entry point:** `/claude-tweaks:dispatch #N` typed into an attended, interactive Claude Code session, for an open `ready` record with no `auto:build` and no hold label.
**Success state:** the queue pull prints `#N has no auto:build label — built on the typed /claude-tweaks:dispatch command`, the run's `decisions.md` gains one `AUTO` line `#N admitted on a typed /claude-tweaks:dispatch command (no auto:build label)`, the record builds like a granted one, and its labels are unchanged afterwards. The run stops at `pending-review` even when the record carries a leftover `auto:merge`, because a merge grant counts only together with a live `auto:build` (#5734).

## Steps

### 1. Type the command
- **URL:** `plugin/bin/lib/hooks/user-prompt-submit.js` (the second writer); `plugin/bin/lib/issues/typed-command.js` `writePointer` (`dispatch-prompts.json` under the session temp root)
- **Action:** Type `/claude-tweaks:dispatch #N` at the prompt. The prompt hook sees a first line naming records and writes a pointer from `#N` to this prompt's id. Every other prompt costs the hook one first-line test and writes nothing.
- **Should feel:** Invisible — nothing extra to type, no confirmation, no label to add first.
- **Should understand:** The pointer is a hint, not the proof. A pointer written by hand, for another record, from another session or older than 30 minutes gains nothing, because the check re-reads the prompt's own transcript row.
- **Red flags:** The hook printing anything, or failing the prompt; a pointer written for `/claude-tweaks:dispatch next` or `--budget`.

### 2. The queue pull admits the record
- **URL:** `plugin/skills/dispatch/SKILL.md` Step 2 (`--named <the numbers> --run "$RUN_ID"`); `plugin/bin/lib/dispatch/queue-pull.js` `admitNamed`; `plugin/bin/lib/issues/build-authority.js` `resolveBuildAuthority`
- **Action:** Dispatch runs the queue pull with `--named N --run …`. `#N` is not in the `auto:build` pool, so the pull fetches it and asks the one rule. Inside the session the rule checks the environment (entrypoint `cli`, attended `1`, not remote, not a hub run, launcher `user` when set) and then the transcript row: `turnOrigin` and `origin.kind` `human`, no scheduled or queue keys, the whole command form naming `#N`, within 30 minutes. It answers `typed`; the pull prints the admit line, writes the `AUTO` line, and appends the record to the pool.
- **Should feel:** The same as naming a granted record — one line saying why it builds, then the build.
- **Should understand:** Every gate a granted record passes still runs after admission (`blocked`, `open-pr`, `not-spec-shaped`, `neighbour-in-flight`, …). A typed command stands in for `auto:build` for this firing only and writes no label.
- **Red flags:** A label added to the record; the record admitted without the `AUTO` line; the queue-order cache read or written on a firing that admitted a typed record.

### 3. Read a refusal by its words
- **URL:** `plugin/skills/dispatch/queue-pull-notes.md` `## Typed command` (word | meaning | remedy table); `build-authority.js` `formatAuthorityLine`
- **Action:** When the check refuses, the pull prints one line naming every failed condition and the first word's remedy, e.g. `#N has no auto:build label — not built: typed command not accepted (not-ready); run /claude-tweaks:specify #N (a typed command with any other argument records nothing)`. Other named-but-not-admitted cases each get their own line: a closed record (`#N is closed — not built: the queue pull takes open records only`), a labelled record the pool fetch missed, an already-claimed record (`bot:in-progress`), a failed audit write. Under `--transport files` the label is still required.
- **Should feel:** Actionable — the reason word and the command that fixes it are on one line.
- **Should understand:** A refusal never falls back to building. `held` (`bot:blocked`, `bot:parked`, `parked`) is refused even with an accepted typed command.
- **Red flags:** A named number with no line at all; a reason word not in the table; a refusal that still builds.

### 4. Lines that look typed but are not
- **URL:** `docs/hooks.md` "Typed dispatch command (#5584)" (the six-case probe table); `.claude-tweaks/pipelines/2026-11-16T015923-record-5584/work/5584-probe.md` Part 2
- **Action:** The same line delivered by a `ScheduleWakeup` prompt, by `cc hub send`, or run headless with `claude -p` reaches the pull but is refused (`not-typed`, or `entrypoint`/`not-attended`). The pointer may exist; the transcript row's markers say who sent it.
- **Should feel:** Safe — a model or a peer cannot grant itself a build by echoing the command.
- **Should understand:** On Claude Code 2.1.325 the transcript cannot tell a launch-line prompt (`claude "/claude-tweaks:dispatch #N"`) from a typed one, so a launcher is refused only through `CC_LAUNCHED_BY` (condition 4). These fields are observed, not a documented contract — re-run `tools/typed-command-probe.js` after an upgrade.
- **Red flags:** `typed` for a scheduled or peer row; a headless run reporting entrypoint `cli` and attended `1`.

### 5. Resume or drive the same record
- **URL:** `plugin/bin/dispatch-resume.js` `runVerdict`; `plugin/bin/lib/dispatch/resume-eligibility.js`; `plugin/bin/lib/driver/steps.js` admission step; `plugin/bin/lib/driver/run.js` (`drive.js #N`, `drive.js --check #N`)
- **Action:** `/claude-tweaks:dispatch resume #N` typed for the record's stalled draft PR is accepted the same way; a refused one names its reason word and that word's remedy. At a plain terminal, `node plugin/bin/drive.js #N` admits the record on the terminal path (stdin a terminal, `CI` unset); the admission event line carries `authority`. `drive.js --budget` never names a record, so it never admits one without the label.
- **Should feel:** Consistent — the same rule, the same words, on every surface that can build.
- **Should understand:** A model-run `drive.js` takes the session path by default; clearing the session variables under a pty is not prevented, which is the same residual as a session adding the label by hand.
- **Red flags:** Resume or the driver disagreeing with the queue pull about the same record; `--check #N` refusing a record `drive.js #N` would admit.

### 6. A leftover merge grant does not merge the typed run
- **URL:** `plugin/bin/lib/driver/merge.js` merge step (entry and pre-merge label reads); `plugin/bin/lib/issues/grant-maturation.js` `evaluateMaturation` (`no-build-grant`); `plugin/bin/lib/console/resolve.js` merge resolution; `plugin/skills/_shared/work-record.md` (the rule, stated once)
- **Action:** The typed run reaches its merge decision on a record that still carries `auto:merge`, or a matured `auto:merge-pending`, from an earlier grant, but no `auto:build`. The driver stops `not-authorized` with detail `record lacks auto:build` (or `record lacks auto:build at the pre-merge read`, when the label was removed mid-run). It makes no label, comment, ready or merge call. On the skill path, Authorization fails with state `no-build-grant`. The Review Console resolves `leave-open` with a reason naming the member and the missing build grant. The PR stays at `pending-review`.
- **Should feel:** Predictable — the typed command authorized a build, and a build is all that happens.
- **Should understand:** To merge, type the merge yourself (`/claude-tweaks:wrap-up #N merge`), or grant `auto:build` together with `auto:merge`. A `no-build-grant` result is never promoted from `auto:merge-pending` to `auto:merge`.
- **Red flags:** A typed run that merges on `auto:merge` alone; a stop detail that does not name `auto:build`; a console reason that points at the merge label when the merge label is present and only the build grant is missing.

## Origin
- Updated during `/claude-tweaks:build` of record #5734 (2026-11-16): step 6, where a merge grant authorizes a merge only together with a live `auto:build`.
- Created during `/claude-tweaks:build` of record #5584 (2026-11-16): a typed `/claude-tweaks:dispatch #N` stands in for `auto:build` for one firing through one build-authority rule shared by the queue pull, resume and the driver.
- Related: #5232 (driver route; its `--check` names its record since this build), #5714, #5715 (follow-ups for consumers that assume a grant label), #5716 (parked re-measurement once the `CC_LAUNCHED_BY` launcher release is installed).
