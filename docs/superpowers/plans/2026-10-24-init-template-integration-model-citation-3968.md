# Init template cites a repo-relative plugin path in the Integration model paragraph (#3968) Implementation Plan

**Goal:** Change the Integration model paragraph's citation from the repo-relative `plugin/skills/_shared/integration-model.md` to the plugin-relative `_shared/integration-model.md` in both the `/init` CLAUDE.md template and this repo's CLAUDE.md, keeping the two `## claude-tweaks Pipeline` sections byte-identical.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061142-record-3968/work/3968-spec.md` (materialized from GitHub issue #3968)

---

### Task 1: Make the Integration model citation plugin-relative in the template and CLAUDE.md

**Files:**
- Modify: `plugin/skills/init/claude-md-template.md`
- Modify: `CLAUDE.md`
- Test: `tests/bin-lib/init/claude-md-conformance.test.js` (existing — run only, no edit)

- [ ] **Step 1: Failing test** — none to add. The acceptance criteria are covered by the existing live conformance test, which must keep passing, and by a grep that currently finds the citation. Confirm the grep finds it now: `grep -n 'plugin/skills/' plugin/skills/init/claude-md-template.md`. Expected: one hit at the `**Integration model**` line.
- [ ] **Step 2: Implement** — in both files, replace the exact substring `**Integration model** (\`plugin/skills/_shared/integration-model.md\`)` with `**Integration model** (\`_shared/integration-model.md\`)`. Change nothing else on that line or in either file.
- [ ] **Step 3: Run** — `grep -n 'plugin/skills/' plugin/skills/init/claude-md-template.md` (expected: no output, exit 1) and `node --test tests/bin-lib/init/claude-md-conformance.test.js` (expected: PASS, 0 failures).
- [ ] **Step 4: Commit** — one commit staging only those two files, with the message `Make init template's Integration model citation plugin-relative — consumer projects have no plugin/skills/ tree` and the trailer `refs #3968`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (citation change in both files, byte-identical) is Task 1 Step 2. Deliverable 2 (conformance test still passes; repo grep for other consumer-facing template text citing `plugin/skills/`) is Step 3. The repo-wide grep ran at plan time: `plugin/skills/specify/spec-template.md` is the only other `*template*` file that mentions `plugin/skills/`. It uses the path only as an illustrative bare-directory example and an incident citation in authoring guidance. That text is never written into consumer projects, so it needs no change. AC 1 (the grep finds nothing) and AC 2 (the conformance test passes) are both Step 3.
- **Placeholders:** none.
