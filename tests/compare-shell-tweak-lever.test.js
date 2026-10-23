'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TEMPLATE = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'compare-shell', 'template.html');

function readTemplate() {
  return readText(TEMPLATE);
}

test('AC1 (#1207): the tweak panel declares hue/spacing-scale/corner-radius levers with data-token attributes', () => {
  const text = readTemplate();
  for (const token of ['hue', 'spacing-scale', 'corner-radius']) {
    assert.match(text, new RegExp(`data-token="${token}"`), `expected a lever with data-token="${token}"`);
  }
});

test('AC1 (#1207): the tweak panel lives inside #focus, so it renders only in the focus view', () => {
  const text = readTemplate();
  const focusMatch = text.match(/<div id="focus">([\s\S]*?)<\/div>\s*<div id="verdict-error"/);
  assert.ok(focusMatch, 'expected #focus to be the element immediately before #verdict-error');
  assert.match(focusMatch[1], /<div id="tweaks">/);
});

test('AC1 (#1207) finding 8: attachTweakHandlers() is called inside the MODE === \'live\' branch', () => {
  const text = readTemplate();
  const liveBranchMatch = text.match(/if \(MODE === 'live'\) \{([\s\S]*?)\n  \} else \{/);
  assert.ok(liveBranchMatch, "expected an if (MODE === 'live') { ... } else { branch");
  assert.match(liveBranchMatch[1], /attachTweakHandlers\(\);/, 'expected attachTweakHandlers() to be called inside the live branch');
});

test('AC1 (#1207) finding 8: attachTweakHandlers( is called exactly once in the whole file, proving exclusivity (not just co-presence with attachVerdictHandlers)', () => {
  const text = readTemplate();
  // The literal call site 'attachTweakHandlers();' is distinct from the
  // function declaration 'attachTweakHandlers() {' — counting the call
  // site's own literal (rather than the bare 'attachTweakHandlers(' prefix,
  // which also matches the declaration) is what actually proves the
  // function is invoked from exactly one place in the file.
  const count = text.split('attachTweakHandlers();').length - 1;
  assert.equal(count, 1, `expected exactly one attachTweakHandlers(); call site, found ${count}`);
});

test('AC1 (#1207): durable mode disables every tweak lever, matching the existing verdict-bar disable pattern', () => {
  const text = readTemplate();
  assert.ok(
    text.includes("steerInput.disabled = true;\n    tweakInputs.forEach(function (input) { input.disabled = true; });"),
    'expected the durable-mode branch to disable every tweak lever right after steerInput, matching the existing verdict-bar disable pattern',
  );
});

test('AC2 (#1207): a tweak lever applies a --tweak-{token} CSS custom property, and posts a tweak event on commit, without a full reroll', () => {
  const text = readTemplate();
  assert.match(text, /function applyTweak\(token, value\) \{/);
  assert.match(text, /document\.documentElement\.style\.setProperty\('--tweak-' \+ token, value\)/);
  assert.match(text, /postEvent\(serializeEvent\('tweak', \{ token: token, value: value \}\)\)/);
});

test('finding 4 (#1207): applyTweak + readout update happen on \'input\' (every tick); postEvent happens on a separate \'change\' listener (once, on commit) — not coalesced onto the same event', () => {
  const text = readTemplate();
  const fnMatch = text.match(/function attachTweakHandlers\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected an attachTweakHandlers function');
  const body = fnMatch[0];

  const inputMatch = body.match(/input\.addEventListener\('input', function \(\) \{([\s\S]*?)\n      \}\);/);
  assert.ok(inputMatch, "expected an 'input' listener inside attachTweakHandlers");
  assert.match(inputMatch[1], /applyTweak\(token, value\)/, "expected applyTweak in the 'input' listener");
  assert.match(inputMatch[1], /readout\.textContent = value/, "expected the readout update in the 'input' listener");
  assert.equal(inputMatch[1].includes('postEvent'), false, "the 'input' listener must never postEvent — that would still fire on every tick of a drag");

  const changeMatch = body.match(/input\.addEventListener\('change', function \(\) \{([\s\S]*?)\n      \}\);/);
  assert.ok(changeMatch, "expected a 'change' listener inside attachTweakHandlers");
  assert.match(changeMatch[1], /postEvent\(serializeEvent\('tweak', \{ token: token, value: value \}\)\)/, "expected postEvent in the 'change' listener");

  // exactly one input listener and one change listener per lever — proves
  // this isn't accidentally attached twice
  assert.equal(body.split("addEventListener('input',").length - 1, 1);
  assert.equal(body.split("addEventListener('change',").length - 1, 1);
});

test('finding 5 (#1207): the tweak panel carries muted helper text distinguishing the shell\'s own preview from the judged candidate', () => {
  const text = readTemplate();
  const panelMatch = text.match(/<div id="tweaks">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(panelMatch, 'expected the #tweaks panel markup');
  assert.match(panelMatch[1], /Preview only/i, 'expected helper text clarifying the swatch previews the shell, not the candidate');
});

test('AC2 (#1207): a preview swatch renders in the compare-shell UI itself and is driven by the --tweak-* custom properties applyTweak sets', () => {
  const text = readTemplate();
  assert.match(text, /<div id="tweak-swatch">/, 'expected a #tweak-swatch element in the tweak panel markup');
  const swatchCss = text.match(/#tweak-swatch \{([\s\S]*?)\}/);
  assert.ok(swatchCss, 'expected a #tweak-swatch CSS rule');
  assert.match(swatchCss[1], /var\(--tweak-/, 'expected the #tweak-swatch rule to read at least one --tweak-* custom property, closing the "nothing reads --tweak-*" gap');
});

test('AC2 (#1207): a live readout span updates in the same \'input\' handler that calls applyTweak (instant feedback, no network write)', () => {
  const text = readTemplate();
  for (const token of ['hue', 'spacing-scale', 'corner-radius']) {
    assert.match(text, new RegExp(`<span class="tweak-readout" data-token="${token}">`), `expected a readout span for data-token="${token}"`);
  }
  assert.match(
    text,
    /applyTweak\(token, value\);\s*\n\s*if \(readout\) readout\.textContent = value;\s*\n\s*\}\);/,
    "expected the readout textContent update to happen inside the same 'input' handler, right after applyTweak, with no postEvent in between",
  );
});

test('finding 3 (#1207): durable mode replays DATA.outcome.tweaks after building outcome-meta — applyTweak, input.value, and readout.textContent all set from the baked value', () => {
  const text = readTemplate();
  const elseMatch = text.match(/\} else \{([\s\S]*?)\n  \}\n\}\)\(\);/);
  assert.ok(elseMatch, 'expected the durable (else) branch');
  const body = elseMatch[1];
  const outcomeMatch = body.match(/if \(DATA\.outcome\) \{([\s\S]*)\}\s*$/);
  assert.ok(outcomeMatch, 'expected an if (DATA.outcome) block inside the durable branch');
  const outcomeBody = outcomeMatch[1];

  assert.match(outcomeBody, /\(DATA\.outcome\.tweaks \|\| \[\]\)\.forEach\(function \(t\) \{/, 'expected a forEach replay over DATA.outcome.tweaks');
  const replayMatch = outcomeBody.match(/\(DATA\.outcome\.tweaks \|\| \[\]\)\.forEach\(function \(t\) \{([\s\S]*?)\n      \}\);/);
  assert.ok(replayMatch, 'expected the replay forEach body');
  const replayBody = replayMatch[1];
  assert.match(replayBody, /applyTweak\(t\.token, t\.value\)/, 'expected applyTweak to be called per baked tweak');
  assert.match(replayBody, /input\.value = t\.value/, 'expected the matching slider input.value to be set from the baked value');
  assert.match(replayBody, /readout\.textContent = t\.value/, 'expected the matching readout textContent to be set from the baked value');

  // the replay must run after the meta element (and hence DATA.outcome) is
  // built, and must not appear before the tweakInputs disable line (which
  // would mean it runs in the live branch by mistake)
  const disableIdx = text.indexOf("tweakInputs.forEach(function (input) { input.disabled = true; });");
  const replayIdx = text.indexOf("(DATA.outcome.tweaks || []).forEach(function (t) {");
  assert.ok(disableIdx > -1 && replayIdx > -1 && replayIdx > disableIdx, 'expected the replay to run after tweak inputs are disabled, inside the durable branch');
});

// --- #1336: restyle the judged candidate itself when a tweak lever moves ---

function readApplyTweakBody(text) {
  const match = text.match(/function applyTweak\(token, value\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, 'expected an applyTweak function body');
  return match[1];
}

test('AC1 (#1336): applyTweak still sets the --tweak-{token} custom property, unchanged from #1207', () => {
  const text = readTemplate();
  const body = readApplyTweakBody(text);
  assert.match(body, /document\.documentElement\.style\.setProperty\('--tweak-' \+ token, value\)/);
});

test('AC1 (#1336): applyTweak postMessages {type: \'compare-shell-tweak\', token, value} into the focused iframe\'s contentWindow', () => {
  const text = readTemplate();
  const body = readApplyTweakBody(text);
  assert.match(body, /var frame = focusStage\.querySelector\('iframe'\);/, 'expected applyTweak to look up the currently-focused iframe from #focus-stage');
  assert.match(
    body,
    /frame\.contentWindow\.postMessage\(\{ type: 'compare-shell-tweak', token: token, value: value \}, '\*'\)/,
    'expected a postMessage carrying type/token/value into the focused iframe',
  );
});

test('AC3 (#1336): the postMessage call is guarded so a durable page with no focused iframe never throws', () => {
  const text = readTemplate();
  const body = readApplyTweakBody(text);
  assert.match(body, /if \(frame && frame\.contentWindow\) \{/, 'expected a null-guard before calling postMessage — durable mode\'s replay calls applyTweak with no focus-stage iframe present');
});

test('AC2 (#1336): the iframe sandbox attribute is unchanged — allow-scripts only, exactly one setAttribute(\'sandbox\', ...) call, never widened to include allow-same-origin', () => {
  const text = readTemplate();
  assert.match(text, /frame\.setAttribute\('sandbox', 'allow-scripts'\);/, 'expected the sandbox attribute to still be exactly allow-scripts');
  const sandboxCalls = text.match(/\.setAttribute\('sandbox', '([^']*)'\)/g) || [];
  assert.equal(sandboxCalls.length, 1, `expected exactly one setAttribute('sandbox', ...) call, found ${sandboxCalls.length}`);
  assert.equal(sandboxCalls[0].includes('allow-same-origin'), false, 'allow-same-origin must never be added to the sandbox value — #1207\'s security boundary is load-bearing');
});

test('#1336: seed-compare.mjs documents the postMessage opt-in convention for candidate authors, without auto-injecting a listener', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = readText(path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'compare-shell', 'seed-compare.mjs'));
  assert.match(text, /compare-shell-tweak/, 'expected the opt-in doc comment to name the message type');
  assert.match(text, /addEventListener\('message'/, 'expected a documented example listener snippet');
  assert.match(text, /Deliberately not auto-injected here/i, 'expected the file to state the no-auto-injection decision explicitly');
});

test('#1336: visual-decision.md\'s tweak event description states the candidate is restyled only when it opts in, and the sandbox posture is unchanged', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'visual-decision.md'));
  assert.match(text, /compare-shell-tweak/, 'expected the doc to name the postMessage type');
  assert.match(text, /opt-in per candidate/i, 'expected the doc to state reflection is opt-in per candidate');
  assert.match(text, /sandbox="allow-scripts"/, 'expected the doc to keep stating the sandbox attribute');
  assert.doesNotMatch(text, /it never restyles the judged candidate itself/i, 'the old absolute claim must be replaced, not left alongside the new conditional behavior');
});
