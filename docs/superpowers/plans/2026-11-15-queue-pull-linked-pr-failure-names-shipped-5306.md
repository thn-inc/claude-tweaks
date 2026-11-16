# Queue pull: a failed linked-PR GraphQL call also disables the shipped pass (#5306) Implementation Plan

**Goal:** When the linked-PR GraphQL call fails, the queue pull's Warning states that the shipped-candidate pass was skipped as well as the open-PR pass, in both the queue-pull module and the retained fence script.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5306/work/5306-spec.md` (materialized from GitHub issue #5306)

**Decision (which AC 1 branch):** AC 1 is met by its second branch — "the Warning names that the shipped pass was skipped" — with no change to which records are excluded. The first branch is unavailable: the shipped pass's only input is the `mentions` the same `resolve-linked-prs.js` call returns (`runShipped` reads `dispatch-linked-prs.json`, queue-pull.js ~852-899), so there is nothing for it to keep working from once that call fails. Failing closed per record (excluding every candidate the shipped pass cannot classify) is not chosen: one transient GraphQL failure would empty the whole queue, while the open-PR pass already fails open on the same failure. The Deliverable's "the Warning states what was skipped" is the half this plan implements.

---

### Task 1: Name the skipped shipped-candidate pass in the linked-PR failure Warning

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` — `runOpenPr`'s Warning at ~715.
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — the retained fence (#5231 has not removed it), its matching `echo "Warning: linked-PR query failed — …"` at ~347; the record's Current State requires fixing both and keeping the parity row. Size headroom (re-measured 2026-11-16 after #5305/#5307 landed on this branch): the file is 52,498 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`), and the Warning change adds 21 bytes. **Remedy:** cut at least 19 bytes of prose outside the bash fence, on an existing line (never add or remove a line — fence-line citations such as `// Fence 338-382` in queue-pull.js and the test file's fence citations key off line numbers). Suggested cut: line 10's `This one DOES remove excluded candidates from \`dispatch-groups.json\` too, the same as the open-PR pass:` → `This one DOES remove excluded candidates too, like the open-PR pass:`. Before cutting, grep `tests/` for the exact phrase being removed to confirm no conformance test pins it. The file must end at or under 52,500. Never trim the `_shared/integration-branch.md` citation near the fence's `remote show origin` line (`tests/integration-branch-conformance.test.js` requires it).
- Modify: `plugin/skills/dispatch/mcp-transport.md` — line ~174, the degrade description `"no open-PR exclusion"` → `"no open-PR or shipped-candidate exclusion"`, so the transport doc names the same skipped pass the Warning does (26,850 bytes, far from the rail).
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`

The new Warning text, identical in module and fence (only the span between `—` and `this run:` changes):

`Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: {stderr of resolve-linked-prs.js}`

It prints exactly when it prints today (the shared linked-PR setup, whether or not `open-pr` or `shipped` is omitted); no other line, exclusion, staged file or session file changes.

- [ ] **Step 1: Failing test** — in `tests/bin-lib/dispatch/queue-pull.test.js`: add an assertion that `LINKED_WARNING` (~1374, read from the fence) equals `'Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: '`, so the F-linked fault row (~3317, `stderr: [\`${LINKED_WARNING}gh-fault: injected failure\`]`) pins the new text on both sides; update the two hardcoded strings at ~1536 and ~1543 to the new text; and in the F-linked row's own dedicated assertions (if any) or a new one beside the row, assert the printed Warning contains `shipped-candidate`. Leave the row's `drops: ['open-pr:9005', 'open-pr:9008', 'shipped:9010']` unchanged — the exclusions do not change. Update the header comment at ~40 ("F-linked's single Warning … also turns off the shipped pass") to say the Warning now names that skip. Run `node --test tests/bin-lib/dispatch/queue-pull.test.js` before Step 2: the new assertions must go red on the current code.
- [ ] **Step 2: Implement** — change the Warning text in `queue-pull.js` (~715) and the fence (~347) to the literal above, byte-identical so the parity suite stays green; apply the queue-pull-script.md prose cut and the mcp-transport.md wording named under Files.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/integration-branch-conformance.test.js` — PASS; `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500 and `wc -l` unchanged (668).
- [ ] **Step 4: Commit** — one commit, `Name the skipped shipped-candidate pass in queue-pull's linked-PR failure Warning`, body `refs #5306`.

---

## Self-review

- **Spec coverage:** Deliverable ("the Warning states what was skipped") → Step 2; AC 1's second branch (the Warning names that the shipped pass was skipped) → Step 1's pinned `LINKED_WARNING` and `shipped-candidate` assertion; the first branch is ruled out in the Decision paragraph.
- **Placeholders:** none.
