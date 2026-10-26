---
name: compose-context-fencing
description: Use when planning or building a record that fences existing skill prose with `<!-- when: key=value -->` markers and adds a `bin/compose-context.js` call site — the survey that must run before the spec is written, how to derive the byte target, what may and may not be fenced, and the pointer sweep over every composed bundle. Keywords - compose-context, when marker, fence, fence survey, conditional prose, composed bytes, bundle, call site, unresolved key.
---

# Compose-context fencing

`docs/skill-authoring.md`'s "Conditional blocks and the composer" owns the *mechanism* — marker grammar, call-site form, the verbatim fallback sentence, the headings-outside-fences rule. This skill owns the *procedure* around it: what to measure before a fencing record is written, and what goes wrong when it isn't. The whole of #1987's decomposition (#1989-#1994) is the evidence, and five of its five fencing records shipped with a premise that measured false — the parent design's audit counted which files agents open, not which files carry branch prose.

## Survey before the spec, never after

A record that asserts "these files already contain branch-specific prose" is a hypothesis. Run the four-file survey shape at plan time — **classification, byte estimate, citation check, pin check, hazards** — on the axis the file really branches on, and put the numbers in Current State:

- **#1991** named four flow-lifecycle files; three measured **0 / 0 / 994 B** fenceable out of 31.6 / 30.3 / 39.1 KB (`manifesto.md`, the fourth, held 1,401 B).
- **#1993** named `_shared/worktree-setup.md` and `build/worktree-setup.md` on the `worktree-policy` axis; both measured **0 B** fenceable (16,671 / 20,032 B unconditional).
- **#1994** named `review-code` / `test-verify` bundles that came out **94,317 / 60,273 B** raw with three marker-free sources — over the gate under every combination. Nothing in scope was buildable and the record shipped no source diff.

**The axis is what the file branches on, not what the record calls it.** #1991's sources branch on `work-backend`, `work-links`, `ceremony`, `integration-model`, `worktree-policy`, and `transport` — not on `mode`; worse, `mode` collides by name with the build *execution* mode (`worktree` / `current-branch`), which is never a legal marker value. Grep for the branch words the file actually uses before trusting the record's key.

## Deriving the byte target

- **Size the AC from the branch-specific share, not the file total.** Additive fencing of prose that already exists is a small percentage: #1989 took the merge path from 58,612 to 55,995 B — **4.5%**. A record whose AC is derived from a whole file's size is arithmetically unachievable before task 1.
- **Measure the composed bundle *and* the raw file.** The hard gate for both a composed call site and a raw source file is the Read rail (`bin/lib/skill-audit/rail.js`, values in `budgets.js`): a bundle's composed max and each source's own `wc -c` are separate numbers, and either one can be the one near `RAIL_BYTES`. The remedy follows the number: a composed bundle near the rail gets another condition-specific passage fenced or composed; a raw source near it gets bytes cut or a genuinely lazy section (one some runs never read) moved out, since fencing leaves the raw file's bytes unchanged (the rail strips only the marker lines). Never a "read X now" split every run follows.
- **Check the max across combinations, and check it is reachable.** `github-pr-scan.md`'s composed max is the `transport=unresolved` combination (40,192 B) — a state the transport probe never produces; the runtime-reachable max is the `gh` bundle (40,184 B). Report both, and say which one binds.
- **A zero-fence call site buys the read-once shape, never bytes.** #1993 shipped one anyway (`build/SKILL.md` Common Step 1, a two-source ~36.8 KB bundle with no markers in either source), which couples both sources' growth under one composed rail check. Decide deliberately whether that trade is wanted; it is not free.

## What may be fenced

- **Per paragraph, not per section body** — whenever other prose cites that section under every condition set ("Root cause above", a table a gate reads). A fenced whole section renders as a bare heading in the untaken composition, which is correct only when nothing cites its body.
- **Mid-line branch-specific clauses stay unfenced.** The grammar is line-anchored, so splitting a sentence to fence half of it is a rewrite, not a fence — score it as 0 B fenceable and move on.
- **Never fence on `mode=confirm`.** `compose.js`'s `VOCAB.mode` lists it, but no source `resolve-conditions.js` reads can produce it: `config.yml`'s `mode` lever holds only `auto` / `hybrid` / `interactive` (a `confirm` run writes `auto` after its gate). Such a fence is unreachable from any real run directory.
- **Source paths in the compose sentence are `${CLAUDE_PLUGIN_ROOT}`-rooted**, never repo-relative `plugin/skills/…` — the repo-relative form resolves only inside a claude-tweaks checkout and makes every installed consumer fall back. Record bodies routinely spell the repo-relative form; the prose must not. `tests/skill-prose-plugin-root-invocations.test.js` pins it.

## Prove the composed bundle, don't read it

Composition can break a pointer that was fine in the raw file: "steps 1-4 below", "per the rule above", "item 4", a cross-reference to another item by number. The item it names may sit inside a branch this run dropped.

**The check is a grep, not a read-through, and it runs on every transport's bundle.** Extract every `step N`, `item N`, `above` / `below`, and `see X` phrase from each composed bundle and resolve it against that bundle's own labels. #1992's proof agent read the `mcp` bundles end to end and reported every pointer resolving; the whole-branch review then found four that did not — two of them in the `gh` bundle it had not been asked to read, and two in-bundle references to numbered items a linear read simply does not trip over. Pin the survivors (`tests/issue-claims-pr-scan-composition.test.js`, `tests/flow-manifesto-composition.test.js`).

