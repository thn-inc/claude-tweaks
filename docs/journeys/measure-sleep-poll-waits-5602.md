---
files:
  - tools/wait-polls.js
  - tools/guard-refusals/transcripts.js
  - tests/wait-polls/cli.test.js
  - docs/reference/blocking-wait-probe.md
---

# Measure How Much Agent Bash Traffic Is a Sleep Poll

**Persona:** The claude-tweaks plugin maintainer, at a terminal in a checkout of this repo (`tools/` is maintainer-side and never ships). Several Claude Code accounts on this machine (`~/.claude/projects` and `~/.claude-accounts/*/projects`) hold a month of dispatched-agent transcripts, and the keep-alive rule in `_shared/subagent-dispatch-core.md` told every subagent, before #5604, to wait with repeated twenty-second sleep calls. The maintainer is deciding whether a blocking wait command (record #5602's `wait-for.js`, gated by its probe) would be worth building.
**Goal:** Know how many Bash calls begin with `sleep`, how they split between main sessions and subagents, and what each one was waiting for, so the next wait design targets the waits that actually happen.
**Entry point:** `node tools/wait-polls.js --projects-dir <root> [--projects-dir <root>]...` run from the repo root.
**Success state:** One JSON line whose `sleepLed` total and `targets` table the maintainer can quote in a PR or a design doc, reproducible with the same `--until`, and read beside `docs/reference/blocking-wait-probe.md`'s harness facts.

## Steps

### 1. Run the CLI over every store root — `node tools/wait-polls.js`
- **URL:** `node tools/wait-polls.js --projects-dir ~/.claude/projects --projects-dir ~/.claude-accounts/<account>/projects ... --until 2026-11-16T00:00:00Z > wait-polls.json`. Flags: `--projects-dir <dir>` (repeatable; default `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), `--match <slug-substring>`, `--since-days <n>` (default 30), `--until <iso>` (default now), `--help`.
- **Action:** Pass one `--projects-dir` per account root. Roots and project directories that are symlinked aliases of one another are resolved to their real paths and read once, so listing every root is safe.
- **Should feel:** One command, one line of JSON, the same numbers when re-run with the same `--until`.
- **Should understand:** The window is `[until - since-days, until)` over transcript file mtimes. Exit 0 is a report. Exit 2 is a malformed invocation or a store that could not be read: a `--projects-dir` that is missing or unresolvable, or a read error other than a vanished file mid-walk. stderr then names the path (`cannot read <path> (<code>)`), and no JSON prints, so a partial read never looks complete.
- **Red flags:** `transcripts.main` near 0 on a machine that ran pipelines (a root was not passed). A `transcripts` count that doubles when you add an alias root (the real-path dedup regressed).

### 2. Read the counts — `transcripts`, `bashCalls`, `sleepLed`
- **URL:** the JSON line's first four keys, each split into `main` and `subagent`
- **Action:** Compare `sleepLed.subagent` with `bashCalls.subagent`. That share is the cost of the keep-alive rule. A call is counted once by its tool-use id, so a fork's replay of its parent's history is not double-counted, and it is attributed to the kind of file it first appeared in.
- **Should feel:** Like a measurement the maintainer can quote. 2026-10-17..2026-11-16 printed 53,555 sleep-led calls (53,295 in subagents), within 1.3% of #5602's independent count.
- **Should understand:** Only a Bash command whose text starts with `sleep <digits>` is sleep-led. `echo sleep 30` is a Bash call, not a sleep.
- **Red flags:** `sleepLed` larger than `bashCalls`, which is impossible and means the counters diverged. A total far from an independent count (a `jq` over the same store) by more than a few percent.

### 3. Read what each sleep waited for — `targets`
- **URL:** `targets`, one `{ calls, share }` per target in a fixed order: `agent-notification`, `background-process`, `output-file`, `ci`, `worktree-git`, `verify`, `dev-server`, `suite-slot`, `other`
- **Action:** Read the top target's `share`. A sleep is classified by the command chained after it (`sleep 30; gh pr checks 12` → `ci`), else by the probe calls between it and its neighbouring sleeps (at most 3 calls per gap), else as `agent-notification` when an `Agent`/`Task` launch precedes it in the same transcript, else `other`.
- **Should feel:** Decisive. In the measured window one target (`agent-notification`, 94.2%) dwarfed the rest, which is what the blocking-wait probe was designed around.
- **Should understand:** The classification is a heuristic stated in the CLI's header. It is not a measurement of intent, and a rule change moves calls between targets without changing `sleepLed`. Whether a blocking command can replace those sleeps depends on harness facts this tool does not measure: `docs/reference/blocking-wait-probe.md` records that a dispatched subagent's foreground Bash call is moved to the background after 180 s.
- **Red flags:** `other` growing past a few percent (a new probe shape no rule matches). A share table that does not sum to about 100.

## Outcome

"How much of our agents' Bash traffic is a sleep, and what is it waiting for" is one command with a reproducible answer. That answer is the evidence a human uses to re-shape #5602's Deliverables 3-6 against the probe's measured 180 s foreground ceiling.

_Origin: record #5602 (Deliverables 1-2: `docs/reference/blocking-wait-probe.md` and `tools/wait-polls.js`; the probe gate stopped the build before `wait-for.js`), built 2026-11-16. Deliverables 3-6 (`plugin/bin/wait-for.js`) then shipped in the same record after the probe-result Decision: `block-on-a-child-agent-ci-or-process-5602.md`. Related: `measure-worktree-guard-refusals-4028.md`, whose transcript walk (`tools/guard-refusals/transcripts.js`) this tool reuses._
