# Advanced Proof Patterns — skill-prose-conformance-tests

Lazy-loaded from `SKILL.md` (this skill's directory). Read this file when a go-red proof needs zero-mutation verification, a change adds or removes an Anti-Patterns row, or a new detection signal needs corpus validation before it's trusted.

## Proving discrimination without editing the tree

A pin's red state can be proven after the fact, with zero tree mutation: `git show {base}:{file} | grep -c -F '{pinned literal}'` must print 0 where the same grep at HEAD prints 1 (or N). This is the check to reach for when a red-run step was skipped (it retroactively proves the assertion could have failed), when reviewing someone else's pin, or when a revert-and-rerun would risk leaving the tree dirty — `git show` mutates nothing. Run it per pinned literal, not per file: one literal that pre-exists at base is a vacuous pin even when its siblings discriminate. (First applied across record #1071's four prose pins; the whole-branch review ran the same table independently.)

**`{base}` must be a fixed, independently-verified ancestor SHA — never a moving ref like `HEAD`.** A moving ref is self-defeating once the change lands: `HEAD` at that point already carries the post-change content, so the "red" side of the comparison silently becomes the same as the "green" side. Pair the pin with its own ancestor-precondition test (`git merge-base --is-ancestor {base-sha} HEAD`) so a rebase or history rewrite that invalidates the fixed SHA fails loudly instead of passing vacuously. Record #1488 shipped both the mistake and the fix in one build: one pin used a fixed SHA with only a rationale comment, no precondition test; a sibling pin landed the correct fixed-SHA-plus-precondition-test form.

**A fixed ancestor SHA is not necessarily a *reachable* one — where the read happens decides the blast radius.** `git show {base}:{file}` resolves only against the objects this checkout actually holds, and a shallow or partial clone (`--depth`, `--filter=blob:none` — an ordinary CI and sandbox provisioning shape) legitimately lacks an ancestor that `origin/main` really does carry. That is neither a history rewrite nor a regression, so the ancestor-precondition test above is the wrong instrument for it: `git merge-base --is-ancestor` fails there too, and failing loudly is exactly what you do *not* want when the cause is how the clone was fetched. Prefer calling the read **from inside the test body** — `tests/demo-visual-decision-adoption.test.js`'s `countAtPreChange(relPath, literal)` and `tests/session-limit-degrade-conformance.test.js`'s equivalent are the shape to copy — so an unreachable SHA fails only the control that needed it. When several tests share one snapshot and the read must stay at module scope, guard it and degrade just the control through node:test's `{ skip: reason }` option:

```js
let goRedControlSkip = false;
try {
  PRE_CHANGE = execFileSync('git', ['show', `${BASE_SHA}:${REL_PATH}`], { cwd: ROOT, encoding: 'utf8' });
} catch (err) {
  goRedControlSkip = `commit ${BASE_SHA} is not reachable in this checkout's git history ` +
    `— the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
}

test('go-red control: …', { skip: goRedControlSkip }, () => { /* reads PRE_CHANGE */ });
```

The stated reason is the load-bearing half — a bare `skip: true` makes an unfetched-history environment and a control that genuinely has nothing to check read identically in the runner's output. Record #2436 is the shipped instance: `tests/shaping-mode-needs-removal.test.js` and `tests/tidy-needs-worklist-rule.test.js` had unguarded module-scope reads turning one unreachable commit into two whole-file `node --test` failures, and the fix moves each control's assertions inside its test body alongside the guard.

**Normalize the base haystack exactly as the live one — a line-based baseline check is vacuous for every literal that wraps.**
The `grep -c -F` form above matches per *line*, and shipped skill prose is hard-wrapped, so a pinned literal that spans a
line break can never be found in the baseline whatever the base file actually contains: the check returns 0 for the wrong
reason and certifies a go-red it never exercised. This is `[IL-66]` one level up from the Project Conventions bullet above —
that bullet collapses the *live* haystack and needle; this one says the baseline needs the same normalizer, not a raw `grep`.
Run the `git show` output through the suite's own collapse helper and count on the collapsed string.
`tests/untrusted-record-content-conformance.test.js`'s `baseFileGrepCount` shipped the line-based form
(`out.split('\n').filter((line) => line.includes(literal))`), survived a dedicated fix round that added five *more* go-red
checks on top of it, and was corrected only at whole-branch review (`e971acc4d`, #1442). The literal it was vacuous for was
``from `grant-check.md`'s own rendered Step 3 output only``, which wraps mid-phrase in `plugin/skills/backlog/refine-mode.md`.

## Bumping the repo-wide Anti-Patterns row-count pin

`tests/bin-lib/skill-audit/anti-patterns.test.js` closes with one cardinality pin over the whole payload — `assert.strictEqual(total, N)`, the total Anti-Patterns table rows across every `plugin/skills/*/SKILL.md`. So *any* change that adds or removes an Anti-Patterns row goes red there rather than in the edited skill's own suite, and the pin is bumped by whoever landed the row. Two rules, both `[IL-99]`, and the running comment above the assertion is the only place the bump history lives — extend it, don't replace it:

- **Measure by running the parser on the working tree; never add the delta to the old number.** The arithmetic agreeing is a check on the measurement, not the evidence for it — a parser change, or a sibling branch's own row arriving in an upstream merge, moves the total independently of your diff. Get the number from a real run, then reconcile it against your expected delta.
- **Quote a diff that actually contains the row.** `git diff -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'` must return exactly the rows you claim and no others — but it returns *nothing* once the row is already committed, which is the ordinary case whenever the pin is bumped in a later commit than the row it counts. Quote the row's own commit instead (`git show {sha} -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'`) or the branch range (`git diff {base}...HEAD -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'`), and say in the comment which form you used. A grep that returns nothing is not evidence of a clean delta; it is evidence you ran the wrong grep.

Rows *reworded in place* change no count and need no bump — but they still belong in the comment, because the next bumper reconciling a delta against the diff will otherwise have to re-derive why the numbers moved by less than the `+`/`-` lines suggest.

**This is not the only repo-wide pin a new skill trips, and none of them live in the edited skill's own suite.** Adding one `SKILL.md`, or editing one `argument-hint`, moves at least four counters that no task-scoped test run will show: the Anti-Patterns total above; `plugin/bin/lib/skill-audit/context-cost.js`'s `DESCRIPTION_TOTAL_CEILING_CHARS` — the summed `description:` length across every shipped skill, bumped by the *same* two rules and carrying the same running comment (7900 → 8200 when `/claude-tweaks:release` landed, #2256, with that description already at 260/260 and no headroom to trim); `tests/reference-card-argument-hint.test.js`'s `| Command | What it does | Takes |` column, which an `argument-hint` edit desyncs; and `tests/skill-catalog-completeness.test.js`, which requires the new skill in `help/reference-card.md`, `help/context-flow.md` and `docs/getting-started.md`. Treat the full `npm test` as part of such a task's own completion check, not as a later gate — #2256 paid two controller commits after the fact for exactly this (ledger rows 92 and 99, `c00c3a11e`, `a1425d275`).

## Choosing a pin/sniff signal empirically

When a test or a skill procedure must *detect* a document class (a heading, a marker, a body shape), run a corpus scan over the live population before committing to the signal: count exactly which documents each candidate signal matches, and reject any candidate that matches a document it must not. Record #1071's scan of all 234 open records proved the line-anchored `## Leaves` heading matched exactly the four real legacy parents — while the plausible alternatives ("decomposition parent" phrase, "(parent)" title/body match) false-positived on the very bug report describing the defect. The scan result belongs in the record/spec as evidence, so the accepted residual risk is grounded rather than guessed.

