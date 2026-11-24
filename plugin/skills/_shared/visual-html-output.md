# Visual HTML Output — Shared Core Procedure

Reusable procedure for producing themed, self-contained HTML+SVG visual output: token extraction from Impeccable's `DESIGN.md`, the core-fragment/wrapper-adapter pattern, MDX/Nextra docs-server compatibility, the persist-vs-ephemeral decision, and delivery (clickable file link + `SendUserFile` handoff). Referenced by `/claude-tweaks:visualize` (diagrams). Any future skill producing themed HTML report output (e.g. a `/code-health`, `/harness-health`, `/journey-health`, or `/review` report mode) can invoke this file directly — it has no callable surface of its own, every step below is executed by the calling skill.

## Step 1: Token extraction

Read the project's `DESIGN.md` (canonical path: project root; fallback: `docs/design/DESIGN.md`, `docs/DESIGN.md` — same resolution order `/claude-tweaks:design-wrapper`'s `pre-build` mode already uses). Parse the YAML frontmatter for `colors`, `typography`, `rounded`, `spacing`. Also read the `.impeccable/design.json` sidecar (project root — Impeccable 4.x's location; a pre-4.x project may instead carry a sibling `DESIGN.json` next to `DESIGN.md`, read that when the root sidecar is absent) when present, for `extensions.colorMeta` tonal ramps and any dark-mode-specific values.

Map each `colors.<slug>` entry to a CSS custom property named `--<slug>` (kebab-case slugs pass through unchanged, e.g. `colors.basil-green` → `--basil-green`). Map `typography.<role>.fontFamily`/`fontSize`/`fontWeight`/`lineHeight`/`letterSpacing` to `--font-<role>-family`, `--font-<role>-size`, `--font-<role>-weight`, `--font-<role>-line-height`, `--font-<role>-letter-spacing`.

### Deriving light/dark values from a flat token list

`DESIGN.md`'s `colors:` frontmatter has no explicit per-token light/dark pairing — it's a flat list of named tokens. To populate the three-part CSS shape (Step 2's pattern, applied to real values instead of the neutral fallback):

1. If the project's colors follow a recognizable light/dark naming pattern (a "dark" family — names containing `dark`, `midnight`, `night`, or similar — pairing a base "light" family by shared semantic role, e.g. `linen-cream` / `midnight-forest` both serving a "surface background" role), map the light-family token's value into the base `:root` block and its dark-family counterpart's value into the `:root[data-theme="dark"]` block, for matching semantic roles (background, text, border, accent).
2. If no clear light/dark pairing exists in the extracted colors, use the same value in both blocks. This is a safe, harmless default — the diagram just won't visually differentiate between light and dark mode, not a failure.

## Step 2: Fallback when DESIGN.md is absent

If no `DESIGN.md` is found at any of the three paths, before generating, call `AskUserQuestion`:

- `question`: `"No DESIGN.md found, so this diagram would use a generic default skin. Set up token theming first?"`
- `header`: `"Theming"`
- Option 1 — `label`: `"Run /impeccable document first (Recommended)"`, `description`: `"Generates DESIGN.md from your actual codebase, then this diagram (and every one after it) picks up your real palette"`
- Option 2 — `label`: `"Continue with neutral default skin"`, `description`: `"Generates the diagram now with a tasteful, generic palette — not tied to your project's tokens"`

If Impeccable itself isn't installed (no `/impeccable:impeccable*` skill resolves in the available skills list), Option 1's description becomes `"Install Impeccable, then run /impeccable document — then this diagram (and every one after it) picks up your real palette"` instead.

**Per-session dedupe:** the first time the user picks Option 2, set an in-memory session marker (never written to disk). Every subsequent call within the same session skips this `AskUserQuestion` entirely and goes straight to the neutral default skin — the same dedupe `/claude-tweaks:design-wrapper`'s own availability check uses ("if the same mode skips twice for the same reason in a session, surface only the first skip"). The marker does not persist across sessions; a project's Impeccable setup can change between them.

**Neutral default skin** (used when `DESIGN.md` is absent and the user either declined or the session marker is set): a small fixed palette, not derived from any project:

```css
:root {
  --neutral-ink: #1a1d23;
  --neutral-ink-muted: #565d6b;
  --neutral-surface: #ffffff;
  --neutral-surface-muted: #f3f4f6;
  --neutral-border: #d7dbe0;
  --neutral-accent: #3d5a80;
}
:root[data-theme="dark"] {
  --neutral-ink: #e7e9ed;
  --neutral-ink-muted: #9aa1ac;
  --neutral-surface: #14161a;
  --neutral-surface-muted: #1d2026;
  --neutral-border: #2c313a;
  --neutral-accent: #7a9cc6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --neutral-ink: #e7e9ed;
    --neutral-ink-muted: #9aa1ac;
    --neutral-surface: #14161a;
    --neutral-surface-muted: #1d2026;
    --neutral-border: #2c313a;
    --neutral-accent: #7a9cc6;
  }
}
```

## Step 3: Core fragment

Generate the visual content (an `<svg>...</svg>` for diagrams) plus a single scoped `<style>` block defining the tokens from Step 1 (real extracted values, paired light/dark per the rule above) or Step 2's neutral fallback (synthetic values), using the same `:root` / `:root[data-theme="dark"]` / `@media (prefers-color-scheme: dark)` shape in either case. Prefix every custom class name in the fragment with a unique per-diagram slug (e.g. `.vz-{slug}-node`, not bare `.node`) so multiple diagrams embedded in the same host document never collide.

This SVG+style pair is the **core** — every wrapper below reuses it byte-for-byte. Never regenerate it per-wrapper; regenerating independently per consumer is exactly how the standalone file and the markdown embed would drift apart.

## Step 4: Wrapper adapters

| Consumer | Wrapper |
|---|---|
| Standalone local file | `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{Diagram Title}</title></head><body>{core}{handshake script from Step 5}</body></html>` |
| Markdown embed | Bare `{core}` — no title, no handshake script, pasted directly into the doc |

## Step 5: MDX/Nextra docs-server compatibility

Every standalone local file (the first row of the table above) always includes this script before `</body>` — unconditionally, not gated behind detection:

```html
<script>
(function () {
  if (window.parent === window) return;
  function reportHeightNow() {
    window.parent.postMessage(
      { type: 'height', height: document.documentElement.scrollHeight },
      window.location.origin
    );
  }
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (data && data.type === 'theme' && (data.theme === 'dark' || data.theme === 'light')) {
      document.documentElement.dataset.theme = data.theme;
      reportHeightNow();
    }
  });
  var heightReportPending = false;
  new ResizeObserver(function () {
    if (heightReportPending) return;
    heightReportPending = true;
    requestAnimationFrame(function () {
      heightReportPending = false;
      reportHeightNow();
    });
  }).observe(document.body);
})();
</script>
```

This is inert with no parent frame (the `window.parent === window` check returns immediately), so it costs nothing for a plain standalone diagram. It matches, field-for-field, the handshake protocol a project's own docs-dashboard embed pattern would already run in production (e.g. an `iframe` + `postMessage` theme-sync component) — a project using that exact pattern can embed a generated diagram with zero changes to the diagram itself.

**Detection (soft signal, not a requirement):** check every `package.json` in the project for a dependency on `nextra`, `nextra-theme-docs`, `fumadocs`, `@next/mdx`, `contentlayer`, `docusaurus`, or `vitepress`. When found, surface this reference snippet in the skill's output (never write it into the target project directly — claude-tweaks doesn't know that project's file layout or whether a bespoke embed component already exists there):

```
Detected an MDX-based docs app in this project. To embed this diagram, a
generic React embed component (adapt to your framework) is:

  function EmbedFrame({ src, title }) {
    // iframe + postMessage theme-sync + ResizeObserver height-report —
    // matches the handshake script this diagram already includes.
    // See skills/_shared/visual-html-output.md Step 5 for the exact protocol.
  }

Copy the generated file into your docs app's static-asset directory
(however your project's own content-sync step does that), then embed it:

  <EmbedFrame src="/path/to/the-diagram.html" title="..." />
```

## Step 6: Persist-vs-ephemeral

| Context | Default | Still asks? |
|---|---|---|
| Invoked via a soft-hook caller already producing a doc (e.g. `/journeys`, `/specify`) | Save as project doc | No |
| Invoked directly, ad-hoc, no calling context | — | Yes — `AskUserQuestion`: `"Save as a project doc"` / `"Just show me now (not saved)"` / `"Both"` |

"Just show me now" still writes the core fragment + standalone wrapper to a scratch path first, so there's something the user can open locally regardless of whether the output is meant to be a durable project doc. It just never lands under a project's `docs/` tree, is never registered in `REGISTRY.md`, and the MDX-embed reference snippet from Step 5 is not offered (there's nothing to embed if it isn't staying in the project).

## Step 7: Deliver the output

Once Step 4's standalone wrapper file exists on disk — whichever of Step 6's branches produced it (persisted under `docs/`, scratch-path-only, or both) — always end the wrapper-output procedure by handing it back to the user directly. Don't leave the calling skill to improvise a preview path (browser automation against a `file://` URL and a throwaway local HTTP server have both been tried in real sessions and both blocked — neither is the answer; this step is).

1. Emit the file's absolute path as a `file://` URI on its own line, as the final line of output. Most terminals (iTerm2, VS Code's integrated terminal, Ghostty, etc.) auto-hyperlink a bare `file://` URI, so this alone gives a clickable open action with no extra tooling:

   ```
   file:///absolute/path/to/the-diagram.html
   ```

2. If the `SendUserFile` tool is present in the current tool set (check the available tools directly — a hosted or headless invocation may not have it; don't assume), call it as the default way to hand the diagram to the user, not as a fallback to reach for only when asked:

   ```
   SendUserFile({ files: ["/absolute/path/to/the-diagram.html"], status: "normal", display: "render" })
   ```

   `display: "render"` opens the diagram inline immediately — the natural way to show visual output. Call it whenever the tool is available; it's complementary to the `file://` link above (one gives an immediate inline preview, the other a durable clickable path for later), not an alternative to it.

If `SendUserFile` isn't available, the `file://` link from step 1 is still the required minimum — this step never ends with only a bare path pasted into prose.
