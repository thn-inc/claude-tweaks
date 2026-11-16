---
files:
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/issues/upstream-ownership.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/console/decision-facts.js
  - plugin/bin/lib/issues/autonomy.js
  - plugin/skills/wrap-up/upstream-feedback.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/feedback/pre-confirmed.md
  - plugin/skills/_shared/autonomy-ceiling.md
---

# File Upstream Feedback by Repo Ownership

**Persona:** a claude-tweaks maintainer who runs with `control-mode: on` and decides only at intent and acceptance. They want upstream feedback about their own repos filed without a prompt. Feedback about a repo they do not own, for example a third-party plugin, should wait for their call. A second persona is the wrap-up agent that stages and files each item.
**Goal:** feedback for a repo the project owns is filed with no prompt and an audit line. Every other item becomes a decision in the acceptance packet. Ownership never depends on the logged-in GitHub account.
**Entry point:** a `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run under `control-mode: on` that reaches `/claude-tweaks:wrap-up` with an Upstream feedback row.
**Success state:**
- every `U#` item is one of two things:
  - an issue filed into an owned repo, with an `Upstream filing: … filed into {repo} as {url}` line in `decisions.md`;
  - a held item, with a `held for the acceptance packet as {factId}` line and one entry under the packet's Decisions left for you.
- Nothing is filed into an external repo.

## Steps

### 1. (Wrap-up agent) Stage the draft with its target
- **URL:** `plugin/skills/wrap-up/upstream-feedback.md` Step 2, with `console-resolve.js --ceiling --run "{ABS_RUN_DIR}"` deciding the layout
- **Action:** the agent scrubs the draft and stages `staged/wrap-up-upstream-{N}.md`. When the ceiling line reads `control-mode on`, the file opens with a header and then the body:

  ```
  <!-- upstream-target: thn-inc/claude-tweaks -->
  Title: {title}

  {scrubbed body}
  ```

  Otherwise the file is the body alone, exactly as before.
- **Should feel:** the same staging step as without control mode, plus two header lines. A dispatched judge gets the run dir as a literal path, so the check never reads an empty variable.
- **Should understand:**
  - A failed `--ceiling` call writes no header. The item then holds, which fails closed.
  - A `**Causal:** systemic` tag goes after the header block, never above it.
- **Red flags:**
  - a header written with control mode off;
  - a control-mode run whose every staged file lacks the header.

### 2. (Wrap-up agent) Route each item by ownership
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --upstream-route '{id}' --run "$PIPELINE_RUN_DIR"`, for every `U#` at every ceiling, `unattended` included
- **Action:** the CLI reads two things:
  - the owner from the `origin` remote;
  - `owned-owners` from `origin/HEAD`'s `.claude-tweaks/policy.yml` (else `main`).

  It then prints `upstream-route {id} {file|hold} target {repo|none} reason {reason|none}`. A `hold` writes a decision fact to `packet-facts/decisions.json` and logs `held for the acceptance packet as {factId} — {reason}`.
- **Should feel:** one call per item and one plain verdict. There is no prompt, whatever the causal tag.
- **Should understand:**
  - Ownership is an exact, case-insensitive owner match, and nothing else:
    - lookalikes such as `thn-inc-evil` and malformed names are external;
    - an invalid `owned-owners` entry is ignored and logged as a `SKIP` line;
    - a cloud or Routine proxy origin is `owner-unresolved`, so items hold there.
  - A staged draft's header may name only `/claude-tweaks:feedback`'s filing target, `thn-inc/claude-tweaks`. A header naming any other repo holds `external`, even when its owner is owned, because the issue would not land there. `--filed` judges the repo its URL names instead.
  - With control mode off the CLI prints `unchanged (control mode off)` and writes nothing, and the old causal-tag default decides.
  - An unreadable policy exits 3 and writes nothing.
  - Any other failed read is logged as a `SKIP` line (step `Upstream ownership`) that names its fallback, never silently: an unresolved `origin/HEAD` reads the base branch as `main`, and an unreadable staged draft holds `external` with no target.
  - An explicit uncheck or untick declines an owned item. An explicit check never files a held one.
