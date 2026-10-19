---
files:
  - plugin/bin/lib/skill-audit/harness-cost.js
  - plugin/bin/harness-cost-report.js
  - plugin/skills/harness-health/SKILL.md
---

# Review the Harness Tool-Scope Cost Report

**Persona:** Maintainer of the claude-tweaks plugin (or the scheduled Routine running `/claude-tweaks:harness-health` on their behalf) checking whether any shipped skill or subagent definition carries a bloated tool roster.
**Goal:** See every shipped skill's `allowed-tools:` and every shipped agent definition's `tools:` scope measured against the same four-tool baseline, so an over-scoped definition of either kind is visible.
**Entry point:** `/claude-tweaks:harness-health`'s Harness cost-efficiency check, which runs `node "${CLAUDE_PLUGIN_ROOT}/bin/harness-cost-report.js" --plugin-root "${CLAUDE_PLUGIN_ROOT}"` every firing — or the same command run by hand (`node plugin/bin/harness-cost-report.js --plugin-root plugin` in this repo).
**Success state:** The report's JSON lists skill rows and agent rows (each with a `kind`), `totalAgents` beside `totalSkills` and `unscopedAgentCount` beside `unscopedCount`, and any agent over 2x the baseline appears in `flagged` exactly as a skill would; harness-health's SUMMARIZE report carries an `{unscopedAgentCount}/{totalAgents} agents unscoped` line.

## Steps

### 1. Run the cost report
- **URL:** N/A (CLI: `node plugin/bin/harness-cost-report.js --plugin-root <dir> [--ratio-threshold <n>]`)
- **Action:** The maintainer (or harness-health) runs the CLI against the plugin payload root — the directory holding `skills/` and `agents/` directly beneath it.
- **Should feel:** One command, one JSON line — nothing to configure.
- **Should understand:** `--plugin-root` is the payload root (`plugin/` here, `${CLAUDE_PLUGIN_ROOT}` for an installed consumer), never the repo root; exit 2 means a malformed invocation or a non-plugin-root path.
- **Red flags:** A plugin root with no `agents/` directory must still exit 0 with `totalAgents: 0` — an error there means the agent half broke the skill half.

### 2. Read skill and agent rows side by side
- **URL:** N/A
- **Action:** The maintainer reads `entries`: each row carries `kind` (`skill` or `agent`), `name`, `bytes`, `tools`, `toolCount`, `overageRatio`, and `sharedCitations`. Agent rows are sized from the flat `agents/{name}.md` file and carry `sharedCitations: null`; the summary carries `totalSkills`, `totalAgents`, `unscopedCount`, and `unscopedAgentCount`.
- **Should feel:** Complete — `qa-agent` shows up (`kind: "agent"`, `tools: ["Bash"]`, `toolCount: 1`) where before it was silently missing, matching what the docs always claimed.
- **Should understand:** `totalSkills` and `unscopedCount` count skills only, `totalAgents` and `unscopedAgentCount` agents only (the SUMMARIZE line renders them as `{unscopedCount}/{totalSkills} skills unscoped, {unscopedAgentCount}/{totalAgents} agents unscoped`); agents are measured against the same Read/Write/Edit/Bash baseline, which was calibrated for skills and has not been validated as a fair yardstick for agents.
- **Red flags:** A skill and an agent with the same name collapsing into one row; an agent counted in `unscopedCount`; an agent row whose `bytes` matches a `skills/{name}/SKILL.md` instead of its own `agents/{name}.md`.

### 3. Act on the flagged list
- **URL:** N/A
- **Action:** The maintainer reads `flagged` — every row (skill or agent) whose declared tool count exceeds 2x the baseline (or `--ratio-threshold`) — and harness-health's SUMMARIZE line, `tool scope: {unscopedCount}/{totalSkills} skills unscoped, {unscopedAgentCount}/{totalAgents} agents unscoped, flagged: {kind}:{name}={toolCount} tools, ...`.
- **Should feel:** Actionable, not noisy — a flagged entry names its kind, so the maintainer knows whether to narrow a SKILL.md `allowed-tools:` line or an agent's `tools:` line.
- **Should understand:** This is reporting only; it never files an issue. An unscoped row (`toolCount: null`) is never flagged — there is no declared count to ratio; it is tallied instead, a skill in `unscopedCount` and an agent in `unscopedAgentCount`.
- **Red flags:** An agent with no `tools:` line (full default roster) missing from `unscopedAgentCount`, or tallied in `unscopedCount` instead; an unscoped agent appearing in `flagged`.

## Origin
- Created during build of #2933 (wire `measureAgentToolCost` into `estimateHarnessCost` and the cost report)
- Related: #2741 (the original harness cost-efficiency lens)
