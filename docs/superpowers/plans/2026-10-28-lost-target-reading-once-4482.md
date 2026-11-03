# State each gate's lost-target reading once, not in both docs/hooks.md and policy-schema-coverage.md (#4482) Implementation Plan

**Goal:** `docs/hooks.md`'s "Lost-cwd denies" bullet spells out every gate's lost-target reading, which `plugin/skills/_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph also states. Leave each gate's reading in that paragraph only, so there is one copy.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T190156-record-4482/work/4482-spec.md` (materialized from GitHub issue #4482)

---

### Task 1: Cut the docs/hooks.md bullet to the marker's contract and point the gate-exemptions skill at the one paragraph

**Files:**
- Modify: `docs/hooks.md`
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`
- Waived `plugin/skills/_shared/policy-schema-coverage.md`: read only, no change. Its "Where a relative target resolves" paragraph is the canonical statement. Every reading removed from `docs/hooks.md` must already be stated there; confirm this before cutting.

- [ ] **Step 1: Check before editing.** Confirm that each gate reading the `docs/hooks.md:15` bullet names is also stated in the coverage paragraph:
  - pipeline shadow guard
  - teardown gate
  - `worktree-always` gate, with the accepted not-opted-in gap
  - `post-tool-use.js` commit lookup
  - E1, the bookkeeping-stamps gate and the dispatch-config gate
  - the `reading` targets each gate checks

  This is a scratch check only; commit no test. The Acceptance Criteria are prose properties, and the repo keeps no conformance test that pins this bullet. Searching `tests/` for `Lost-cwd` and `Where a relative target resolves` finds nothing.
- [ ] **Step 2: Implement.**
  1. In `docs/hooks.md`, keep the bullet's heading `**Lost-cwd denies (block tier, #4303):**` and the `lost` marker's contract:
     - the `CWD_SET_CAP` loss, the `lost: true` marker beside the stand-in path, `rel` for writes and `mkdir`
     - the second walk as base d9aa6b82d walked it, whose new targets come back as known targets marked `reading`
     - `subject` on a lost commit
     - how a handler walk opts in: `resolveGitCommand`'s `lost` field and `keepLost`

     Keep the sentence saying a stand-in is no path bash is known to be in, so a deny on the marker is a deliberate exception to "ambiguity resolves to allow". Remove every clause that names what an individual gate does with a `lost` or `reading` target: the shadow guard, the teardown gate, the `worktree-always` gate and its accepted gap, `post-tool-use.js`, E1, the bookkeeping-stamps gate and the dispatch-config gate. Replace them with one pointer: each gate's reading is stated once, in `plugin/skills/_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph, and is not restated here. This mirrors line 6's `[IL-93]` rule.
  2. In `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`'s `lost`-target bullet (line 34), name `_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph as the one place to record a new gate's reading. Drop the instruction to also add it to `docs/hooks.md`'s bullet. Reword the closing #4303 sentence ("whose reading neither file stated") so it no longer implies two files.
- [ ] **Step 3: Run.**
  - Re-read both edited passages against the Acceptance Criteria. `docs/hooks.md` names no individual gate's lost-target reading, and the skill names one place.
  - Run `grep -n "shadow guard\|teardown\|post-tool-use\|bookkeeping-stamps\|dispatch-config" docs/hooks.md` and confirm no hit is in the Lost-cwd bullet. Other bullets may legitimately name these gates.
  - Run the focused suite `node --test tests/hooks-gate-coverage.test.js`. The full suite runs once at Common Step 5.
- [ ] **Step 4: Commit.** Make one commit, `Cut docs/hooks.md's lost-cwd bullet to the marker contract — each gate's reading stated once in policy-schema-coverage.md, refs #4482`.

---

## Self-review

- **Spec coverage:** Step 2.1 covers Deliverable 1 and AC 1. Step 2.2 covers Deliverable 2 and AC 2. Common Step 5's full `npm test` covers AC 3.
- **Placeholders:** none.
