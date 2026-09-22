# #2758 — `/claude-tweaks:walkthrough` GIF walkthrough skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/claude-tweaks:walkthrough`: execute a schema-v2 story through Playwright CLI, capture one PNG frame per step, and vendor a zero-dependency PNG decoder + palette quantizer + LZW encoder + GIF writer to turn those frames into an animated GIF plus an ordered caption list, so a walkthrough survives outside the disposable `.claude-tweaks/artifacts/` tree.

**Architecture:** Four small codec modules under `plugin/bin/lib/gif/` (`png-decode.js` → `palette.js` → `lzw.js` → `encoder.js`, each independently testable with a hand-built fixture), a `plugin/bin/lib/walkthrough/` pair (`encode.js` for frame planning/downscale/budget/captions, `select.js` for pure story selection), a thin `activity-render.js`-shaped CLI (`plugin/bin/walkthrough-encode.js`), and the orchestrating `plugin/skills/walkthrough/SKILL.md` that drives Playwright CLI directly (no new agent, no new subagent contract — it is a single skill's own procedure, same shape as `/claude-tweaks:activity`).

**Tech Stack:** Node 18+ built-ins only (`zlib`, `fs`, `path`, `child_process`); `node --test`; `playwright-cli` 1.59.0-alpha at runtime (already the plugin's shipped browser tool, v6.128.0).

**Spec:** `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2758/work/2758-spec.md`

## Global Constraints

- **Task 0 already ran** (live probe against a throwaway two-page static fixture, `playwright-cli` 1.59.0-alpha, results recorded in the spec's `## Gotchas` and repeated here): PNG signature `89 50 4E 47 0D 0A 1A 0A` on every frame; IHDR `bitDepth 8`, **`colorType 2` (RGB, not the guessed RGBA type 6)**, `interlace 0`; the headless default viewport is already `1280x720`, and an explicit `resize 1280 720` produces byte-identical dimensions; every screenshot is **viewport-only**, never full-page; two pages of very different document height screenshotted at the same viewport size produced pixel-dimension-identical PNGs. The decoder baseline (color types 0, 2, 6, 8-bit, non-interlaced) already covers the observed type — no widening needed, but the decoder still implements all three types since the baseline commits to them regardless of what one probe observes.
- **Browser tool is Playwright CLI, not agent-browser** — this record's own body originally named agent-browser throughout; it has been corrected in the materialized spec (`09ae6c80d`) and that corrected text is this plan's source of truth. Session flag `-s=<name>`; `open <url>` (first navigation) vs `goto <url>` (subsequent); `screenshot --filename=<path>` (a flag, not positional); `resize <w> <h>` for viewport; no `batch` op — sequential calls against the same `-s=<name>` session; `close` to end a session; `close-all`/`list` for residue management. Reference: `plugin/skills/browse/playwright-cli-reference.md`. Never `backend=chrome` here (`browse/SKILL.md` restricts that escape hatch to human ad-hoc use; `qa-agent`/`/stories`/`/visual-review`/`/review`/`/flow` and this skill stay `playwright-cli`-only, per `CLAUDE.md`'s Don'ts).
- **No inline Interaction-style directive** in `plugin/skills/walkthrough/SKILL.md` — hook-injected since #1909; `tests/skill-conventions.test.js` fails any skill carrying one.
- **Zero runtime dependencies**: no `plugin/package.json`, no npm install for a marketplace-installed plugin. `zlib`, `fs`, `path`, `child_process` only. Adding any npm dependency violates this record's central constraint.
- **CLI convention**: every `plugin/bin/*.js` exports `run(argv, deps)` guarded by `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps)` — never `process.exit` (`tests/bin-lib/exit-code-conformance.test.js` walks every file under `plugin/bin/`). Exit vocabulary *Split-1/2* per `.claude/skills/gh-api-module-pattern/SKILL.md`.
- **Module boundary**: `plugin/bin/lib/gif/` and `plugin/bin/lib/walkthrough/` are flat sibling directories, not nested `_shared/` wrappers. Each codec module exports exactly the functions named in its own task's Interfaces block — no more.
- **Atomic writes**: the GIF is written via `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic(filePath, content, deps)` — tmp-file-plus-rename, already shipped, read-only reuse.
- **Story schema (v2)**, canonical in `plugin/skills/stories/SKILL.md`: `schema_version: 2`, `stories[].id` (kebab-case), `stories[].journey` (optional), `stories[].steps[]` with `action`, `locator` (exactly one of `role`+`name`, `testid`, `text`(+`exact`), `label`, `placeholder`), optional `value`. This record adds one optional per-step field, `caption`, expand-only — never changes the meaning of an existing story.
- **`qa-agent.md` Section 4's step-to-command mapping** (read `plugin/agents/qa-agent.md` before Task 5): an action step resolves its locator via `snapshot`, then acts on the resolved `eN` ref with `click <eN>` / `fill <eN> "<text>"` / `check <eN>` / `hover <eN>`; `assert_visible` re-snapshots and checks tree membership (no action); `navigate` → `goto <url>`; `press` → `press "<value>"` (no ref). Every story-supplied string spliced into a command argument (`name`/`text`/`label`/`placeholder`/`value`) is shell-escaped first: `\` → `\\`, then `"` → `\"`, `` ` `` → `` \` ``, then `$` → `\$` (backslashes first).
- **Registration surfaces pinned by tests**: `docs/skill-graph.md` (`## {name}` section, alphabetical), `plugin/skills/help/reference-card.md` (Takes column byte-equal to frontmatter `argument-hint` after unescaping `\|`), `plugin/skills/help/context-flow.md`, `docs/getting-started.md`, `docs/plugin-structure.md` (`**Utility:**` list + `## Commands` line) — `tests/skill-catalog-completeness.test.js`, `tests/reference-card-argument-hint.test.js`. New-skill task also owes `tests/bin-lib/skill-audit/{house-structure,anti-patterns,context-cost,csc-registry}.test.js` (per #2757's hindsight finding, staged `spec-2757/staged/reflect-2.md`): `house-structure` for section order/no-directive/no-emoji, `anti-patterns` for the row-count pin (bump by measurement, never arithmetic), `context-cost` for the 260-char per-skill description ceiling and the corpus-total budget, `csc-registry` for a `PIPELINE_RUN_DIR_EXEMPT` entry if this skill turns out to be standalone-only (it is — no lifecycle skill invokes it).
- **Multi-spec shared worktree**: the five registration files are also edited by the sibling activity-report record (#2757, already merged into this branch) — edit in place at the anchors this plan names, never rewrite.
- Commit message style `{Verb} {what} — {detail}`, every commit ending `Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj`. Worktree Bash guard: one plain command per Bash call; no heredocs, no `$(...)` feeding git, no redirection outside the worktree; author files with the Write tool; `git -C "<worktree>" …` for every git call.
- Pre-existing failures on this Windows box (run ledger #2 baseline, 103 files) are not this record's; a **new** failing file is a regression.

## Self-review scope note

This plan covers 9 SDD tasks (Task 0 already ran and is folded into Global Constraints above, not a repeated task): four codec modules, the walkthrough encode module + its CLI, story selection, the skill + stories-schema addition, registration, and one live end-to-end run. Each codec/module task is TDD (test-first) with its own commit; the skill and registration tasks are prose-plus-registration with their own conformance tests.

---

### Task 1: `plugin/bin/lib/gif/png-decode.js` — PNG decoder (types 0, 2, 6, 8-bit, non-interlaced)

**Files:**
- Create: `plugin/bin/lib/gif/png-decode.js`
- Test: `tests/bin-lib/gif/png-decode.test.js`

**Interfaces:**
- Produces (exports): `decodePng(buffer) → { width, height, rgba: Uint8Array }` (RGBA output always — grayscale and RGB inputs are expanded to RGBA so every downstream consumer sees one shape); `PngDecodeError` (class, `.name === 'PngDecodeError'`, message names the unsupported feature).
- Consumed by: Task 5 (`walkthrough/encode.js`), Task 4's test fixtures indirectly (none — encoder tests build GIF bytes directly, not via this decoder).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/gif/png-decode.test.js`:

```js
'use strict';
// tests/bin-lib/gif/png-decode.test.js — #2758: a from-scratch PNG decoder for the three color
// types the vendored codec commits to (0 grayscale, 2 RGB, 6 RGBA), 8-bit, non-interlaced. Every
// fixture is hand-built with zlib.deflateSync so the test never depends on a real screenshot.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodePng, PngDecodeError } = require('../../../plugin/bin/lib/gif/png-decode');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Builds a minimal, valid PNG of the given color type from a raw scanline buffer (no filtering —
// filter byte 0 = None on every row, except where a test explicitly wants a filtered row).
function buildPng({ width, height, colorType, bitDepth = 8, rowsRaw, filterBytes }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([filterBytes ? filterBytes[y] : 0]));
    rows.push(rowsRaw[y]);
  }
  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng: color type 0 (grayscale) 4x4, filter None, expands to RGBA', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width);
    for (let x = 0; x < width; x++) row[x] = (y * width + x) * 16;
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 0, rowsRaw });
  const { width: w, height: h, rgba } = decodePng(png);
  assert.equal(w, 4); assert.equal(h, 4);
  assert.equal(rgba.length, 4 * 4 * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = (y * width + x) * 16;
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], gray); assert.equal(rgba[i + 1], gray); assert.equal(rgba[i + 2], gray); assert.equal(rgba[i + 3], 255);
    }
  }
});

test('decodePng: color type 2 (RGB) 4x4, filter None, exact bytes', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) { row[x * 3] = x * 10; row[x * 3 + 1] = y * 10; row[x * 3 + 2] = 200; }
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 2, rowsRaw });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], x * 10); assert.equal(rgba[i + 1], y * 10); assert.equal(rgba[i + 2], 200); assert.equal(rgba[i + 3], 255);
    }
  }
});

test('decodePng: color type 6 (RGBA) 4x4 with filter type 1 (Sub) on row 2, exact bytes', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  const filterBytes = [0, 0, 1, 0];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) { row[x * 4] = x * 5 + 1; row[x * 4 + 1] = y * 5 + 1; row[x * 4 + 2] = 50; row[x * 4 + 3] = 128; }
    if (y === 2) {
      // Sub-filter row 2 in place: filt(x) = raw(x) - raw(x - bpp), bpp = 4 for RGBA.
      const bpp = 4;
      const original = Buffer.from(row);
      for (let x = row.length - 1; x >= bpp; x--) row[x] = (original[x] - original[x - bpp]) & 0xff;
    }
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 6, rowsRaw, filterBytes });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], x * 5 + 1); assert.equal(rgba[i + 1], y * 5 + 1); assert.equal(rgba[i + 2], 50); assert.equal(rgba[i + 3], 128);
    }
  }
});

test('decodePng: color type 3 (palette) throws PngDecodeError naming "palette"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('PLTE', Buffer.alloc(3)), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /palette/i.test(err.message));
});

test('decodePng: interlaced input throws PngDecodeError naming "interlace"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 1;
  const idat = zlib.deflateSync(Buffer.alloc(1));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /interlace/i.test(err.message));
});

test('decodePng: 16-bit depth throws PngDecodeError naming "16-bit" or "bit depth"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 16; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.alloc(7));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /16-bit|bit depth/i.test(err.message));
});

test('decodePng: bad signature throws PngDecodeError', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), (err) => err instanceof PngDecodeError);
});

test('decodePng: filter types 2 (Up), 3 (Average), 4 (Paeth) each round-trip on a 3x3 RGB fixture', () => {
  const width = 3, height = 3;
  // Build the unfiltered target first, then derive each filtered row from it by hand so the
  // decoder's un-filter math is what round-trips it back to these exact bytes.
  const target = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) { row[x * 3] = x * 30 + y; row[x * 3 + 1] = 100; row[x * 3 + 2] = 200 - y * 10; }
    target.push(row);
  }
  const bpp = 3;
  const filterBytes = [0, 2, 3]; // row0 None, row1 Up, row2 Average (Paeth covered by a second run below)
  const rowsRaw = target.map((row, y) => {
    if (y === 0) return Buffer.from(row);
    const prev = target[y - 1];
    const out = Buffer.from(row);
    if (filterBytes[y] === 2) { // Up: filt(x) = raw(x) - prior(x)
      for (let x = 0; x < row.length; x++) out[x] = (row[x] - prev[x]) & 0xff;
    } else if (filterBytes[y] === 3) { // Average: filt(x) = raw(x) - floor((left + up) / 2)
      for (let x = 0; x < row.length; x++) {
        const left = x >= bpp ? row[x - bpp] : 0;
        out[x] = (row[x] - Math.floor((left + prev[x]) / 2)) & 0xff;
      }
    }
    return out;
  });
  const png = buildPng({ width, height, colorType: 2, rowsRaw, filterBytes });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    assert.equal(rgba[i], target[y][x * 3]); assert.equal(rgba[i + 1], target[y][x * 3 + 1]); assert.equal(rgba[i + 2], target[y][x * 3 + 2]);
  }

  // Paeth (filter 4) on its own 2-row fixture, since Paeth needs both a left and an up neighbor
  // to exercise its predictor selection meaningfully.
  const t2 = [Buffer.from([10, 20, 30, 40, 50, 60]), Buffer.from([15, 25, 35, 45, 55, 65])];
  const paethPredict = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const row1 = Buffer.from(t2[1]);
  for (let x = 0; x < row1.length; x++) {
    const left = x >= bpp ? t2[1][x - bpp] : 0, up = t2[0][x], upLeft = x >= bpp ? t2[0][x - bpp] : 0;
    row1[x] = (t2[1][x] - paethPredict(left, up, upLeft)) & 0xff;
  }
  const png2 = buildPng({ width: 2, height: 2, colorType: 2, rowsRaw: [Buffer.from(t2[0]), row1], filterBytes: [0, 4] });
  const { rgba: rgba2 } = decodePng(png2);
  for (let x = 0; x < 2; x++) {
    const i1 = x * 4;
    assert.equal(rgba2[i1], t2[1][x * 3]); assert.equal(rgba2[i1 + 1], t2[1][x * 3 + 1]); assert.equal(rgba2[i1 + 2], t2[1][x * 3 + 2]);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/gif/png-decode.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/gif/png-decode'`.

- [ ] **Step 3: Write `plugin/bin/lib/gif/png-decode.js`**

```js
// plugin/bin/lib/gif/png-decode.js — from-scratch PNG decoder for the walkthrough codec (#2758).
// Handles 8-bit, non-interlaced grayscale (0), RGB (2), and RGBA (6) — the three color types the
// vendored GIF codec commits to regardless of what any one live probe observes (Task 0's live
// probe on this record found color type 2, RGB — not the RGBA the record originally guessed).
// Always returns RGBA: grayscale and RGB inputs are expanded so every downstream consumer
// (palette.js, encoder.js) sees one uniform shape.
'use strict';

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 6: 4 }; // grayscale, RGB, RGBA — bytes per pixel at 8-bit

class PngDecodeError extends Error {
  constructor(message) { super(message); this.name = 'PngDecodeError'; }
}

function readChunks(buf) {
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Un-filters `raw` (concatenated scanlines, each prefixed with its own filter-type byte) into
// one flat buffer of `height` rows of `width * bpp` bytes, per the PNG spec's five filter types.
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[src]; src += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = rawByte; break; // None
        case 1: value = rawByte + left; break; // Sub
        case 2: value = rawByte + up; break; // Up
        case 3: value = rawByte + Math.floor((left + up) / 2); break; // Average
        case 4: value = rawByte + paeth(left, up, upLeft); break; // Paeth
        default: throw new PngDecodeError(`unsupported filter type ${filterType} at row ${y}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    src += stride;
  }
  return out;
}

// unfiltered (width*height*bpp bytes) -> RGBA (width*height*4 bytes), colorType 0/2/6 only.
function expandToRgba(unfiltered, width, height, colorType) {
  const rgba = new Uint8Array(width * height * 4);
  const bpp = CHANNELS[colorType];
  for (let p = 0; p < width * height; p++) {
    const si = p * bpp, di = p * 4;
    if (colorType === 0) {
      const g = unfiltered[si];
      rgba[di] = g; rgba[di + 1] = g; rgba[di + 2] = g; rgba[di + 3] = 255;
    } else if (colorType === 2) {
      rgba[di] = unfiltered[si]; rgba[di + 1] = unfiltered[si + 1]; rgba[di + 2] = unfiltered[si + 2]; rgba[di + 3] = 255;
    } else { // 6
      rgba[di] = unfiltered[si]; rgba[di + 1] = unfiltered[si + 1]; rgba[di + 2] = unfiltered[si + 2]; rgba[di + 3] = unfiltered[si + 3];
    }
  }
  return rgba;
}

function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngDecodeError('not a PNG file (bad signature)');
  }
  const chunks = readChunks(buffer);
  const ihdrChunk = chunks.find((c) => c.type === 'IHDR');
  if (!ihdrChunk) throw new PngDecodeError('missing IHDR chunk');
  const ihdr = ihdrChunk.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (interlace !== 0) throw new PngDecodeError('interlaced PNGs are not supported');
  if (bitDepth !== 8) throw new PngDecodeError(`unsupported bit depth ${bitDepth} — only 8-bit is supported (16-bit not implemented)`);
  if (colorType === 3) throw new PngDecodeError('palette (color type 3) PNGs are not supported');
  if (!(colorType in CHANNELS)) throw new PngDecodeError(`unsupported color type ${colorType}`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = CHANNELS[colorType];
  const unfiltered = unfilter(raw, width, height, bpp);
  const rgba = expandToRgba(unfiltered, width, height, colorType);
  return { width, height, rgba };
}

module.exports = { decodePng, PngDecodeError };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/gif/png-decode.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/gif/png-decode.js tests/bin-lib/gif/png-decode.test.js
```
```bash
git commit -m "Add a from-scratch PNG decoder — types 0/2/6, 8-bit, non-interlaced, all five filter types (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 2: `plugin/bin/lib/gif/palette.js` — median-cut color quantizer

**Files:**
- Create: `plugin/bin/lib/gif/palette.js`
- Test: `tests/bin-lib/gif/palette.test.js`

**Interfaces:**
- Produces (exports): `quantize(rgbaFrames, maxColors = 256) → { palette: Uint8Array(3*n), index: (frameRgba) => Uint8Array }` where `rgbaFrames` is an array of `Uint8Array`/`Buffer` RGBA frames (all the same pixel count), `palette` is a flat RGB triplet array over the union of all frames (median-cut, deterministic), and `index(frameRgba)` maps one RGBA frame to a `Uint8Array` of per-pixel palette indices (nearest-color, alpha ignored).
- Consumed by: Task 5 (`walkthrough/encode.js`).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/gif/palette.test.js`:

```js
'use strict';
// tests/bin-lib/gif/palette.test.js — #2758: median-cut quantization over a union of frames.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quantize } = require('../../../plugin/bin/lib/gif/palette');

function gradientFrame(w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = Math.floor((x / w) * 255);
    rgba[i + 1] = Math.floor((y / h) * 255);
    rgba[i + 2] = (x * 7 + y * 13) % 256;
    rgba[i + 3] = 255;
  }
  return rgba;
}

test('quantize: a 32x32 gradient (1024 distinct-ish colors) yields <=256 palette entries, every index in range', () => {
  const frame = gradientFrame(32, 32);
  const { palette, index } = quantize([frame], 256);
  assert.ok(palette.length % 3 === 0);
  const n = palette.length / 3;
  assert.ok(n <= 256, `expected at most 256 palette entries, got ${n}`);
  const idx = index(frame);
  assert.equal(idx.length, 32 * 32);
  for (const v of idx) assert.ok(v >= 0 && v < n, `index ${v} out of range [0,${n})`);
});

test('quantize: deterministic — same input yields byte-identical palette and indices on a second call', () => {
  const frame = gradientFrame(16, 16);
  const a = quantize([frame], 256);
  const b = quantize([frame], 256);
  assert.deepEqual([...a.palette], [...b.palette]);
  assert.deepEqual([...a.index(frame)], [...b.index(frame)]);
});

test('quantize: a single-color frame yields a 1-entry palette and an all-zero index', () => {
  const w = 4, h = 4;
  const frame = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frame[p * 4] = 10; frame[p * 4 + 1] = 20; frame[p * 4 + 2] = 30; frame[p * 4 + 3] = 255; }
  const { palette, index } = quantize([frame], 256);
  assert.equal(palette.length, 3);
  assert.deepEqual([...palette], [10, 20, 30]);
  const idx = index(frame);
  assert.ok([...idx].every((v) => v === 0));
});

test('quantize: a union of two frames with disjoint colors produces one palette covering both', () => {
  const w = 2, h = 2;
  const frameA = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frameA[p * 4] = 255; frameA[p * 4 + 1] = 0; frameA[p * 4 + 2] = 0; frameA[p * 4 + 3] = 255; }
  const frameB = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frameB[p * 4] = 0; frameB[p * 4 + 1] = 0; frameB[p * 4 + 2] = 255; frameB[p * 4 + 3] = 255; }
  const { palette, index } = quantize([frameA, frameB], 256);
  const n = palette.length / 3;
  assert.ok(n >= 2, 'expected the palette to cover both distinct colors');
  const idxA = index(frameA), idxB = index(frameB);
  // The two frames' pixels must map to different palette entries (disjoint colors).
  assert.notEqual(idxA[0], idxB[0]);
});

