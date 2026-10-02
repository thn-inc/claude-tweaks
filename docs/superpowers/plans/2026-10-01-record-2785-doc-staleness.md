# Doc staleness: decisions/0019 Consequences (#2785) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dangling, unresolvable commit-hash citation (`41dc8424f`) in `docs/decisions/0019-vendored-gif-codec-over-a-runtime-dependency.md`'s Consequences section with an accurate statement of where the LZW clear-code-width fix actually landed.

**Architecture:** Docs-only text substitution — no code, schema, or behavioral change. One sentence in one decision record is edited in place.

**Tech Stack:** Markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-01T081654-record-2785/work/2785-spec.md` (materialized from GitHub issue #2785)

## Global Constraints

None beyond the spec's own Acceptance Criteria — this is a single-sentence prose correction.

## Review Focus

- A reviewer running `git show 41dc8424f` must now understand why that hash is unresolvable, rather than re-discovering it as an open question.
- The replacement text must not introduce a *new* unverifiable claim (e.g. a commit hash that also doesn't resolve) — `15553cf` must be checked to exist before citing it.

---

### Task 1: Replace the dangling commit-hash citation

**Files:**
- Modify: `docs/decisions/0019-vendored-gif-codec-over-a-runtime-dependency.md` (Consequences section, the sentence citing `41dc8424f`)

**Interfaces:** None — prose-only change, no code interfaces.

- [ ] **Step 1: Confirm the premise (read-only, no test to write — this is a prose correction)**

Run: `git cat-file -t 41dc8424f; git rev-list --all | grep ^41dc84; git log --oneline --diff-filter=A -- plugin/bin/lib/gif/lzw.js plugin/bin/lib/gif/encoder.js plugin/bin/lib/gif/palette.js plugin/bin/lib/gif/png-decode.js; git cat-file -t 15553cf`
Expected: the first two commands produce no output / error (`41dc8424f` does not exist); the third shows all four codec files added in a single commit `15553cf...`; the fourth resolves `15553cf` as a real commit object.

- [ ] **Step 2: Edit the Consequences sentence**

In `docs/decisions/0019-vendored-gif-codec-over-a-runtime-dependency.md`, replace:

```
Fixed at `41dc8424f` and independently re-verified against real screenshots: 4 mid-stream resets exercised across both frames, decoding bit-exact at 921,600/921,600 pixels with 0 mismatches, while the pre-fix output fails the same decoder with a bitstream underrun.
```

with:

```
Fixed within the same pipeline run; the standalone fix commit does not survive in this repo's history (folded away when the run was archived and squashed into `15553cf`, the commit that actually landed this codec — `41dc8424f` is not a resolvable object in this repository). Independently re-verified against real screenshots: 4 mid-stream resets exercised across both frames, decoding bit-exact at 921,600/921,600 pixels with 0 mismatches, while the pre-fix output fails the same decoder with a bitstream underrun.
```

- [ ] **Step 3: Verify the edit landed and no other dangling reference to `41dc8424f` remains**

Run: `grep -rn "41dc8424f" docs/ plugin/ 2>/dev/null`
Expected: no matches (the citation is fully replaced, and it was never referenced anywhere else).

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0019-vendored-gif-codec-over-a-runtime-dependency.md
git commit -m "Fix dangling commit-hash citation in decisions/0019 Consequences

refs #2785"
```

---

## Self-review

- **Spec coverage:** the spec's sole Deliverable (replace the Current block with the Proposed block) and sole Acceptance Criterion (the dangling hash no longer cited) are both covered by Task 1's Steps 2-3.
- **Placeholders:** none.
