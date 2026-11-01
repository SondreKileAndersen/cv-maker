// Run with Vite on port 5190 and a dedicated headless Chrome on debug port 9335.
// Uses a separate browser profile: never run against your normal browser session.
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixturePath = join(tmpdir(), `cv-kiwi-formatting-${Date.now()}.json`);

const tabs = await (await fetch('http://127.0.0.1:9335/json/list')).json();
const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params);
  if (message.id) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(expression, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert.equal(errors.length, 0, JSON.stringify(errors));
    if (await evaluate(expression)) return;
    await delay(250);
  }
  throw new Error(`Timed out: ${expression}`);
}

try {
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'about:blank' });
  await delay(250);
  errors.length = 0;
  await call('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:5190', storageTypes: 'all' });
  await call('Page.navigate', { url: 'http://127.0.0.1:5190/' });
  await waitFor('Boolean(document.querySelector(".welcome-dialog"))');
  await waitFor('(async () => { const { loadBrowserProject } = await import("/src/storage/fileSystemStore.ts"); await loadBrowserProject(); return true; })()');
  const fixture = await evaluate(`(async () => {
    const { exampleCv } = await import('/src/sampleData.ts');
    const project = structuredClone(exampleCv);
    const section = project.sections.find(section => section.entries.length);
    const entry = section.entries[0];
    section.entries = Array.from({ length: 110 }, (_, index) => ({
      ...structuredClone(entry), id: 'stress-' + index, title: 'Layout stress ' + index,
      descriptionVariants: undefined, activeDescriptionVariantId: undefined,
      lines: Array.from({ length: 20 }, () => ({ runs: [{ text: 'Meaningful layout stress text repeated to exercise page breaks, formatting and animation.', bold: false }] }))
    }));
    project.sections = [section];
    project.cvVersions = undefined;
    project.cvSelectionInitialized = true;
    project.selectedBlockIds = ['profile', section.id];
    project.qualificationDescription = 'Normal qualification summary remains editable.';
    project.qualificationDescriptionLines = [{ runs: [{ text: project.qualificationDescription, bold: false }] }];
    // Legacy projects may still contain removed highlight selections.
    project.customCategorySelectionIds = [section.id];
    return JSON.stringify(project);
  })()`);
  await writeFile(fixturePath, fixture);
  await evaluate('document.querySelector(".welcome-storage-options button:nth-child(2)").click()');
  const { root } = await call('DOM.getDocument');
  const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '.rail-json-input' });
  await call('DOM.setFileInputFiles', { nodeId, files: [fixturePath] });
  await waitFor('document.querySelectorAll(".preview-section-group [data-preview-entry-anchor]").length === 110 && document.querySelectorAll(".cv-page").length > 50 && !document.body.classList.contains("is-entry-reordering")');
  assert.equal(await evaluate('document.querySelector(".qualification-preview-description")?.textContent'), 'Normal qualification summary remains editable.');
  assert.equal(await evaluate('document.querySelectorAll(".qualification-key-toggle, .qualification-key-guide, .qualification-preview-list").length'), 0);
  await evaluate('document.querySelector(".qualification-preview-editable").click()');
  assert.equal(await evaluate('Boolean(document.querySelector(".qualification-inline-editor"))'), true);
  await evaluate('document.querySelector(".qualification-inline-cancel").click()');
  console.log('PASS legacy highlights ignored; normal qualification text and editor retained');
  await evaluate('if (!document.querySelector(".preview-format-panel")) document.querySelector(".preview-format-button").click()');
  await waitFor('Boolean(document.querySelector(".preview-format-panel"))');
  for (const [label, value] of [['Bildestørrelse', 90], ['Navn', 36], ['Avstand mellom navn og tittel', 48], ['Avstand mellom bilde og tekst', 80], ['Deltittel', 18], ['Paragraf', 16], ['Bildestørrelse', 32]]) {
    await evaluate(`(() => {
      const input = document.querySelector('[data-format-label="${label}"] .preview-format-number input');
      input.focus(); input.select();
    })()`);
    await call('Input.insertText', { text: String(value) });
    await evaluate('document.activeElement.blur()');
    await delay(1200);
    await waitFor('document.querySelectorAll(".preview-section-group [data-preview-entry-anchor]").length === 110 && !document.body.classList.contains("is-entry-reordering")');
    assert.equal(await evaluate(`document.querySelector('[data-format-label="${label}"] .preview-format-number input').value`), String(value));
    console.log(`PASS ${label}=${value}`);
  }
  const point = await evaluate(`(() => {
    const input = document.querySelector('[data-format-label="Bildestørrelse"] .preview-format-number input');
    input.scrollIntoView({ block: 'center' });
    const rect = input.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  for (let offset = 6; offset <= 360; offset += 12) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + offset, y: point.y, button: 'left', buttons: 1 });
    await delay(16);
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 360, y: point.y, button: 'left', clickCount: 1 });
  await delay(1500);
  await waitFor('document.querySelectorAll(".preview-section-group [data-preview-entry-anchor]").length === 110 && !document.body.classList.contains("is-entry-reordering")');
  assert.equal(await evaluate('document.querySelector(\'[data-format-label="Bildestørrelse"] .preview-format-number input\').value'), '90');
  console.log('PASS continuous image-size drag from 32 to 90');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS: 110 entries, >50 pages, all entries retained, no browser errors.');
} finally {
  await unlink(fixturePath).catch(() => {});
  socket.close();
}
