# Bound the shell-scanner differential recipe so a real write shape cannot outlive its run and fill the disk (#4391) Implementation Plan

**Goal:** The `shell-scanner-bash-differential` skill's "bash verdict" recipe runs each shape with no timeout, no file-size cap, no process group and the real PATH after the stubs, so a real write shape can outlive its run and fill the disk. Bound it.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T094256-record-4391/work/4391-spec.md` (materialized from GitHub issue #4391)

---

### Task 1: Bound the bash-verdict recipe and record the incident

**Files:**
- Modify: `.claude/skills/shell-scanner-bash-differential/SKILL.md`
- Test: scratchpad driver + check scripts (scratch only — the repo keeps no tests for project-skill prose recipes)

- [ ] **Step 1: Failing test** — write a scratch check script that runs the driver on `dd if=/dev/zero of=f1`, `cat a f1 > f1`, `dd if=/dev/zero of=f1 &`, under `/bin/bash` and bash 5, and asserts: ends within the timeout, no PPID-1 leftover in `ps -ax -o ppid,command`, `f1` at or under the cap; plus a SIGTERM-the-driver case and a SIGKILL-the-driver case (cap backstop).
- [ ] **Step 2: Implement** — write the bounded driver (`ulimit -f` in the `bash -c` prefix, `detached: true` process group, wall-clock timeout, group kill on timeout / bash exit / driver exit, `stdio: ['ignore', …]`, `PATH: stubDir` only with explicitly linked real tools); copy its text into the skill's Common Operations; add the Anti-Patterns row for the 2026-10-26 incident; add the leftover check.
- [ ] **Step 3: Run** the check script from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4391`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (cap, process group + timeout + group kill + closed stdin, stub-only PATH + linked-tool list, Anti-Patterns row, leftover check) and every `## Acceptance Criteria` item (dd, cat, backgrounded dd, SIGTERM, recipe copied from the working script) is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