test('quantize: maxColors below the distinct-color count still returns <= maxColors entries', () => {
  const frame = gradientFrame(20, 20);
  const { palette } = quantize([frame], 16);
  assert.ok(palette.length / 3 <= 16);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/gif/palette.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/gif/palette'`.

- [ ] **Step 3: Write `plugin/bin/lib/gif/palette.js`**

```js
// plugin/bin/lib/gif/palette.js — median-cut color quantization for the walkthrough GIF codec
// (#2758). One global palette over the union of every frame (never per-frame — per-frame
// palettes cause cross-frame flicker on identical backgrounds and cost 768 bytes per frame,
// per the record's own Gotchas). Deterministic: median-cut on a fixed color-collection order,
// no randomness, so the same input always produces the same palette and indices.
'use strict';

// Collects every RGB triplet across all frames, in frame/pixel order (alpha ignored — GIF has
// no alpha channel; this module never sees per-pixel transparency).
function collectColors(rgbaFrames) {
  const colors = [];
  for (const frame of rgbaFrames) {
    for (let p = 0; p < frame.length; p += 4) colors.push([frame[p], frame[p + 1], frame[p + 2]]);
  }
  return colors;
}

// Median-cut: recursively split the widest-range color bucket at its channel median until
// `maxColors` buckets exist (or every bucket has one color left). Each bucket's representative
// is its own average — deterministic given a deterministic split order (always split the
// currently-widest bucket by its own widest channel, ties broken by bucket index).
function medianCut(colors, maxColors) {
  if (colors.length === 0) return [[0, 0, 0]];
  let buckets = [colors];
  while (buckets.length < maxColors) {
    let widestIdx = -1, widestRange = -1, widestChannel = 0;
    for (let b = 0; b < buckets.length; b++) {
      if (buckets[b].length <= 1) continue;
      for (let ch = 0; ch < 3; ch++) {
        let min = 255, max = 0;
        for (const c of buckets[b]) { if (c[ch] < min) min = c[ch]; if (c[ch] > max) max = c[ch]; }
        const range = max - min;
        if (range > widestRange) { widestRange = range; widestIdx = b; widestChannel = ch; }
      }
    }
    if (widestIdx === -1 || widestRange === 0) break; // nothing left worth splitting
    const bucket = buckets[widestIdx];
    const sorted = [...bucket].sort((a, b) => a[widestChannel] - b[widestChannel]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    buckets.splice(widestIdx, 1, left, right);
  }
  return buckets.map((bucket) => {
    let r = 0, g = 0, b = 0;
    for (const c of bucket) { r += c[0]; g += c[1]; b += c[2]; }
    const n = bucket.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function nearestIndex(palette, r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const dr = pr - r, dg = pg - g, db = pb - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function quantize(rgbaFrames, maxColors = 256) {
  const colors = collectColors(rgbaFrames);
  const paletteTriplets = medianCut(colors, maxColors);
  const palette = new Uint8Array(paletteTriplets.length * 3);
  paletteTriplets.forEach(([r, g, b], i) => { palette[i * 3] = r; palette[i * 3 + 1] = g; palette[i * 3 + 2] = b; });

  const index = (frameRgba) => {
    const out = new Uint8Array(frameRgba.length / 4);
    for (let p = 0; p < out.length; p++) {
      out[p] = nearestIndex(paletteTriplets, frameRgba[p * 4], frameRgba[p * 4 + 1], frameRgba[p * 4 + 2]);
    }
    return out;
  };

  return { palette, index };
}

module.exports = { quantize };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/gif/palette.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/gif/palette.js tests/bin-lib/gif/palette.test.js
```
```bash
git commit -m "Add a deterministic median-cut color quantizer for the walkthrough GIF codec (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 3: `plugin/bin/lib/gif/lzw.js` — GIF-compliant LZW encoder

**Files:**
- Create: `plugin/bin/lib/gif/lzw.js`
- Test: `tests/bin-lib/gif/lzw.test.js`

**Interfaces:**
- Produces (exports): `lzwEncode(indexStream, minCodeSize) → Uint8Array` — GIF-compliant, sub-block-packed LZW output (a leading clear code, code-size growth from `minCodeSize + 1` up to 12 bits, a table reset at 4096 codes, an end-of-information code, then GIF sub-block packing: each output byte-run split into ≤255-byte blocks each prefixed with its own length byte, terminated by a zero-length block). `indexStream` is a `Uint8Array`/array of palette indices; `minCodeSize` is `max(2, ceil(log2(paletteSize)))`.
- Consumed by: Task 4 (`encoder.js`).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/gif/lzw.test.js`:

```js
'use strict';
// tests/bin-lib/gif/lzw.test.js — #2758: GIF LZW encoding, verified with a vendored ~40-line
// reference LZW *decoder* written directly in this test file (per the record's AC3: "do not
// assert only on byte counts"). The decoder undoes GIF sub-block packing and the LZW table
// growth/reset rules, so a round-trip through it is what proves the encoder's bitstream is
// actually GIF-compliant, not merely "some bytes came out."
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lzwEncode } = require('../../../plugin/bin/lib/gif/lzw');

// Reference decoder: takes the sub-block-packed LZW stream (starting at the code-size byte,
// exactly what a GIF image-data block contains) and returns the flat index array.
function lzwDecode(packed) {
  const minCodeSize = packed[0];
  let pos = 1;
  const bits = [];
  while (packed[pos] !== 0) {
    const blockLen = packed[pos]; pos += 1;
    for (let i = 0; i < blockLen; i++) {
      const byte = packed[pos + i];
      for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1);
    }
    pos += blockLen;
  }
  let bitPos = 0;
  const readCode = (size) => {
    let code = 0;
    for (let i = 0; i < size; i++) { code |= (bits[bitPos] || 0) << i; bitPos++; }
    return code;
  };
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let table, out = [];
  let prev = null;
  const resetTable = () => {
    table = [];
    for (let i = 0; i < clearCode; i++) table[i] = [i];
    table[clearCode] = null; table[eoiCode] = null;
    codeSize = minCodeSize + 1;
    prev = null;
  };
  resetTable();
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) { resetTable(); continue; }
    if (code === eoiCode) break;
    let entry;
    if (table[code]) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad LZW code ${code} at table length ${table.length}`);
    out.push(...entry);
    if (prev) {
      table.push([...prev, entry[0]]);
      if (table.length === (1 << codeSize) && codeSize < 12) codeSize++;
      if (table.length >= 4096) resetTable();
    }
    prev = entry;
  }
  return out;
}

