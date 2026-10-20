---
files:
  - plugin/bin/lib/review-context/build.js
  - plugin/bin/build-review-context.js
  - plugin/skills/review/step3-lens-dispatch.md
---

# Read a Size-Capped Review Lens Bundle

**Persona:** the `/claude-tweaks:review` controller at Step 3 on an ordinary feature branch: a dozen-plus changed files, one of them a regenerated `package-lock.json` and another a captured-API `.jsonl` fixture. It has just built the shared context bundle and must decide whether to hand that one path to every lens agent. A dispatched lens agent then reads the bundle.
**Goal:** get a bundle a lens agent can read in one or two calls, with every file that was left out named, so nobody has to drop the bundle and improvise a file-list hand-off.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/build-review-context.js" build --base <ref> --branch HEAD --run "$PIPELINE_RUN_DIR"`, as `step3-lens-dispatch.md` directs.
**Success state:** the printed JSON line is `{dir, contextPath, bytes, files, emptySections, oversizeSections, baselinePath, listenersPath}`. `oversizeSections` names every file whose section was stubbed or whose diff hunk was elided, each listed once. The bundle at `contextPath` carries the diff with every modified hand-written file's hunks whole, then one section per file.

## Steps

### 1. Build the bundle and read the one JSON line
- **URL:** `build-review-context.js build --base <ref> --branch HEAD --run "$PIPELINE_RUN_DIR"`
- **Action:** Run the command and read the single JSON line it prints. Only that line enters the controller's thread.
- **Should feel:** The same one command and one line as before, plus one field. Nothing to opt into, and no flag to remember.
- **Should understand:**
  - `bytes` is now bounded per file, not for the whole bundle. A huge rewrite of an existing hand-written file still inlines its whole hunk, because that hunk is what is being reviewed. A readable markdown file's section is never inlined, whatever its size (#3713); its modified hunk stays whole in the diff.
  - `--files-from` is still the escape hatch for scoping the bundle down.
- **Red flags:**
  - A `bytes` in the megabytes on a diff with no large modified source file.
  - A JSON line with no `oversizeSections` key (an installed CLI older than this change).

### 2. Hand the bundle path to every lens agent
- **URL:** the `contextPath` from step 1
- **Action:** Pass `contextPath` as each lens agent's shared context, per `step3-lens-dispatch.md`, instead of falling back to a hand-built file list.
- **Should feel:** One path every lens agent can trust, sized so the hunks are reached quickly instead of after paging through megabytes of unchanged test code or fixture data.
- **Should understand:** `oversizeSections` names both stubbed sections and elided diff hunks. A path in it does not always mean its section is a stub: an added file of exactly the cap can have its diff hunk elided while its section is inlined in full.
- **Red flags:** The controller dropping the bundle anyway because it is "too big". That is the defect this change exists to remove, so capture the `bytes` and file mix if it recurs.

### 3. Lens agent meets a stubbed section
- **URL:** `===== {file} =====` sections in `context.md`
- **Action:** **Lens agent** reads a section that is a single line starting `[section omitted: {file} …`. It says "is {N} bytes, over the 65536-byte per-file cap", "always stubbed (lockfile or .jsonl)", "is {N} bytes of markdown, not inlined; …" (any readable `.md`/`.markdown` file, whatever its size), or, for a deleted file over the cap, gives no reason and goes straight to where to look. Every stub line ends with where to look.
- **Should feel:** Clearly a marker, never mistakable for file content. Lens findings cite `Path:Line` from the live file, and a stub line has no line numbers to confuse that.
- **Should understand:** The stub says exactly what is still available:
  - "its change is in the diff above": the hunk is still inline.
  - "its diff was elided too": run the quoted `git diff {base}...{branch} -- '{path}'` for the change, or read the live file.
  - "the file is deleted and its diff was elided": run that same `git diff` command for its last content. A deleted file over the cap gets this stub too, so the empty section is never a dead end.
- **Red flags:**
  - A stub that points at "the diff above" when that file's hunk is itself the elision marker.
  - A lockfile or `.jsonl` file inlined in full.
  - A markdown file's content inlined in a section.

### 4. Lens agent meets an elided diff hunk
- **URL:** the diff part of `context.md`, before the first `=====` section
- **Action:** **Lens agent** finds `diff --git a/{path} b/{path}` followed by `[{N} bytes of diff elided for {path} — see oversizeSections]` in place of the hunk.
- **Should feel:** Predictable. Only added or deleted files over the cap, and lockfiles or `.jsonl` of any change type (a renamed lockfile included, matched on its destination name), are elided. A modified source file's hunk is never cut.
- **Should understand:** Elision does not depend on the user's git config. `diff.noprefix` and non-ASCII file names (under the default `core.quotePath`) still parse, because the CLI forces `a/`/`b/` prefixes and unquoted paths.
- **Red flags:**
  - A modified hand-written source file whose hunk was replaced by the marker.
  - An over-cap added file whose hunk is still inline under an unusual git config or file name.

## Origin

Built by #3020 (run `2026-10-17T214422-record-3020`). It fixes the reported defect where a 32-file feature diff produced a 1.97 MB bundle, and a 16-file diff with a ~900 KB `.jsonl` fixture produced a 1.27 MB bundle, that lens agents could not read.
