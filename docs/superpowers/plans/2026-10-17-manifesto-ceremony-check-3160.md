# Manifesto-time ceremony-check fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A record with no `ceremony:*` label is judged by `ceremony-check` at `/flow`'s Manifesto (Step 3), so `config.yml`'s `ceremony-profile` reflects the verdict from the start of the run instead of defaulting to `standard`.

**Architecture:** The record lists two possible fix sites. This plan takes the second: move the existing `/flow` ceremony-check fallback earlier, from build-time materialize (Step 4) to the Manifesto's Ceremony profile computation (Step 3). The verdict is logged once per record to `decisions.md`, and Step 4's materialize then passes it to `bin/materialize.js --ceremony` without judging again. That keeps one judgment per record per run, the property ADR 0006 cites when it rejects duplicate judgments. The first option, stamping `ceremony:*` at every filing site, is rejected for three reasons. ADR 0006 and the `_shared/work-record.md` permission matrix reserve the label for `/specify`. The option would add label-write authority to every health sweep plus wrap-up's Review Console filing. And it would still miss hand-authored and older records. The Manifesto-side fix covers every unlabeled record, whoever filed it.

**Tech Stack:** Markdown skill prose (`plugin/skills/**`), `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T212804-record-3160/work/3160-spec.md` (record #3160)

**Scope keywords:** materialization fallback, materialize.md fallback, materialize step falls back

## Global Constraints

- Hand-written commit subjects use `{Verb} {what} — {detail}`, imperative, with no conventional-commit prefix. Reference the record as `refs #3160`, never `closes`/`fixes`.
- Skill references inside actionable instruction text use the fully-qualified `/claude-tweaks:{skill}` form.
- Each skill relationship is stated once, in `docs/skill-graph.md`. Never restate an edge inside a `SKILL.md`.
- `plugin/skills/flow/materialize.md` must keep two phrases that `tests/untrusted-record-content-conformance.test.js` pins byte-exact: ``wrapped per `_shared/ceremony-check-invocation.md`'s untrusted-content paragraph`` and ``never defaulted to `standard` ``.
- `docs/skill-graph.md` table cells must not contain an unescaped `|` (`tests/skill-graph-table-structure.test.js`). Any new row must not mention `_shared/untrusted-record-content.md`, because that test counts its dedicated rows.
- No edited `plugin/skills/**/*.md` line may contain both `fast-lane` and `skip`. `tests/ceremony-profile-roster.test.js` flags such a line unless it carries a roster tag.
- `/claude-tweaks:specify` remains the sole owner of the `ceremony:*` label. Nothing in this plan writes a label back.

## Review Focus

1. **Mixed multi-record run.** Labeled records fold their label, and only the unlabeled ones get a ceremony-check call. A reasonable reader expects one call per *unlabeled* record, never one per record. The pin is the "carries no `ceremony:*` label" condition, AC1.1 in Task 1.
2. **Case-1 adoption (resume with `config.yml` present)** reads levers from the pack and must not re-run ceremony-check. Nothing in this plan changes `steps-and-gates.md` case 1, and the computation paragraph sits under "Compute recommendations", which case 1 skips. The reviewer confirms no new prose implies a re-run.
3. **Missing `CEREMONY:` line.** The pipeline must stop and never fold `standard`. This is pinned by the AC1.2 test, Task 1.
4. **A label appears between the Manifesto and materialize.** `materialize.js` prefers the label (`facets.ceremony || opts.ceremony`, line 542), so the header can differ from the fold. This is accepted: the fold is locked at Step 3 like every other lever. The reviewer checks that no prose claims the two always match.
5. **Standalone `/claude-tweaks:build`** (no Manifesto) must still run the fallback at materialize time. This is pinned by AC1.3, which reads materialize.md's "Only a materialize with no such line" clause.

---

### Task 1: Manifesto runs the ceremony-check fallback; materialize reuses the verdict

**Files:**
- Test: `tests/flow-manifesto-ceremony-fallback-conformance.test.js` (create)
- Modify: `plugin/skills/flow/manifesto.md:33` (the `**Ceremony profile computation.**` paragraph), `:42` (per-spec preview `Ceremony` row), `:154-158` (the lever-9 footnote under Recommendation defaults)
- Modify: `plugin/skills/flow/materialize.md:110` (the `` - `ceremony` — `` bullet)
- Modify: `plugin/skills/flow/SKILL.md` Step 4 item 2 (the sentence starting "For the `build` step in record mode: compose, write, and commit the materialized file now")

**Interfaces:**
- Produces: a `decisions.md` line, written via `log-decision.js --section "/flow" --status AUTO --step "Manifesto ceremony-check"`, whose text is exactly `#{n} carries no ceremony:* label -> CEREMONY: {verdict}`. Task 1's materialize bullet reads it back, and Task 2's prose cites it.

- [ ] **Step 1: Write the failing test**

Create `tests/flow-manifesto-ceremony-fallback-conformance.test.js`. Start with a header comment naming #3160. It should say that live prose is read deliberately because the paragraph is the contract this record changes, the same house pattern as `tests/manifesto-lever-conformance.test.js`. Helpers: `read(rel)` (`fs.readFileSync(path.join(ROOT, rel), 'utf8')`, with `ROOT = path.join(__dirname, '..')`), `collapse(s)` (`s.replace(/\s+/g, ' ')`) and `paragraph(rel, lead)`, which reads the raw file, slices from `lead` to the next `\n\n`, and returns the collapsed slice, or `null` when `lead` is absent. `FROZEN_PRE_3160` is the current `manifesto.md:33` paragraph, copied verbatim and collapsed. Tests:

```js
const MANIFESTO = 'plugin/skills/flow/manifesto.md';
const LEAD = '**Ceremony profile computation.**';

test('AC1.1: an unlabeled record is judged by ceremony-check at the Manifesto', () => {
  const p = paragraph(MANIFESTO, LEAD);
  assert.ok(p, 'Ceremony profile computation paragraph missing');
  assert.ok(p.includes('carries no `ceremony:*` label'), 'unlabeled-record condition missing');
  assert.ok(p.includes('`_shared/ceremony-check-invocation.md`'), 'canonical invocation pointer missing');
  assert.ok(p.includes('#{n} carries no ceremony:* label -> CEREMONY: {verdict}'), 'per-record verdict log line missing');
});

test('AC1.2: the fold never defaults an unlabeled record to standard', () => {
  const p = paragraph(MANIFESTO, LEAD);
  assert.ok(!p.includes('missing the field (defaults to `standard`)'), 'pre-#3160 missing-field default still present');
  assert.ok(p.includes('never defaulted to `standard`'), 'missing-verdict stop clause missing');
  assert.ok(!collapse(read(MANIFESTO)).includes('so the header always has a value'), 'lever-9 footnote still claims every record is labeled');
});

test('AC1.3: materialize reuses the Manifesto verdict instead of judging again', () => {
  const b = paragraph('plugin/skills/flow/materialize.md', '- `ceremony` — `facets.ceremony`');
  assert.ok(b, 'materialize.md ceremony bullet missing');
  assert.ok(b.includes('pass that verdict as `--ceremony`'), 'verdict pass-through missing');
  assert.ok(b.includes('#{n} carries no ceremony:* label -> CEREMONY: {verdict}'), 'materialize must name the line it reads');
  assert.ok(b.includes('Only a materialize with no such line'), 'standalone-build fallback clause missing');
  assert.ok(collapse(read('plugin/skills/flow/SKILL.md')).includes('Manifesto-time ceremony verdict as `--ceremony`'), 'flow Step 4 must pass the verdict to materialize');
});

test('control: the frozen pre-#3160 paragraph fails the AC1.1/AC1.2 pins', () => {
  assert.ok(!FROZEN_PRE_3160.includes('carries no `ceremony:*` label'));
  assert.ok(FROZEN_PRE_3160.includes('missing the field (defaults to `standard`)'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-manifesto-ceremony-fallback-conformance.test.js`
Expected: FAIL. AC1.1, AC1.2 and AC1.3 fail, and `control` passes.

- [ ] **Step 3: Rewrite the three manifesto.md sites, the materialize.md bullet, and flow/SKILL.md Step 4**

`manifesto.md:33`: replace the paragraph and keep its first and last sentences' meaning. The new text must contain these points, with every phrase quoted here appearing literally:
- The fold is a logical AND over each record's ceremony value. The value is the record's `ceremony:*` label (`facets.ceremony`, from Step 1's resolution fetch).
- A record that "carries no `ceremony:*` label" is judged here, before the fold. Run the canonical pattern (`_shared/ceremony-check-invocation.md`) with `#{n}`, using Step 1's fetched body and labels. Then log once per record: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status AUTO --step "Manifesto ceremony-check" --text "#{n} carries no ceremony:* label -> CEREMONY: {verdict}" --reversibility n/a`.
- Why: the materialized header this used to read does not exist at Step 3, so `standard` was the only possible outcome (#3160).
- This is the run's only verdict for that record. Step 4's materialize passes it through as `--ceremony` (cite `materialize.md`'s `ceremony` bullet).
- Output with no `CEREMONY:` line stops the pipeline before Step 4 with the generic failure card (`failure-cards.md`, gate `ceremony-check`). It is "never defaulted to `standard`".
- Keep "Source is always `header`" and the existing Recommended/`9=value` override sentence.

`manifesto.md:42` Ceremony row Source cell: "the record's `ceremony:*` label, else the Ceremony profile computation's ceremony-check verdict above".

`manifesto.md:154-158` footnote: say that lever 9's source is `header`, bundle-folded per the Ceremony profile computation. A labeled record carries its `/claude-tweaks:specify`-stamped value, and an unlabeled one is judged at that step, so there is nothing for a default to fill. Keep the deleted-design-doc citation.

`materialize.md:110`: replace the `**Fallback only:**` sentence. When `facets.ceremony` is `null`, the verdict comes from the canonical ceremony-check pattern with `#{n}`, run once per record. Under a `/flow` parent it already ran at the Manifesto (cite `manifesto.md`'s Ceremony profile computation, #3160), so this step does not judge again: "pass that verdict as `--ceremony`". Read it from the run's `decisions.md` line `#{n} carries no ceremony:* label -> CEREMONY: {verdict}`; in a multi-spec run that is the parent run directory's `decisions.md`. "Only a materialize with no such line" invokes the pattern here: a standalone `/claude-tweaks:build`, or a resumed run whose Manifesto predates it. Keep the rest of the bullet unchanged, including both pinned phrases from Global Constraints.

`flow/SKILL.md` Step 4 item 2: after "(`materialize.md`'s Composing the file + When this runs)", insert ", passing an unlabeled record's Manifesto-time ceremony verdict as `--ceremony` (`manifesto.md`'s Ceremony profile computation)".

- [ ] **Step 4: Run test to verify it passes, plus the suites that pin these files**

Run: `node --test tests/flow-manifesto-ceremony-fallback-conformance.test.js tests/untrusted-record-content-conformance.test.js tests/flow-manifesto-composition.test.js tests/manifesto-auto-fast-path.test.js tests/manifesto-lever-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/flow-manifesto-ceremony-fallback-conformance.test.js plugin/skills/flow/manifesto.md plugin/skills/flow/materialize.md plugin/skills/flow/SKILL.md
git commit -m "Run ceremony-check at flow's Manifesto for unlabeled records — refs #3160"
```

### Task 2: Retarget every description of the fallback's call site

**Files:**
- Modify: `plugin/skills/assess-agent-autonomy/ceremony-check.md` (the Called-from paragraph starting "`/claude-tweaks:flow`'s materialize.md"; Step 1's "**Fallback call, from `/flow`'s materialize.md:**" lead; Step 3's "`/flow`'s materialize.md fallback call uses the verdict only for that run's own materialized header")
- Modify: `plugin/skills/assess-agent-autonomy/SKILL.md:86-87` ("`/claude-tweaks:flow` (materialization fallback, …)")
- Modify: `plugin/skills/_shared/ceremony-check-invocation.md` (the "Referenced by" list naming `flow/materialize.md`, and the failure-reporting sentence's `materialize.md:` clause)
- Modify: `docs/skill-graph.md:515` (the `/specify` section's `/assess-agent-autonomy` row: "`/flow`'s `materialize.md` falls back to it…"), plus one new row in `## flow` directly after the `/design-wrapper` row
- Modify: `docs/getting-started.md:86`, `docs/plugin-structure.md:102`
- Modify: `docs/decisions/0006-ceremony-tiering-owned-by-specify.md` (add a dated note after the 2026-09-06 note)

**Interfaces:**
- Consumes: Task 1's log-line text `#{n} carries no ceremony:* label -> CEREMONY: {verdict}` and the `manifesto.md` "Ceremony profile computation" anchor.

- [ ] **Step 1: Sweep for stale call-site wording**

Run: `git grep -n -i -e "materialization fallback" -e "materialize.md fallback" -e "materialize step falls back" -e "materialize.md\` falls back" -e "materialize.md (\`skills/flow/materialize.md\`) calls this mode" -- plugin docs`
Expected, verified once at authoring time: 5 hits — `docs/getting-started.md:86`, `docs/plugin-structure.md:102`, `docs/skill-graph.md:515`, `plugin/skills/assess-agent-autonomy/ceremony-check.md:8` and `:71`. This grep is line-based, so it cannot see the wording in `assess-agent-autonomy/SKILL.md:86-87` ("materialization" and "fallback" fall on separate lines) or the `flow/materialize.md` mentions in `_shared/ceremony-check-invocation.md`. Both are already listed in Files and edited regardless. `help/reference-card.md`'s "flow falls back to it" stays true and is left unchanged. Any hit outside these gets added to this task.

- [ ] **Step 2: Apply the edits**

Each site says one thing: `/flow` runs the fallback once per unlabeled record at the Manifesto (`skills/flow/manifesto.md`'s Ceremony profile computation, #3160), so the run's `ceremony-profile` fold sees the verdict. Materialize reuses that verdict and runs the fallback itself only when no Manifesto ran (a standalone `/claude-tweaks:build`). It still never writes a label back. In `ceremony-check-invocation.md`'s failure-reporting sentence, add a `flow/manifesto.md` clause: the pipeline stops before Step 4 with the generic failure card. Keep the `materialize.md` clause for the standalone path. Do not alter the phrases that `tests/untrusted-record-content-conformance.test.js` and `tests/ceremony-framing-per-record-conformance.test.js` pin in these files.

New `## flow` row in `docs/skill-graph.md`: target `/assess-agent-autonomy`. The relationship text: Step 3's Manifesto invokes `ceremony-check` inline, once per target record that carries no `ceremony:*` label, before folding `ceremony-profile` (#3160). Step 4's materialize passes that verdict to `bin/materialize.js --ceremony` rather than judging again. Fallback-only: `/specify` owns the label, and nothing on this edge writes one back. No `|` characters.

ADR 0006 note, `**Note (2026-10-17):**`: the `/flow` fallback this ADR describes now runs at the Manifesto (Step 3), not at materialize time, so an unlabeled record's verdict reaches the run's `ceremony-profile` fold (#3160). Materialize passes the same verdict through as `--ceremony`, so it is still one judgment per record per run, and never written back. The body is left as originally written.

- [ ] **Step 3: Verify**

Run: `node --test tests/untrusted-record-content-conformance.test.js tests/ceremony-framing-per-record-conformance.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/flow-manifesto-ceremony-fallback-conformance.test.js`
Expected: PASS, with 0 failures. Re-run Step 1's grep: 0 hits.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/assess-agent-autonomy/ceremony-check.md plugin/skills/assess-agent-autonomy/SKILL.md plugin/skills/_shared/ceremony-check-invocation.md docs/skill-graph.md docs/getting-started.md docs/plugin-structure.md docs/decisions/0006-ceremony-tiering-owned-by-specify.md
git commit -m "Retarget ceremony-check fallback call-site descriptions to flow's Manifesto — refs #3160"
```