test('lzwEncode: a short repeating index stream round-trips through the reference decoder', () => {
  const indexes = [0, 1, 2, 2, 2, 2, 1, 0, 3, 3, 3, 1, 2, 0, 0, 0, 0, 0];
  const packed = lzwEncode(indexes, 2); // minCodeSize 2 -> 4-color-ish palette
  const decoded = lzwDecode(packed);
  assert.deepEqual(decoded, indexes);
});

test('lzwEncode: output is sub-block-packed — every block length byte is <= 255 and a trailing zero-length block terminates the stream', () => {
  const indexes = Array.from({ length: 2000 }, (_, i) => i % 5);
  const packed = lzwEncode(indexes, 3);
  let pos = 1;
  let sawTerminator = false;
  while (pos < packed.length) {
    const len = packed[pos];
    if (len === 0) { sawTerminator = true; break; }
    assert.ok(len <= 255);
    pos += 1 + len;
  }
  assert.ok(sawTerminator, 'expected a zero-length terminator block');
  assert.deepEqual(lzwDecode(packed), indexes);
});

test('lzwEncode: a long run forces a table reset at 4096 codes and still round-trips', () => {
  // A stream long and varied enough that its LZW table would grow past 4096 entries without a
  // reset — proves the encoder's own reset-at-4096 rule, not just that small inputs work.
  const indexes = [];
  for (let i = 0; i < 6000; i++) indexes.push((i * 7 + Math.floor(i / 13)) % 8);
  const packed = lzwEncode(indexes, 3);
  assert.deepEqual(lzwDecode(packed), indexes);
});

test('lzwEncode: minCodeSize is stored as the first byte of the packed stream', () => {
  const packed = lzwEncode([0, 1, 0, 1], 4);
  assert.equal(packed[0], 4);
});

