---
files:
  - tests/bin-lib/cli-entry-conformance.test.js
  - .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
  - plugin/bin/resolve-policy.js
---

# Act on a Red CLI Entry Conformance Scan

**Persona:** A claude-tweaks plugin maintainer who has just added a top-level `plugin/bin/*.js` CLI, or converted an existing one to the in-process entry contract, and sees `tests/bin-lib/cli-entry-conformance.test.js` go red in `npm test`.
**Goal:** Get the CLI's entry into the contract's shape, or take its name off the exemption list once it is, so the scan is green and the list of unconverted CLIs only shrinks.
**Entry point:** `npm test` (or `node --test tests/bin-lib/cli-entry-conformance.test.js`) reports one of:
- `<file> breaks the CLI entry contract:` followed by one offence per line
- `<file> now conforms — delete it from NOT_YET`
- a failure in `AC9.4: NOT_YET holds 27 existing files, sorted, without duplicates`
**Success state:** The scan passes: every top-level `plugin/bin/*.js` either meets the three entry rules or is still named in `NOT_YET`, and `NOT_YET` names only files that exist and do not conform.

## Steps

### 1. Read which side of the ratchet failed
- **URL:** the failing assertion's message in the test run.
- **Action:** Tell the two messages apart. `breaks the CLI entry contract` is about a file that is not on `NOT_YET` and has offences. `now conforms — delete it from NOT_YET` is about a file that is on the list and has none.
- **Should feel:** Unambiguous. The message names the file and, for a breaking file, each rule it breaks with a line number.
- **Should understand:**
  - The scan reads every `*.js` file directly in `plugin/bin` as text (no recursion into `plugin/bin/lib`), with comments stripped.
  - The offences are: `exports no run`; `no require.main === module guard`; `process.exitCode above the guard (line N)` and `process.exit( above the guard (line N)`, counted against the last guard line in the file; a comment-stripper verdict other than `ok`; and `guard blanked by the stripper`.
- **Red flags:** A message that the walk saw fewer than 120 files. The scan stopped seeing `plugin/bin/*.js`; fix the walk, never lower the floor.

### 2. A file breaks the contract: fix the CLI's entry
- **URL:** the named CLI under `plugin/bin/`, and the entry-contract bullet in `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`.
- **Action:** Give the file the contract's shape: export `run(argv, deps)` and `realDeps`, and make the last statement `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. Move every `process.exitCode` assignment and `process.exit(` call above that line into a returned exit code.
- **Should feel:** Like following a worked example. `plugin/bin/resolve-policy.js` shows the whole shape, including a core that returns an object and a `run` that only prints it.
- **Should understand:** The rule exists so a test can call the CLI inside its own process through `tests/helpers/run-cli.js`. A `process.exit()` there would end the test run, and a `process.exitCode` set there would leak into it.
- **Red flags:**
  - Adding a new CLI to `NOT_YET` to get to green. The list only shrinks; a new CLI conforms from its first commit.
  - A `process.exit(` inside a string or template literal above the guard is flagged too, because the stripper keeps literals. Reword the literal or build it from parts.

### 3. A file now conforms: delete its line
- **URL:** the `NOT_YET` array near the top of `tests/bin-lib/cli-entry-conformance.test.js`.
- **Action:** Delete the converted CLI's line, and lower the count in `AC9.4` (`assert.strictEqual(NOT_YET.length, 27)`) by the number of lines removed. Keep the list sorted.
- **Should feel:** Like ticking an item off. The list is the count of CLIs still to convert.
- **Should understand:** `AC9.4` also fails when the list is unsorted, holds a duplicate, or names a file that no longer exists in `plugin/bin`, so a renamed or deleted CLI is removed here as well. `hooks.js` leaves the list through #5377, as a named exemption with its reason kept apart from `NOT_YET`.
- **Red flags:** Leaving a conforming file on the list "to be safe". The scan fails on exactly that, by design.

### 4. Re-run and confirm
- **URL:** the scan.
- **Action:** Run `node --test tests/bin-lib/cli-entry-conformance.test.js`.
- **Should feel:** Mechanical. All tests pass, including the self-tests that plant each offence and expect it flagged on its exact line.
- **Should understand:** The self-tests run through the same `checkEntry` as the walk, and one of them repeats the verdict on a CRLF copy of the text, so a green run on a Windows checkout means the same thing.
- **Red flags:** A self-test fails after you edited a rule. The rule no longer flags the shape it names; fix the rule, and keep the self-test.

## Origin
- Created during build of #5374, which added the scan with a `NOT_YET` list of 27 files and wrote the entry contract into `cli-wrapper-contract.md`.
- Related: `call-a-plugin-bin-cli-in-process-from-a-test-5374.md` (what the contract makes possible), `act-on-a-red-strip-comments-caller-pin-4008.md` (the scan's stem is on that pin's caller lists).
