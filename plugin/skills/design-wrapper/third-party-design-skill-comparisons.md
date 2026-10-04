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
| Take an **external** reference (someone else's screenshot or live URL) and extract a structured design diagnosis from it | Nothing does this. `init.md` (4.0.2) says the opposite: "Do not ask for an aesthetic direction, emotional feel, visual references, colors, typography, or style during init." Direction comes from a dealt concept roll (`explore` mode → `concept-seed.mjs`), not from a reference. No `design-wrapper` mode accepts a reference image or URL as a design source — `live`'s URL and `survey`'s `--screenshots` are the app under review, not an outside reference. | **Does not do** |
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
