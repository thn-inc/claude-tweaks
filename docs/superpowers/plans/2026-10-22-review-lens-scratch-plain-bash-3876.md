# Tell review lens agents to write scratch probes as one plain Bash call each (#3876) Implementation Plan

**Goal:** `plugin/skills/review/step3-lens-dispatch.md`'s Scratch path paragraph tells a lens agent that each scratch create/delete step is its own plain Bash call: no `&&`/`;` chaining, and no shell variable carried between calls (a literal absolute path each time), citing `_shared/scratch-worktree.md` §7.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T121139-record-3876/work/3876-spec.md` (materialized from GitHub issue #3876)

**Base-state note:** #3675 already added the one-plain-command recipe (`mkdir -p` / write / `rm` each its own call, no heredoc or `&&` chain) and the §7 citation to this paragraph. The remaining gap against the Deliverables is `;` chaining and the shell variable carried between calls, which is the exact `S="…" && mkdir -p "$S"` shape #3809's lens agents were refused on.

**Headroom:** the file is 51,044 bytes against the 52,500-byte `RAIL_BYTES` rail (97%). Keep the inserted clause under ~300 bytes; no other edits to the file.

---

### Task 1: State "no `;` chain, no carried shell variable, literal absolute path" in the Scratch path paragraph

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (Scratch path paragraph, the `**Scratch path (per dispatch).**` blockquote line)
- Test: `tests/subagent-contract-clauses.test.js` (next to the #3675 Scratch path citation test)

- [ ] **Step 1: Failing test** — add a test asserting that `scratchPathParagraph(lens)` includes the literal phrases `no shell variable carried between calls` and `literal absolute path`, and mentions a `;` chain. Run: `node --test tests/subagent-contract-clauses.test.js`. Expected: FAIL (the phrases are absent at base).
- [ ] **Step 2: Implement** — right after the pinned `SHELL_SAFE_RECIPE` fragment (`…which the harness Bash guard refuses by shape`) insert one clause saying there is no `;` sequence either and no shell variable carried between calls: every call spells out the scratch path as a literal absolute path (never `S={path} && mkdir -p "$S"`). Leave the verbatim recipe fragment, the `_shared/subagent-dispatch-core.md` rule citation and the `_shared/scratch-worktree.md` §7 citation byte-identical.
- [ ] **Step 3: Run** `node --test tests/subagent-contract-clauses.test.js`. Expected: PASS.
- [ ] **Step 4: Commit** — one commit: `Tell review lens agents to name scratch paths literally — no ; chain or carried shell variable, refs #3876`.

---

## Self-review

- **Spec coverage:** the Deliverable (separate plain Bash calls, no `&&`/`;` chaining, no carried shell variable, absolute paths each time, §7 citation) and the single Acceptance Criterion (states each create/delete is its own plain call with no chaining, cites §7) are both covered by Task 1. The parts already on base are preserved verbatim, and Step 1's test pins the newly added parts.
- **Placeholders:** none.
