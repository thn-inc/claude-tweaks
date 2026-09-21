---
files:
  - plugin/bin/resolve-profile.js
  - plugin/bin/lib/hooks/worktree-detect.js
  - plugin/bin/lib/model-profiles/profiles.js
  - plugin/bin/lib/model-profiles/policy-fragment.js
  - plugin/bin/lib/model-profiles/session-failures.js
  - plugin/skills/_shared/subagent-dispatch-core.md
---

# Resolve a Dispatch's Model Profile

**Persona:** claude-tweaks skill author (or a maintainer of a project using the plugin) who wants proof that dispatch-time model resolution actually honors the documented override chain — table default, policy row, stance, ceiling, Frontier gates, session-failure avoidance — rather than trusting the contract's prose.
**Goal:** Watch one profile resolve under five configurations and confirm the returned `model`/`effort`/`source` change exactly as `plugin/skills/_shared/subagent-dispatch-core.md` §Model Selection says they will.
**Entry point:** A terminal at this repo's checkout root — the repo that ships `plugin/bin/resolve-profile.js`, not the `plugin/` payload directory itself.
**Success state:** Five JSON lines whose `source` fields read `default`, `policy`, `degraded:cap`, `degraded:session-failure`, and back to `default` (post-`clear-failures`) respectively, with the models the contract's table and override rules predict.

## Steps

### 1. Resolve the table default — terminal
- **URL:** `node plugin/bin/resolve-profile.js standard`
- **Action:** Run that command from the checkout root (profile lowercase).
- **Should feel:** Instant and unambiguous — one line of JSON, no configuration needed.
- **Should understand:** `{"model":"sonnet","effort":"high","source":"default",...}` is the canonical Standard row from the contract's table — the same data `PROFILES` exports and the table-pinning test enforces, so this output and the contract's prose cannot silently diverge.
- **Red flags:** A thrown stack trace (the CLI is fail-loud by contract — errors are one named line on stderr, exit 1); `source` anything other than `default` in a checkout with no `.claude-tweaks/policy.yml` model keys **and** no `record-failure` call recorded against the current `CLAUDE_CODE_SESSION_ID` this session (see Step 4) — a `degraded:session-failure` source here is correct behavior, not a defect, if this session already blacklisted `sonnet`.

