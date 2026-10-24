---
files:
  - plugin/bin/lib/issues/record.js
  - plugin/bin/lib/issues/record-payload.js
  - plugin/bin/lib/code-health/issue-payload.js
  - plugin/bin/lib/docs-health/issue-payload.js
  - plugin/bin/lib/harness-health/issue-payload.js
  - plugin/bin/lib/journey-health/issue-payload.js
  - plugin/bin/harness-health.js
  - plugin/skills/capture/SKILL.md
  - plugin/skills/reflect/SKILL.md
  - plugin/skills/wrap-up/leftover-routing.md
  - plugin/skills/build/micro-plan.md
  - plugin/bin/lib/issues/grouping.js
---

# Give an Agent-Filed Record a Key Files List

**Persona:** A claude-tweaks maintainer whose `/claude-tweaks:capture`, `/claude-tweaks:reflect`, wrap-up leftover routing, or a health sweep just filed a small, born-ready record — and who later watches `/claude-tweaks:dispatch` build it and wants the one-file fix to take `/claude-tweaks:build`'s micro-plan fast path instead of a full planning dispatch.
**Goal:** The filed record carries a parseable `## Technical Approach` / `### Key Files` section naming its repo-relative target file(s), so `build/micro-plan.md`'s condition 3 and `grouping.js`'s `extractKeyFilesSection` can read it.
**Entry point:** A checkout of this repo; any producer that composes a body through `specShapedBody` (`plugin/bin/lib/issues/record.js`).
**Success state:** The record body ends `## Release Note` → `## Technical Approach` → `### Key Files` → one `` - `{path}` — {change} `` bullet per file → the producer's footer; a fast-lane, `size:low` record naming one implementation file passes condition 3; a producer with no known files files a body byte-identical to before.

## Steps

### 1. Compose a body with `keyFiles`
- **URL:** `node -e "const {specShapedBody}=require('./plugin/bin/lib/issues/record.js'); console.log(specShapedBody({currentState:'c',deliverables:'d',acceptanceCriteria:'a',releaseNote:'No user-visible change.',filedBy:'capture',footer:'_Filed by \`capture\` via specShapedBody._',keyFiles:[{path:'plugin/bin/lib/dream/scan.js',change:'fix the scan'}]}))"`
- **Action:** Run it, then run it again without `keyFiles` (and once with `keyFiles: []`).
- **Should feel:** One optional argument, no new ceremony — the section appears only when files are passed, and the footer stays the last line.
- **Should understand:** `change` defaults to `modify`. Without `keyFiles` (or with `[]`) the output is byte-identical to the composer's pre-#2975 output. An absolute (posix or Windows) path, a `..` segment, an empty, multi-line, or backticked path, or a multi-line `change` throws an error naming `keyFiles` — `isRepoRelativeKeyFilePath` (exported from the same file) is the predicate it uses.
- **Red flags:** The new section landing before `## Release Note` or after the footer; any byte difference in the no-`keyFiles` case.

### 2. Watch a health sweep fill it from the finding's target
- **URL:** `plugin/bin/lib/{code,docs,harness,journey}-health/issue-payload.js`, via the sweep's `validate-findings` filing step
- **Action:** File (or `--dry-run`) a finding from each sweep and read the payload body's `### Key Files`.
- **Should feel:** Each record names the one file the finding is about, with no hand-editing.
- **Should understand:** code-health lists the `Anchor:` path with its `#symbol` stripped; docs-health lists `docs/{id}.md`; journey-health lists `docs/journeys/{journey}.md`; harness-health lists `finding.path` made relative to the sweep's repo root (`options.repoRoot`, passed by `bin/harness-health.js`). A harness memory file outside the repo, a new-skill candidate, or any LLM-written target that fails `isRepoRelativeKeyFilePath` omits the section rather than aborting the whole sweep run. Dispatch's grouping still reads these four origins from their header line, not from Key Files ([IL-83]) — the section is for the micro-plan gate.
- **Red flags:** An absolute, machine-local path under `### Key Files`; a single malformed finding stopping `validate-findings` for the whole batch.

### 3. File from a prose producer that knows its files
- **URL:** `plugin/skills/capture/SKILL.md` (shaped-body branch, steps 1 and 3), `plugin/skills/reflect/SKILL.md` (tangential staged finding), `plugin/skills/wrap-up/leftover-routing.md` (step 1 compose)
- **Action:** Capture a shaped body whose `## Technical Approach` carries a `### Key Files` list, or let reflect/wrap-up stage a finding that names its files.
- **Should feel:** The file list you already wrote survives filing instead of being dropped by the section split.
- **Should understand:** Each producer passes `keyFiles: [{ path, change }]` only when it knows the affected files — repo-relative only, omitted when unknown. A record filed before #2975 keeps its old body; nothing is backfilled.
- **Red flags:** A captured body whose Key Files bullets vanish from the filed record; a producer passing an absolute path and the compose throwing.

### 4. See the fast path taken at build time
- **URL:** `plugin/skills/build/micro-plan.md` (Applicability gate), `{run-dir}/work/{n}-spec.md`, `{run-dir}/decisions.md`
- **Action:** Dispatch a `ceremony:fast-lane`, `size:low` record whose Key Files names one implementation file (plus, optionally, its test).
- **Should feel:** A one-file fix goes straight to a one-task plan — no writing-plans dispatch, no plan audit.
- **Should understand:** Condition 3 counts implementation files only (tests, `*.test.*`/`*.spec.*`, and markdown that is not prompt prose such as `docs/**` excluded; markdown under `skills/`, `agents/`, or `commands/` counts as implementation — the same split `computeDiffFacts` applies, #3477), and `extractKeyFilesSection` returns the bullets' backticked paths. A record with no Key Files section still falls through ("could not parse" is never "parsed to zero").
- **Red flags:** `decisions.md` shows a full `/superpowers:writing-plans` dispatch for a fast-lane single-file record that carries Key Files; `extractKeyFilesSection` returning `[]` on a body that visibly has the section.

## Origin
- Created during build of #2975 (micro-plan gate unreachable for specShapedBody-composed records), the producer-side fix chosen over a gate fallback or materialize-time derivation.
- Related journeys: `add-a-fast-lane-skip-to-the-roster-1926.md` (the fast-lane roster the micro-plan skip belongs to), `harness-health-premise-check.md` (the sibling body-metadata line harness-health composes).
