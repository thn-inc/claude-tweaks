# Research — Verify Mode

Loaded by `/claude-tweaks:research` when `$ARGUMENTS` opens with the positional token `verify`.
The bare-topic path (`/claude-tweaks:research <topic>`) never reads this file.

`verify` mode grounds a design *before* it is written. It is a different job from the bare-topic
web survey, not a fifth depth tier — which is why it is a leading positional mode token rather
than another `--mode=` value. Overloading `--mode=` would make `--mode=verify --mode=deep`
unexpressible.

## Lifecycle position

```
[ /claude-tweaks:research verify ] → /superpowers:brainstorming → /claude-tweaks:specify
```

Verify mode runs **before** a design is written, not after. A design session that starts from
unchecked assumptions bakes them in, and the cheapest moment to discover a premise is wrong is
before anything rests on it. Verify mode answers the claims a design would stand on — against this
repository, its history, its dependencies, and the web — and hands brainstorming a grounded
starting point instead of a guessed one.

It is human-invoked. Nothing invokes it automatically.

### Not reachable from `/claude-tweaks:flow`

`/flow` consumes ready sub-issue records, which are post-design by construction. Grounding a design
there is structurally too late to change it, so `verify` is deliberately **not reachable** from
`/flow` and is not an allowed flow step. Run it before `/superpowers:brainstorming`, not after
`/claude-tweaks:specify`.

## Input resolution

`/claude-tweaks:research verify [brief-path|#N]`

| Input | Resolution |
|---|---|
| A brief path — any document that already enumerates assumptions or open questions | Read its assumption and open-question entries; each becomes one candidate question. No skill currently produces such a brief (see below), so this path serves a hand-written note or a legacy artifact. |
| A record reference (`#N`) | Resolve the record and enumerate the claims its stated approach rests on. If a brief happens to exist for its topic, read that too. |
| Neither — a bare topic | **No-brief case.** Generate the candidate set from the topic directly: enumerate the claims the design would rest on if written today. |

**The no-brief case is the normal one.** Nothing upstream hands verify mode a ready-made list of
assumptions to check: `/claude-tweaks:challenge` was reshaped into a framing-check component and a
debiasing-lens escape hatch, and no longer produces a Brainstorming Brief. Verify mode therefore
generates its own candidates in most runs, and the brief-path row above is an accommodation, not
the expected input.

The candidate set is the input to the consequence filter below. It is never researched as-is.

### The bare-`verify` ambiguity

`/claude-tweaks:research verify` with nothing after it is ambiguous: `verify` could be the mode
token with a missing argument, or it could be the research topic (a user researching the word
"verify"). Resolve it by presenting a choice — never by silently assuming either reading. Call
`AskUserQuestion` with `question`: `"'verify' could be the verify-mode token or the research
topic. Which did you mean?"`, `header`: `"Input type"`, `multiSelect`: `false`, and:

- Option 1 — `label`: `"Verify mode (Recommended)"`, `description`: `"Run verify mode; I'll ask which brief, record, or topic to ground."`
- Option 2 — `label`: `"Topic named 'verify'"`, `description`: `"Run the bare-topic web survey on the literal topic \"verify\"."`

This mirrors the numbered-choice disambiguation `/claude-tweaks:specify`'s `## Input` already
establishes for its own topic-vs-path collision.

## The consequence filter

The filter is the entire cost-control mechanism. There is no budget knob and no per-source
authorization: a topic where nothing diverges correctly costs nothing, and a topic on new ground —
where you have no priors, so almost everything diverges — automatically authorizes more work. The
filter self-calibrates, which is why no separate green-field mode exists.

Apply it to every candidate question, one at a time:

> **If the answer surprised me, would the design change?**

The question has exactly two outcomes. It is not a severity scale and not a scoring rubric —
do not rank candidates by importance, confidence, or cost, and do not assign points.

| Outcome | Action |
|---|---|
| **Yes** — at least one answer leads to a different design | Keep it. It goes to routing (below). |
| **No** — both branches lead to the same design | Drop it, and log the drop. |

Both branches converging is the *only* reason to drop a question. A question is never dropped for
being expensive, broad, or unlikely to resolve.

**"The design would be whichever branch the answer picks" is divergence, not convergence.** A
question whose answers select between two different systems to build — different components,
different endpoints, different failure modes — is a keep, even when the design brief already
sketches both branches. Convergence means the *same* design gets built under either answer; it
does not mean "we have a plan for either answer." The distinction to draw: answers that change
*which* system gets built diverge; answers that only tune a parameter, threshold, or policy
*within* one system — the same components get built either way — converge, however important the
knob sounds.

**Dropping requires a positive demonstration — and when the brief states one, take it.** To drop,
you must be able to state the concrete reason both branches yield the same design, in the form the
drop log requires: a stated constraint that already fixes the choice, a value that is rebuilt
regardless of the answer. When the brief itself supplies that reason, the demonstration is in hand
— drop, citing it; keeping anyway is cost with no design consequence. When no such stated reason
exists, "this reads like a tunable detail someone can adjust later" is not a demonstration:
whether something is a knob on one design or a fork between two designs is exactly what priors
tell you, so on a no-priors topic that doubt resolves to keep.

Order the surviving questions by **divergence** — how different the two designs are — highest
first. That ordering is the output; it is what makes a partial run useful when one is cut short.

### Logging a drop

Every drop writes one line to the run's `decisions.md`, in the Entry schema
`skills/_shared/auto-decision-log.md`'s "## Entry schema" section defines — cited here, not
restated.

Concretely, under a `## /research` heading:

```
- AUTO 14:22:07 — verify filter: dropped "does the cache need a TTL?" — both answers lead to the same design (the module is rebuilt per-run either way). Reversibility: high.
```

