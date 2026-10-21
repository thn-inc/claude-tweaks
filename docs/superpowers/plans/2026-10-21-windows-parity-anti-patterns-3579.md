# Windows Test-Parity Anti-Patterns (#3579) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Windows test-parity anti-pattern rows to the project-local `windows-checkout-test-parity` skill's Anti-Patterns table.

**Architecture:** A doc-only edit to one maintainer-side skill file (`.claude/skills/`, outside the shipped `plugin/` payload). The four rows go in as one contiguous block directly after the `Mapping every spawn throw…` row. That keeps them clear of the table's tail, where open PRs #3569/#3540 append rows.

**Tech Stack:** Markdown; verification with `grep` and `npm test` (`node --test`).

**Spec:** `.claude-tweaks/pipelines/2026-10-21T155238-record-3579/work/3579-spec.md` (materialized from GitHub issue #3579)

## Global Constraints

- Edit only `.claude/skills/windows-checkout-test-parity/SKILL.md`. No other file changes.
- Insert the four rows directly after the row that begins `| Mapping every spawn throw to a "not installed" or "not found" verdict |` (currently line 157), before the `| Passing a literal \`/bin/sh\`` row.
- Each row's claims must stay accurate against the files it cites. All were verified at plan time (see "Verified facts" below), so insert the rows verbatim.
- Do not add a `chmod 0o000` row. That row already exists (the `Simulating an unreadable file or directory with \`fs.chmodSync(path, 0o000)\`` row, currently line 169; #3540 merged).

## Verified facts (plan-time probes, base `b0620afac`)

- `tests/bin-lib/timing/cli.test.js:22-24` defines `fixtureHomeEnv(home)`. It drops `CLAUDE_CONFIG_DIR` and sets both `HOME` and `USERPROFILE`.
- `tests/statusline.test.js:1052-1056` records `os.homedir()` reading `USERPROFILE` on Windows.
- `PATH_STUB_SKIP` is defined in `tests/bin-lib/reconcile/pr-state.test.js:14` and `tests/bin-lib/reconcile/release-merged.test.js:15`. `pr-state.test.js:13` uses `REPO_ROOT = os.tmpdir()`.
- `tests/bin-lib/console/residue.test.js`: commit `1ed26d947` (Fixes #3440/#3505/#3506) changed the `(spec-12/console.json)` and `(spec-2/console.json)` literals to `path.join` forms. The producer builds those values with `path.relative` (`plugin/bin/lib/console/residue.js:108,113`).

## Review Focus

- **Row placement:** a row inserted at the table's tail instead of mid-table conflicts with #3569/#3540. The `grep -n` line numbers in Step 3 must fall between the `Mapping every spawn throw` row and the `/bin/sh` row.
- **Table integrity:** a row with a stray or missing `|`, or a blank line inside the table, breaks the markdown table for everything below it. Step 3 checks that the table is still contiguous.
- **Duplicate chmod row:** covered by Global Constraints and checked in Step 3.

---

### Task 1: Insert the four anti-pattern rows

**Files:**
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md:157` (insert after this line)

**Interfaces:**
- Consumes: none
- Produces: none (doc-only)

- [ ] **Step 1: Confirm the rows are absent (expected FAIL of AC1)**

Run: `grep -c -e "fixture home with" -e "script named" -e "POSIX literal such as" -e "Fixing only the assertions" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: `0`

- [ ] **Step 2: Insert these four lines verbatim, immediately after the `| Mapping every spawn throw …` row**

```markdown
| Pointing a spawned child at a fixture home with `HOME` alone (`env: { ...process.env, HOME: home }`) | `os.homedir()` reads `USERPROFILE` on win32, so the child searches the runner's real profile and every transcript lookup reports "not found". Set both keys to the fixture home, and drop an inherited `CLAUDE_CONFIG_DIR` so a developer's own config dir cannot redirect the lookup: `tests/bin-lib/timing/cli.test.js`'s `fixtureHomeEnv` (#3440; `tests/statusline.test.js` records the same behavior) |
| A test that puts a `#!/bin/sh` script named `gh` on `PATH` to fake the CLI | `execFileSync('gh')` never spawns an extensionless script on win32, so the test fails there for a reason that has nothing to do with the code under test. Skip every test that writes such a stub with one per-file constant that states the reason (`PATH_STUB_SKIP` in `tests/bin-lib/reconcile/pr-state.test.js` and `release-merged.test.js`, #3506), and leave the tests that remove `gh` from `PATH` running: they pass on Windows. Judge each test by whether it writes a stub, not by its title |
| Passing a POSIX literal such as `'/tmp'` as a spawn `cwd` or `repoRoot` | The directory does not exist on Windows, so the spawn fails with `ENOENT` and reads as a missing binary. Take a real directory from the OS: `os.tmpdir()` (#3506). A deliberately nonexistent path stays literal when the test is about that case |
| Fixing only the assertions a failure excerpt or a spec names | The filer's excerpt shows the first failing tests, and a spec written from it can miss siblings with the same shape. #3505's spec listed five `${dir}/…` lines in `tests/bin-lib/console/residue.test.js`; the first `windows-latest` run on the branch still failed two more in that file (`(spec-12/console.json)` and `(spec-2/console.json)`, built with `path.relative`). Grep the whole file for the separator literal, and read the per-file isolated log of a dispatched `windows-regression.yml` run on the branch before calling the fix done |
```

- [ ] **Step 3: Verify AC1.1–AC1.4, placement, the chmod non-duplicate, and table integrity**

Run each command, one per call:
- `grep -n "fixture home with" .claude/skills/windows-checkout-test-parity/SKILL.md` (AC1.1). Expected: exactly one line.
- `grep -n "script named" .claude/skills/windows-checkout-test-parity/SKILL.md` (AC1.2). Expected: exactly one line.
- `grep -n "POSIX literal such as" .claude/skills/windows-checkout-test-parity/SKILL.md` (AC1.3). Expected: exactly one line.
- `grep -n "Fixing only the assertions" .claude/skills/windows-checkout-test-parity/SKILL.md` (AC1.4). Expected: exactly one line.
- `grep -n -e "Mapping every spawn throw" -e "Passing a literal \`/bin/sh\`" .claude/skills/windows-checkout-test-parity/SKILL.md`. Expected: the four new rows' line numbers fall strictly between these two.
- `grep -c "chmodSync(path, 0o000)" .claude/skills/windows-checkout-test-parity/SKILL.md`. Expected: `1`.
- `awk '/^## Anti-Patterns/{f=1;next} /^## /{f=0} f && NF && !/^\|/' .claude/skills/windows-checkout-test-parity/SKILL.md`. Expected: no output. A printed line is non-blank text inside the Anti-Patterns section that is not a table row.

- [ ] **Step 4: Verify AC2 (every cited file exists)**

Run: `ls tests/bin-lib/timing/cli.test.js tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/console/residue.test.js tests/statusline.test.js`
Expected: all five paths listed, no "No such file".

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/windows-checkout-test-parity/SKILL.md
git commit -m "Add four Windows test-parity anti-patterns to windows-checkout-test-parity — HOME-only fixture home, gh PATH stub, /tmp literal, excerpt-only fixes

refs #3579"
```

AC3 (`npm test` passes) runs centrally in /build's Common Step 5 and /test, not in this task.

---

## Self-review

- **Spec coverage:** Deliverable 1 is covered by Task 1 Steps 2–3. Deliverable 2 (chmod row) is covered by Global Constraints, the Step 3 chmod grep, and the PR note. AC1 → Step 3, AC2 → Step 4, AC3 → central verification.
- **Placeholders:** none.
- **Proportion:** one task, one file, rows supplied verbatim by the spec.
