---
files:
  - plugin/bin/implementer-tier.js
  - plugin/bin/lib/model-profiles/implementer-tier.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/handoff-template.md
  - .claude-tweaks/policy.yml
---

# Pick an Implementer's Work Profile from a Record's Spec

**Persona:** claude-tweaks maintainer wiring a build lane (the standard lane's task loop, #5999, or the driver, #5997) who needs to know which work profile an implementer should run on for one record, and wants to see the `implementer-tier` rule decide it before any build relies on it.
**Goal:** Ask the CLI for one materialized spec's implementer profile under each rule, escalate it one step, and confirm a mistyped run directory is refused instead of silently ignored.
**Entry point:** A terminal at this repo's checkout root (or a worktree of it) that holds a materialized spec, e.g. `.claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md`.
**Success state:** One JSON line per call, `{"profile","stepUp","rule","size","keyFileCount"}`, whose `profile` matches the rule the line names; and a non-zero exit, with no JSON, for every bad input.

## Steps

### 1. Ask under the project's rule — terminal
- **URL:** `node plugin/bin/implementer-tier.js --spec-file .claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md`
- **Action:** Run it with no `--rule`, so the CLI resolves `implementer-tier` from `.claude-tweaks/policy.yml` (this repo sets `record`).
- **Should feel:** Like asking one question and getting one answer: a single JSON line, nothing to configure.
- **Should understand:** `{"profile":"standard","stepUp":"capable","rule":"record","size":"medium","keyFileCount":9}`. `rule` names where the decision came from. Under `record`, only a `size: low` record whose Key Files name one or two distinct paths gets `fast`; a directory, glob (`*`, `?`) or brace-list (`{a,b}`) entry counts as at least 3, so it never qualifies. Every other record, `size: high` included, gets `standard`. `stepUp` is the one profile a failed first attempt may escalate to.
- **Red flags:** `"rule":"lane"` in this repo (the `policy.yml` opt-in line is missing, or a run `config.yml` overrides it); `"profile":"capable"` under `record` (the record rule never returns Capable directly); any stack trace.

### 2. Compare with today's size-only mapping — terminal
- **URL:** `node plugin/bin/implementer-tier.js --spec-file .claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md --rule lane --from capable`
- **Action:** Force the `lane` rule and ask what one step up from Capable would be.
- **Should feel:** Like flipping a switch with a visible effect: the same spec, a named rule, and an escalation that stops at the top.
- **Should understand:** `{"profile":"standard","stepUp":null,"rule":"lane","size":"medium","keyFileCount":9}`. `lane` is today's mapping (`low` → `fast`, `medium` → `standard`, `high` → `capable`, no `size` → `null`, meaning no override). `--from` lets a caller escalate a profile that came from a per-task marker or a `profile=` token; nothing steps up past `capable`, and `frontier` is never returned.
- **Red flags:** `stepUp` reading `"frontier"`; `--from huge` or `--rule sometimes` producing JSON instead of exit 2.

### 3. Mistype the run directory — terminal
- **URL:** `node plugin/bin/implementer-tier.js --spec-file .claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md --rule lane --run /tmp/no-such-run-5996`
- **Action:** Pass a `--run` that does not exist, together with `--rule`.
- **Should feel:** Strict: the call fails at once and names the bad path, even though `--rule` already decided the answer.
- **Should understand:** stderr `implementer-tier: --run dir does not exist or is not a directory: /tmp/no-such-run-5996`, exit 2, no JSON. `--run` is always validated (the record's Reading B decision), through the same anchored-or-outside guard and existence check `resolve-policy.js` uses. A flag given twice (`--rule lane --rule record`) is exit 2 too, and a malformed header (`size: huge`, two `size:` lines) or an invalid `implementer-tier` value in `policy.yml` or the run's `config.yml` is exit 1, naming the value.
- **Red flags:** Exit 0 with a JSON line (a typo'd run id passed silently); a message that does not name the path or value it refused.

### 4. Watch a build take its profile from the rule — run directory
- **URL:** `{run-dir}/decisions.md` of a `/claude-tweaks:flow #N` or `/claude-tweaks:build #N` record build (#5999)
- **Action:** Build a record, then read the run's `## /build` section.
- **Should feel:** Traceable: one line names the profile every untagged task started on and the inputs that chose it, so there is nothing to reverse-engineer from model names.
- **Should understand:** Exactly one `implementer profile {profile} (rule: {rule}, size: {size}, key files: {count}) effort {startEffort}` line per build; a resumed build adds no second one. Precedence is the `profile=` token, then a task's `**Role:**` marker, then this profile. Under `record` only, a task whose implementer replies `STATUS: BLOCKED`, or whose first fix round fails re-review, gets one fresh implementer one profile up, logged `task {k} implementer escalated {from} → {to} (blocked|fix-round-failed)`. It happens at most once per task, even across a context handoff. A build given `profile=` (or `tier=`) never escalates. A standalone build with no run dir lists both lines in its handoff's `### Implementer profile (standalone build)` section.
- **Red flags:** Two `implementer profile` lines in one run; an escalation line under `rule: lane`, or a second one for the same task; a build that proceeds after the CLI exited non-zero (it must stop before the first dispatch and quote the CLI's message).
