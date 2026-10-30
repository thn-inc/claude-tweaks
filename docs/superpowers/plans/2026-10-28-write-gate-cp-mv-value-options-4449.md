# Write gate misreads cp/mv value-taking options (-S/--suffix) (#4449) Implementation Plan

**Goal:** The cp/mv operand loop in `plugin/bin/lib/hooks/git-command.js` skips the value of a value-taking option, so `cp a b -S .bak` resolves `b`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T211630-record-4449/work/4449-spec.md` (materialized from GitHub issue #4449)

**Probed facts (this host, bash 3.2):** GNU `gcp a b -S .bak`, `gcp a b --suffix .bak` and `gmv a b -S .bak` write `b` (plus the backup `b.bak`). macOS BSD `/bin/cp` and `/bin/mv` stop option parsing at the first operand, so `-S` and `.bak` are operands and they write `.bak/a` and `.bak/b`. `cp --suffix -t X a` already resolves `a` at base (#4303's `explicitTargetDir` skips a long option's value), so AC2 needs only a pin.

---

### Task 1: Skip value-taking option values in the cp/mv operand loop

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (the `cp`/`mv` branch of `fileWriteTargets`)
- Test: `tests/hooks-gate-coverage.test.js`

- [ ] **Step 1: Failing test.** In `tests/hooks-gate-coverage.test.js`, next to the #4303 cp/mv blocks, add a #4449 block:
  - `cp a b -S .bak`, `cp a b --suffix .bak`, `cp a b --suf .bak`, `mv a b -S .bak` and `cp a b -bS .bak` each report `/r/b` (the GNU reading) and also the last word (the BSD reading). Assert that the file list deep-equals `[GNU destination, BSD destination]`.
  - `cp --suffix -t X a` resolves exactly `/r/a` (AC2's exact shape, a pin).
  - `cp -S .bak a b` and `cp a b --suffix=.bak` still resolve exactly `/r/b`, because the two readings agree there.
  Run `node --test tests/hooks-gate-coverage.test.js`. Expected: FAIL on the operand-value rows.
- [ ] **Step 2: Implement.** In the `cp`/`mv` branch, add a GNU operand list that applies `explicitTargetDir`'s skip rules: `--` ends options; a long word with `takesLongValue(a, t[0])` skips the next word; a short cluster whose `readShortCluster(a, 'St')` value is `null` skips the next word. With no `-t` resolved, report the GNU last operand (when there are at least 2 operands). Then report the existing loop's last non-flag word (the BSD reading) when it differs.
- [ ] **Step 3: Run.** Run the Step 1 test file and `tests/hooks-*.test.js`. Expected: PASS. Then run a mutant for each rule and confirm it turns red:
  - drop the short-cluster skip;
  - drop the `takesLongValue` skip in the new loop;
  - drop `explicitTargetDir`'s `takesLongValue` skip (AC2);
  - drop the BSD-reading report.

  Restore the code after each mutant.
- [ ] **Step 4: Commit.** Make one commit with the message `Skip cp/mv option values in the write gate's operand loop — refs #4449`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (skip `-S`/`--suffix`/`--suffix=` and the other cp/mv value options in the operand loop and `explicitTargetDir`) is Step 2. `explicitTargetDir` already skips them, and Step 1 pins that.
  - Deliverable 2 (pin both shapes) is Step 1.
  - Each AC has a test row in Step 1, and Step 3 runs the mutants and the scanner suites.
- **Placeholders:** none.
