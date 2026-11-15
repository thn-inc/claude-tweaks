---
files:
  - plugin/bin/lib/hooks/harness-refusal.js
  - plugin/bin/lib/hooks/post-tool-use-failure.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - tools/upstream-drift/manifest.yml
  - tools/upstream-drift/manifest.js
  - tools/upstream-drift/checks.js
  - tools/upstream-drift/run.js
  - tests/harness-refusal-drift-pin.test.js
---

# Notice a Reworded Isolation Refusal

**Persona:** the claude-tweaks maintainer. Claude Code auto-updated overnight. They run the upstream-drift sweep before trusting the next week's reflect Friction Lens numbers.
**Goal:** if the new Claude Code reworded the worktree-isolation Bash refusal that `post-tool-use-failure.js` matches, the sweep says so. The alternative is `wd-guard-refusal` events quietly dropping to zero and friction reports reading as a clean week.
**Entry point:** `/upstream-drift --dep claude-code` (or `node tools/upstream-drift/run.js due --dep claude-code`) on a machine where `claude` is installed.
**Success state:** an unchanged refusal yields no drift finding. A reworded refusal yields an `assertion-drift` finding that names `plugin/bin/lib/hooks/harness-refusal.js` and the literal that stopped matching. The maintainer updates that one module and the manifest's must-match values together, and the pin test keeps them in lockstep.

## Steps

### 1. Run the sweep after a Claude Code update: main checkout
- **URL:** `/upstream-drift --dep claude-code`
- **Action:** the maintainer runs the sweep. `checkVersion` reads `claude --version` against the `floor` pin. `checkAssertions` resolves the installed binary through `readlink -f "$(command -v claude)"` and searches its raw bytes, without decoding, for nine literals:
  - five refusal fragments: `noun:"This session"`, `noun:"This agent"`, ` is isolated in the worktree `, `Refusing to run it` and `Refusing to run there`;
  - four anchors unique to the templates the hook matches: the git-operations `Refusing to run it` + escaped-dash form, `Refusing to run it there`, the fixed worktree-gone `Refusing to run there` + escaped-dash form, and the noun worktree-gone `outside that worktree. Refusing to run there.`.
- **Should feel:** routine and quick. A minute's wait while it reads a ~268 MB binary a few times, then a short report.
- **Should understand:** claude-code never reports `upgrade-available`: the entry sets `report-upgrades: false`, because Claude Code ships near daily and the assertions, not the version, carry the signal. Without `claude` installed (CI) the entry reports `absent` and skips its assertions, never a false drift.
- **Red flags:**
  - every claude-code assertion turns `unmatched` at once. That more likely means the bundler changed its escape form, or `claude` now resolves to a wrapper script, than that the wording changed. Read the binary before editing anything;
  - the sweep runs out of memory reading the binary.

### 2. Read a drift finding: the sweep's report
- **URL:** the `assertion-drift` finding (or its filed `by:upstream-drift` issue)
- **Action:** a finding names `plugin/bin/lib/hooks/harness-refusal.js`, the claim, and the literal that is no longer present.
- **Should feel:** pointed. One file to open and one literal to re-derive, not a hunt through two hooks.
- **Should understand:** a template-anchor finding with all five fragments still `ok` is the targeted case. Claude Code changed the refusal the hook depends on while the bare phrases survive in unrelated messages. Matching is literal substring search, so it cannot prove how a message is assembled. A change that keeps every asserted literal somewhere in the binary still passes.
- **Red flags:** a fragment finding with every template anchor still `ok`. That usually means a shared phrase moved, not that the refusal changed. Confirm against a real refusal before editing the constant.

### 3. Re-derive the wording and update in one place: a branch
- **URL:** `plugin/bin/lib/hooks/harness-refusal.js`, `tools/upstream-drift/manifest.yml`
- **Action:** the maintainer captures a real refusal from the new Claude Code and updates the fragment constants. `HARNESS_ISOLATION_REFUSAL_RE`, `classifyRefusal` and the prefilter's `REFUSAL_SIGNATURES` all follow automatically. They then update the claude-code entry's must-match values to match.
- **Should feel:** a one-file code change plus its manifest twin, with the test suite saying when the two disagree.
- **Should understand:** `tests/harness-refusal-drift-pin.test.js` fails until every fragment in `REFUSAL_FRAGMENTS` appears in some claude-code must-match. `tests/hooks-harness-refusal.test.js` pins the regex source, so a wording change also updates that expectation deliberately. `plugin/skills/reflect/full-mode.md`'s transcript-grep literals are pinned to `REFUSAL_SIGNATURE` and `WORKTREE_GONE_SIGNATURE` too.
- **Red flags:**
  - the regex or the signature is edited inline in `post-tool-use-failure.js` or `bash-prefilter.js`. The one-place test rejects that;
  - the manifest is updated but the constant is not, or the reverse.

## Origin
- Created during build of #3304 (the drift check for the refusal wording #2783's hook matches)
- Steps 1-3 built in this session
- Related specs: #2783 (the post-tool-use-failure hook), #3074 (the Bash prefilter's refusal signature gate)
- Updated during build of #3820: step 1 now reflects the claude-code entry's `report-upgrades: false` opt-out (validated in `manifest.js`, honored by `run.js`'s `hasUpgrade`), so a version lag alone is neither a finding nor a reason the entry is due
- Updated during build of #3819: step 1 now asserts nine literals (the `This agent` noun, the worktree-gone `Refusing to run there` signature and its two template anchors added), and step 3 names `classifyRefusal` and `REFUSAL_SIGNATURES`