### 2. Override a row from project policy — `.claude-tweaks/policy.yml`
- **URL:** temporarily append to `.claude-tweaks/policy.yml`: a `model-profiles:` block with `  standard:` / `    model: opus` / `    effort: low`, then re-run `node plugin/bin/resolve-profile.js standard`
- **Action:** Add the block, re-run, then remove the block.
- **Should feel:** Like configuration, not code — a project remaps what "Standard" means in one place and every dispatch site inherits it.
- **Should understand:** `{"model":"opus","effort":"low","source":"policy",...}` — the `source` field is the audit trail: it names which layer of the precedence chain decided this pair. Partial rows merge (a row with only `effort:` keeps the table's model).
- **Red flags:** `source` still `default` after adding the block (indentation must be 2 spaces per level); a typo'd effort value resolving anything at all — `effort: hgih` must exit 1 naming the value, never silently resolve.

### 3. Watch the Frontier cap degrade — terminal with a scratch run dir
- **URL:** `mkdir -p /tmp/mp-journey && node plugin/bin/resolve-profile.js frontier --run-dir /tmp/mp-journey` (run it four times)
- **Action:** Run the command four times; inspect `/tmp/mp-journey/frontier-tally.log` between runs.
- **Should feel:** Deterministic — three `fable` resolutions, each appending one `frontier\t{timestamp}` tally line, then a fourth returning `{"model":"opus",...,"source":"degraded:cap"}` with no fourth tally line.
- **Should understand:** This is the per-run spend ceiling on the most expensive model profile: the cap (default 3, policy key `frontier-run-cap`) is enforced mechanically by the resolver, and degradation is visible in `source` rather than silent. `--unattended` degrades immediately the same way — headless contexts never resolve Frontier. The two are independent inputs, not one mechanism: the tally flags (`--run-dir`, `--frontier-used`) answer "how much Frontier has this run already spent", while `--unattended` answers "is a human present" — it resolves `{"source":"degraded:unattended"}` (never `degraded:cap`), reads no tally and appends no tally line even with `--run-dir` passed. Run `node plugin/bin/resolve-profile.js frontier --run-dir /tmp/mp-journey --unattended` on a fresh dir to see both: a degraded line and no `frontier-tally.log` at all.
- **Red flags:** A fourth tally line appearing after the degraded resolution (the tally must only record actual Frontier results); the cap counting non-`frontier` lines in the log. Running this step from a **linked worktree** with a *relative* `--run-dir` (or one pointing inside any checkout other than the main one) exits 1 with a "resolves outside the main checkout" message naming the resolved path — that is the anchored-or-outside guard (#1065, the `[IL-127]` shadow-copy protection) working as designed, not a defect; the documented `/tmp/mp-journey` form is outside any checkout and always passes.

### 4. Blacklist a failed model, then confirm the next resolution avoids it — terminal
- **URL:** `CLAUDE_CODE_SESSION_ID=journey-probe-$$ node plugin/bin/resolve-profile.js record-failure fable`, then `CLAUDE_CODE_SESSION_ID=journey-probe-$$ node plugin/bin/resolve-profile.js frontier`
- **Action:** Run the `record-failure` command first (any real family alias — `haiku`/`sonnet`/`opus`/`fable`), then immediately resolve `frontier` under the same synthetic session id.
- **Should feel:** Like a durable decision for the rest of that session — no automatic re-enable, no confirmation prompt. This is deliberate: the mechanism exists specifically so a credit-exhausted model never gets silently re-resolved and re-fails a second time (#763). It is not, however, permanent — see Step 5.
- **Should understand:** `record-failure` prints `{"recorded":true,"model":"fable","sessionId":"journey-probe-..."}` and validates the model name against the real family aliases (`node plugin/bin/resolve-profile.js record-failure not-a-model` exits 1 naming the invalid value and recording nothing). The following `frontier` resolution returns `{"model":"opus","effort":"high","source":"degraded:session-failure",...}` — `resolve()`'s seventh and final stage stepping down `PROFILE_ORDER` to the next model not in this session's blacklist, guarded so a model *already* at the floor with nowhere lower to go claims no `source` change (a genuine no-op, not a fresh degrade — #841). The blacklist lives at `os.tmpdir()/ct-model-failures-{sessionId}.json`, keyed by `CLAUDE_CODE_SESSION_ID` — omitting that env var (or using a fresh id) makes every resolution unaffected, exactly as before this mechanism existed. Concurrent `record-failure` calls for two different models in the same session serialize behind a short mkdir-based lock (`session-failures.js`'s `acquireLock`) rather than racing to lose one of them.
- **Red flags:** `record-failure` accepting a garbage model name and reporting `"recorded":true` anyway (it must reject anything not in the four real aliases); the blacklisted model still being returned by the next resolution under the same session id; the blacklist affecting a *different* session id (cross-session leakage).

### 5. Clear the blacklist before its session ends — terminal
- **URL:** `CLAUDE_CODE_SESSION_ID=journey-probe-$$ node plugin/bin/resolve-profile.js clear-failures`, then re-run `CLAUDE_CODE_SESSION_ID=journey-probe-$$ node plugin/bin/resolve-profile.js frontier`
- **Action:** Run `clear-failures` under the same synthetic session id Step 4 blacklisted `fable` in, then resolve `frontier` again.
- **Should feel:** Like the one deliberate escape hatch (#841 item 3): credit exhaustion is normally a usage window, not a permanent state, so a session degraded early in a long window has a documented way to recover before that window naturally rolls over, rather than waiting it out or starting a fresh session id.
- **Should understand:** `clear-failures` prints `{"cleared":true,"sessionId":"journey-probe-..."}` and deletes the same `os.tmpdir()/ct-model-failures-{sessionId}.json` file `record-failure` wrote — the next `frontier` resolution returns to `{"model":"fable","source":"default",...}`, exactly as if `record-failure` had never run this session. Equivalent manual recovery (no CLI needed): `rm "${TMPDIR:-/tmp}/ct-model-failures-${CLAUDE_CODE_SESSION_ID}.json"`.
- **Red flags:** `clear-failures` exiting 0 but the following resolution still returning `degraded:session-failure` (the delete silently failed, or targeted the wrong session's file); `clear-failures` throwing when the blacklist file never existed (it must be a harmless no-op).
