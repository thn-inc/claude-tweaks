---
files:
  - plugin/bin/lib/plan-audit/parser.js
  - plugin/bin/lib/plan-audit/checks.js
  - plugin/bin/plan-audit.js
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/plan-authoring-checks.md
---

# Mark a Task's Review Risk With a Reason

**Persona:** A `/claude-tweaks:build` session (or the maintainer editing its plan) who marks a risky task `**Review risk:** high` and wants to note why on the same line.
**Goal:** The task gets the Capable task review its author asked for, and the reason stays readable next to the marker.
**Entry point:** Writing a `### Task N:` block in a plan, then `/claude-tweaks:build`'s per-task tier forwarding running `node plugin/bin/plan-audit.js --task-markers {plan}` before it dispatches SDD.
**Success state:** `--task-markers` reports the task with `"risk": "high"` (or its marked `role`), no `findings` entry, nothing on stderr, and the forwarded tier table gives the task a Capable review.

## Steps

### 1. Write the marker with its reason on the same line
- **URL:** the plan file, under a `### Task N:` heading, outside any fenced code block; the syntax is stated in `plugin/skills/build/plan-authoring-checks.md`'s **Per-task role/review-risk markers (#3378).** paragraph.
- **Action:** Write `**Review risk:** high (a read-once/write-last ordering, and branching on computed state)`, or `**Role:** judgment — needs design judgment`.
- **Should feel:** Natural. The reason sits where a reader expects it, and nothing forces it onto a separate line.
- **Should understand:**
  - The value is its first whitespace-delimited word. Anything after the value and whitespace is an ignored annotation.
  - `high-ish`, `high,` or `medium` are not `high`. An attached separator keeps the value unrecognized.
- **Red flags:**
  - Having to move the reason to its own `Why:` line before the marker counts.

### 2. Check the markers before dispatch
- **URL:** `node plugin/bin/plan-audit.js --task-markers {plan}`.
- **Action:** Run it. Read the JSON line on stdout and anything on stderr.
- **Should feel:** Quiet when the markers are right: one JSON line, exit 0, empty stderr.
- **Should understand:**
  - An annotated valid value reads as the value itself (`"risk": "high"`), with no `findings` key.
  - Any unrecognized value still lands in `findings` with its full raw text, and now also prints one stderr line: `plan-audit.js: warning: task {taskIndex} "{title}" — unrecognized {field} value "{value}"; that field reads as unmarked`.
  - The exit code stays 0 either way. Findings are warn-only.
- **Red flags:**
  - A task the author marked high reporting `"risk": null` with nothing on stderr.
  - A misspelled key (`**Rol:**`) expected to warn. It is undetectable and reads as unmarked.

### 3. Let /build forward the tier, and see any finding in the decision log
- **URL:** `plugin/skills/build/dispatch.md`'s Per-task role/review-risk tier forwarding paragraph; the run's `decisions.md`.
- **Action:** `/claude-tweaks:build` runs `--task-markers`, builds the per-task tier table, and dispatches SDD.
- **Should feel:** Trustworthy. A marked task gets its tier, and an unparsed marker leaves a trace instead of silently costing the task its Capable review.
- **Should understand:**
  - When the output carries `findings`, `/build` logs one `SKIP` line under step `Per-task tier forwarding (degraded)` naming every offending task, field and value, then dispatches with that field unmarked. It never stops the build.
- **Red flags:**
  - A `findings` entry with no matching `SKIP` line in `decisions.md`.
  - The build stopping on a bad marker value.

## Origin
- Created during build of #4640. Before it, `**Review risk:** high (reason)` parsed as `risk: null`, its `findings` entry was printed only inside the stdout JSON, and `dispatch.md` never read `findings`, so the task silently dropped from a Capable review to the unpinned tier.
- Pinned by `tests/bin-lib/plan-audit/parser.test.js`, `checks.test.js` and `cli.test.js` (the `#4640` cases), and by `tests/plan-task-markers-conformance.test.js`.
- Related: `merge-small-adjacent-tasks-at-plan-time-3379.md`, another plan-authoring rule `/claude-tweaks:build` applies before dispatch.
