---
files:
  - plugin/bin/lib/skill-audit/budgets.js
  - plugin/bin/lib/skill-audit/rail.js
  - tests/bin-lib/skill-audit/context-cost.test.js
  - tests/bin-lib/skill-audit/budgets.test.js
---

# Act on a Red Read-Limit Rail Test

**Persona:** A claude-tweaks plugin maintainer. Their branch grows a skill file, a `_shared/*.md` source, or a skill description, and `npm test` goes red on a test whose name starts with `rail`.
**Goal:** Understand which file or bundle no longer fits a single Read call, see why that is a real platform limit rather than an arbitrary budget, and shrink the right thing.
**Entry point:** `npm test` (or `node --test tests/bin-lib/skill-audit/context-cost.test.js`) reports `not ok … rail: …`.
**Success state:** The maintainer splits or fences the named file or bundle until the rail test passes. They never raise the rail or add an exception, because the rail tracks the Read tool's own cap.

## Steps

### 1. Read which rail failed
- **URL:** the failing test in `tests/bin-lib/skill-audit/context-cost.test.js`.
- **Action:** Read the test name and its assertion message.
- **Should feel:** Unambiguous. The test name says which kind of object overflowed, and the diff lists each offender with its measurement.
- **Should understand:** There are three rail tests:
  - `rail: every shipped skill .md fits one Read call (bytes and lines)` lists `{file} {bytes} B, {lines} lines` for each skill file over 52,500 measured bytes or 2,000 lines.
  - `rail: every compose call site's max composed bytes fit one Read call` lists `{step} @ {file}:{line} {bytes} B`, or the call site's error when it could not be measured.
  - `rail: every skill description fits the CLI listing max` lists `{skill} ({chars} chars)` over 1,536 characters.

  The offender lists come from `plugin/bin/lib/skill-audit/rail.js`, the same mapping harness-health will use. Bytes are measured CRLF-normalized with `when:` marker lines stripped. Lines are counted the way Read counts them.
- **Red flags:**
  - An offender line with no byte or line count.
  - A compose call site reported over the rail with no `step @ file:line`.
  - A rail test that passes while a call site's sources are missing. An unmeasured bundle must fail.

### 2. See why the limit is real
- **URL:** `plugin/bin/lib/skill-audit/budgets.js`'s header comment.
- **Action:** Read the calibration block and the margin paragraph.
- **Should feel:** Like a measurement, not an opinion. The header gives the CLI version, the date, three samples with their token counts, and the Read tool's own paged-view message.
- **Should understand:**
  - Read's cap is 25,000 tokens and 2,000 lines.
  - A file over the cap cannot be read in one call: Read 2.1.302 shows only the first page plus a total-token count.
  - The byte rail is the token cap times a calibrated 2.1 bytes per token, the densest of three measured samples.
  - The rail sits at the cap with no percentage margin, and the header names what that leaves unabsorbed: tokenizer drift, marker lines, and a denser-than-sampled file.
- **Red flags:**
  - Editing `RAIL_RATIO` or `BYTES_PER_TOKEN` to make the test pass. The `BYTES_PER_TOKEN` test in `budgets.test.js` pins `2.1` and says to re-run the calibration instead. Its go-red fixtures show each rail failing one unit over its limit.
  - Adding a per-file exception list.

### 3. Shrink the right thing
- **URL:** the offending file, or the sources named in the compose call site's `--step` line.
- **Action:** Split an independent procedure into its own lazily read sub-file, or fence branch-specific text with `when:` markers so the composed bundle drops it.
- **Should feel:** Like a real reduction. What one Read must load gets smaller, not just the file's size.
- **Should understand:**
  - A skill file over the rail must lose bytes or lines that one Read pays for.
  - A bundle over the rail must drop text from the combination that composes largest.
  - A description over 1,536 characters is truncated in the CLI's skill listing, so trim prose and keep the selection keywords.
  - Re-running `node --test tests/bin-lib/skill-audit/context-cost.test.js` confirms the fix.
  - The `rail diagnostic:` line printed by the same suite reports the corpus-wide description total against the listing budget (8,000 chars at 200k context, 40,000 at 1M). It never fails the suite.
- **Red flags:**
  - A "read X now" split that moves bytes into a sibling every invocation still loads.
  - Treating the `rail diagnostic:` line as a failure.
  - Shrinking a file the failing test did not name.

## Origin
- Created during build of #3306 (the Read-limit rail and `budgets.js`, the expand step of parent #3305's strangler-fig rollout). #3310 cuts every size consumer over to the rail; the older size and description-ceiling gates still run alongside it until #3311 removes them.
- Updated during build of #3311: the older gates are gone, so the rail is the only size limit. `tests/skill-size-single-source.test.js` now fails on any per-file size pin (`act-on-a-red-skill-size-guard-3311.md`).
- Related: `measure-composed-bytes-per-call-site-1990.md` (the composed-bytes gate whose enumeration the composed rail reuses), `read-a-size-outlier-in-the-bloat-scan-3308.md` (the advisory size signal, which never blocks).
