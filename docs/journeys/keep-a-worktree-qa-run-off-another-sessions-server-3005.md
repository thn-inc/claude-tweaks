---
files:
  - plugin/skills/test/qa-prompts.md
  - plugin/skills/test/qa-reporting.md
  - plugin/skills/stories/SKILL.md
  - plugin/agents/qa-agent.md
---

# Keep a Worktree QA Run Off Another Session's Server

**Persona:** a developer running `/claude-tweaks:test qa` (or a `/claude-tweaks:flow` run's test step) from a linked worktree while a sibling session on the same machine runs its own app and mock API on fixed ports — and whose stories were written with absolute `navigate` URLs, such as a reset call against a mock on `http://127.0.0.1:4010`.
**Goal:** QA navigates only to servers this run owns. Steps that point at the app's own pinned address follow this worktree's resolved `APP_URL`, and a step that would reach some other local server is caught before the agent touches it, instead of clearing another session's fixture state.
**Entry point:** `plugin/skills/test/qa-prompts.md`'s "Resolve each story's dispatch URL against `APP_URL`" block, which runs before any story prompt is assembled.
**Success state:** every dispatched prompt's step YAML carries resolved URLs. A story that would have reached a secondary loopback server shows as `SKIPPED` with `unresolved-secondary-origin: {origin}` in the QA report. One flag line in the decision log names the distinct flagged origins and the affected story ids.

## Steps

### 1. The story author writes `navigate` steps with a `target`
- **URL:** `plugin/skills/stories/SKILL.md`, "Story schema (v2)" and "The `url:` field"
- **Action:** The developer writes `- action: navigate` with `target: "/checkout"` (root-relative, preferred), or keeps an older story that pins an absolute `target`, or one that still uses `value`.
- **Should feel:** Familiar — the same field the shipped example already uses, with a stated preference for root-relative URLs that survive worktree isolation.
- **Should understand:** `target` is canonical and `value` is read as a fallback. An absolute origin in a step is not followed literally: it is resolved the same way `story.url` is. A secondary local server (a mock API on its own port) cannot be resolved inside a worktree yet. Until #3082 ships, such a story is skipped there.
- **Red flags:** A schema section with no `navigate` example; a `url:` paragraph that still implies only `story.url` is rewritten.

### 2. The dispatcher resolves every `navigate` URL before serializing the steps
- **URL:** `plugin/skills/test/qa-prompts.md`, "Resolve every `navigate` step's URL the same way"
- **Action:** For each story, the dispatcher walks `setup.steps`, `story.steps` and `teardown.steps`. It joins a root-relative `target` to `APP_URL` and leaves a URL already on `APP_URL`'s origin alone. A protocol-relative `//host/path` is resolved against `APP_URL` first and then classified like any absolute URL. It rewrites an origin equal to the story's own origin to `APP_URL`'s, keeping path, query and fragment. With `url: http://127.0.0.1:9999/app` and `APP_URL=http://localhost:54321`, a step to `http://127.0.0.1:9999/reset` becomes `http://localhost:54321/reset`. The qa-agent then runs `playwright-cli -s=<story-id> goto <target>` on the already-resolved value (`plugin/agents/qa-agent.md`).
- **Should feel:** Invisible when nothing is wrong — the orchestrator stops hand-editing ports into every prompt.
- **Should understand:** Only `navigate` is touched; a `fill` value that happens to be a URL reaches the form verbatim. Legacy `workflow`-string stories are free text and are not parsed. One line per run, `QA: N navigate step origins rewritten to APP_URL`, records how many step origins were rewritten.
- **Red flags:** A prompt whose step YAML still carries the pinned `9999` port; a `fill` URL rewritten; a per-story log line instead of one per run.

### 3. A secondary loopback origin is flagged, and skipped on a worktree run
- **URL:** `plugin/skills/test/qa-prompts.md` (classification bullets and "Log the rewrite once per run"); `plugin/skills/test/qa-reporting.md`, "Skipped" section
- **Action:** A step to `http://127.0.0.1:4010/__reset` matches neither the story's own origin nor `APP_URL`'s. On a worktree run (`repoInfo(process.cwd()).isLinkedWorktree`), the story is marked `SKIPPED` with reason `unresolved-secondary-origin`, naming the origin, and its dependents cascade as `SKIPPED`. On a primary-checkout run it dispatches unchanged. Either way, the run emits one flag line: `QA: flagged secondary origins {origin, …} in stories {id, …}`. A non-loopback origin (a public site) dispatches unchanged and is never flagged.
- **Should feel:** Safe and legible — a skip with a named reason and origin, not a mysterious failure, and certainly not a silent reset of a sibling session's mock.
- **Should understand:** Loopback means `qa-procedures.md`'s Target environment check host set (`localhost`, `127.0.0.1`, `::1`, `*.localhost`). The skip is deliberate: a secondary server's port can't be assumed inside a worktree. The report's Skipped table lists the story under `unresolved-secondary-origin: {origin}`.
- **Red flags:** The agent navigating to a port this run did not start; a skipped story whose dependents still run; a Skipped table row with no reason.

## Origin
- Created during build of #3005 (QA step-origin resolution: `qa-prompts.md` URL-resolution block, `stories/SKILL.md` `navigate` + `target` schema, `qa-agent.md` navigate mapping, `qa-reporting.md` Skipped reason) — reported via `/claude-tweaks:feedback` from a worktree QA run whose story reset a mock on a pinned port shared with another session.
- Related: #2283 (fixed the same hazard for `story.url`), #3082 (declared secondary-server start command — revisit the worktree skip when it ships).