A drop is `AUTO`, never `STAGED` or `KEPT-PROMPT`: the filter acted, and the log is how that action
stays auditable. Dropping silently is forbidden — an unlogged drop is indistinguishable from a
question nobody thought of.

**When no run directory resolves** — the normal case for a direct human invocation — there is no
`decisions.md` to append to, and `/claude-tweaks:research` is not on the standalone-auto allowlist
in `skills/_shared/run-dir-resolution.md`'s step 4, so it may not create one. Report the drops inline in the
run's own output instead, in the same one-line-per-drop shape. The requirement is that a drop is
never silent; the log file is where that lands when a run exists, not the only place it may land.

## Question shape: falsifiable vs. unfalsifiable

Every surviving question is classified by shape before it is researched, because the two shapes
return different things.

| Shape | Meaning | Routes to | Returns |
|---|---|---|---|
| **Falsifiable** | A specific source could show the claim is wrong — "does `X` already handle `Y`?", "is this file loaded at startup?" | The source registry | A **verdict** |
| **Human-only** | No source settles it because the answer is intent, priority, or an unstated constraint — "which of these matters more to us?" | The registry's human terminator | A **question for the user**, not a verdict |
| **Unfalsifiable** | No single source settles it — "how do other tools approach this?", "what are the tradeoffs here?" | Survey | A **landscape** |

The third row is not a weaker form of the second. An unfalsifiable question has an answer out in
the world that a survey can approximate; a human-only question has an answer only in someone's
head, and surveying for it produces a confident landscape about the wrong thing. When a question
could be read either way, ask whether any amount of reading would settle it — if not, it is
human-only.

The registry itself — every source, what each can falsify, its confidence tier, and how it is
read — lives in `source-registry.md` in this skill's directory, along with the routing rules, the
dispatch procedure, and the verdict shape. Read it when a question routes to the registry.

### Depth tiers bound survey breadth only

`--mode=quick|standard|deep|ultradeep` **bounds survey breadth only** — how wide the landscape
sweep goes for unfalsifiable questions. The tiers do not govern falsifiable questions at all: a
verdict is settled by whether a source falsifies the claim, and no depth setting makes that answer
more or less true. A falsifiable question is researched until a source settles it or the sources
are exhausted, regardless of the tier in effect.

### Absence is a finding

A source that returns nothing has answered the question. Report it as such — "no precedent exists"
— never omit it. A silently-absent result is indistinguishable from a lookup that failed, and
silence cannot be found by keyword search later. This binds hardest on history- and
telemetry-shaped sources, where "we have never done this before" is frequently the single most
design-changing thing the run surfaces.

## Auto-mode behavior

Survey depth resolves through the standard chain in `skills/_shared/auto-mode-card.md` —
**CLI arg > pipeline config > project policy > skill default** — never by prompting:

1. **CLI arg** — an explicit `--mode=` on this invocation always wins.
2. **Pipeline config** — the run directory's `config.yml`, when one resolves.
3. **Project policy** — `.claude-tweaks/policy.yml`. Execute 2-3 as ONE resolver call — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" research-mode` (drop `--run` when no run directory resolves); a null `value` in the envelope means neither source set `research-mode` — fall through.
4. **Skill default** — `standard`.

Verify mode introduces **no new mid-flow stop**. The Mode Picker's interactive prompt is skipped
whenever `auto` is active or `$PIPELINE_RUN_DIR` is set, exactly as the bare-topic path already
does; the resolved tier is logged rather than asked.

The bare-`verify` ambiguity above is not an exception to this, but it does need its own rule.
`verify` is not reachable from `/claude-tweaks:flow` (see Lifecycle position), so no orchestrator
invokes it as a pipeline step — but a run directory can still resolve here:
`_shared/run-dir-resolution.md`'s step 2 most-recent-matching-directory fallback can resolve one with no
orchestrator at all.

- **No run directory resolves** — a direct human invocation. Present the choice above. This is the
  normal case.
- **A run directory resolves** — do not prompt, and do not guess a target. A bare `verify` carries
  no brief, no record, and no topic, so the missing input is a *target*, not a mode: picking either
  reading still leaves nothing to research. Log `NEEDS_CONTEXT` to the run's `decisions.md` per
  `skills/_shared/auto-mode-contract.md` — "if the skill genuinely needs information not in the
  Config Manifesto, it logs `NEEDS_CONTEXT` to the auto-decision log and surfaces it at the Review
  Console — it does not stop mid-flow" — and return with no verdicts. Returning empty is not a
  gate: the pipeline continues, and the missing target surfaces at the Review Console.

Every verdict writes one `decisions.md` line, in the same entry schema a filter drop uses.

## Output

Verify mode writes no dated report directory. `SKILL.md`'s Workflow Steps 2 and 6 — which
construct `{root}/[YYYY-MM-DD]-[topic-slug]/` and write `report.md` — are exactly the steps it
routes around, so `--output=<path>` has nothing to override here. `--engine=auto|inline` does not
apply either: a falsifiable question is settled by the source registry, not by `/deep-research` or
the inline WebSearch method.

| Output | Destination |
|---|---|
| One line per filter drop, and one per verdict | The run's `decisions.md` when one resolves, inline in the run output otherwise (see Logging a drop) |
| The verdicts themselves | Reported inline to the caller. **They are not persisted anywhere, and no record currently owns making them so.** A write-back was scoped as #178, against `/claude-tweaks:challenge`'s Brainstorming Brief; that brief no longer exists and the record was closed as obsolete. Durable verification provenance needs a fresh record shaped against whatever artifact should carry it. |
| The landscape, for unfalsifiable questions | Reported inline to the caller alongside the verdicts. Not persisted anywhere — same as the verdicts above. |
