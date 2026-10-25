# skill-prose-conformance-tests skill: add the roster-coverage pin pattern (#4185) Implementation Plan

**Goal:** Teach `.claude/skills/skill-prose-conformance-tests/SKILL.md` the roster-coverage pin pattern — a forward sweep that every live site is listed plus a reverse check that every listed site still exists — citing both instance tests by path.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T121000-record-4185/work/4185-spec.md` (materialized from GitHub issue #4185)

**Premise correction (logged to decisions.md):** only `tests/timing-nested-parent-roster.test.js` carries both halves (its second test fails on a stale `NESTED_PARENT` key). `tests/ceremony-profile-roster.test.js` carries the forward sweep and pins its skip-tag list exactly, but has no reverse check — a `Mentions that are not skips` row whose line is gone stays green. The prose must say so rather than claim both tests carry both halves.

---

### Task 1: Add the roster-coverage Decision Framework row and Reference citations, pinned by a test

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/SKILL.md`
- Test: `tests/skill-prose-roster-coverage-pin.test.js` (Create)

- [ ] **Step 1: Failing test** — create `tests/skill-prose-roster-coverage-pin.test.js` (read the skill via `tests/helpers/read-skill.js`'s `readText`). It must:
  - Slice the `## Decision Framework` section by its own start and end anchors (assert both resolve — the end anchor is `\n## Project Conventions`) and select the one table row containing `` `tests/timing-nested-parent-roster.test.js` `` (assert exactly one such row in the section).
  - Assert, via a missing-facts predicate returning `[]` on the live row, that the row names the pattern (`forward sweep`, `reverse staleness check`) and cites both `` `tests/timing-nested-parent-roster.test.js` `` and `` `tests/ceremony-profile-roster.test.js` ``.
  - Slice the `## Reference` section (to end of file) and assert it cites both paths.
  - Assert every `tests/*.test.js` path cited in that row and in the Reference section exists on disk (`fs.existsSync` from repo root), and that at least two were found (non-empty haystack).
  - Go-red proofs, in memory only: strip each fact from the row and assert the predicate returns exactly `[fact]` (with `assert.notStrictEqual` on the doctored text); swap one cited path for the nonsense token `tests/zzz-no-such-roster-4185.test.js` and assert the existence check reports exactly that path.
  - Run: `node --test tests/skill-prose-roster-coverage-pin.test.js` — Expected: FAIL (the row and Reference citations do not exist yet).
- [ ] **Step 2: Implement** — in `SKILL.md`:
  - Insert one Decision Framework row directly after the row beginning `| How many places still carry a clause, block, or snippet |`:
    `| A roster — a tag table, registry, or allowlist — that must name every live site of a pattern across the corpus | Pin both directions. The forward sweep walks the live corpus and fails on any site the roster does not name; the reverse staleness check fails on any roster entry with no live site left, which otherwise rots into covering nothing while the roster still reads as complete. `tests/timing-nested-parent-roster.test.js` (#2030) carries both halves: every `/claude-tweaks:{name}` call site must be a `PHASES` member, a `NESTED_PARENT` key, or an `ALLOWLIST` mention, and every `NESTED_PARENT` key must still be invoked somewhere. `tests/ceremony-profile-roster.test.js` (#1926) carries the forward sweep (every fast-lane skip line has a roster tag or a rostered Mentions row) and pins the tag list exactly, but has no reverse check, so a Mentions row whose line is gone stays green. An exemption list needs the same reverse half — see "An allowlist entry owes a stale-check of its own" |`
  - Add one bullet to the `## Reference` section, after the `- Instances:` bullet:
    `- Roster-coverage pin instances: `tests/timing-nested-parent-roster.test.js` (forward sweep plus reverse staleness check), `tests/ceremony-profile-roster.test.js` (forward sweep only)`
- [ ] **Step 3: Run** `node --test tests/skill-prose-roster-coverage-pin.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit: `Add roster-coverage pin pattern to skill-prose-conformance-tests — forward sweep plus reverse staleness, both instance tests cited (refs #4185)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (Decision Framework row, both directions) → Step 2 first bullet; Deliverable 2 (both tests named in Reference) → Step 2 second bullet. AC "names the pattern and cites both test files by path" → Step 1's row predicate + Reference assertion; AC "both cited paths exist (checked by a test)" → Step 1's existence assertion with its go-red control.
- **Placeholders:** none.
