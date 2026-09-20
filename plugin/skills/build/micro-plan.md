# Micro-Plan — single-file fast-lane records skip `/superpowers:writing-plans` (#1911)

Read from Spec Step 3, before invoking `/superpowers:writing-plans`. A one-file, one-task record
has no cross-task structure for a full plan to capture — no task ordering, no shared-file
conflicts, no pre-execution conflict scan for SDD to run over task pairs. This procedure composes
that single task directly from the already-materialized spec instead.

## Applicability gate

All three must hold, checked in this order (cheapest first):

1. The materialized header (`{run-dir}/work/{n}-spec.md`'s frontmatter, `skills/flow/materialize.md`)
   carries `ceremony: fast-lane`.
2. The same header carries `size: low`.
3. The spec body's `### Key Files` section (under `## Technical Approach`, spec-template's own
   heading) names **at most one implementation file** — count every listed path except one under
   `tests/`, matching `*.test.*`/`*.spec.*`, or itself a `docs/**`/`*.md` path (the same test/docs
   exclusion `bin/lib/dispatch/ceremony-derive.js`'s `computeDiffFacts` already applies to a diff,
   read here against the spec's own file list instead of a diff). Zero implementation files still
   qualifies (a docs-only or test-only record) — the gate is "at most one," not "exactly one."

**Any other header shape** — `ceremony: standard`, `size: medium`/`high`/absent, or two or more
implementation files in `### Key Files` — **falls through to today's path unchanged**: proceed to
Spec Step 3's `/superpowers:writing-plans` invocation exactly as before. A `### Key Files` section
this step cannot parse (missing entirely, or not a plain list) also falls through — never guess a
count from an absent or malformed section; per `parse-signal-discipline`, "could not parse" and
"parsed to zero" are distinguishable and only the latter satisfies condition 3.

Standalone `/build` (no `config.yml`) never qualifies — the gate reads `ceremony`/`size` from the
materialized header regardless of pipeline parent, but a standalone build with no
`ceremony:fast-lane` label path (a hand-authored record, or one that skipped `/specify`) treats
the header's own fallback rules per `materialize.md`; this procedure adds no separate standalone
carve-out beyond that.

## Composing the micro-plan

When the gate passes, compose one plan file at `docs/superpowers/plans/YYYY-MM-DD-{feature}-{n}.md`
(same naming convention `/superpowers:writing-plans` uses — a dated, slugged path under the same
directory, so every downstream reader — `plan-audit.js`, `dispatch.md`'s `--count-tasks`, SDD's own
`task-brief`/`sdd-workspace` scripts — finds it exactly where it expects a plan):

```markdown
# {Spec title} (#{n}) Implementation Plan

**Goal:** {one sentence, the spec's own title/Current State opener}

**Spec:** `{run-dir}/work/{n}-spec.md` (materialized from GitHub issue #{n})

---

### Task 1: {short verb-phrase drawn from the spec's ## Deliverables}

**Files:**
{one line per ### Key Files entry — `Create:` for a path the repo does not yet have, `Modify:`
otherwise (probe with a plain file-existence check, not a guess); a test file from ### Key Files
or implied by the Acceptance Criteria is its own `Test:` line}

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #{n}`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above.
- **Placeholders:** none.
```

This is deliberately not a copy of `/superpowers:writing-plans`'s full task-authoring machinery
(no Global Constraints block, no per-step `Probe`/mutation-probe scaffolding) — those exist to
coordinate multiple tasks and multiple reviewers across a plan large enough to need them. A
one-task, one-file plan has nothing for that scaffolding to coordinate; SDD's `task-brief` script
only requires a heading matching `^#+\s+Task\s+{n}` to extract the section, which the template
above satisfies.

**Skip plan-audit.md too:** Common Step 1.5 already skips when `config.yml`'s `ceremony-profile`
is `fast-lane` (its own gate, unchanged by this file) — the micro-plan path never needs a separate
audit-skip rule, since every micro-plan is by definition composed under that same condition.

## Logging the skip

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Spec Step 3 (skipped)" \
  --text "condition: ceremony=fast-lane, size=low, <=1 implementation file in ### Key Files → fallback: micro-plan composed directly at {plan-path}" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead
(`handoff-template.md`'s inline-skip listing), naming the composed plan's path.

Proceed to **Common Step 2** exactly as Spec Step 3 would after a normal `/superpowers:writing-plans`
invocation.

## Escape hatch: NEEDS_CONTEXT re-run

A micro-plan is a bet that one task is enough structure — stated with a fallback, the same shape
`architecture-alignment.md`'s fast-lane skip already uses. If Common Step 2's dispatch (`dispatch.md`)
reports the single task implementer returned `NEEDS_CONTEXT` (`_shared/subagent-output-contract.md`'s
status line) specifically because the task needed broader plan structure the micro-plan didn't
provide — not a NEEDS_CONTEXT for an unrelated reason (missing credentials, an ambiguous spec
detail unrelated to task decomposition) — `/build` re-runs the full path **once**: return to Spec
Step 3, skip this gate entirely for the retry (do not re-check applicability — the point is to get
the full `/superpowers:writing-plans` treatment this time), invoke `/superpowers:writing-plans`
normally, then re-run Common Step 1.5 and Common Step 2 against the resulting plan. Log the retry:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO \
  --section "/build" --step "Spec Step 3 (micro-plan retry)" \
  --text "micro-plan task reported NEEDS_CONTEXT — re-running /superpowers:writing-plans in full once" --reversibility n/a
```

**One cycle cap:** if the full-path retry's own task(s) also fail, this is a genuine build failure
— surface it through `failure-recovery.md`'s normal table, never a second micro-plan attempt or a
second full-path re-run. This mirrors `/flow`'s polish/re-verify one-cycle cap (`steps-and-gates.md`)
— the same anti-oscillation discipline, applied to plan composition instead of polish.
