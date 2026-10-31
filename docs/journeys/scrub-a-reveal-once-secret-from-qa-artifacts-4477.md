---
files:
  - plugin/skills/stories/SKILL.md
  - plugin/skills/stories/story-examples.md
  - plugin/skills/test/qa-prompts.md
  - plugin/skills/test/qa-reporting.md
  - plugin/agents/qa-agent.md
  - plugin/bin/qa-scrub.js
  - plugin/bin/lib/qa-scrub/scrub.js
  - plugin/bin/lib/qa-scrub/secrets.js
  - plugin/bin/lib/qa-scrub/snapshot-locator.js
  - plugin/bin/lib/qa-report/compose.js
---

# Scrub a Reveal-Once Secret From QA Artifacts

**Persona:** a developer whose app shows a value exactly once — an API key, a recovery code, a one-time token, an invite link — and who wants `/claude-tweaks:test qa` to check that flow without leaving the value behind in the run's snapshots, traces and screenshots.
**Goal:** declare which values are secret once, in the story, and trust the QA run to remove them from every artifact it wrote — or to fail loudly when it cannot.
**Entry point:** the story-level `secrets:` field in a schema-v2 story file (`plugin/skills/stories/SKILL.md`'s Story schema section; `story-examples.md` Example 5), then `/claude-tweaks:test qa`.
**Success state:** the QA report's Secret Scrub section shows `{N} secret value(s) scrubbed from {M} artifact(s); {K} screenshot(s) removed` for the story; `grep -r` for the value over the story's screenshot dir, its trace dir and `.playwright-cli/` finds nothing; screenshots from before the reveal are still there.

## Steps

### 1. Declare the secret in the story
- **URL:** `plugin/skills/stories/SKILL.md` — Story schema (v2), the `secrets:` paragraph; `plugin/skills/stories/story-examples.md` Example 5
- **Action:** Add `secrets:` to the story: a `pattern:` (a JavaScript regex) when the value's format is known, or a `locator:` (`role` with an optional `name`, `label`, or `placeholder`) naming the element that displays it.
- **Should feel:** Like adding one more line of intent to a story — the steps themselves don't change.
- **Should understand:** Only patterns and locators go in the file, never the value; use fake values in examples, since story files are committed. A `testid` or `text` locator is refused, because an accessibility snapshot carries no test ids and a text locator would name the value itself — write a `pattern` for either. A pattern that matches the empty string (`.*`) is refused too.
- **Red flags:** A real-looking token committed in the story file; a story declaring `secrets:` that runs with no scrub afterwards.

### 2. The QA run hands the agent the secrets file
- **URL:** `plugin/skills/test/qa-prompts.md` step 19, "Secrets (#4477)"
- **Action:** Before dispatch, `/test qa` writes the story's `secrets:` block as JSON to `{RUN_DIR}/secrets/{story-id}.json` and adds `**Secrets file:**` and `**Scrub helper:**` to that story's agent prompt. A story without `secrets:` gets neither field.
- **Should feel:** Invisible — nothing to configure beyond the story.
- **Should understand:** The agent records the story's start time before opening the browser, because `.playwright-cli/` is shared by every story running in parallel and the scrub must know which of its files belong to this story.
- **Red flags:** A story without `secrets:` whose prompt carries either field, or whose `report.json` entry gains a `scrub` key.

### 3. After the story closes, the scrub runs
- **URL:** `plugin/agents/qa-agent.md` — Section 6.5 Secret scrub; `plugin/bin/qa-scrub.js`
- **Action:** Pass or fail, after the session is closed, the agent runs `qa-scrub.js` over the story's screenshot dir, trace dir and `.playwright-cli/` files since the story started. It resolves each locator's value from the story's own snapshots (in memory only), replaces every value with `[REDACTED:qa-secret]` in snapshot YAML, traces, network logs and console logs, deletes zip traces and binaries holding a value, and deletes screenshots (step screenshots and trace frames) from the reveal onward — the reveal being the first snapshot that shows the value.
- **Should feel:** Deterministic — the same artifacts in always give the same outcome out, and nothing depends on the agent remembering not to print something.
- **Should understand:** Pixels cannot be redacted by regex, so screenshots are judged by time, not content: those taken before the reveal are kept, those from it onward are removed. If the value shows up only outside snapshots, the reveal is unknown and every in-scope screenshot goes. Trace frames from parallel stories written after the reveal are deleted too, since the frames directory is shared. A pattern that matched nothing is reported as a caveat, because it may mean the pattern is wrong rather than that the value never appeared.
- **Red flags:** The value in any file the scrub left behind; an earlier screenshot deleted while a reveal snapshot existed; the value printed in the agent's reply or the helper's output.

### 4. The report records the outcome, and a failed scrub fails the story
- **URL:** `plugin/skills/test/qa-reporting.md` Phase 4 and Phase 5 (the `scrub` payload field and the Secret Scrub section); `plugin/bin/lib/qa-report/compose.js`
- **Action:** The agent's `REPORT_JSON` carries a `scrub` object; Phase 5 passes it into `story-results.json`, and `qa-report.js` writes `stories[].scrub` with the composed line. The QA summary's Secret Scrub section lists each story's line, and the remaining paths for a failed scrub.
- **Should feel:** Trustworthy without an audit — one line says what was cleaned, and a problem cannot hide behind a PASS.
- **Should understand:** When the scrub cannot prove every value gone (an unreadable trace, a locator that resolved to nothing, a value too short to scrub safely) the helper exits 3 and the story is FAIL with every remaining path listed; when it never ran (an invalid secrets file) the story is FAIL with the artifact dirs listed. `qa-report.js` refuses a payload that pairs a failed scrub with a non-FAIL status, so the report can never show such a story as clean — and a failed story keeps the QA pass stamp from being written.
- **Red flags:** A story with a failed scrub reported PASS; a report line that rewords or omits the counts; a missing Secret Scrub section when a story declared `secrets:`.

## Origin
- Created during build of #4477 (story `secrets:` field, `plugin/bin/qa-scrub.js` + `plugin/bin/lib/qa-scrub/`, qa-agent Section 6.5, `report.json` `stories[].scrub`) — reported from a 6.145.0 QA run where a "token shown once" story left the token in four artifact files the tooling wrote on its own.
- Related: #4408.