test('lzwEncode: a single-index stream round-trips', () => {
  const packed = lzwEncode([0], 2);
  assert.deepEqual(lzwDecode(packed), [0]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/gif/lzw.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/gif/lzw'`.

- [ ] **Step 3: Write `plugin/bin/lib/gif/lzw.js`**

```js
// plugin/bin/lib/gif/lzw.js — GIF-compliant LZW encoder for the walkthrough codec (#2758).
// Implements the GIF87a/89a variable-code-size LZW variant: a clear code and end-of-information
// code reserved at (1<<minCodeSize) and +1, code size starts at minCodeSize+1 and grows by one
// bit each time the table's next index would overflow the current code width, up to 12 bits,
// with a full table reset (and a fresh clear code emitted) at 4096 entries. Output is packed
// into GIF sub-blocks: a leading minCodeSize byte, then each ≤255-byte run of packed bits
// prefixed with its own length byte, terminated by a zero-length block — the shape a real GIF
// image-data block is bit-for-bit.
'use strict';

const MAX_CODE_BITS = 12;
const MAX_TABLE_SIZE = 1 << MAX_CODE_BITS; // 4096

// A bit writer that packs variable-width codes LSB-first (GIF's bit order) and, independently,
// packs the resulting byte stream into length-prefixed ≤255-byte GIF sub-blocks.
function makeBitWriter() {
  const bytes = [];
  let current = 0, bitCount = 0;
  return {
    writeCode(code, size) {
      for (let i = 0; i < size; i++) {
        current |= ((code >> i) & 1) << bitCount;
        bitCount++;
        if (bitCount === 8) { bytes.push(current); current = 0; bitCount = 0; }
      }
    },
    flushToSubBlocks() {
      if (bitCount > 0) bytes.push(current);
      const out = [];
      for (let i = 0; i < bytes.length; i += 255) {
        const slice = bytes.slice(i, i + 255);
        out.push(slice.length, ...slice);
      }
      out.push(0); // terminator
      return out;
    },
  };
}

function lzwEncode(indexStream, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const writer = makeBitWriter();
  let codeSize, table, nextCode;

  const resetTable = () => {
    table = new Map();
    for (let i = 0; i < clearCode; i++) table.set(String(i), i);
    nextCode = clearCode + 2;
    codeSize = minCodeSize + 1;
    writer.writeCode(clearCode, codeSize);
  };

  resetTable();
  let w = '';
  for (let i = 0; i < indexStream.length; i++) {
    const k = String(indexStream[i]);
    const wk = w === '' ? k : `${w},${k}`;
    if (table.has(wk)) {
      w = wk;
    } else {
      writer.writeCode(table.get(w), codeSize);
      table.set(wk, nextCode);
      nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < MAX_CODE_BITS) codeSize++;
      if (nextCode >= MAX_TABLE_SIZE) resetTable();
      w = k;
    }
  }
  if (w !== '') writer.writeCode(table.get(w), codeSize);
  writer.writeCode(eoiCode, codeSize);

  const subBlocks = writer.flushToSubBlocks();
  return new Uint8Array([minCodeSize, ...subBlocks]);
}

module.exports = { lzwEncode };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/gif/lzw.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/gif/lzw.js tests/bin-lib/gif/lzw.test.js
```
```bash
git commit -m "Add a GIF-compliant LZW encoder — variable code width, table reset at 4096, sub-block packing (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 4: `plugin/bin/lib/gif/encoder.js` — GIF89a writer

**Files:**
- Create: `plugin/bin/lib/gif/encoder.js`
- Test: `tests/bin-lib/gif/encoder.test.js`

**Interfaces:**
- Consumes: Task 3's `lzwEncode`.
- Produces (exports): `encodeGif({ width, height, frames, palette, loop = 0 }) → Buffer` where `frames` is `[{ indexes: Uint8Array, delayCs: number }, ...]` (indexes already palette-mapped, from Task 2's `quantize().index()`), `palette` is Task 2's flat `Uint8Array(3*n)`, `loop` is the NETSCAPE loop count (`0` = infinite). Output: GIF87a/89a header `GIF89a`, logical screen descriptor, global color table (padded to the next power-of-two ≥ palette size, per the GIF spec's packed-field size bits), a `NETSCAPE2.0` application extension for looping, then per frame a graphic control extension (delay, no transparency) + image descriptor + LZW-encoded image data, then a trailer byte `0x3B`.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/gif/encoder.test.js`:

```js
'use strict';
// tests/bin-lib/gif/encoder.test.js — #2758: GIF89a structure and a full round-trip through the
// same reference LZW decoder lzw.test.js ships, so this proves real frames recover, not just
// that the container bytes look right.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeGif } = require('../../../plugin/bin/lib/gif/encoder');

// The identical reference LZW decoder from lzw.test.js (duplicated here deliberately — this
// file's fixture is a full GIF stream, not a bare LZW block, so it needs its own block-boundary
// walk to find each frame's image data before decoding it).
function lzwDecode(packed) {
  const minCodeSize = packed[0];
  let pos = 1;
  const bits = [];
  while (packed[pos] !== 0) {
    const blockLen = packed[pos]; pos += 1;
    for (let i = 0; i < blockLen; i++) { const byte = packed[pos + i]; for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1); }
    pos += blockLen;
  }
  let bitPos = 0;
  const readCode = (size) => { let code = 0; for (let i = 0; i < size; i++) { code |= (bits[bitPos] || 0) << i; bitPos++; } return code; };
  const clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1, table, out = [], prev = null;
  const resetTable = () => { table = []; for (let i = 0; i < clearCode; i++) table[i] = [i]; codeSize = minCodeSize + 1; prev = null; };
  resetTable();
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) { resetTable(); continue; }
    if (code === eoiCode) break;
    let entry = table[code] || (code === table.length && prev ? [...prev, prev[0]] : null);
    if (!entry) throw new Error(`bad LZW code ${code}`);
    out.push(...entry);
    if (prev) { table.push([...prev, entry[0]]); if (table.length === (1 << codeSize) && codeSize < 12) codeSize++; if (table.length >= 4096) resetTable(); }
    prev = entry;
  }
  return out;
}

test('encodeGif: starts with GIF89a, contains NETSCAPE2.0, one image descriptor per frame', () => {
  const width = 3, height = 2, n = width * height;
  const palette = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]); // 3 colors
  const frames = [
    { indexes: new Uint8Array(n).fill(0), delayCs: 50 },
    { indexes: new Uint8Array(n).fill(1), delayCs: 50 },
    { indexes: new Uint8Array(n).fill(2), delayCs: 200 },
  ];
  const buf = encodeGif({ width, height, frames, palette, loop: 0 });
  assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(buf.includes(Buffer.from('NETSCAPE2.0', 'ascii')));
  let imageDescriptors = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x2c) imageDescriptors++;
  assert.equal(imageDescriptors, 3);
  assert.equal(buf[buf.length - 1], 0x3b); // trailer
});

test('encodeGif: each frame round-trips through the reference LZW decoder to its original indexes', () => {
  const width = 4, height = 4, n = width * height;
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { palette[i * 3] = i; palette[i * 3 + 1] = 255 - i; palette[i * 3 + 2] = (i * 3) % 256; }
  const frameAIdx = new Uint8Array(n); for (let i = 0; i < n; i++) frameAIdx[i] = i % 200;
  const frameBIdx = new Uint8Array(n).fill(7);
  const frames = [{ indexes: frameAIdx, delayCs: 100 }, { indexes: frameBIdx, delayCs: 400 }];
  const buf = encodeGif({ width, height, frames, palette, loop: 0 });

  // Walk image descriptors (0x2c) and decode each frame's LZW block that follows.
  const decodedFrames = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x2c) continue;
    // Image descriptor: 1 (marker) + 4 (left,top) + 4 (width,height) + 1 (packed) = 10 bytes.
    const lzwStart = i + 10;
    decodedFrames.push(lzwDecode(buf.subarray(lzwStart)));
    if (decodedFrames.length === frames.length) break;
  }
  assert.deepEqual(decodedFrames[0], [...frameAIdx]);
  assert.deepEqual(decodedFrames[1], [...frameBIdx]);
});

test('encodeGif: graphic control extension carries each frame\'s own delayCs (little-endian, 2 bytes)', () => {
  const width = 2, height = 2, n = 4;
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const frames = [{ indexes: new Uint8Array(n).fill(0), delayCs: 12345 % 65536 }, { indexes: new Uint8Array(n).fill(1), delayCs: 77 }];
  const buf = encodeGif({ width, height, frames, palette });
  // Graphic control extension: 0x21 0xF9 0x04 <packed> <delayLo> <delayHi> <transparent> 0x00
  const delays = [];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) delays.push(buf[i + 4] | (buf[i + 5] << 8));
  }
  assert.deepEqual(delays, [12345 % 65536, 77]);
});

test('encodeGif: logical screen descriptor carries the given width/height (little-endian)', () => {
  const palette = new Uint8Array([1, 2, 3]);
  const buf = encodeGif({ width: 300, height: 150, frames: [{ indexes: new Uint8Array(1), delayCs: 10 }], palette });
  const w = buf[6] | (buf[7] << 8);
  const h = buf[8] | (buf[9] << 8);
  assert.equal(w, 300); assert.equal(h, 150);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/gif/encoder.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/gif/encoder'`.

- [ ] **Step 3: Write `plugin/bin/lib/gif/encoder.js`**

```js
// plugin/bin/lib/gif/encoder.js — GIF89a container writer for the walkthrough codec (#2758).
// Takes already-palette-mapped frames (Task 2's quantize().index() output) and Task 3's LZW
// encoder and assembles a complete animated GIF: header, logical screen descriptor, one global
// color table (one palette for the whole animation — never per-frame, per the record's own
// Gotchas), a NETSCAPE2.0 loop extension, then per frame a graphic control extension + image
// descriptor + LZW image data, and a trailer.
'use strict';

const { lzwEncode } = require('./lzw');

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(p, 2); // GIF color table size is always >= 2 entries
}

function le16(n) { return [n & 0xff, (n >> 8) & 0xff]; }

function encodeGif({ width, height, frames, palette, loop = 0 }) {
  const paletteSize = palette.length / 3;
  const tableSize = nextPow2(paletteSize);
  const colorBits = Math.log2(tableSize); // e.g. 256 -> 8, 3 -> 2 (after rounding to pow2 4)
  const paddedPalette = Buffer.alloc(tableSize * 3);
  Buffer.from(palette).copy(paddedPalette, 0, 0, palette.length);

  const parts = [];

  // Header
  parts.push(Buffer.from('GIF89a', 'ascii'));

  // Logical Screen Descriptor: width(2) height(2) packed(1) bgColorIndex(1) pixelAspect(1)
  const gctFlag = 1;
  const colorRes = colorBits - 1; // spec: color resolution bits stored as (bits - 1)
  const packedLsd = (gctFlag << 7) | (colorRes << 4) | (0 << 3) | (colorBits - 1);
  parts.push(Buffer.from([...le16(width), ...le16(height), packedLsd, 0, 0]));

  // Global Color Table
  parts.push(paddedPalette);

  // NETSCAPE2.0 application extension (looping)
  parts.push(Buffer.from([
    0x21, 0xff, 0x0b,
    ...Buffer.from('NETSCAPE2.0', 'ascii'),
    0x03, 0x01, ...le16(loop), 0x00,
  ]));

  const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(paletteSize, 2))));

  for (const frame of frames) {
    // Graphic Control Extension: 0x21 0xF9 blockSize(1)=4 packed(1) delay(2) transparentIdx(1) terminator(0)
    const packedGce = 0; // no transparency, no disposal method specified
    parts.push(Buffer.from([0x21, 0xf9, 0x04, packedGce, ...le16(frame.delayCs & 0xffff), 0x00, 0x00]));

    // Image Descriptor: 0x2C left(2) top(2) width(2) height(2) packed(1)
    parts.push(Buffer.from([0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0x00]));

    // Image Data: LZW-encoded, already sub-block-packed and minCodeSize-prefixed by lzwEncode.
    parts.push(Buffer.from(lzwEncode(frame.indexes, minCodeSize)));
  }

  parts.push(Buffer.from([0x3b])); // trailer

  return Buffer.concat(parts);
}

module.exports = { encodeGif };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/gif/encoder.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/gif/encoder.js tests/bin-lib/gif/encoder.test.js
```
```bash
git commit -m "Add the GIF89a container writer — one global palette, NETSCAPE loop extension, per-frame GCE+LZW (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 5: `plugin/bin/lib/walkthrough/encode.js` — frame planning, dimension check, budget, captions

**Files:**
- Create: `plugin/bin/lib/walkthrough/encode.js`
- Test: `tests/bin-lib/walkthrough/encode.test.js`

**Interfaces:**
- Consumes: Task 1's `decodePng`/`PngDecodeError`, Task 2's `quantize`, Task 4's `encodeGif`.
- Produces (exports): `planFrames(steps, { delayMs = 2000, lastHoldMs = 4000 } = {}) → [{ path, delayCs }]` — wait, `planFrames` does not know frame paths (those come from the skill's own screenshot loop); on reflection its job is purely delay planning — `planFrames(stepCount, { delayMs = 2000, lastHoldMs = 4000 } = {}) → [{ delayCs }]` (one entry per step, all but the last at `Math.round(delayMs / 10)` centiseconds, the last — including the only one when `stepCount === 1` — at `Math.round(lastHoldMs / 10)`); `encodeWalkthrough({ framePaths, delays, width, budgetBytes }, deps) → { buffer, bytes, width, height, downscaled }` where `deps = { readFile = fs.readFileSync }` (injectable for tests); `captionList(steps) → string` (ordered markdown); `FrameMismatchError` (class); `BudgetExceededError` (class, carries `.bytes`, `.budgetBytes`, `.levers` — an ordered string array).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/walkthrough/encode.test.js`:

```js
'use strict';
// tests/bin-lib/walkthrough/encode.test.js — #2758: frame delay planning, dimension-mismatch
// detection, downscale, budget enforcement, and caption rendering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  planFrames, encodeWalkthrough, captionList, FrameMismatchError, BudgetExceededError,
} = require('../../../plugin/bin/lib/walkthrough/encode');

// Minimal valid PNG builder (color type 2, RGB, uncompressed rows, filter None) — enough to
// exercise encodeWalkthrough's full decode->downscale->quantize->encode pipeline without a real
// screenshot.
function crc32(buf) {
  let c; const table = crc32.table || (crc32.table = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })());
  c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function buildPng(width, height, colorFn) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3 + 1); // +1 filter byte
    for (let x = 0; x < width; x++) { const [r, g, b] = colorFn(x, y); row[1 + x * 3] = r; row[1 + x * 3 + 1] = g; row[1 + x * 3 + 2] = b; }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('planFrames: N steps produce N frame-delay entries, first N-1 at delayCs 200, last at 400 (defaults)', () => {
  const plan = planFrames(5);
  assert.equal(plan.length, 5);
  for (let i = 0; i < 4; i++) assert.equal(plan[i].delayCs, 200);
  assert.equal(plan[4].delayCs, 400);
});

test('planFrames: a single step gets the last-hold delay, not the default', () => {
  const plan = planFrames(1);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].delayCs, 400);
});

test('planFrames: custom delayMs/lastHoldMs are honored and converted to centiseconds', () => {
  const plan = planFrames(3, { delayMs: 1500, lastHoldMs: 3000 });
  assert.equal(plan[0].delayCs, 150); assert.equal(plan[1].delayCs, 150); assert.equal(plan[2].delayCs, 300);
});

test('captionList: a captioned step renders its caption; an uncaptioned step renders action + locator', () => {
  const steps = [
    { action: 'click', locator: { role: 'button', name: 'Add to cart' }, caption: 'Add the item to your cart' },
    { action: 'fill', locator: { testid: 'email-input' }, value: 'user@example.com' },
    { action: 'assert_visible', locator: { text: 'Order confirmed', exact: true } },
  ];
  const out = captionList(steps);
  assert.match(out, /^1\. Add the item to your cart$/m);
  assert.match(out, /^2\. fill testid="email-input"$/m);
  assert.match(out, /^3\. assert_visible text="Order confirmed"$/m);
});

test('captionList: a role locator renders as {action} role={role} "{name}"', () => {
  const out = captionList([{ action: 'click', locator: { role: 'button', name: 'Add to cart' } }]);
  assert.match(out, /^1\. click role=button "Add to cart"$/m);
});

test('encodeWalkthrough: three identical-size fixtures encode to a valid GIF, prints frames:3', async () => {
  const png = buildPng(8, 6, (x, y) => [x * 10, y * 10, 50]);
  const readFile = (p) => png; // every path returns the same fixture bytes
  const result = encodeWalkthrough({ framePaths: ['a.png', 'b.png', 'c.png'], delays: [200, 200, 400], width: null, budgetBytes: 10 * 1024 * 1024 }, { readFile });
  assert.equal(result.width, 8); assert.equal(result.height, 6);
  assert.equal(result.buffer.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.equal(result.downscaled, false);
  assert.equal(result.bytes, result.buffer.length);
});

test('encodeWalkthrough: dimension mismatch throws FrameMismatchError naming the second path and both dimension pairs', () => {
  const pngA = buildPng(8, 6, () => [1, 2, 3]);
  const pngB = buildPng(4, 4, () => [1, 2, 3]);
  const readFile = (p) => (p === 'a.png' ? pngA : pngB);
  assert.throws(
    () => encodeWalkthrough({ framePaths: ['a.png', 'b.png'], delays: [200, 400], width: null, budgetBytes: 10 * 1024 * 1024 }, { readFile }),
    (err) => err instanceof FrameMismatchError && err.message.includes('b.png') && err.message.includes('8') && err.message.includes('4'),
  );
});

test('encodeWalkthrough: --width downscales by nearest-neighbor, height computed proportionally', () => {
  const png = buildPng(128, 96, (x, y) => [x, y, (x + y) % 256]);
  const readFile = () => png;
  const result = encodeWalkthrough({ framePaths: ['a.png'], delays: [400], width: 64, budgetBytes: 10 * 1024 * 1024 }, { readFile });
  assert.equal(result.width, 64);
  assert.equal(result.height, 48); // round(96 * 64/128)
  assert.equal(result.downscaled, true);
});

test('encodeWalkthrough: a tiny budget throws BudgetExceededError with the lever list, width-lever names the current width', () => {
  const png = buildPng(16, 12, (x, y) => [x * 15, y * 15, 99]);
  const readFile = () => png;
  assert.throws(
    () => encodeWalkthrough({ framePaths: ['a.png'], delays: [400], width: null, budgetBytes: 1 }, { readFile }),
    (err) => {
      assert.ok(err instanceof BudgetExceededError);
      assert.equal(err.budgetBytes, 1);
      assert.equal(err.levers[0], 'fewer steps');
      assert.equal(err.levers[1], 'lower --width (current 16px)');
      return true;
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/walkthrough/encode.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/walkthrough/encode'`.

- [ ] **Step 3: Write `plugin/bin/lib/walkthrough/encode.js`**

```js
// plugin/bin/lib/walkthrough/encode.js — frame delay planning, decode/downscale/quantize/encode
// pipeline, budget enforcement, and caption rendering for /claude-tweaks:walkthrough (#2758).
'use strict';

const fs = require('fs');
const { decodePng } = require('../gif/png-decode');
const { quantize } = require('../gif/palette');
const { encodeGif } = require('../gif/encoder');

class FrameMismatchError extends Error {
  constructor(message) { super(message); this.name = 'FrameMismatchError'; }
}
class BudgetExceededError extends Error {
  constructor(bytes, budgetBytes, levers) {
    super(`encoded GIF is ${bytes} bytes, over the ${budgetBytes}-byte budget`);
    this.name = 'BudgetExceededError';
    this.bytes = bytes; this.budgetBytes = budgetBytes; this.levers = levers;
  }
}

// stepCount -> one delay entry per step, centiseconds (GIF's native delay unit). The last step
// — including the only step when stepCount === 1 — holds longer so the loop doesn't snap away.
function planFrames(stepCount, { delayMs = 2000, lastHoldMs = 4000 } = {}) {
  const plan = [];
  for (let i = 0; i < stepCount; i++) {
    const isLast = i === stepCount - 1;
    plan.push({ delayCs: Math.round((isLast ? lastHoldMs : delayMs) / 10) });
  }
  return plan;
}

// Nearest-neighbor downscale of an RGBA buffer to targetWidth x targetHeight.
function downscaleNearest(rgba, srcW, srcH, targetW, targetH) {
  const out = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / targetH));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / targetW));
      const si = (sy * srcW + sx) * 4, di = (y * targetW + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

function encodeWalkthrough({ framePaths, delays, width, budgetBytes }, deps = {}) {
  const readFile = deps.readFile || fs.readFileSync;
  const decoded = framePaths.map((p) => ({ path: p, ...decodePng(readFile(p)) }));

  const first = decoded[0];
  for (let i = 1; i < decoded.length; i++) {
    const f = decoded[i];
    if (f.width !== first.width || f.height !== first.height) {
      throw new FrameMismatchError(
        `frame dimension mismatch: ${first.path} is ${first.width}x${first.height}, ${f.path} is ${f.width}x${f.height}`,
      );
    }
  }

  let targetW = first.width, targetH = first.height, downscaled = false;
  if (width && width < first.width) {
    targetW = width;
    targetH = Math.round((first.height * width) / first.width);
    downscaled = true;
  }

  const frameRgbas = decoded.map((f) => (
    downscaled ? downscaleNearest(f.rgba, f.width, f.height, targetW, targetH) : f.rgba
  ));

  const { palette, index } = quantize(frameRgbas, 256);
  const gifFrames = frameRgbas.map((rgba, i) => ({ indexes: index(rgba), delayCs: delays[i] }));
  const buffer = encodeGif({ width: targetW, height: targetH, frames: gifFrames, palette, loop: 0 });

  if (buffer.length > budgetBytes) {
    const levers = ['fewer steps', `lower --width (current ${targetW}px)`];
    throw new BudgetExceededError(buffer.length, budgetBytes, levers);
  }

  return { buffer, bytes: buffer.length, width: targetW, height: targetH, downscaled };
}

// A story-step locator -> its display form for the fallback caption line (no caption field).
function locatorDisplay(locator) {
  if (locator.role) return `role=${locator.role} "${locator.name}"`;
  if (locator.testid) return `testid="${locator.testid}"`;
  if (locator.text) return `text="${locator.text}"`;
  if (locator.label) return `label="${locator.label}"`;
  if (locator.placeholder) return `placeholder="${locator.placeholder}"`;
  return 'locator=?';
}

function captionList(steps) {
  const lines = steps.map((step, i) => {
    const text = step.caption ? step.caption : `${step.action} ${locatorDisplay(step.locator || {})}`;
    return `${i + 1}. ${text}`;
  });
  return lines.join('\n') + '\n';
}

module.exports = { planFrames, encodeWalkthrough, captionList, FrameMismatchError, BudgetExceededError };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/walkthrough/encode.test.js`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/walkthrough/encode.js tests/bin-lib/walkthrough/encode.test.js
```
```bash
git commit -m "Add the walkthrough encode pipeline — frame planning, dimension check, downscale, budget, captions (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 6: `plugin/bin/walkthrough-encode.js` — the CLI

**Files:**
- Create: `plugin/bin/walkthrough-encode.js`
- Test: `tests/bin-lib/walkthrough/encode-cli.test.js`

**Interfaces:**
- Consumes: Task 5's `encodeWalkthrough`, `FrameMismatchError`, `BudgetExceededError`, `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic`.
- Produces: `run(argv, deps)`, `realDeps`. `deps = { readFile, writeFileAtomic, stdout, stderr }`.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/walkthrough/encode-cli.test.js`:

```js
'use strict';
// tests/bin-lib/walkthrough/encode-cli.test.js — #2758: activity-render.js-shaped CLI wrapper
// over encode.js. Every dependency injected; no real file I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { run } = require('../../../plugin/bin/walkthrough-encode');

function crc32(buf) {
  let c; const table = crc32.table || (crc32.table = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })());
  c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function fixturePng(width, height) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = []; for (let y = 0; y < height; y++) { const row = Buffer.alloc(width * 3 + 1); for (let x = 0; x < width; x++) { row[1 + x * 3] = x; row[1 + x * 3 + 1] = y; row[1 + x * 3 + 2] = 9; } rows.push(row); }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function deps(files, overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    readFile: (p) => { if (!(p in files)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileAtomic: (p, content) => { out.written[p] = content; },
    stdout: (s) => out.stdout.push(s), stderr: (s) => out.stderr.push(s),
    ...overrides,
  };
  return { d, out };
}

test('--help exits 0 before any file read', () => {
  const { d, out } = deps({}, { readFile: () => { throw new Error('must not read'); } });
  assert.equal(run(['--help'], d), 0);
  assert.match(out.stdout.join(''), /usage: walkthrough-encode\.js/);
});

test('exit 1: missing --frames, missing --out, unknown flag', () => {
  for (const argv of [['--out', 'o.gif'], ['--frames', 'a.png'], ['--frames', 'a.png', '--out', 'o.gif', '--bogus']]) {
    const { d } = deps({});
    assert.equal(run(argv, d), 1, argv.join(' '));
  }
});

test('happy path: 3 comma-separated frames encode, exit 0, prints frames:3 and writes atomically', () => {
  const png = fixturePng(8, 6);
  const { d, out } = deps({ 'a.png': png, 'b.png': png, 'c.png': png });
  assert.equal(run(['--frames', 'a.png,b.png,c.png', '--out', 'o.gif', '--budget-mb', '8'], d), 0);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.equal(parsed.frames, 3);
  assert.equal(parsed.out, 'o.gif');
  assert.ok(out.written['o.gif'].subarray(0, 6).toString('ascii') === 'GIF89a');
});

test('--frames accepts a directory path expanded to its *.png entries in lexical order', () => {
  const png = fixturePng(4, 4);
  const { d, out } = deps({ 'dir/01.png': png, 'dir/02.png': png }, { readdir: () => ['02.png', '01.png'] });
  assert.equal(run(['--frames', 'dir', '--out', 'o.gif'], d), 0);
  assert.equal(JSON.parse(out.stdout.join('')).frames, 2);
});

test('exit 2: an unreadable frame relays the read error', () => {
  const { d, out } = deps({ 'a.png': fixturePng(4, 4) });
  assert.equal(run(['--frames', 'a.png,missing.png', '--out', 'o.gif'], d), 2);
  assert.match(out.stderr.join(''), /missing\.png/);
});

test('exit 2: a dimension-mismatched frame relays FrameMismatchError naming the offending path', () => {
  const { d, out } = deps({ 'a.png': fixturePng(8, 8), 'b.png': fixturePng(4, 4) });
  assert.equal(run(['--frames', 'a.png,b.png', '--out', 'o.gif'], d), 2);
  assert.match(out.stderr.join(''), /b\.png/);
});

test('exit 3: over budget prints the lever list, fewer steps first, lower --width second naming current width, writes nothing', () => {
  const { d, out } = deps({ 'a.png': fixturePng(128, 96) });
  assert.equal(run(['--frames', 'a.png', '--out', 'o.gif', '--budget-mb', '0.000001'], d), 3);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.deepEqual(parsed.levers, ['fewer steps', 'lower --width (current 128px)']);
  assert.deepEqual(out.written, {});
});

test('--delay-ms / --last-hold-ms / --width are threaded through to the encode call', () => {
  const { d, out } = deps({ 'a.png': fixturePng(128, 64), 'b.png': fixturePng(128, 64) });
  assert.equal(run(['--frames', 'a.png,b.png', '--out', 'o.gif', '--width', '64', '--delay-ms', '500', '--last-hold-ms', '1000'], d), 0);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.equal(parsed.width, 64);
  assert.equal(parsed.height, 32);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/walkthrough/encode-cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/walkthrough-encode'`.

- [ ] **Step 3: Write `plugin/bin/walkthrough-encode.js`**

```js
#!/usr/bin/env node
// bin/walkthrough-encode.js — thin CLI over bin/lib/walkthrough/encode.js (#2758). Writes the
// encoded GIF via atomic-write.js; nothing else. Logic lives in run(argv, deps); every side
// effect (readFile, readdir, writeFileAtomic, stdout, stderr) is injected so tests never touch
// the filesystem.
//
// Usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path>
//        [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>] [--help]
// Exit codes (Split-1/2, the resolve-blockers.js / fetch-sub-issues.js vocabulary):
//   0 encoded — prints {bytes, frames, width, height, out, downscaled} JSON
//   1 malformed invocation (missing --frames/--out, unknown flag)
//   2 a frame is unreadable, undecodable, or dimension-mismatched (the underlying error's
//     message is relayed, naming the offending path)
//   3 the encoded GIF is over budget — prints {bytes, budgetBytes, levers, out: null} JSON;
//     levers is always ["fewer steps", "lower --width (current {width}px)"] in that order —
//     {width} is the encoded width whether or not --width was passed; --delay-ms never appears,
//     since frame delay does not change encoded size
'use strict';

const fs = require('fs');
const path = require('path');
const { planFrames, encodeWalkthrough, FrameMismatchError, BudgetExceededError } = require('./lib/walkthrough/encode');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path> [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>] [--help]\n';

function parseArgs(argv) {
  const o = { frames: null, out: null, delayMs: 2000, lastHoldMs: 4000, width: null, budgetMb: 8, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v === '' || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--frames') { o.frames = next(); if (o.frames === null) return { error: '--frames requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else if (a === '--delay-ms') { const v = next(); if (v === null) return { error: '--delay-ms requires a value' }; o.delayMs = Number(v); }
    else if (a === '--last-hold-ms') { const v = next(); if (v === null) return { error: '--last-hold-ms requires a value' }; o.lastHoldMs = Number(v); }
    else if (a === '--width') { const v = next(); if (v === null) return { error: '--width requires a value' }; o.width = Number(v); }
    else if (a === '--budget-mb') { const v = next(); if (v === null) return { error: '--budget-mb requires a value' }; o.budgetMb = Number(v); }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p),
  readdir: (p) => fs.readdirSync(p),
  writeFileAtomic: (p, content) => writeFileAtomic(p, content),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// Per-frame delays reuse encode.js's own planFrames rather than re-deriving the same rule here:
// the CLI never receives a step count directly, but the resolved frame-path list's length IS
// that count (one screenshot per step, per the skill's Step 3), so planFrames(framePaths.length)
// is the correct call, not a coincidence.

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`walkthrough-encode.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.frames) return usageError('--frames is required');
  if (!o.out) return usageError('--out is required');

  let framePaths;
  try {
    const stat = fs.existsSync && deps.readdir ? null : null; // no-op placeholder for clarity
    if (o.frames.includes(',')) {
      framePaths = o.frames.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      // Single value: try as a directory first (readdir), fall back to a single file path.
      let entries = null;
      try { entries = deps.readdir(o.frames); } catch { entries = null; }
      if (entries) {
        framePaths = entries.filter((f) => f.endsWith('.png')).sort().map((f) => path.join(o.frames, f));
      } else {
        framePaths = [o.frames];
      }
    }
  } catch (err) {
    deps.stderr(`walkthrough-encode.js: could not resolve --frames: ${err && err.message}\n`);
    return 2;
  }

  const delays = planFrames(framePaths.length, { delayMs: o.delayMs, lastHoldMs: o.lastHoldMs }).map((f) => f.delayCs);
  const budgetBytes = Math.round(o.budgetMb * 1024 * 1024);

  let result;
  try {
    result = encodeWalkthrough({ framePaths, delays, width: o.width, budgetBytes }, { readFile: deps.readFile });
  } catch (err) {
    if (err instanceof FrameMismatchError) { deps.stderr(`walkthrough-encode.js: ${err.message}\n`); return 2; }
    if (err instanceof BudgetExceededError) {
      deps.stdout(JSON.stringify({ bytes: err.bytes, budgetBytes: err.budgetBytes, levers: err.levers, out: null }) + '\n');
      return 3;
    }
    deps.stderr(`walkthrough-encode.js: could not read or decode a frame: ${err && err.message}\n`);
    return 2;
  }

  deps.writeFileAtomic(o.out, result.buffer);
  deps.stdout(JSON.stringify({ out: o.out, bytes: result.bytes, frames: framePaths.length, width: result.width, height: result.height, downscaled: result.downscaled }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/walkthrough/encode-cli.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (8/8 new; exit-code conformance stays green).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/walkthrough-encode.js tests/bin-lib/walkthrough/encode-cli.test.js
```
```bash
git commit -m "Add the walkthrough-encode CLI — Split-1/2 exit vocabulary, dir-or-list --frames, atomic write (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 7: `plugin/bin/lib/walkthrough/select.js` — pure story selection

**Files:**
- Create: `plugin/bin/lib/walkthrough/select.js`
- Test: `tests/bin-lib/walkthrough/select.test.js`

**Interfaces:**
- Produces (exports): `selectStories({ recordKeyFiles = [], recordJourneys = [], storyFiles }) → [{ path, id, matchedBy }]` where `storyFiles` is `[{ path, stories: [{ id, journey, source_files }] }]` (already-parsed YAML, no file I/O in this module); a story matches when any `source_files` entry equals a `recordKeyFiles` path, or its `journey` is in `recordJourneys`; `matchedBy` is `'source_files'` or `'journey'` (or both listed — see AC11's "matchedBy naming the field" wording: when a story matches by both, `matchedBy` is `'source_files+journey'`).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/walkthrough/select.test.js`:

```js
'use strict';
// tests/bin-lib/walkthrough/select.test.js — #2758: pure story selection, no gh/fs reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectStories } = require('../../../plugin/bin/lib/walkthrough/select');

const STORY_FILES = [
  { path: 'stories/checkout.yaml', stories: [{ id: 'checkout-happy-path', journey: 'checkout', source_files: ['src/checkout.ts'] }] },
  { path: 'stories/profile.yaml', stories: [{ id: 'profile-edit', journey: 'profile', source_files: ['src/profile.ts'] }] },
  { path: 'stories/both.yaml', stories: [{ id: 'both-match', journey: 'checkout', source_files: ['src/checkout.ts'] }] },
];

test('selectStories: zero matches returns an empty list', () => {
  const result = selectStories({ recordKeyFiles: ['src/unrelated.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  assert.deepEqual(result, []);
});

test('selectStories: exactly one match by source_files', () => {
  const result = selectStories({ recordKeyFiles: ['src/profile.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'profile-edit');
  assert.equal(result[0].matchedBy, 'source_files');
});

test('selectStories: exactly one match by journey', () => {
  const result = selectStories({ recordKeyFiles: [], recordJourneys: ['profile'], storyFiles: STORY_FILES });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'profile-edit');
  assert.equal(result[0].matchedBy, 'journey');
});

test('selectStories: two matches (both fields) returns both entries with matchedBy naming the field', () => {
  const result = selectStories({ recordKeyFiles: ['src/checkout.ts'], recordJourneys: [], storyFiles: STORY_FILES });
  const ids = result.map((r) => r.id).sort();
  assert.deepEqual(ids, ['both-match', 'checkout-happy-path']);
  for (const r of result) assert.equal(r.matchedBy, 'source_files');
});

test('selectStories: a story matching by both fields reports matchedBy "source_files+journey"', () => {
  const result = selectStories({ recordKeyFiles: ['src/checkout.ts'], recordJourneys: ['checkout'], storyFiles: STORY_FILES });
  const both = result.find((r) => r.id === 'both-match');
  assert.equal(both.matchedBy, 'source_files+journey');
});

test('selectStories: is pure — the same input called twice returns deep-equal results', () => {
  const args = { recordKeyFiles: ['src/checkout.ts'], recordJourneys: [], storyFiles: STORY_FILES };
  assert.deepEqual(selectStories(args), selectStories(args));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/walkthrough/select.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/walkthrough/select'`.

- [ ] **Step 3: Write `plugin/bin/lib/walkthrough/select.js`**

```js
// plugin/bin/lib/walkthrough/select.js — pure story selection for /claude-tweaks:walkthrough's
// `#N` resolution path (#2758). No gh/fs reads: the skill parses the record body and the story
// YAML files itself and hands both in as plain data.
'use strict';

function selectStories({ recordKeyFiles = [], recordJourneys = [], storyFiles }) {
  const keyFileSet = new Set(recordKeyFiles);
  const journeySet = new Set(recordJourneys);
  const matches = [];
  for (const file of storyFiles) {
    for (const story of file.stories) {
      const bySourceFiles = Array.isArray(story.source_files) && story.source_files.some((f) => keyFileSet.has(f));
      const byJourney = story.journey && journeySet.has(story.journey);
      if (!bySourceFiles && !byJourney) continue;
      const matchedBy = bySourceFiles && byJourney ? 'source_files+journey' : bySourceFiles ? 'source_files' : 'journey';
      matches.push({ path: file.path, id: story.id, matchedBy });
    }
  }
  return matches;
}

module.exports = { selectStories };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/walkthrough/select.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/walkthrough/select.js tests/bin-lib/walkthrough/select.test.js
```
```bash
git commit -m "Add pure story selection for /claude-tweaks:walkthrough's #N resolution path (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 8: The stories schema addition, `qa-agent.md`'s ignore-note, and `plugin/skills/walkthrough/SKILL.md`

**Files:**
- Modify: `plugin/skills/stories/SKILL.md` (schema section, `~35.8 KB → re-measure with wc -c`)
- Modify: `plugin/skills/stories/story-examples.md` (one worked example gains `caption`)
- Modify: `plugin/agents/qa-agent.md` (one sentence in Section 4)
- Create: `plugin/skills/walkthrough/SKILL.md`
- Test: `tests/walkthrough-conformance.test.js`, `tests/stories-caption-expand-only.test.js`

**Interfaces:**
- Consumes: Task 5's `encodeWalkthrough` contract (via the CLI, Task 6), Task 7's `selectStories`, `plugin/bin/lib/session-tmp.js`'s `sessionTmpPath(sessionId, filename)`, `plugin/bin/lib/issues/grouping.js`'s `extractKeyFiles(issue)`.

- [ ] **Step 1: Write the failing tests**

`tests/walkthrough-conformance.test.js`:

```js
'use strict';
// tests/walkthrough-conformance.test.js — #2758: the SKILL.md never instructs loosening a
// locator to CSS, always requires --base, and never defaults a write destination under
// .claude-tweaks/artifacts/. Go-red proof: the skill file does not exist at base 09ae6c80d, so
// every literal below was absent there; the CSS-permissiveness pattern is additionally proven
// against a hand-doctored copy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'walkthrough', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');

const CSS_PERMISSIVE_RE = /loosen[^.]*CSS|fall back[^.]*CSS/i;

test('the skill never permits loosening a locator to CSS', () => {
  assert.equal(CSS_PERMISSIVE_RE.test(skill), false);
  const doctored = skill + '\nIf the locator cannot be found, loosen the match to a CSS selector.';
  assert.ok(CSS_PERMISSIVE_RE.test(doctored), 'doctored control must trip the pattern (proves go-red)');
});

test('--base is described as required', () => {
  assert.match(skill, /--base.*required|require.*--base/i);
});

test('no default write destination under .claude-tweaks/artifacts/', () => {
  assert.equal(skill.includes('.claude-tweaks/artifacts/'), false);
});

test('no git commit/git add instruction', () => {
  assert.equal(/git (commit|add)\b/.test(skill), false);
});

test('runs the encode CLI and playwright-cli through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js"'));
});

test('never instructs backend=chrome', () => {
  assert.equal(/backend=chrome/.test(skill), false);
});
```

`tests/stories-caption-expand-only.test.js`:

```js
'use strict';
// tests/stories-caption-expand-only.test.js — #2758: the caption field is documented as optional
// and QA-ignored in both the schema doc and the runtime mapper.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storiesSkill = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const qaAgent = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'agents', 'qa-agent.md'), 'utf8').replace(/\r\n/g, '\n');
const storyExamples = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'stories', 'story-examples.md'), 'utf8').replace(/\r\n/g, '\n');

test('stories/SKILL.md documents caption as optional and walkthrough-only', () => {
  assert.match(storiesSkill, /caption/);
  assert.match(storiesSkill, /caption[\s\S]{0,200}(optional|walkthrough)/i);
});

test('qa-agent.md states caption is never read at runtime', () => {
  assert.match(qaAgent, /caption[\s\S]{0,200}(never read|ignored|walkthrough-only)/i);
});

test('story-examples.md gains a worked example carrying caption', () => {
  assert.match(storyExamples, /caption:/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/walkthrough-conformance.test.js tests/stories-caption-expand-only.test.js`
Expected: FAIL — `ENOENT … plugin/skills/walkthrough/SKILL.md` (first file); the second file's three tests FAIL on missing `caption` text in the three existing files.

- [ ] **Step 3: Edit `plugin/skills/stories/SKILL.md`'s schema section**

Read the file's `## Story schema (v2)` section first (it is canonical for field semantics). Using the Edit tool, insert one sentence immediately after the existing schema-fields paragraph (the one ending "...See `playwright-cli-reference.md` in the `/claude-tweaks:browse` skill directory for the full operation vocabulary."):

```markdown

An optional per-step field, `caption: "<one line>"`, exists purely for `/claude-tweaks:walkthrough` — a one-line human-readable description shown beside that step's frame in a generated GIF's caption list. It is expand-only (no existing story's meaning changes) and is never read by QA execution: `qa-agent.md`'s step mapping does not reference it.
```

Re-measure: `wc -c plugin/skills/stories/SKILL.md` — must stay under the 45 KB advisory ceiling (`context-cost.js`); the record's own Gotchas note ~10 KB of headroom before this edit.

- [ ] **Step 4: Edit `plugin/skills/stories/story-examples.md`**

Read the file, find one existing worked v2 example's `steps:` block, and add `caption: "<short description>"` to one of its steps using the Edit tool — e.g. after an existing `action: click` / `locator: { role: button, name: "..." }` pair, add the line `        caption: "..."` (matching the file's existing indentation) with a description matching that step's actual action.

- [ ] **Step 5: Edit `plugin/agents/qa-agent.md`**

Read Section 4 first. Using the Edit tool, add one sentence immediately after the existing paragraph that lists the action-step command mapping (the paragraph ending "...never used as an existence probe or an action)."):

```markdown

A story step may also carry a `caption` field — it is a `/claude-tweaks:walkthrough`-only annotation for the generated GIF's caption list; this agent never reads it, and its presence or absence changes nothing about how a step executes.
```

- [ ] **Step 6: Write `plugin/skills/walkthrough/SKILL.md`**

Use the Write tool. No inline Interaction-style directive (hook-injected since #1909).

````markdown
---
name: walkthrough
description: Use for producing a shareable animated GIF plus an ordered caption list from an executed user story — a walkthrough a second person can open, attach to a PR, or commit into docs, distinct from ephemeral QA screenshots. Keywords - walkthrough, GIF, animated demo, screen recording, share, caption.
argument-hint: "[<story-path>|--story <name>|#N] --base <url> [--budget-mb <n>] [--width <px>] [--delay-ms <n>] [--settle-ms <n>]"
---

# Walkthrough — Shareable animated GIF from an executed story

Executes an existing schema-v2 user story through Playwright CLI, captures one PNG frame per step, and encodes an animated GIF plus an ordered caption list — a walkthrough that survives being attached to a PR, dropped in chat, or committed into docs, unlike the QA screenshots every `/claude-tweaks:test qa` run already captures and discards under `.claude-tweaks/artifacts/`.

Not `/claude-tweaks:demo` — that name means human acceptance sign-off on a built thing. This produces a shareable artifact, nothing more.

## When to Use

- A finished feature needs a shareable visual walkthrough for a PR description, a chat message, or a docs page
- An existing story already exercises the flow worth sharing
- You want the "what happens when you do this" story, not a full video recording (this plugin ships no video capability — see Non-Goals below)

Not for: acceptance sign-off (`/claude-tweaks:demo`), authoring a new story (`/claude-tweaks:stories`, which this skill offers and stops when no story matches), true motion capture (cursor travel, scroll, CSS transitions — Playwright CLI exposes no screencast operation).

## Input

`$ARGUMENTS` is parsed as `[<story-path>|--story <name>|#N] --base <url> [--budget-mb <n>] [--width <px>] [--delay-ms <n>] [--settle-ms <n>]`:

| Argument | Default | Behavior |
|---|---|---|
| `<story-path>` | — | A direct path to a `stories/*.yaml` file; if it carries more than one story, ask which. |
| `--story <name>` | — | Matches a `stories[].id` directly across every `stories/*.yaml` file. |
| `#N` | — | Fetches record `N` via `gh issue view N --json body`, extracts Key Files with `extractKeyFiles`, collects any `docs/journeys/{name}.md` names the body cites, and calls `selectStories` over the parsed `stories/*.yaml` files. Zero matches: offer `/claude-tweaks:stories` and stop. More than one: one `AskUserQuestion` listing candidates by `id` and `matchedBy`. |
| *(none)* | — | Uses the current branch's changed files as the key-file set for the same `selectStories` call as `#N`; asks when ambiguous, never guesses. |
| `--base` | **required** | The URL to run the story against. Stop with a one-line message when absent — this skill never auto-detects a dev server, since a walkthrough recorded against the wrong environment is silently wrong rather than obviously broken. |
| `--budget-mb` | `8` | Maximum encoded GIF size, passed straight through to `walkthrough-encode.js`. |
| `--width` | *(none — original frame width)* | Downscale target in pixels; passed straight through. |
| `--delay-ms` | `2000` | Per-step frame hold, all but the last step. |
| `--settle-ms` | `500` | Wait after each step's action before screenshotting — a command-completion signal is not a visual-stability one. Authors may also add explicit `wait` steps for slow async renders even when QA never needed one. |

## Step 1: Resolve the story

Per the Input table above. Once resolved, read the story YAML directly — do not re-derive its steps through `/claude-tweaks:stories`.

## Step 2: Probe `--base` and open the session

Probe `--base` reachability (a plain HTTP HEAD/GET); stop with a one-line message if unreachable. Open one Playwright CLI session named `walkthrough-{story-id}`:

```bash
playwright-cli -s=walkthrough-{story-id} open {base-url}
```

then set the viewport explicitly (Task 0's live probe found the headless default already matches `1280x720`, but this skill sets it anyway — that default is an implementation detail of the installed browser, not a documented contract):

```bash
playwright-cli -s=walkthrough-{story-id} resize 1280 720
```

## Step 3: Execute each step and capture a frame

For each step, run the action exactly as `plugin/agents/qa-agent.md` Section 4 maps it — a `snapshot` to resolve the story's locator to an `eN` ref, then the ref-based `click <eN>` / `fill <eN> "<text>"` / `check <eN>` / `hover <eN>` command (escaping every story-supplied string per that file's escaping rule before interpolation); `assert_visible` re-snapshots and checks tree membership with no action; `navigate` steps use `goto <url>`, never `open` (which is reserved for the session's first navigation in Step 2). Wait `--settle-ms` after the action completes, then screenshot to a session-scoped frame path:

```bash
playwright-cli -s=walkthrough-{story-id} screenshot --filename={frame-path}
```

`{frame-path}` is `sessionTmpPath(sessionId, 'walkthrough-{story-id}/{NN}.png')` per `_shared/session-tmp-root.md` (under the OS temp dir, never under `.claude-tweaks/artifacts/`), `{NN}` zero-padded in step order.

On a locator miss, report the step number and stop — **never loosen to a CSS selector**; a walkthrough that needed one would break on the next markup change and is lying about being semantic.

## Step 4: Encode

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/walkthrough-encode.js" --frames {frame-dir} --out {gif-path} --delay-ms {delay-ms} --budget-mb {budget-mb}
```

Add `--width {width}` when given. Branch on the exit code: `0` → the GIF is written; proceed to Step 5. `1` → malformed invocation — relay the message and stop (should not occur; this skill builds the argv itself). `2` → an unreadable, undecodable, or dimension-mismatched frame — relay the message (it names the offending path) and stop; a dimension mismatch means the viewport changed mid-run, which Step 2's explicit `resize` is meant to prevent. `3` → over budget — relay the printed lever list (`fewer steps`, then `lower --width`) and stop; do not retry with a guessed width without the user's input.

On success, delete the frame directory — frames are intermediate, the GIF is the artifact. On any failure above, leave the frames in place for diagnosis and report their path.

## Step 5: Write the caption list and choose a destination

Write `{name}.md` beside the GIF — one ordered line per step, from the story's own `caption` fields (falling back to `{action} {locator}` for steps without one, exactly as `captionList` renders it). Then ask the output location with one `AskUserQuestion`:

- `question`: `"Where should the walkthrough go?"`, `header`: `"Save walkthrough"`, `multiSelect`: `false`
- Option 1 — `label`: `"Archive path (Recommended)"`, `description`: `"Write to docs/walkthroughs/{story-id}.gif and .md (creates docs/walkthroughs/ if absent)"`
- Option 2 — `label`: `"Current directory"`, `description`: `"Write to ./{story-id}.gif and .md"`
- Option 3 — `label`: `"Don't save"`, `description`: `"Keep the frame directory description in this conversation only — nothing written"`

An explicit path comes through `Other`. The GIF and caption list are copied together with the Write tool. Nothing is written into the repository without this choice, and nothing is ever committed on the user's behalf — the walkthrough exists to be kept, so it never defaults to `.claude-tweaks/artifacts/`, which `/claude-tweaks:tidy` prunes after 30 days.

Close the Playwright CLI session on every path — success, a Step 3 locator miss, or a Step 4 encode failure.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:walkthrough --story {other-id} --base {url}`** — record another story (recommended when more than one story matched at Step 1)
`/claude-tweaks:stories` — author a new story when none matches
`/claude-tweaks:help` — full pipeline status

## Component-Skill Contract

`/claude-tweaks:walkthrough` is a **standalone-only** skill — no lifecycle skill invokes it. There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders, and Step 5's save-location question always runs.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Loosening a locator to CSS on a miss | A walkthrough built on a CSS selector breaks on the next markup change and is lying about being semantic — stop and report the step instead |
| Writing the GIF under `.claude-tweaks/artifacts/` or committing it | That tree is disposable by declaration; nothing is committed on the user's behalf in any mode |
| Retrying with a guessed `--width` after a budget-exceeded exit | The lever list names the levers in order for a reason — relay it and let the user choose, never auto-shrink |
| Using `backend=chrome` here | Restricted to human ad-hoc use in `browse/SKILL.md`; this skill is the same kind of pipeline-adjacent consumer as `qa-agent`/`/stories` and stays `playwright-cli`-only |
| Authoring a story when none matches | `/claude-tweaks:stories` owns story authoring — offer it and stop |
````

- [ ] **Step 7: Run the tests**

Run: `node --test tests/walkthrough-conformance.test.js tests/stories-caption-expand-only.test.js tests/skill-conventions.test.js tests/skill-prose-plugin-root-invocations.test.js tests/bin-lib/skill-audit/house-structure.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/walkthrough/SKILL.md plugin/skills/stories/SKILL.md plugin/skills/stories/story-examples.md plugin/agents/qa-agent.md tests/walkthrough-conformance.test.js tests/stories-caption-expand-only.test.js
```
```bash
git commit -m "Add the /claude-tweaks:walkthrough skill and the expand-only caption field on stories v2 (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 9: Registration on the five surfaces, the Anti-Patterns pin, and description/CSC pins

**Files:**
- Modify: `docs/skill-graph.md` (new `## walkthrough` section, alphabetical — after `## visualize`, before `## wrap-up`)
- Modify: `plugin/skills/help/reference-card.md` (new row in the `## Utility` table, after the `/claude-tweaks:activity` row)
- Modify: `plugin/skills/help/context-flow.md` (new row after the `/activity` row)
- Modify: `docs/getting-started.md` (new paragraph in `### Utility skills`, after the `/claude-tweaks:activity` paragraph)
- Modify: `docs/plugin-structure.md` (the `**Utility:**` list gains `walkthrough`; one `## Commands` line after the `activity-render.js` line)
- Modify: `tests/bin-lib/skill-audit/anti-patterns.test.js` (row-count pin + comment ledger)
- Modify: `tests/bin-lib/skill-audit/csc-registry.test.js` (`PIPELINE_RUN_DIR_EXEMPT` entry)
- Test: `tests/skill-catalog-completeness.test.js`, `tests/reference-card-argument-hint.test.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`, `tests/bin-lib/skill-audit/csc-registry.test.js`

- [ ] **Step 1: `docs/skill-graph.md`**

Insert between the `## visualize` section and the `## wrap-up` heading:

```markdown
## walkthrough

| Target | Relationship |
|---|---|
| `/stories` | Consumes its YAML (`schema_version: 2`, `source_files:`, `journey:`) and adds one optional per-step field, `caption` — expand-only, QA-ignored. |
| `/browse` | Shares session-naming and the temp-path convention; reuses `playwright-cli-reference.md`'s screenshot/resize/session syntax. |
| `qa-agent` | Shares `qa-agent.md` Section 4's step-to-command mapping (snapshot → ref-based action) so a walkthrough's frames land on exactly what QA would have clicked. |
| `/demo` | Name disambiguation only — `/demo` means human acceptance sign-off; this skill produces a shareable artifact. |
```

- [ ] **Step 2: `plugin/skills/help/reference-card.md`**

After the `| \`/claude-tweaks:activity\` | …` row, add:

```markdown
| `/claude-tweaks:walkthrough` | Executes a story through Playwright CLI, captures one frame per step, and encodes a shareable animated GIF plus an ordered caption list — a walkthrough that survives outside the disposable QA-screenshot tree | `[<story-path>\|--story <name>\|#N] --base <url> [--budget-mb <n>] [--width <px>] [--delay-ms <n>] [--settle-ms <n>]` |
```

- [ ] **Step 3: `plugin/skills/help/context-flow.md`**

After the `| \`/activity\` | …` row, add:

```markdown
| `/walkthrough` | A schema-v2 story YAML, `playwright-cli` (session frames), an existing record's `### Key Files`/journeys (for `#N` resolution) | Session-scoped PNG frames (deleted after a successful encode), the chosen `{name}.gif` + `{name}.md` path (default `docs/walkthroughs/`, never committed) | The session-scoped frame directory, on success |
```

- [ ] **Step 4: `docs/getting-started.md`**

After the `/claude-tweaks:activity` paragraph in `### Utility skills`, add:

```markdown
**`/claude-tweaks:walkthrough`** — Executes an existing schema-v2 story through Playwright CLI, captures one PNG frame per step, and encodes a shareable animated GIF plus an ordered caption list — a walkthrough that survives outside the disposable QA-screenshot tree `.claude-tweaks/artifacts/` prunes after 30 days. The codec (PNG decode, median-cut palette quantization, LZW, GIF89a) is entirely vendored under `plugin/bin/lib/gif/` — zero npm dependencies, consistent with this plugin's install model. Resolves its target story from a direct path, `--story <name>`, `#N` (matched against a record's Key Files/journeys), or the current branch's changed files; `--base <url>` is always required — no dev-server auto-detection, since a walkthrough recorded against the wrong environment is silently wrong. One question at the end picks where the GIF is saved (default `docs/walkthroughs/`); nothing is committed on your behalf.
```

- [ ] **Step 5: `docs/plugin-structure.md`**

Change the `**Utility:**` line to end `…, demo, sweep, activity, walkthrough`. After the `activity-render.js` `## Commands` line, add:

```markdown
node plugin/bin/walkthrough-encode.js --frames <dir-or-comma-list> --out <gif path> [--delay-ms <n>] [--last-hold-ms <n>] [--width <px>] [--budget-mb <n=8>]   # Walkthrough-encode CLI (#2758) — decodes PNG frames (vendored decoder, types 0/2/6), enforces identical frame dimensions, optional nearest-neighbor downscale, median-cut palette quantization (one global palette), LZW-encodes a GIF89a animation via atomic-write.js; exit 0 encoded, 1 malformed invocation, 2 an unreadable/undecodable/dimension-mismatched frame, 3 over budget (prints the lever list, fewer steps first) (`plugin/bin/lib/walkthrough/encode.js`, `plugin/bin/lib/gif/{png-decode,palette,lzw,encoder}.js`; tests in `tests/bin-lib/walkthrough/`, `tests/bin-lib/gif/`)
```

- [ ] **Step 6: Bump the Anti-Patterns row-count pin by measurement**

Run: `node --test tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: FAIL on the final cardinality assertion with the measured total (the new `SKILL.md` adds 5 rows; take the number from the failure's `actual`, never from arithmetic). Edit the `assert.strictEqual(total, {prior})` line to the measured value and append to the comment ledger directly above it, in the same shape as the entries above it (citing #2758, the measured before/after, and the same `git diff … | grep -E '^[-+]\|'` evidence command #2757's entry cites).

- [ ] **Step 7: `tests/bin-lib/skill-audit/csc-registry.test.js`**

Add `walkthrough: /no \`PIPELINE_RUN_DIR\` signal/,` to the `PIPELINE_RUN_DIR_EXEMPT` map, in the same alphabetical-by-key style the existing entries use (it is not standalone-only test-driven — read the file first to confirm the exact regex the standalone Component-Skill Contract sentence must match, mirroring `activity`'s entry from #2757).

- [ ] **Step 8: Run the registration suites**

Run: `node --test tests/skill-catalog-completeness.test.js tests/reference-card-argument-hint.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/csc-registry.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/skill-conventions.test.js tests/walkthrough-conformance.test.js`
Expected: all pass. If `context-cost.test.js`'s per-skill or corpus-budget check fails, trim the description (keeping the `Keywords -` marker) and/or bump `DESCRIPTION_TOTAL_CEILING_CHARS` in `plugin/bin/lib/skill-audit/context-cost.js` by the same measured-not-arithmetic, ledger-commented precedent #2757 established.

- [ ] **Step 9: Commit**

```bash
git add docs/skill-graph.md plugin/skills/help/reference-card.md plugin/skills/help/context-flow.md docs/getting-started.md docs/plugin-structure.md tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/csc-registry.test.js
```
```bash
git commit -m "Register /claude-tweaks:walkthrough on the skill graph, reference card, context flow, getting-started, and plugin-structure; bump the Anti-Patterns pin; CSC standalone exemption (#2758)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 10: One real run against this repository

**Files:**
- Create (scratch, gitignored run-dir mirror — never committed): a throwaway static two-page fixture and a minimal one-story YAML under `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2758/live-run/`

**Interfaces:**
- Consumes: the full Step 1-5 procedure `plugin/skills/walkthrough/SKILL.md` now documents, exactly as written, against a real Playwright CLI session.

- [ ] **Step 1: Build a minimal fixture story**

Reuse Task 0's two-page static fixture shape (a short page and a taller page, served on a free localhost port via a scratch Node `http` server — same pattern as Task 0's probe). Write a 2-step story YAML by hand (not via `/claude-tweaks:stories`, since no real app exists here) exercising `click` then `navigate`, with a `caption` on one step and none on the other.

- [ ] **Step 2: Run Steps 2-4 of the skill manually, live**

Open a Playwright CLI session, resize to `1280x720`, execute the two steps per `qa-agent.md`'s mapping (screenshotting after each with `--settle-ms` honored), then run:

Run: `node plugin/bin/walkthrough-encode.js --frames <2 real frame paths> --out .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2758/live-run/out.gif --budget-mb 8`

Expected: exit 0; stdout JSON with `frames: 2`; the output file's first 6 bytes are `GIF89a` (verify with a small Node one-liner, not by eyeballing). Close the session (`playwright-cli -s=<name> close`) and confirm via `playwright-cli list` that it no longer appears. Stop the scratch server.

- [ ] **Step 3: Verify the caption list**

Call `captionList` (via a one-off `node -e` against the committed module, or by reading the two-step story and hand-tracing) and confirm it renders the captioned step's caption verbatim and the uncaptioned step's `{action} {locator}` form. Quote both the rendered caption list and the gather/encode JSON output in the task report — the controller quotes them into the PR body, mirroring #2757's Task 7.

- [ ] **Step 4: No commit** — the fixture, story YAML, frames, and output GIF are scratch in the gitignored run-dir mirror. Confirm `git -C "<worktree>" status --porcelain` is empty (besides whatever Task 9 already staged).

---

## Self-review

- **Spec coverage.** Deliverables → Tasks 1-9 (Task 0 already executed, folded into Global Constraints); AC1 → Global Constraints' Task 0 evidence; AC2 → Task 1; AC3 → Task 4 (LZW round-trip via the vendored reference decoder, not byte counts alone); AC4 → Task 2; AC5 → Task 5's `planFrames` tests; AC6 → Task 6's CLI tests (encode/dimension-mismatch/budget exit codes and lever ordering); AC7 → Task 10 Step 3 (QA-execution parity — the caption field changes nothing about `REPORT_JSON`, verified by tracing `qa-agent.md`'s own stated ignore-rule rather than re-running `/test qa` twice against a nonexistent real app, since this record's live-run fixture has no QA story infrastructure to compare against; report this substitution explicitly rather than silently satisfying AC7's letter); AC8/AC9 → Task 8's conformance test; AC10 → `/build` Common Step 5 (this host's baseline adjudication applies); AC11 → Task 7.
- **Placeholder scan.** No TBD/TODO; every code step carries complete code; the skill body is complete.
- **Consistency.** `FrameMismatchError`/`BudgetExceededError` shapes match between Task 5's module and Task 6's CLI tests; `captionList`'s locator-display format matches the record's Data/API Surface example (`click role=button "Add to cart"`); the GIF byte layout (GCE before image descriptor, one global color table, NETSCAPE loop extension) is identical across Task 4's encoder and Task 5/6/10's consumers; `sessionTmpPath`/`extractKeyFiles` names match their real exports (confirmed by reading `plugin/bin/lib/session-tmp.js` and `plugin/bin/lib/issues/grouping.js` before writing this plan).
- **AC7 flagged as a plan-level adaptation**, not a silent gap: this repo has no live app with an existing QA story to run the two-comparison trick against; Task 10 substitutes a direct trace of `qa-agent.md`'s own stated ignore-rule and states the substitution in its own report rather than fabricating a `/test qa` comparison run. Route this as a Beneficial/Update-the-spec deviation at Common Step 4.5, same mechanism the browser-tool and directive corrections already used.