**Composition can also make a pre-existing wrong instruction the only one a reader sees.** `_shared/issue-claims.md`'s "The lock" step 2 tells the reader to `jq -r '.content'` a `{content, sha}` wrapper — correct beside the `gh` bullet, wrong under `transport=mcp`, where the surviving bullet already wrote the content. Fencing did not create that; it removed the neighbouring text that made it read as one of two paths. Read each composed bundle as the only instruction its reader gets, and file what you find rather than assuming the raw file's correctness carries over.

## A phase call site: register the bundles, write one `--phase` line

Since #4027 a call site can be a *phase* rather than a step: `compose-context.js --run "$PIPELINE_RUN_DIR" --phase <name>` composes every bundle `plugin/bin/lib/compose-context/phases.js`'s `PHASES` registers for that phase (`first-call`, `second-call`, `review-lens` today). Each bundle is `{ step, sources, load }`: `load: 'always'` is read once, whole, before the child's first step; `'on-demand'` only when a step needs it. The registry, not the prose, names the sources.

- **The prose line carries no sources.** `--phase` excludes `--step` and source arguments (the CLI exits 2), and in prose any token after the phase name makes the rail scanner's row unparsed. A placeholder name (`--phase {phase}`) is documentation and is not measured.
- **The rail measures each bundle, not the phase.** `plugin/bin/lib/skill-audit/context-cost.js` expands a `--phase` line into one row per registered bundle, so every bundle meets `RAIL_BYTES` on its own, and an unknown phase in prose fails `composedRailViolations`. A registered phase with no shipped `--phase` line is a bundle nothing measures: `tests/dispatch-prompt-bundle-citations.test.js` fails on it, with a drop-each-phase discrimination proof.
- **Adding a phase or bundle is a registry edit plus one prose line.** `tests/bin-lib/compose-context/phases.test.js` pins the exact phase-key set, that each step passes `STEP_RE`, and that every source exists under `plugin/`. Update the key-set assertion in the same change.
- **A step name shared with a hand-written `--step` line shares its output file.** Both write `{run}/context/{step}.md`, so whichever composer ran last overwrites the other's bundle unless the source lists match. `phases.test.js` pins every hand-written `--step merge|claims` line's sources to the registry's; a new registered step that a hand-written line also composes needs the same pin.
- **A phase writes all its bundles or none.** `composePhase` reads every source of every bundle and validates every marker before the first write, so one bad marker anywhere in the phase leaves no bundle at all and the caller takes the documented fallback.

## Anti-patterns

| Pattern | Why it fails here |
|---|---|
| Writing the fencing spec from an audit of which files agents *open* | That audit does not say which files carry branch prose or which axis they branch on — the error behind five of five false premises in #1987's decomposition |
| Taking the record's named key as the file's real axis | `mode` collided with the build execution mode in #1991; the sources actually branched on `work-backend`, `ceremony`, `transport`, and three others |
| Setting the byte AC from the source file's total size | Additive fencing moves a few percent (#1989: 4.5%), so the AC is unachievable before task 1 and the record fails on arithmetic, not on build quality |
| Fencing a whole section body | It renders as a bare heading in the untaken composition — safe only when nothing cites the body, which the citation check is there to establish |
| Adding a compose sentence to a source file without a `wc -c` first | Two files in this run finished with 150 B and 829 B of raw headroom; the compose sentence itself cost 672 B in one of them |
| Proving the bundles by reading one of them end to end | Two of #1992's four broken pointers were in the transport bundle nobody was asked to read; a linear read does not trip over a reference to an absent numbered item |
| Copying a repo-relative source path out of the record body into the prose | It resolves only inside a claude-tweaks checkout, so every installed consumer silently takes the fallback path instead |
| Registering a phase in `phases.js` without shipping its `--phase` line, or listing sources on the line | The rail scanner only measures bundles a shipped `--phase` line reaches, and a line with sources after the phase name parses as unparsed; the registry is the one home of a phase's sources (#4027) |

## Evidence

- Ledger: `docs/plans/2026-09-06-skill-context-composer-ledger.md` (resolved and removed) rows 10, 13, 14, 15, 17, 19, 20, 22 — the survey misses, the byte-derivation rule, the two headroom pins, the unreachable `mode=confirm`, and the pointer-sweep guidance, each with its own measurement.
- Mechanism and grammar: `docs/skill-authoring.md`, "Conditional blocks and the composer".
- Composer: `plugin/bin/compose-context.js`, `plugin/bin/lib/compose-context/{compose,resolve-conditions,index}.js`.
- Gates: the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js` (raw files and composed bundles, via `plugin/bin/lib/skill-audit/rail.js`), `plugin/bin/lib/plan-audit/checks.js`'s `headroomCheck` against `RAIL_BYTES`, and `plugin/bin/lib/skill-audit/bloat.js`'s size-outlier signal (coherence, never a block).
- Suites: `tests/compose-markers-conformance.test.js`, `tests/issue-claims-pr-scan-composition.test.js`, `tests/flow-manifesto-composition.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`.
- Phase registry (#4027): `plugin/bin/lib/compose-context/phases.js`, `composePhase` in `plugin/bin/lib/compose-context/index.js`, `tests/bin-lib/compose-context/phases.test.js`, and the `--phase` cases in `tests/bin-lib/skill-audit/context-cost.test.js`.
