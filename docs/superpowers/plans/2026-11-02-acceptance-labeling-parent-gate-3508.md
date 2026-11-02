# acceptance-labeling parent-gate alignment (#3508) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `engine-verify.js`'s `acceptance-labeling` parent path agree with the Parent-Gate Procedure: `resolved` skips, `gated` has its brief checked with no floor, and the floor applies only to `due`.

**Architecture:** Branch on `parentGateState`'s result before the floor check in the check's parent path. The procedure file gains a table of what the row does per state, and a test pins that table against the row the check actually emits.

**Tech Stack:** Node 18+, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T210158-record-3508/work/3508-spec.md` (materialized from GitHub issue #3508)

## Pre-build findings (the spec's Gotchas, resolved at authoring time)

- **Where the rule lives after #4603 (merged as 7e561d151):** `plugin/bin/lib/issues/parent-gate.js:331` already computes `exceeds` only on `state === 'due'`, so the CLI needs no change. The procedure-side half stays in `verification-brief-parent-gate.md`.
- **#4625 (remove `demo:*` labels):** still open, and `plugin/bin/lib/issues/acceptance.js` still reads those labels, so this record still applies.
- **Line numbers moved:** the spec's `engine-verify.js:904` condition is now `:1033`. The spec's `verification-brief-parent-gate.md:252` is now `:339`.

## Global Constraints

- The floor change is narrow: `due` keeps its floor. Don't remove the floor from the parent path altogether.
- `incomplete` keeps today's skip and its exact detail text.
- Skip reason for `resolved`, exactly: `parent #P already dispositioned`, with `#P` the parent's number.
- `plugin/skills/wrap-up/verification-brief-parent-gate.md` is 44,844 B against the 52,500 B Read-limit rail (`RAIL_BYTES`). This plan adds about 900 B, leaving about 6,700 B of headroom.
- `tests/try-it-contract-conformance.test.js:182` pins the literal `` `gated`/`resolved` `` at line 50 of the procedure file, and `tests/below-floor-parent-close-conformance.test.js:1405` parses the bullets between `## Evaluate the gate` and `**Oversight-floor check`. Leave those lines and bullets as they are: the new table goes after the `exceeds: true` bullet, before `## Close the parent below the floor`.
- Governing project skill `prose-code-twin-pin`, quoted: "Either shape is a real pin; a test only asserting that individual literal strings are *present* somewhere is not". And: "*A string the shared module emits and the prose quotes* is a twin too". The new table is that twin, so its test compares each row's quoted detail with the row the check emits.
- Governing project skill `plan-authoring-checks`' Go-red control check, quoted: "the control must run the same assertion code the positive test runs, against the mutated input, and expect it to throw."
- No other project skill under `.claude/skills/` governs these changes. `gh-api-module-pattern` and `mcp-agent-fetch-node-compute` name `parent-gate` modules this plan does not modify, and this plan adds no `gh` call.

## Review Focus

- A parent carrying both `demo:pending` and `demo:approved` resolves to `resolved` and skips. It no longer fails `pending label outranked by a verdict`.
- A verdict in the other spellings (`accept:approved`, `demo:changes-requested`) skips the same way as `demo:approved`.
- A sub-issue reopened after its parent was accepted (a sibling still open) reads `already dispositioned`, not `not due`, because the parent's label wins.
- A `gated` parent with an open sibling and a below-floor tier still has its brief checked, and a trusted brief on it passes rather than skips.
- A resolved parent beside a failing target: the row stays `fail` and still carries the resolved parent's skip reason. Beside a passing target, the row is `pass` with that reason in its detail.

---

### Task 1: Branch the parent path on gate state

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:892-900` (comment), `:1029-1046` (parent path)
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md:373-376` (new table after this bullet)
- Modify: `docs/journeys/verify-wrap-ups-closure-checklist-900.md` (lines 69 and 72, and its changelog)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`
- Waived `plugin/bin/lib/issues/acceptance.js`: read only, per the spec's Key Files; `parentGateState`'s mapping is what the new branch reads.

**Interfaces:**
- Consumes: `parentGateState({ subIssues, parentLabels })` returning `'incomplete' | 'gated' | 'resolved' | 'due'`; test helpers `parentGateRow`, `twoParentRow`.
- Produces: `parentGateRow` gains an optional `parentComments = []`; `twoParentRow` gains an optional `otherParentLabels = []` (the labels parent #898 returns). Existing callers are unaffected by both defaults.

- [ ] **Step 1: Write the failing tests**

Add these beside the existing `parentGateRow` cases, each name carrying `#3508`. A brief here is `{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }`. The existing `AC1.1/AC1.2`, `AC2.1` and `AC3.1` cases (`engine-verify.test.js:1858-1894`) stay as the `incomplete` and `due` pins.

