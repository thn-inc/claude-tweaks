# Design Mode — live

Invoked via `/claude-tweaks:design-wrapper live <target>`. Returns `{mode, result: "ok", session: "completed"}` or `{mode, skipped, ...}` to caller. **Interactive-only — has no auto-mode branch.**

## When this runs

Called by `/claude-tweaks:specify` (shape-time throwaway-scaffold exploration) and `/claude-tweaks:visual-review` (standalone Boost gate, "Explore alternatives"). Both callers are already gated to interactive, no-`$PIPELINE_RUN_DIR` contexts before reaching this mode — this mode performs no additional mode-gating of its own.

`<target>` is a URL: either an ephemeral scaffold server (`/specify`'s caller) or the already-running app under review (`/visual-review`'s caller).

## Preconditions

Run the universal preconditions from `../SKILL.md` (Layers 1+3 — Layer 2 does not apply, same as `shape` mode, since a `live` session isn't necessarily tied to one spec — and availability for the Impeccable plugin, extended per Step 2 below).

## Procedure

### Step 1: Run preconditions

On any skip, return the skip object.

### Step 1.5: Native surface — mode unavailable

Read `surface_track` from the track resolution in `../SKILL.md`'s Step 1. When it is `ios`, `android`, or `adaptive`, return immediately:

```json
{ "mode": "live", "skipped": "native surface — live mode is web-only", "surface_track": "<ios|android|adaptive>" }
```

Upstream states the constraint: *"`live` and the bundled `detect.mjs` are web-only"* (`reference/routing.md`). Live mode drives a browser overlay against a served page; a native app has no page to attach it to. This is unavailability, not a veto — unlike Step 2.5's dev-server signal there is no `true` that could authorize it, because the mode has nothing to run against on this track at all.

**This gate reads `setup.platform` only, and that is a real limit worth naming.** `live` skips Layer 2 (see Preconditions above), so it never receives a `Surface:` line — the `null` + `Surface: mobile` row of the track table is unreachable from here, and a native project with no `Platform` section in its `PRODUCT.md` resolves to the web track and proceeds. The caller that *does* know the surface closes that gap on its own side: `/claude-tweaks:specify`'s Step 2.5b-ii skips scaffold-and-live entirely for a native surface rather than building an HTML scaffold for a native app.

### Step 2: Availability check (live-specific)

In addition to the standard `/impeccable:impeccable*` skill-resolution check, live mode depends on scripts under `.claude/skills/impeccable/scripts/` (`live.mjs` et al.) shipping with the installed Impeccable plugin version. If `/impeccable:impeccable*` resolves at all, treat these scripts as present — they ship together as one plugin release; there is no separate installation step to check.

### Step 2.5: Dev-server veto (Layer 0, when signals resolved)

When Layer 0 resolved (see `../impeccable-plugin.md`), read `devServer.running`. It is a **veto only**, and the asymmetry is the whole rule:

| Signal | Effect |
|--------|--------|
| `devServer.running: false` | **Sufficient to skip.** Return `{mode: "live", skipped: "no dev server is listening"}`. Nothing is serving `<target>`, so a live session has nothing to attach to. |
| `devServer.running: true` | **Not sufficient to enter.** Proceed to Step 3, where live's existing human-present requirement still governs — exactly as it does when Layer 0 carried no signals at all. |

The reason for the asymmetry: the probe is a bare TCP connect against seven common dev ports and cannot tell whose server answered. Verified 2026-08-06 — it reported `running: true, ports: [8080]` on a machine with no dev server for this project. A `true` is therefore evidence that *something* is listening, never that it is `<target>`.

**One precondition on the veto: the probe must have looked where `<target>` lives.** `running: false` means "none of `3000 4200 4321 5173 5174 8000 8080` accepted a connection" — it is silent about every other port. When `<target>`'s port is parseable from the URL and is **not** in that set, `false` is not evidence about `<target>` and must not skip; proceed to Step 3. This is the same argument the asymmetry above rests on — the probe's answer is only as good as its resolution — applied to its coverage rather than its precision. Reading `false` as conclusive regardless would silently refuse a live session against an ephemeral scaffold server on an uncommon port, which is exactly what `/claude-tweaks:specify`'s caller provides.

When Layer 0 did not resolve, skip this step entirely and proceed to Step 3 — degradation is never a failure, and this mode behaved exactly this way before Layer 0 existed.

### Step 3: Hand off to live mode

Invoke via the Skill tool: `/impeccable:impeccable live`, passing `<target>` as the page to open (per `live.md`'s own "Navigate to the URL that serves `pageFile`" contract). Follow `live.md`'s own procedure verbatim — boot, poll loop, generate/accept/discard/exit handling. This wrapper does not reimplement any of live mode's mechanics; it only gates whether the mode is reachable at all, matching every other mode's role in this skill.

**Scope injection to `<target>` only (#2540).** When `<target>`'s path resolves to a specific file this checkout owns — always true for `/specify`'s throwaway-scaffold caller (`design-pre-steps.md`'s single-scaffold offer builds and serves exactly one file), and true for `/visual-review`'s caller whenever the reviewed page maps to a known source file — include that concrete path in the boot instruction as upstream's own `--target <path>` scoping (`reference/live.md`'s boot step 1: "If the request names or implies a file, route, or app inside a monorepo, infer the concrete path and run `impeccable live --target <path>` instead"). Never let the boot infer a directory-wide scope when a single-file target is already known — upstream's own `--target` mechanism exists precisely to narrow a live session (and everything it injects) to one app/file instead of scanning its containing directory. This is what keeps live-inject from touching sibling tracked files the session was never booted against — the record's Current State names exactly this failure: injection landed in every tracked scaffold file under `docs/plans/`, not only the new one, because no explicit target scope was ever passed.

### Step 4: Return

When the session ends (user says "stop"/"exit live", closes the tab, or the poll returns `exit` and cleanup completes): return `{mode: "live", result: "ok", session: "completed"}`. There is no "declined" return from this mode — the caller's own front-door-confirm gate is what decides whether to invoke this mode at all; once invoked, the mode always runs to a real session.

## Output to caller

```json
{
  "mode": "live",
  "result": "ok",
  "session": "completed"
}
```
