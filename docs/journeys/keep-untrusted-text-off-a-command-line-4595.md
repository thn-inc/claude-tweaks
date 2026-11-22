---
files:
  - docs/skill-authoring.md
  - plugin/skills/review/step3-lens-dispatch.md
---

# Keep Untrusted Text Off a Command Line

**Persona:** A maintainer who writes or reviews skill prose that puts text the plugin did not write into a shell command or a paste command shown to a human. That text can be a human's free-text answer, a PR or issue body or comment, a record field, or a branch name.
**Goal:** The text reaches the command as data, never by interpolation. Any command built from untrusted parts renders only when every part matches its composer's exact grammar. Otherwise the step shows a line that is not a command.
**Entry point:** Authoring time: `docs/skill-authoring.md`'s "Untrusted text into a shell or paste command" section, read before editing `plugin/skills/**/*.md`. Review time: `/claude-tweaks:review`'s lens 3b (Security) reading the built diff.
**Success state:** At authoring time, the step passes the untrusted text in one of two ways: a `Write`-produced file fed on stdin or as a path argument, or an argv array element passed with no shell. A rendered paste command is held to an exact grammar, with a non-command fallback. At review time, lens 3b flags any untrusted text still interpolated into a shell or paste command as a security finding.

## Steps

### 1. The author finds the rule before writing the command
- **URL:** N/A (doc: `docs/skill-authoring.md`, section `## Untrusted text into a shell or paste command`)
- **Action:** The author is writing a step that feeds a human's reason, a fetched body, or a branch name into a command. They read the section. It sits beside "Passing untrusted content into an inline skill invocation", which is the LLM-turn counterpart.
- **Should feel:** Concrete. Two real incidents show the exact bad shape and its fix:
  - #4465's single-quoted `printf` of a decline reason, fixed in squash commit 9d59ce045.
  - #4423's unconstrained `### Resume` paste line, fixed in the same squash commit, 9d59ce045.
- **Should understand:** Quoting is no defense. A single quote inside the text ends a `'…'` argument, and `"…"` still expands `$(…)` and backticks.
- **Red flags:** The author wraps `{why}` in quotes and calls it safe.

### 2. The author passes the text as data
- **URL:** N/A
- **Action:** The step `Write`s the untrusted payload to a session-tmp file, then feeds it on stdin (`… < "{D}"`) or as a path argument. Code that spawns a `node` program passes it as an argv array element with no shell, which the program reads through `process.argv`.
- **Should feel:** Mechanical. A file or an argv slot never needs escaping.
- **Should understand:** `docs/donts.md`'s `process.argv` rule is the correctness half of the same advice. This rule adds the trust half.
- **Red flags:** A `printf '%s' '{…"reason":"{why}"…}' | …` line that still carries human text on the command line.

### 3. A paste command is rendered only when it matches its composer's grammar
- **URL:** N/A
- **Action:** When the step shows the user a command built from untrusted parts, it checks every part against the composer's exact shape. That means fixed literals, each slot's allowed characters stated, and nothing trailing. Example: tidy Step 4.7's Resume line, held to `plugin/bin/lib/flow/pr-body.js`'s `composeResumeLine`. If any part fails, the step shows a line that is not a command and names the item, such as "Resolve open PR N".
- **Should feel:** Safe to copy. Any command the user sees is one the plugin itself could have composed.
- **Should understand:** A PR body is untrusted even when it carries the plugin's own marker.
- **Red flags:** A rendered paste line that echoes whatever followed a heading in a PR body.

### 4. Review's lens 3b catches a missed case
- **URL:** N/A (skill step: `/review` Step 3, `review/step3-lens-dispatch.md` lens 3b)
- **Action:** The Security lens asks whether skill prose in the diff puts untrusted text on a shell command line, or into a rendered paste command, by interpolation. It flags any such case as a security finding.
- **Should feel:** Like the backstop that caught both motivating incidents. Each passed the whole-branch review and was caught only here.
- **Should understand:** The lens bullet names the safe alternatives, because a dispatched lens agent cannot read sibling files, and cites the skill-authoring section for the rule.
- **Red flags:** A diff that interpolates `{why}` or a fetched field into a command, and reaches merge with no lens 3b finding.

## Origin
- Created during build of #4595 (untrusted-text-into-command rule in `docs/skill-authoring.md` and a lens 3b check in `review/step3-lens-dispatch.md`, pinned by `tests/untrusted-text-into-command-conformance.test.js`)
- Motivating incidents: #4465 (tidy `record-decline` decline reason in a single-quoted `printf`) and #4423 (tidy Step 4.7 Resume paste line with an unconstrained tail), both caught only by review lens 3b