- `AC1.1: #3508 a demo:approved parent with every sibling closed skips as already dispositioned`: labels `['demo:approved']`, subs closed with `risk:high`. `row.result === 'skip'`; detail matches `/parent #898 already dispositioned/`; detail does not match `/missing demo:pending/`.
- `#3508 a below-floor resolved parent skips as dispositioned, not below the floor`: same with `risk:medium`. Detail matches `/already dispositioned/`, does not match `/below oversight floor/`.
- `#3508 every verdict spelling and an outranked pending label skip as dispositioned`: for each of `['accept:approved']`, `['demo:changes-requested']`, `['accept:changes-requested']`, `['demo:pending', 'demo:approved']`: `skip`, `/already dispositioned/`, and not `/outranked/`.
- `#3508 a reopened sub-issue under a resolved parent reads dispositioned, not not due`: labels `['demo:approved']`, sibling #901 open. `skip`, `/already dispositioned/`, not `/not due/`.
- `AC2.1: #3508 a below-floor gated parent with no brief fails`: labels `['demo:pending']`, subs `risk:medium`. `row.result === 'fail'`; detail matches `/#898: no comment carries a confirmed Verification Brief or an acceptance packet/`; not `/below oversight floor/`.
- `#3508 a below-floor gated parent with a brief passes, never skips`: same plus `parentComments: [brief]`. `row.result === 'pass'`.
- `#3508 a gated parent with an open sibling still has its brief checked`: labels `['demo:pending']`, subs `risk:medium`, sibling #901 open, no brief. `fail`, not `/not due/`, not `/below oversight floor/`.
- `#3508 a resolved parent's skip reason rides a failing row` and `... a passing row`: `twoParentRow({ otherParentLabels: ['demo:approved'], dueParentLabels: [], dueParentComments: [] })` gives `fail`, matching both `/#899: missing demo:pending or accept:pending label/` and `/parent #898 already dispositioned/`. With `dueParentLabels: ['demo:pending']` and a brief it gives `pass`, with the detail matching `/parent #898 already dispositioned/`.
- `AC3.1: #3508 the procedure's gate-state table matches the row the check emits`: factor the comparison into `assertGateTableTwin(doc)`. It finds the `**What the \`acceptance-labeling\` row does with each gate state.**` heading (asserting it exists), slices to `## Close the parent below the floor`, and parses every `` | `...` `` row into state, result (the Row cell's first backticked word) and detail (the Detail cell's backticked text). It asserts `deepEqual` of the state cells to ``['`incomplete`', '`resolved`', '`gated`', '`due`, `exceeds: false`', '`due`, `exceeds: true`']``. For each state it runs the matching `parentGateRow` fixture below, maps `#898` to `#P` and `1 sibling` to `N sibling` in `row.detail`, and asserts result and detail equal the parsed cells:
  - `incomplete`: no labels, subs #900 and #901 open, `risk:high`.
  - `resolved`: `['demo:approved']`, subs closed, `risk:high`.
  - `gated`: `['demo:pending']`, subs closed, `risk:medium`, no brief.
  - `due`, `exceeds: false`: no labels, subs closed, `risk:medium`.
  - `due`, `exceeds: true`: no labels, subs closed, `risk:high`.
- `#3508 the gate-state table pin goes red on a reworded detail and a dropped row`: `assert.throws(() => assertGateTableTwin(doc.replace('already dispositioned', 'already accepted')))`, then the same with the `` | `gated` `` row line removed.

Waived AC5.1: `npm test` in full runs at `/build` Common Step 5, not in this task.

- [ ] **Step 2: Run the new tests and save the red run as AC4.1's evidence**

Create the directory: `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T210158-record-3508/evidence"`

Run: `node --test --test-name-pattern "#3508" tests/bin-lib/wrap-up/engine-verify.test.js > "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T210158-record-3508/evidence/ac4-new-tests-red.txt" 2>&1`
Expected: FAIL, with every `#3508` test failing against today's `if (gate === 'incomplete')`-only condition. The go-red control test must fail too, because the table it needs does not exist yet. A new test that passes here is a defect in that test: strengthen it before continuing.

Record it (AC4.1) by writing one line with the Write tool to the path `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.160.3/bin/session-tmp-resolve.js" --value ac4-evidence.txt` prints, carrying the AC4 wording, the command above and the pass/fail counts, then:
`node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.160.3/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T210158-record-3508" --section "/build" --status AUTO --step "AC evidence" --text-file "{that path}" --reversibility n/a`

