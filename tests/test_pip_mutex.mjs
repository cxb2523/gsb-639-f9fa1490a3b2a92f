import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { pipView } from '../web/js/pip-view.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({ stdin: { contents: `
  export { setupVideo } from './web/js/video-player.js';
  export { initTrackCfg } from './web/js/trackcfg.js';`, resolveDir: root },
  bundle: true, write: false, format: 'iife', globalName: 'PipMutex' });
const html = await readFile(new URL('../web/player.html', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, { supported = true, bridgeOverrides = {}, failVideoOpen = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://localhost/player.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, calls = [];
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  w.console.warn = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.screen.orientation = { unlock() {} };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return this._paused !== false; } });
  w.HTMLMediaElement.prototype.play = function () {
    if (this.paused) { this._paused = false; this.dispatchEvent(new w.Event('play')); }
    return Promise.resolve();
  };
  w.HTMLMediaElement.prototype.pause = function () {
    if (!this.paused) { this._paused = true; this.dispatchEvent(new w.Event('pause')); }
  };
  const bridge = {
    open: async (value) => { calls.push(['open', value]); },
    update: async (value) => { calls.push(['update', value]); },
    close: async (value) => { calls.push(['close', value]); }, ...bridgeOverrides,
  };
  w.LinguaNative = { platform: 'ios', captionPip: supported ? bridge : null };
  w.eval(outputFiles[0].text);
  const api = w.PipMutex, app = doc.getElementById('app'), media = doc.getElementById('video');
  app.classList.add('has-video');
  // 经典 webkit PiP 桩: 跟随 presentation mode 并派发事件, 可按要求拒绝打开。
  let mode = 'inline';
  const mediaState = { readyState: 2, error: null };
  Object.defineProperties(media, {
    readyState: { configurable: true, get: () => mediaState.readyState },
    error: { configurable: true, get: () => mediaState.error },
    duration: { configurable: true, value: 30 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
    webkitPresentationMode: { configurable: true, get: () => mode },
  });
  media.webkitSupportsPresentationMode = (kind) => kind === 'picture-in-picture';
  media.webkitSetPresentationMode = (next) => {
    if (next === 'picture-in-picture' && failVideoOpen) throw new Error('denied');
    mode = next;
    media.dispatchEvent(new w.Event('webkitpresentationmodechanged'));
  };
  media.addTextTrack = () => ({ mode: 'disabled', cues: null, addCue() {}, removeCue() {} });
  const track = { S: 2, sStart: [0, 10], sEnd: [10, 30], title: 'Lesson',
    sentences: [{ text: 'First sentence.', translation: '第一句。' }, { text: 'Second sentence.', translation: '第二句。' }],
    lang: 'en', langName: '英语', space: true, features: ['tr'],
    layerOrder: [], layers: {}, supports: () => false };
  const engine = { track, reader: { activeS: 0 }, seek: (time) => { media.currentTime = time; } };
  api.initTrackCfg('lesson', 'en');
  const player = api.setupVideo({ video: media, app, engine, toggle() {}, onLayout() {},
    overlayOpen: () => false, openSettings() {} });
  const videoBtn = doc.getElementById('btnVideoPip');
  const audioBtn = doc.getElementById('btnAudioPip');
  const note = doc.getElementById('videoPipNote');
  const click = async (el) => { el.click(); await flush(); await flush(); };
  const toast = () => doc.getElementById('toast').textContent;
  return { w, doc, app, media, mediaState, calls, bridge, player,
    pip: player.pip, audioPip: player.audioPip, videoBtn, audioBtn, note, click, toast };
}

test('pipView maps one state snapshot to buttons, note and app classes', () => {
  const off = pipView({});
  assert.equal(off.video.pressed, false); assert.equal(off.video.label, '小窗播放');
  assert.equal(off.audio.hidden, true); assert.equal(off.audio.pressed, false);
  assert.equal(off.note.hidden, true);
  assert.deepEqual(off.classes, { 'is-pip': false, 'is-audio-pip': false });
  const video = pipView({ videoActive: true, audioSupported: true });
  assert.equal(video.video.pressed, true); assert.equal(video.video.label, '关闭小窗');
  assert.equal(video.audio.hidden, false); assert.equal(video.audio.label, '字幕画中画');
  assert.equal(video.note.hidden, false); assert.equal(video.note.text, '退出小窗播放');
  assert.deepEqual(video.classes, { 'is-pip': true, 'is-audio-pip': false });
  const audio = pipView({ audioActive: true, audioSupported: true });
  assert.equal(audio.audio.pressed, true); assert.equal(audio.audio.label, '关闭字幕画中画');
  assert.equal(audio.note.hidden, false); assert.equal(audio.note.text, '退出字幕小窗');
  assert.deepEqual(audio.classes, { 'is-pip': false, 'is-audio-pip': true });
  const busy = pipView({ audioSupported: true, audioBusy: true });
  assert.equal(busy.audio.busy, true); assert.equal(busy.audio.pressed, false);
  assert.equal(busy.note.hidden, true);
});

test('video and caption windows switch exclusively and never paint both pressed', async (t) => {
  const h = harness(t);
  const paints = [];
  const observer = new h.w.MutationObserver(() => {
    paints.push([h.videoBtn.getAttribute('aria-pressed'), h.audioBtn.getAttribute('aria-pressed')]);
  });
  for (const button of [h.videoBtn, h.audioBtn]) {
    observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
  }
  assert.equal(h.audioBtn.hidden, false);
  assert.equal(h.audioBtn.getAttribute('aria-label'), '字幕画中画');

  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), true);
  assert.equal(h.app.classList.contains('is-pip'), true);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(h.videoBtn.getAttribute('aria-label'), '关闭小窗');
  assert.equal(h.note.hidden, false); assert.equal(h.note.textContent, '退出小窗播放');

  await h.click(h.audioBtn);   // 视频小窗开着时点字幕小窗: 先关视频小窗再开字幕小窗
  assert.equal(h.audioPip.isActive(), true);
  assert.equal(h.pip.isActive(), false);
  assert.equal(h.app.classList.contains('is-pip'), false);
  assert.equal(h.app.classList.contains('is-audio-pip'), true);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.audioBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(h.audioBtn.getAttribute('aria-label'), '关闭字幕画中画');
  assert.equal(h.note.hidden, false); assert.equal(h.note.textContent, '退出字幕小窗');
  assert.equal(h.calls.filter(([name]) => name === 'open').length, 1);

  await h.click(h.videoBtn);   // 反向切换: 先关字幕小窗再开视频小窗
  assert.equal(h.pip.isActive(), true);
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.app.classList.contains('is-pip'), true);
  assert.equal(h.app.classList.contains('is-audio-pip'), false);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(h.audioBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.audioBtn.getAttribute('aria-label'), '字幕画中画');
  assert.equal(h.calls.filter(([name]) => name === 'close').length, 1);

  await flush();
  assert.ok(paints.length > 0);
  assert.ok(paints.every(([video, audio]) => !(video === 'true' && audio === 'true')),
    `both windows painted pressed: ${JSON.stringify(paints)}`);

  await h.click(h.videoBtn);   // 退出后占位提示隐藏, 类名回到无小窗状态
  assert.equal(h.pip.isActive(), false);
  assert.equal(h.note.hidden, true);
  assert.equal(h.app.classList.contains('is-pip'), false);
  assert.equal(h.app.classList.contains('is-audio-pip'), false);
});

test('a failed caption-window open rolls back to no window with a readable toast', async (t) => {
  const h = harness(t, { bridgeOverrides: {
    open: async () => { throw Object.assign(new Error('native boom'), { code: 'PIP_START_FAILED' }); },
  } });
  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), true);
  await h.click(h.audioBtn);   // 视频小窗被关掉后字幕小窗打开失败: 必须回到无小窗
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.audioPip.hasSession(), false);
  assert.equal(h.pip.isActive(), false);
  assert.equal(h.app.classList.contains('is-pip'), false);
  assert.equal(h.app.classList.contains('is-audio-pip'), false);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.audioBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.note.hidden, true);
  assert.match(h.toast(), /字幕小窗启动失败，请重试/);
  assert.doesNotMatch(h.toast(), /native boom/);
});

test('a failed video-window open leaves no window and toasts a readable error', async (t) => {
  const h = harness(t, { failVideoOpen: true });
  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), false);
  assert.equal(h.app.classList.contains('is-pip'), false);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.audioBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(h.note.hidden, true);
  assert.match(h.toast(), /无法开启画中画/);
});

test('caption window refuses to open while media is unready and keeps the video window untouched', async (t) => {
  const h = harness(t);
  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), true);
  h.mediaState.readyState = 1;
  await h.click(h.audioBtn);
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.calls.filter(([name]) => name === 'open').length, 0);
  assert.equal(h.pip.isActive(), true);            // 视频小窗的既有状态不变
  assert.equal(h.app.classList.contains('is-pip'), true);
  assert.equal(h.videoBtn.getAttribute('aria-pressed'), 'true');
  assert.match(h.toast(), /媒体正在加载/);
  h.mediaState.readyState = 2;
  h.mediaState.error = { code: 4 };
  await h.click(h.audioBtn);
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.calls.filter(([name]) => name === 'open').length, 0);
  assert.equal(h.pip.isActive(), true);
  assert.match(h.toast(), /媒体加载失败/);
});

test('an unsupported caption window keeps its button hidden, even while the video window is open', async (t) => {
  const h = harness(t, { supported: false });
  assert.equal(h.audioBtn.hidden, true);
  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), true);
  assert.equal(h.audioBtn.hidden, true);
  await h.click(h.audioBtn);   // 不支持时点击不生效, 也不影响视频小窗
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.pip.isActive(), true);
  assert.equal(h.calls.length, 0);
});

test('the placeholder note exits the active window and then hides', async (t) => {
  const h = harness(t);
  await h.click(h.audioBtn);
  assert.equal(h.audioPip.isActive(), true);
  assert.equal(h.note.hidden, false);
  await h.click(h.note);
  assert.equal(h.audioPip.isActive(), false);
  assert.equal(h.note.hidden, true);
  assert.equal(h.app.classList.contains('is-audio-pip'), false);
  await h.click(h.videoBtn);
  assert.equal(h.pip.isActive(), true);
  await h.click(h.note);
  assert.equal(h.pip.isActive(), false);
  assert.equal(h.note.hidden, true);
  assert.equal(h.app.classList.contains('is-pip'), false);
});
