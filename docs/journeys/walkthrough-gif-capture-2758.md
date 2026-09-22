---
files:
  - plugin/skills/walkthrough/SKILL.md
  - plugin/bin/walkthrough-encode.js
  - plugin/bin/lib/walkthrough/encode.js
  - plugin/bin/lib/walkthrough/select.js
  - plugin/bin/lib/gif/encoder.js
  - plugin/bin/lib/gif/palette.js
  - plugin/bin/lib/gif/lzw.js
  - plugin/bin/lib/gif/png-decode.js
  - plugin/agents/qa-agent.md
---

# Capture a Shareable Walkthrough GIF via /walkthrough

**Persona:** A developer who just finished building a feature and wants a shareable animated GIF for the PR description or a chat message, without hand-recording a screen capture.
**Goal:** Turn an existing QA story's execution into an animated GIF plus an ordered caption list, saved somewhere durable — not the QA screenshots that already exist and get thrown away under `.claude-tweaks/artifacts/`'s 30-day cleanup.
**Entry point:** `/claude-tweaks:walkthrough --story {id} --base {url}` (or `#N` to resolve a story from a record's Key Files, or bare to resolve from the current branch's changed files).
**Success state:** A GIF and its `{name}.md` caption list land at the developer's chosen location (`docs/walkthroughs/{story-id}.gif`+`.md` by default), ready to attach to a PR or drop in chat — nothing is written to the repo or committed without that explicit choice.

## Steps

### 1. Resolve the story — `/claude-tweaks:walkthrough --story checkout-happy-path --base http://localhost:3000`
- **URL:** `/claude-tweaks:walkthrough --story checkout-happy-path --base http://localhost:3000` (or `/claude-tweaks:walkthrough {story-path} --base {url}`, `/claude-tweaks:walkthrough #2758 --base {url}`, or bare with `--base` only)
- **Action:** Point the skill at an existing schema-v2 story — by direct path, by `--story` id, by record number (Key Files → `selectStories`), or by the current branch's changed files when invoked bare. `--base` is always required.
- **Should feel:** No re-authoring — the flow being shared is the same one QA already exercises, not a fresh description of it.
- **Should understand:** This never authors a new story. Zero matches offers `/claude-tweaks:stories` and stops; more than one match asks which, listing candidates by `id` and `matchedBy`.
- **Red flags:** The skill guessing a story on ambiguity instead of asking; re-deriving steps through `/claude-tweaks:stories` rather than reading the story YAML directly; proceeding without `--base`.

### 2. Watch it execute — one frame per step
- **URL:** *(no command — the skill drives Playwright CLI)*
- **Action:** Nothing. The skill opens one Playwright CLI session, sets the viewport to `1280x720` explicitly, then for each story step: resolves the locator via `snapshot`, performs the ref-based action (`click`/`fill`/`check`/`hover`), waits `--settle-ms`, and screenshots to a session-scoped temp path.
- **Should feel:** Like watching the QA run happen again, except this time the frames are being kept instead of discarded.
- **Should understand:** A locator miss stops the whole run and reports the step number — the step mapping is identical to what `qa-agent.md` Section 4 already uses for QA, so a walkthrough frame is exactly what QA would have clicked.
- **Red flags:** Falling back to a CSS selector on a locator miss; a frame path under `.claude-tweaks/artifacts/`; a viewport resize mid-run (would desync frame dimensions).

### 3. Encode — GIF plus caption list
- **URL:** *(no command — `walkthrough-encode.js` runs)*
- **Action:** Nothing. The CLI decodes every PNG frame, downscales to `--width` if given, quantizes to one global palette, LZW-encodes, and writes the GIF; when the skill passes `--steps-json`/`--captions`, it also renders and writes the ordered caption list in the same call.
- **Should feel:** Fast and predictable — encoding a handful of 1280x720 frames takes a couple of seconds, not a wait.
- **Should understand:** An over-budget result relays the lever list in order (`fewer steps`, then `lower --width`) for the developer to choose — the skill never auto-shrinks and retries with a guessed width. A frame-dimension mismatch or an undecodable frame stops the run and names the offending path instead of padding, cropping, or skipping it.
- **Red flags:** A silent retry with a smaller width after a budget-exceeded exit; frames deleted after a failed encode (they should be left in place for diagnosis, with the path reported).

### 4. Choose where it lands
- **URL:** *(`AskUserQuestion` rendered by the skill)*
- **Action:** Pick the archive path (`docs/walkthroughs/{story-id}.gif`+`.md`, recommended), the current directory, an explicit `Other` path, or don't save at all.
- **Should feel:** The developer's own call — nothing lands in the repository, and nothing is ever committed, without this explicit choice.
- **Should understand:** The recommended default is deliberately outside `.claude-tweaks/artifacts/` — a walkthrough exists to be kept and shared, not pruned by `/claude-tweaks:tidy`'s 30-day cleanup like the QA screenshots it's built from.
- **Red flags:** An automatic commit; a default save path under `.claude-tweaks/artifacts/`; the Playwright CLI session left open after this step (it closes on every path — success, a Step 2 locator miss, or a Step 3 encode failure).

## Origin
- Created during build of #2758 (`/claude-tweaks:walkthrough` — a GIF-encoding skill added to the claude-tweaks plugin)
- Related specs: #2758