- **Red flags:**
  - a different `gh` login changing a verdict;
  - an external item filed at `unattended`;
  - a staged header naming any repo but `thn-inc/claude-tweaks` routed `file`;
  - the PR's own `owned-owners` edit granting itself auto-filing.

### 3. (Wrap-up agent) File an owned item and log it
- **URL:** `/claude-tweaks:feedback --pre-confirmed` on a `file` verdict, then `console-resolve.js --upstream-route '{id}' --filed '{url}' --run "$PIPELINE_RUN_DIR"`
- **Action:** the agent files the scrubbed body with no per-item prompt, then runs `--filed` with the issue URL. The CLI routes the repo that the URL names. It needs no staged file, because `/feedback` deletes that file after a successful filing. It logs `Upstream filing: {id} filed into {repo} as {url} (control mode: owned target, no prompt)`.
- **Should feel:** done and recorded in one line that names the repo and the issue.
- **Should understand:**
  - On anything but `file`, `--filed` still logs `filed as {url} against a hold verdict ({reason})`, prints that on stdout and exits 5, so the issue is never unlogged. Do not refile it.
  - Exit 5 with nothing on stdout means the id was refused and nothing was logged. Report it.
  - Exit 3 stops with the issue URL named, because the issue exists but is unlogged.
- **Red flags:**
  - a filed issue with no `decisions.md` line;
  - the header lines appearing in the filed issue body.

### 4. (Wrap-up agent) Hold a failed filing or a scrub hit
- **URL:** `console-resolve.js --upstream-route '{id}' --hold filing-failed|scrub-hit --reason '{why}' --run "{run dir owning the staged file}"`
- **Action:**
  - A `gh` failure (permission denied, rate limit, archived repo) holds as `filing-failed`.
  - A scrub stop, or a scrub that changed the approved draft, holds as `scrub-hit`.
  - There is no retry and no `AskUserQuestion`.
- **Should feel:** a dead end turned into a decision, not a stall.
- **Should understand:**
  - `{why}` is a short phrase the agent writes, with any `'` written as `'\''`.
  - A scrub-hit fact points to the staged draft by path. A failed-scrub draft never goes inline into the packet comment.
  - A repeated `--hold` writes no second fact.
  - The `{why}` phrase goes into the `decisions.md` line. A scrub-hit fact carries neither the phrase nor the draft title, so no scanner detail reaches the packet.
  - A `console.json` that exists but cannot be read exits 5 after the fact has landed, and the console item stays unchanged.
- **Red flags:**
  - a filing retry loop;
  - a mid-run question under control mode;
  - a scrub-hit draft pasted into the packet.

### 5. (Maintainer) Decide the held items at acceptance
- **URL:** the acceptance packet comment's Decisions left for you
- **Action:** the maintainer reads one line per held item: the target, the reason and the staged draft's path. An `external` or `filing-failed` line also carries the draft title and the draft inline, and a `filing-failed` one the agent's `--reason` phrase. A `scrub-hit` line carries neither the title nor the phrase. They then file it themselves or decline it.
- **Should feel:** the only upstream decision left, with everything needed to make it.
- **Should understand:**
  - Holding is the default for anything not provably owned.
  - Only `thn-inc/claude-tweaks`, the repo `/claude-tweaks:feedback` files into, can ever file. `owned-owners` on the default branch decides whether it counts as owned in a project whose origin owner is not `thn-inc`. Adding any other owner files nothing more.
- **Red flags:**
  - a held item missing from the packet;
  - an external issue that appeared without the maintainer's action.

## Origin
- Created during the build of #4621 (run `2026-11-16T100700-record-4621`). It covers `lib/issues/upstream-ownership.js`, the `ownedUpstreamFiling` capability, resolver routing, the `console-resolve.js --upstream-route` shape (route, `--hold`, `--filed`), and the control-mode branches in `wrap-up/upstream-feedback.md`, `wrap-up/review-console.md` and `feedback/pre-confirmed.md`.
- Related journeys:
  - `carry-undecidable-console-items-into-the-acceptance-packet-4620.md` covers the carry route this record adds a producer to.
  - `file-upstream-feedback-in-batch.md` covers the non-control-mode batch filing.
