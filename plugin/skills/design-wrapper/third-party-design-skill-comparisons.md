# Third-party design skills vs. Impeccable — comparison notes

One file for every evaluation of a third-party design skill against Impeccable, one `##`
section per skill. Read this before proposing that `design-wrapper` route any mode to something
other than Impeccable. Reference only — no mode's dispatch logic loads it.

Anthropic's native `/design` skill is deliberately **not** here: its record (#2690,
`claude-design-skill-comparison.md`) is a first-party skill decided on a structural invocation
block, not a feature comparison, and folding it in would bury that argument. Later third-party
evaluations (e.g. #2694's Taste / Web Design Guidelines) belong in this file as further sections
rather than as new sibling files.

## Hallmark (#2695)

### What was compared, and what was not

**Compared from published source, read on 2026-10-04.** Hallmark is not installed on the machine
this record was built on, and it was not installed for this record. Everything below about
Hallmark traces to its public repository, [Nutlope/hallmark](https://github.com/Nutlope/hallmark),
at commit `13ac0ec7e148655948100b6396439e481361d690`. Files read in full:
[`README.md`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/README.md),
[`references/study.md`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/skills/hallmark/references/study.md),
[`references/design-md.md`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/skills/hallmark/references/design-md.md),
[`package.json`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/package.json),
and Hallmark's own study test write-up,
[`site/_tests/verbs/study/notes.md`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/site/_tests/verbs/study/notes.md).
Read in part:
[`SKILL.md`](https://github.com/Nutlope/hallmark/blob/13ac0ec7e148655948100b6396439e481361d690/skills/hallmark/SKILL.md)
(the verb table and the `hallmark study` section). **Not read:** `slop-test.md`,
`anti-patterns.md`, the theme, macrostructure, and component references, and the `audit` /
`redesign` verb files — so this note makes no claim about the quality or content of Hallmark's
anti-slop rules beyond what its README states.

The Impeccable side was read from the plugin cache: the agent definitions at the pinned plugin
version 4.0.2 (`impeccable-plugin.md`'s pin) and at 4.5.0, plus 4.0.2's `reference/init.md`,
`visualize.md`, `new-work.md`, `extract.md`, and `document.md`.

**Not exercised — the remaining gap against this record's first Deliverable.** The record asked
for a hands-on trial of `hallmark study` against a sample build, alongside Impeccable's asset and
finish-review passes. That trial was **not run**: no Hallmark output was produced, and no
side-by-side of real output exists. Every statement below about what `study` does is a statement
about what its published instructions say it does, not an observation of its behaviour. The
decision below is therefore a source-level decision; "Revisit when" names the trial that would
turn it into an evidence-level one.

### What Hallmark is

Per its README: a design skill for Claude Code, Cursor, and Codex ("Made by Together AI") with
four verbs — a default build verb, `hallmark audit`, `hallmark redesign`, and
`hallmark study <screenshot | URL>`. The README describes a catalog of macrostructures and
twenty-one themes and "fifty-seven slop-test gates plus a pre-emit self-critique". It is prose
only: the repository ships `SKILL.md` plus a `references/` tree, and `package.json` declares
`"files": ["skills"]` — no CLI, no scripts, no agents.

### What `study` does (per `study.md`)

- **Input:** one screenshot (image mode) or one `http(s)` URL (URL mode). One source per
  diagnosis; blending several references is refused.
- **Extraction:** a five-step pass — surface (paper and accent colour), type, structure, motion,
  rhythm — filling a fixed structured schema. Structure is expressed in Hallmark's **own**
  vocabulary: one of its named macrostructures plus its component archetypes (`H2-Split`,
  `Ft3-Index`, …) and their variation knobs.
- **Image mode** is a vision pass: colours are estimated bands, fonts are named by *role* only
  with one or two candidates ("Fonts cannot be identified from screenshots reliably").
- **URL mode** uses the harness's WebFetch on the page's HTML and same-origin CSS: exact colour
  values and declared font names, but rhythm (density, asymmetry) is marked
  `unknown (URL mode)`. It carries an SSRF-style safety list, treats fetched content as
  untrusted, and falls back to asking for a screenshot on auth walls and client-rendered SPA
  shells.
- **Output:** a short *diagnosis report*, then a stop. "Do not write code in the same turn as
  the diagnosis. Wait for confirmation." The user then chooses: build with the DNA (hand-off to
  the default or `redesign` verb), emit a portable `design.md`, or stop.
- **Explicitly not a cloner:** "`study` extracts structure, not pixels." Imagery is never
  copied; template-marketplace sources are refused; URL-mode `design.md` emission requires the
  user to attest the source is theirs or a public reference for their own brand.

So the reel's description — "pull styling from a reference screenshot or website and apply it to
a build" — is accurate in outline, with one correction: by its own contract, `study` transfers a
structural diagnosis and a token/role set, not the reference's look pixel-for-pixel.

### Is that something Impeccable already does?

| Capability | Impeccable (as wrapped by `design-wrapper`) | Verdict |
|---|---|---|
| Take an **external** reference (someone else's screenshot or live URL) and extract a structured design diagnosis from it | Nothing does this. `init.md` (4.0.2) says the opposite: "Do not ask for an aesthetic direction, emotional feel, visual references, colors, typography, or style during init." Direction comes from a dealt concept roll (`explore` mode → the engine's `concept-seed` verb), not from a reference. No `design-wrapper` mode accepts a reference image or URL as a design source — `live`'s URL and `survey`'s `--screenshots` are the app under review, not an outside reference. | **Does not do** |
| Match a build against **a** reference image | `impeccable-asset-producer` and `impeccable-finish-reviewer` both work against a reference — but the reference is Impeccable's **own approved comp**, generated by its `visualize` step from the project's committed world, never an outside site. The asset producer "work[s] only from the approved mock" to produce clean raster assets ("Do not redesign"); the finish reviewer judges a finished build against its direction contract and, when one exists, that comp. | **Partly** — same verb ("match a reference"), different reference and opposite intent |
| Fidelity direction | At pinned 4.0.2 the finish reviewer compares "commitment and finish, never composition; the card is a bar, not a layout." At 4.5.0 it has moved toward measured fidelity to the approved comp (a per-region diff report, mandatory TYPE / MATERIAL / GROUND rows). Hallmark `study` goes the other way by design: looser than the reference, never pixel-faithful. | **Different axis** |
| User-supplied visual constraints | Partial intake only: `init.md` records a volunteered "binding visual constraint … without expanding it" under PRODUCT.md's Brand Commitments, and `new-work.md`'s "category standard" exit asks for "two or three products this should sit alongside" and makes "their craft level the bar" — a quality bar, not an extraction. | **Partly** |
| Extract tokens/patterns | `extract` consolidates the **project's own** repeated components and hard-coded values into its design system; `document` writes DESIGN.md from the project's current visual system. Both read the codebase being built, not a reference. Name collision only. | **Does not do** (for external sources) |
| Lock a portable design-system file | `explore` mode's Lock-in runs upstream `document --seed`, which writes `DESIGN.md`. Hallmark's "lock the DNA" writes `design.md`. | **Overlap** — see the collision below |
| Anti-slop gating | `test` mode runs Impeccable's CLI detector deterministically at a pinned version; `review`/`polish` dispatch critique, audit, and the refinement set. Hallmark's gates are a prose checklist the model applies to itself. Not compared in depth (Hallmark's `slop-test.md` was not read). | **Overlap** in purpose; depth not assessed |

**Answer to the record's question:** Hallmark's reference-matching is **not redundant** with
Impeccable. The asset-producer and finish-reviewer roles match a build to an *internally
generated, user-approved* comp; `study` reads an *external* reference and turns it into a
starting direction. Those are different jobs at different points in the lifecycle: `study` is an
input to direction-setting (where `explore` and `/specify`'s design questions sit), while the two
Impeccable roles are downstream production and review. The one genuinely unserved need it points
at is "I have a reference I like — start from that," which today a user can only express as
free text.

### Why it is not adopted

Complementary in capability does not make it routable from `design-wrapper` today:

1. **Two design-system files, one filename.** Hallmark writes `design.md` at the project root,
   matching "the project's case convention (`design.md` or `DESIGN.md`)", and every later
   Hallmark run "read[s] `design.md` first". Impeccable's `DESIGN.md` is a different format (YAML
   token frontmatter plus fixed sections, per `document.md`). In a project with a locked
   Impeccable `DESIGN.md`, Hallmark's stated no-overwrite rule leaves the system alone but
   refreshes an `## Exports` section inside it — a third-party write into the file
   `design-wrapper` treats as upstream-owned ("upstream writes DESIGN.md, never this wrapper").
   Not exercised; read from `design-md.md`'s No-overwrite policy.
2. **Vocabulary does not transfer.** The diagnosis is expressed in Hallmark's macrostructure,
   archetype, and theme names. Impeccable's direction contract (THESIS, OWN-WORLD, STORY, FIRST
   VIEWPORT, FORM) has no slot for them, and the 4.5.0 finish reviewer checks FORM for the seed
   key the concept roll printed — a direction that came from a `study` diagnosis has none.
3. **Interactive by contract.** `study` stops and waits after the diagnosis. That fits only an
   interactive mode like `explore`; no pipeline phase could call it.
4. **Nothing to pin.** The repository has no tags and no releases; `package.json` says `1.1.0`;
   the install command (`npx skills add nutlope/hallmark`, "Re-run any time to update") tracks
   the default branch. Every Impeccable contract this wrapper relies on is verified against an
   exact pinned version (`impeccable-plugin.md`, `impeccable-cli.md`); a prose-only skill that
   changes under an unversioned install offers nothing equivalent to verify against.
5. **Harness-dependent.** URL mode depends on the harness's WebFetch and cannot read
   client-rendered pages; image mode needs the user to attach a capture.

### Decision

**Stay Impeccable-only; do not route any `design-wrapper` mode to Hallmark.** Hallmark's
`study` is **complementary, not redundant** — Impeccable has no external-reference intake — but
the two skills each want to own the project's design-system file and direction vocabulary, and
Hallmark has no versioned contract to pin. A user who wants a reference-led start can run
`hallmark study` themselves for the diagnosis alone (the diagnosis "is a complete deliverable on
its own") and bring its findings to `/claude-tweaks:specify` or `explore` as free-text direction,
without letting it emit `design.md` into an Impeccable-managed project.

### Availability and stability

- Public, MIT-licensed, created 2026-04-27, last pushed 2026-08-06 (the commit above).
- No tags, no releases; `package.json` version `1.1.0`. Install tracks the default branch.
- Counts in the published docs disagree with each other (README: twenty-one themes; one
  `study.md` fallback row still says "one of the eight") — a sign the references move faster
  than they are reconciled, and a reason not to quote its numbers as stable.

### Revisit when

- Someone runs the trial this record could not: `hallmark study` on a reference screenshot
  **and** a reference URL against a sample build, in a scratch project with no Impeccable
  `DESIGN.md`, with the diagnosis and built output kept — then compares that output against
  the same brief taken through `explore` plus Impeccable's asset-producer and finish-reviewer
  passes. That is the evidence this note lacks.
- Impeccable gains its own external-reference intake (which would make `study` redundant), or
- Hallmark ships tagged releases, giving `design-wrapper` something to pin.

## Taste / Web Design Guidelines (#2694)

### What was compared, and what was not

**Compared from published source and live catalog probes, read on 2026-10-06.** Neither skill
is installed in this session, registered in the Claude Code skill registry here, or present in
any plugin marketplace this account has enabled — verified directly, the same way #2690 verified
native `/design`'s invocation block, rather than assumed:

- `SearchSkills` (keywords `taste`, `anti-slop design` and, separately, `web design guidelines`,
  `vercel accessibility audit`) returned `{"results":[]}` for both.
- Invoking either by name through the Skill tool returns `Unknown skill: taste. Did you mean
  test?` and `Unknown skill: web-design-guidelines` respectively — the same "not registered"
  signature #2690 used to distinguish absence from a deliberate invocation block (native
  `/design`'s `disable-model-invocation` refusal reads differently from either of these).
- `SearchPlugins` (keywords `taste`, `web design guidelines`) surfaces no plugin named or
  described as Taste at all, but does surface **`audit-suite`** (community, Anthropic Directory
  marketplace) — a 16-skill bundle whose description names `web-design-guidelines` and
  `emil-design-engineering` (the same Emil critic `critics.md`'s roster already routes to) among
  its bundled skills. `audit-suite` is listed, not enabled, for this account — it is one
  `/plugin install` away, unlike Taste, which has no presence in this catalog under any name and
  would require the external `npx skills add` installer instead.

Everything below about what each skill *does* traces to its published source, read the same way
the Hallmark section above reads `hallmark study` — a description-level comparison, not a
hands-on trial. **Not exercised — the same gap the Hallmark section's own first Deliverable left
open.** The record asked for a trial "against a sample build alongside Impeccable's own passes";
that trial was not run, for the same reason native `/design` and Hallmark's trials were not run:
nothing to invoke. Taste's source was read via its GitHub README (`Leonxlnx/taste-skill`, MIT,
default branch `main`, no tagged commit to pin to — see Availability below); Web Design
Guidelines' source was read via its `SKILL.md` on `vercel-labs/agent-skills`' default branch, plus
the live rule source it itself fetches (`vercel-labs/web-interface-guidelines`). Not read in
depth: Taste's eight non-default sub-skills (`gpt-taste`, `image-to-code`,
`redesign-existing-projects`, `minimalist-ui`, `industrial-brutalist-ui`,
`stitch-design-taste`, `full-output-enforcement`, the three `imagegen-*` skills) and Web Design
Guidelines' full rule list beyond the category names its own documentation groups them under.

### What Taste is

Per its README: "The Anti-Slop Frontend Framework for AI Agents" — a family of SKILL.md files
(no CLI, no deterministic scanner) compatible with Claude Code, Cursor, Codex, and others,
installed via `npx skills add https://github.com/Leonxlnx/taste-skill`. The default skill
(`design-taste-frontend`, "v2 experimental") reads the brief, infers a design language, and
tunes three numeric 1–10 dials before generating UI: `DESIGN_VARIANCE` (layout experimentation),
`MOTION_INTENSITY` (animation depth), `VISUAL_DENSITY` (information per viewport). Sub-skills
specialize the same mechanism by output style (`minimalist-ui`, `industrial-brutalist-ui`),
target model (`gpt-taste`), input mode (`image-to-code`), or task (`redesign-existing-projects`,
three `imagegen-*` asset skills). The whole family is **generation-time** guidance: prose
instructions the model follows *while writing code*, not a post-hoc scan or review step.

### What Web Design Guidelines is

A single-purpose audit skill: given a request to review UI code, it fetches the current Vercel
Web Interface Guidelines live from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`,
reads the files or patterns named, checks each against the fetched rule set, and reports
violations in `file:line` format with a suggested fix. Published category coverage: accessibility
(aria, semantic HTML, keyboard handlers), focus states, forms, animation (including
`prefers-reduced-motion`), typography, images, performance, navigation/state, dark mode/theming,
touch/interaction, and locale/i18n — order 100+ individual rules across those groups. It ships
as part of Vercel's own `vercel-labs/agent-skills` catalog (install:
`npx skills add vercel-labs/agent-skills@web-design-guidelines`) and is also reachable, bundled,
through this account's `audit-suite` community plugin. It is **post-hoc audit only** — no
generation guidance, no dials, nothing to tune.

### Is either something Impeccable already does?

| Capability | Impeccable (as wrapped by `design-wrapper`) | Verdict |
|---|---|---|
| Generation-time anti-slop steering (palette, layout, motion) | `explore` mode deals competing visual-identity directions via the engine's `concept-seed` verb; `polish`'s `animate`/`delight` dispatch is driven by `Design-intent:` metadata and audit `suggestion` fields, not numeric dials. Different mechanism, same stated goal as Taste's dials. | **Overlap** in purpose, different mechanism — not assessed head-to-head |
| Deterministic anti-slop detection | `impeccable-cli.md`'s pinned 4.1.0 `detect --json` scans for named anti-patterns including `ai-color-palette` ("Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs") — the identical complaint Taste's README opens with. | **Overlap** — same target, Impeccable's version is deterministic and version-pinned |
| LLM craft critique (layout, typography, motion, rhythm) | `critics.md`'s roster (`emil-design-eng`, `review-animations`) plus Impeccable's native `critique`/`audit` cover exactly Taste's stated dimensions ("stronger layout, typography, motion, and rhythm"). Notably, Emil is also one of `audit-suite`'s bundled skills under its own name (`emil-design-engineering`) — the same critic reached two ways. | **Overlap** |
| Accessibility / WCAG-style audit (contrast, aria, focus states, forms, i18n) | Not covered. Impeccable's `detect` rule set is anti-slop/aesthetic, not accessibility (no hit for `accessib`/`aria`/`contrast`/`focus-visible` anywhere in `impeccable-cli.md`). The LLM critics (`design-craft.md`'s relevance map, `critics.md`'s roster) are craft-focused, not compliance-focused. The only accessibility-adjacent check anywhere in this repo is `_shared/criteria-prelaunch.md`'s `alt-text` and `mobile-breakpoints` rows — `/claude-tweaks:code-health`'s `focus=prelaunch` lens, a presence-only check ("every `<img>` carries an `alt` attribute") on a completely different skill, not `design-wrapper`. | **Does not do** — the one genuine, unserved gap either skill points at |
| Motion-preference accessibility specifically | Partial: `command-map.md`'s Frequency Gate guardrail notes "Impeccable's own mandatory `prefers-reduced-motion` rule baked into every `animate` call" — one of Web Design Guidelines' ~11 category groups is already enforced, narrowly, inside one command dispatch path. | **Partly** |
| Portable design-system / token lock-in | `explore`'s Lock-in runs `document --seed`, writing Impeccable's `DESIGN.md`. Neither Taste nor Web Design Guidelines proposes a competing design-system file — Taste's dials are runtime parameters, not a locked artifact; Web Design Guidelines emits a violation report, not a token file. | **No collision** (unlike Hallmark's `design.md`) |

**Answer to the record's question.** Taste's core value proposition — steer generation away from
generic, AI-recognizable UI — is already Impeccable's stated purpose end to end: a deterministic
detector for the exact anti-pattern Taste's README leads with, an `explore`-mode direction-dealing
step, and an LLM critic roster covering the same craft dimensions. Nothing here claims Taste's
*particular* dials produce worse or better output than Impeccable's mechanism — that comparison
needs the trial this note could not run — but the *job* substantially duplicates Impeccable's,
unlike Hallmark's external-reference intake, which filled a dimension nothing else covered. Web
Design Guidelines is the opposite case: its accessibility/compliance rule set is **not**
duplicated anywhere in this wrapper's Impeccable-routed passes, and is the one genuinely unserved
need this record surfaces — the same shape of finding as Hallmark's "I have a reference I like"
gap, just in a different dimension (compliance audit, not direction-setting).

### Why it is not adopted

1. **Taste duplicates Impeccable's own stated purpose**, per the capability table above, with no
   trial evidence that its dial-based mechanism does the job better — the conservative call absent
   evidence is not to add a second, unpinned path to the same goal.
2. **Neither skill has a contract `design-wrapper` could pin the way it pins Impeccable.**
   Taste: no tags, no releases (`Leonxlnx/taste-skill`'s Releases page: "There aren't any releases
   here"); 167 commits against a 92.9k-star, 6.3k-fork, MIT repo, install tracks `main`. Web
   Design Guidelines is the harder case: it does not even pin at *install* time — its own
   `SKILL.md` instructs a **live fetch** of a third repository's `main` branch
   (`vercel-labs/web-interface-guidelines/main/command.md`) on every single invocation, so the
   rule set two runs of the identically-versioned skill check against can differ without the
   skill itself changing at all. `impeccable-cli.md`'s and `impeccable-plugin.md`'s pin discipline
   exists precisely to prevent this class of silent drift (`[IL-89]`) — a skill that is
   unpinnable *by design* is the opposite of what that discipline asks for.
3. **No dispatch contract to receive either output.** `design-wrapper`'s modes dispatch to a
   fixed roster (`critics.md`) or Impeccable's own CLI/LLM surface (`impeccable-cli.md`,
   `command-map.md`); a `file:line` violation list (Web Design Guidelines) or a tuned-dial
   generation pass (Taste) has no normalized shape to merge into either, the same boundary
   `critics.md`'s own header states for why there is no open manifest: "arbitrary skills' output
   shapes cannot be normalized at the boundary."
4. **Web Design Guidelines' gap is real but narrow enough to not justify a new routed dependency
   today.** It is reachable without installing anything new as a manual, standalone audit (a
   human or agent can run it directly, same as Hallmark's `study` "is a complete deliverable on
   its own") without `design-wrapper` routing a mode to it.

### Decision

**Stay Impeccable-only; do not route any `design-wrapper` mode to either skill.** Taste
duplicates Impeccable's anti-slop purpose through an unpinnable, unversioned mechanism with no
evidence it outperforms Impeccable's own deterministic detector and critic roster. Web Design
Guidelines points at a real gap — this wrapper has no accessibility/WCAG-style audit anywhere —
but its live-fetch-on-every-run design is structurally unpinnable, worse than Hallmark's
untagged-but-installed case, and it has no slot in the critic roster or command-map dispatch
contract to land in. The accessibility gap is logged here as the record's actual finding, not
papered over: a future accessibility critic row (the same unblocking condition `critics.md`'s
"Native row" section already uses for a different gap — "added only if... Impeccable's native
critique/audit prove insufficient") is the right shape for closing it, if and when it is pinnable.

### Availability and stability

**Taste** (`Leonxlnx/taste-skill`): public, MIT-licensed. Observed via web search on 2026-10-06:
~92.9k stars, ~6.3k forks, 167 commits on `main`, 37 open issues, 36 open PRs (the record's own
Gotchas text, carried from the source reel, cites "76k GitHub stars" — the two figures disagree,
consistent with a fast-moving repo rather than a transcription error on either side; neither
figure should be read as a stable count going forward). No tags, no releases. Install
(`npx skills add https://github.com/Leonxlnx/taste-skill`) tracks the default branch.

**Web Design Guidelines** (`vercel-labs/agent-skills`, `skills/web-design-guidelines/`): public,
MIT-licensed, published by Vercel. No tags/releases observed for the skill path specifically; the
most recent commit touching it was reported as short hash `ba46938` ("Fix SKILL.md frontmatter
formatting for web-design-guidelines (#28)"), dated 2026-01-16 — read through a fetch-and-summarize
tool rather than a direct `git log`, so treat the hash as indicative, not verified byte-for-byte.
Independent of the skill's own commit history, its rule *source* (`vercel-labs/web-interface-guidelines`)
is fetched live from `main` on every run — there is no version to report for what a given
invocation actually checked against, by the skill's own design.

### Revisit when

- Someone runs the trial this record could not: install `audit-suite` (already visible in this
  account's catalog, no external installer needed) or `vercel-labs/agent-skills@web-design-guidelines`
  directly, and `Leonxlnx/taste-skill` via `npx skills add`, against the same sample build
  Impeccable's asset-producer and finish-reviewer passes already cover — keep the real violation
  list and the real generated output, and compare both against Impeccable's own `detect` findings
  and critic feedback on the identical build.
- `design-wrapper` grows an accessibility-focused critic row (closing the gap this note
  identifies) — at that point Web Design Guidelines' rule *content* (not its live-fetch mechanism)
  is the natural reference to pin a vendored snapshot against, or
- Web Design Guidelines starts shipping a pinnable snapshot of its rule source instead of a live
  per-run fetch, or Taste ships tagged releases — either would give `design-wrapper` something
  to pin the way it pins Impeccable.