- [ ] **Step 3: Implement the branch in `engine-verify.js`'s parent path**

After the existing `incomplete` block: when `gate === 'resolved'`, `skipped.push(\`parent #${target} already dispositioned\`)` and `continue`. Wrap the existing `exceedsOversightFloor` check and its below-floor skip in `if (gate === 'due') { ... }`, unchanged inside. `gated` falls through to the existing disposition and brief checks. Rewrite the `#3222` comment at `:892-900` to state all four states and name #3508.

- [ ] **Step 4: Add the table to `verification-brief-parent-gate.md`**

After the `exceeds: true` bullet, before `## Close the parent below the floor`, add exactly:

```markdown
**What the `acceptance-labeling` row does with each gate state.** The bullets above say what labeling does on this entry. `wrap-up-engine.js verify`'s `acceptance-labeling` row (`bin/lib/wrap-up/engine-verify.js`) then checks the outcome against the same rule (#3508), with this run's records counted as closed. A `resolved` parent owes nothing more. A `gated` parent owes the brief its gate posted, whatever its risk tier, since the floor decides only whether a `due` parent is gated.

| State | Row | Detail |
|---|---|---|
| `incomplete` | `skip` | `parent gate #P not due — N sibling sub-issue(s) open` |
| `resolved` | `skip` | `parent #P already dispositioned` |
| `gated` | `fail` with no packet or brief, `pass` with one | `#P: no comment carries a confirmed Verification Brief or an acceptance packet` |
| `due`, `exceeds: false` | `skip` | `parent #P below oversight floor — closes after the merge lands (Step 4.0b)` |
| `due`, `exceeds: true` | `fail` with no pending label | `#P: missing demo:pending or accept:pending label` |
```

- [ ] **Step 5: Update the journey (behavior-change prose sweep)**

`grep -rn -F -e 'gated`/`resolved' -e 'gated/resolved' -e 'gated or resolved' plugin docs/journeys docs/hooks.md tests` found one stale statement of the old rule, in `docs/journeys/verify-wrap-ups-closure-checklist-900.md:69`. Its other two hits (`verification-brief-parent-gate.md:50`, `tests/try-it-contract-conformance.test.js:182`) are the no-change pin above.

- Line 69: replace `Only a \`due\`/\`gated\`/\`resolved\` gate on an above-floor parent reaches the \`demo:pending\` + Verification Brief check, so a genuinely ungated due parent still fails ...` with: a `resolved` parent → `skip (parent #P already dispositioned)`; a `gated` parent has its packet or brief checked whatever its risk tier; only a `due` parent reaches the floor, and an above-floor one still fails `#P: missing demo:pending or accept:pending label`. In the next sentence, change `for a parent or any other target` to say the `pending label outranked` detail now applies to a non-parent target, because an outranked label on a parent resolves as `resolved`.
- Line 72 (Red flags): append `acceptance-labeling | fail | #P: missing demo:pending or accept:pending label` on a parent already carrying a verdict (the #3508 false fail), and a below-floor `gated` parent skipping its brief check.
- Changelog: add a line under the `Updated for #4551` one: `- Updated for #3508: ...`, summarizing the rule.

- [ ] **Step 6: Run the tests and the source-scan suites**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/try-it-contract-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, including every `#3508` test and every pre-existing parent-gate case unchanged. A pre-existing test that fails here because it pinned the old `resolved`/`gated` behavior is a finding to report, not one to rewrite silently.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js plugin/skills/wrap-up/verification-brief-parent-gate.md docs/journeys/verify-wrap-ups-closure-checklist-900.md tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Align acceptance-labeling's parent path with the Parent-Gate Procedure — refs #3508"
```

## Spec coverage

| Deliverable / AC | Where |
|---|---|
| `resolved` renders `skip` naming `already dispositioned` / AC1.1 | Steps 1, 3 |
| `gated` has its brief checked, no floor / AC2.1 | Steps 1, 3 |
| Floor only on `due`; `incomplete` unchanged / AC3.1 | Steps 1, 3; existing cases at `:1858-1894` |
| Procedure and code state the same rule | Steps 3, 4; the table twin test |
| Pin each gate state | Step 1 |
| AC4.1 new tests fail on today's condition | Step 2's saved run |
| Waived AC5.1 | Common Step 5 |

This is one task because the code, its prose twin and the twin's test can't be reviewed apart: the twin test goes red until both land.
