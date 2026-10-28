// Web edition of Orbit Pinball: game session, input, UI. Port of GameSession.swift / GameView.swift.
import { PinballEngine } from './core/physics.js';
import { PinballRules, Ranks } from './core/rules.js';
import { Missions, findMission, SelectionRows } from './core/missions.js';
import { TableRenderer } from './renderer.js';
import { PinballAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('orbit.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('orbit.' + key, JSON.stringify(value)); } catch { /* private mode */ } },
};
const fmt = (n) => n.toLocaleString('en-US');
const now = () => performance.now() / 1000;
const lowPower = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;

const engine = new PinballEngine();
const audio = new PinballAudio();
const settings = {
  sound: store.get('sound', true), music: store.get('music', true), haptics: store.get('haptics', true),
  drainRule: store.get('windowsDrainRule', true),
};
let best = store.get('bestScore', 0);
engine.rules.resetMissionOnDrain = settings.drainRule;
audio.enabled = settings.sound; audio.musicEnabled = settings.music; audio.hapticsEnabled = settings.haptics;

let renderer;
try {
  renderer = new TableRenderer($('table'), { lowPower });
} catch (error) {
  $('loading').innerHTML = '<p>このブラウザでは3D表示（WebGL）が使えないため、遊べません。<br>最新の Chrome / Safari / Edge でお試しください。</p>';
  throw error;
}

const state = { started: false, paused: false, modal: false, charging: false, chargeStart: 0, charge: 0, left: false, right: false, lastTime: 0 };
const suspended = () => !state.started || state.paused || state.modal;

// --- Rendering loop ---------------------------------------------------------------------
function resize() {
  const stage = $('table').parentElement.getBoundingClientRect();
  renderer.resize(Math.max(1, stage.width), Math.max(1, stage.height));
}
new ResizeObserver(resize).observe($('table').parentElement);
resize();

function captureInputTime() {
  // Advance physics to the moment of the press so the frame boundary doesn't change the shot.
  if (suspended() || state.lastTime === 0) return;
  const t = now();
  if (t > state.lastTime) { engine.advance(t - state.lastTime); state.lastTime = t; }
}

let lastUi = 0;
function frame(ms) {
  const t = ms / 1000;
  const dt = state.lastTime === 0 ? 0 : Math.max(0, t - state.lastTime);
  state.lastTime = Math.max(t, state.lastTime);
  if (!suspended()) engine.advance(dt);
  if (state.charging) state.charge = Math.min(0.98, 0.06 + (now() - state.chargeStart) / 1.3);
  if (!suspended()) {
    for (const item of engine.rules.takeFeedback()) { audio.play(item); renderer.feedback(item, engine.ball.position); }
  }
  renderer.update(engine, { charge: state.charge, dt: suspended() ? 0 : dt, time: engine.time, active: !suspended() });
  audio.updateRolling(engine.ball.velocity.length, engine.ball.position.x,
    !suspended() && engine.rules.phase === 'playing' && !engine.guided && !engine.deployment);
  if (t - lastUi > 1 / 30) { renderer.updateLamps(engine.rules, t); updateUi(); lastUi = t; }
  renderer.render();
  requestAnimationFrame(frame);
}

// --- UI -----------------------------------------------------------------------------------
const fuelBars = Array.from({ length: 10 }, () => document.createElement('i')); $('fuel').append(...fuelBars);
const ballDots = Array.from({ length: PinballRules.startingBalls }, () => document.createElement('i')); $('ball-dots').append(...ballDots);
const text = (id, value) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };
let lastPhase = null;
function updateUi() {
  const r = engine.rules;
  if (r.score > best) { best = r.score; store.set('bestScore', best); }
  text('score', fmt(r.score)); text('multiplier', `×${r.multiplier}`); text('best', fmt(best));
  ballDots.forEach((d, i) => d.classList.toggle('on', i < r.ballsRemaining));
  text('ball-count', `${r.ballsRemaining} / ${PinballRules.startingBalls}`); text('extra-balls', r.extraBalls > 0 ? `+${r.extraBalls}` : '');
  text('rank', `${Ranks[r.rank]}  /  ${String(r.rank + 1).padStart(2, '0')}`);
  const info = $('info');
  text('info', r.messageTime > 0 ? r.message : r.missionTitle);
  info.className = 'info' + (r.messageTime > 0 ? '' : r.activeMission ? ' active' : ' idle');
  text('mission', r.missionInstruction);
  $('mission-bar').classList.toggle('active', !!r.activeMission);
  fuelBars.forEach((b, i) => b.classList.toggle('on', i * 10 < r.fuel)); $('fuel').classList.toggle('low', r.fuel < 25);
  $('btn-nudge').disabled = suspended() || r.phase !== 'playing';
  const ready = r.phase === 'ready';
  $('pad-launch').classList.toggle('ready', ready);
  text('launch-label', state.charging ? `${Math.round(state.charge * 100)}%` : r.awaitingRelaunch ? 'RELAUNCH' : 'LAUNCH');
  $('charge-ring').style.strokeDashoffset = String(106.8 * (1 - (ready ? Math.max(0.025, state.charging ? state.charge : 0) : 0)));
  for (const id of ['pad-left', 'pad-right']) $(id).classList.toggle('restart', r.phase === 'gameOver');
  for (const el of $('pad-left').querySelectorAll('small')) el.textContent = r.phase === 'gameOver' ? 'RESTART' : 'FLIPPER';
  for (const el of $('pad-right').querySelectorAll('small')) el.textContent = r.phase === 'gameOver' ? 'RESTART' : 'FLIPPER';
  const showHint = ready && state.started && !state.paused;
  $('hint').classList.toggle('hidden', !showHint);
  if (showHint) text('hint', r.currentBallIsExtra ? 'EXTRA BALL · LAUNCHで続行' : r.awaitingRelaunch ? '球を回収しました · 長押しで再射出' : r.ballNumber > 1 ? `残り${r.ballsRemaining}球 · LAUNCHで続行` : 'LAUNCH を長押し → 離して射出');
  const bonus = r.phase === 'bonus' && !state.paused;
  $('bonus').classList.toggle('hidden', !bonus);
  if (bonus) {
    text('bonus-count', `+${fmt(r.ballBonusCounted)}`);
    $('bonus-meter').style.width = `${100 * r.ballBonusCounted / Math.max(1, r.ballBonusAward)}%`;
    text('bonus-note', r.tilted ? 'TILT · ボーナスなし' : `${fmt(r.ballBonusAward)}点を合計に加算`);
  }
  $('gameover').classList.toggle('hidden', r.phase !== 'gameOver');
  if (r.phase === 'gameOver') { text('final-score', fmt(r.score)); text('final-missions', `ミッション達成 ${r.completedMissions} 回`); }
  if (r.phase !== lastPhase) { if (r.phase !== 'playing') releaseAll(); lastPhase = r.phase; }
  $('paused').classList.toggle('hidden', !state.paused);
  setIcon('btn-pause', state.paused ? 'play' : 'pause');
  setIcon('btn-sound', settings.sound ? 'sound' : 'mute');
  updateMusic();
}
const Icons = {
  pause: '<path d="M7 5v14M17 5v14" stroke-width="3"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  sound: '<path d="M4 9.5h4l5-4v13l-5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h4l5-4v13l-5-4H4z" fill="currentColor" stroke="none"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
};
const shownIcons = {};
function setIcon(id, name) {
  if (shownIcons[id] === name) return; shownIcons[id] = name;
  $(id).innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Icons[name]}</svg>`;
}
function updateMusic() {
  if (suspended() || engine.rules.phase === 'gameOver') audio.setMusic(null);
  else audio.setMusic(engine.rules.activeMission ? 'mission' : 'cruise');
}

// --- Input ------------------------------------------------------------------------------
function flipper(left, down) {
  captureInputTime();
  if (suspended()) { engine.releaseControls(); return; }
  if (down && engine.rules.phase === 'gameOver') { engine.newGame(); audio.playName('target'); updateUi(); return; }
  engine.setFlipper(left, down);
  if (down && engine.rules.phase === 'ready') audio.playName('flipper');
  $(left ? 'pad-left' : 'pad-right').classList.toggle('down', down);
}
function plunger(down) {
  captureInputTime();
  if (suspended() || engine.rules.phase !== 'ready') { state.charging = false; state.charge = 0; return; }
  if (down) { if (!state.charging) { state.charging = true; state.charge = 0.06; state.chargeStart = now(); } }
  else if (state.charging) {
    const power = Math.max(0.06, Math.min(0.98, 0.06 + (now() - state.chargeStart) / 1.3));
    state.charging = false; state.charge = 0; engine.launch(power);
  }
  $('pad-launch').classList.toggle('down', down && state.charging);
}
function releaseAll() {
  state.charging = false; state.charge = 0; state.left = state.right = false; engine.releaseControls();
  for (const id of ['pad-left', 'pad-right', 'pad-launch']) $(id).classList.remove('down');
  for (const pad of pads) pad.pointers.clear();
}
function nudge() { if (!suspended()) { captureInputTime(); engine.nudge(); } }

// Each pad tracks its own touches. Releases are read from the window, because iOS Safari
// reports lost pointer capture right after a touch starts on a button.
const pads = [];
function bindPad(id, onChange) {
  const el = $(id), pointers = new Set();
  pads.push({ pointers, onChange });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); ensureAudio(); pointers.add(e.pointerId);
    if (pointers.size === 1) onChange(true);
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function releasePointer(e) {
  for (const pad of pads) if (pad.pointers.delete(e.pointerId) && pad.pointers.size === 0) pad.onChange(false);
}
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);
bindPad('pad-left', (down) => { state.left = down; flipper(true, down); });
bindPad('pad-right', (down) => { state.right = down; flipper(false, down); });
bindPad('pad-launch', (down) => plunger(down));

const keyMap = {
  KeyZ: 'left', ShiftLeft: 'left', ArrowLeft: 'left', KeyA: 'left',
  Slash: 'right', ShiftRight: 'right', ArrowRight: 'right', KeyL: 'right', KeyM: 'right',
  Space: 'launch', Enter: 'launch', ArrowDown: 'launch', KeyN: 'nudge', ArrowUp: 'nudge', KeyP: 'pause', Escape: 'pause',
};
const heldKeys = new Set();
window.addEventListener('keydown', (e) => {
  const action = keyMap[e.code];
  if (!action || state.modal) return;
  e.preventDefault();
  if (e.repeat || heldKeys.has(e.code)) return;
  heldKeys.add(e.code); ensureAudio();
  if (!state.started && action !== 'pause') { start(); return; }
  if (action === 'left') flipper(true, true);
  else if (action === 'right') flipper(false, true);
  else if (action === 'launch') plunger(true);
  else if (action === 'nudge') nudge();
  else if (action === 'pause') togglePause();
});
window.addEventListener('keyup', (e) => {
  const action = keyMap[e.code];
  if (!heldKeys.delete(e.code) || !action) return;
  const stillHeld = (a) => [...heldKeys].some((k) => keyMap[k] === a);
  if (action === 'left' && !stillHeld('left')) flipper(true, false);
  else if (action === 'right' && !stillHeld('right')) flipper(false, false);
  else if (action === 'launch' && !stillHeld('launch')) plunger(false);
});
window.addEventListener('blur', () => { heldKeys.clear(); releaseAll(); if (state.started) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state.started) pause(); });

function ensureAudio() { audio.unlock(); }
function start() { ensureAudio(); state.started = true; $('start').classList.add('hidden'); state.lastTime = 0; updateUi(); }
function pause() { if (!state.paused) { state.paused = true; releaseAll(); audio.suspend(); updateUi(); } }
function resume() { state.paused = false; state.lastTime = 0; releaseAll(); updateUi(); }
function togglePause() { if (state.paused) resume(); else pause(); }

$('btn-start').addEventListener('click', start);
$('btn-pause').addEventListener('click', () => { if (state.started) togglePause(); });
$('btn-resume').addEventListener('click', resume);
$('btn-nudge').addEventListener('pointerdown', (e) => { e.preventDefault(); nudge(); });
$('btn-sound').addEventListener('click', () => { ensureAudio(); setSetting('sound', !settings.sound); });
$('btn-guide').addEventListener('click', () => openSheet('guide'));
$('btn-settings').addEventListener('click', () => openSheet('settings'));
$('btn-new').addEventListener('click', () => openSheet('confirm'));
$('btn-confirm-new').addEventListener('click', () => { $('confirm').close(); engine.newGame(); engine.rules.resetMissionOnDrain = settings.drainRule; resume(); });

function openSheet(id) {
  releaseAll(); state.modal = true;
  const d = $(id); d.showModal();
}
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('close', () => { state.modal = [...document.querySelectorAll('dialog')].some((x) => x.open); state.lastTime = 0; });
  d.addEventListener('click', (e) => { if (e.target === d || e.target.hasAttribute('data-close')) d.close(); });
}
function setSetting(key, value) {
  settings[key] = value;
  if (key === 'sound') { audio.setEnabled(value); store.set('sound', value); }
  if (key === 'music') { audio.setMusicEnabled(value); store.set('music', value); }
  if (key === 'haptics') { audio.hapticsEnabled = value; store.set('haptics', value); }
  if (key === 'drainRule') { engine.rules.resetMissionOnDrain = value; store.set('windowsDrainRule', value); }
  syncSettings(); updateUi();
}
function syncSettings() {
  $('set-sound').checked = settings.sound; $('set-music').checked = settings.music;
  $('set-haptics').checked = settings.haptics; $('set-drain').checked = settings.drainRule;
}
for (const [id, key] of [['set-sound', 'sound'], ['set-music', 'music'], ['set-haptics', 'haptics'], ['set-drain', 'drainRule']]) {
  $(id).addEventListener('change', (e) => setSetting(key, e.target.checked));
}
syncSettings();

// --- Guide (same content as the iOS guide, with keyboard controls) -------------------------
function buildGuide() {
  const row = (mark, title, body) => `<div class="g-row"><span class="mark">${mark}</span><div><b>${title}</b><p>${body}</p></div></div>`;
  const bullet = (title, body) => `<div class="g-bullet"><b>${title}</b><p>${body}</p></div>`;
  const section = (title, html) => `<section class="guide-section"><h3>${title}</h3>${html}</section>`;
  const score = (a, b) => `<div><span>${a}</span><span>${b}</span></div>`;
  const tiers = [['士官候補生', 0], ['少尉・中尉', 1], ['大尉・少佐', 2], ['中佐・准将', 3], ['大将・艦隊司令官', 4]];
  const mission = (id, tag) => {
    const m = findMission(id);
    const steps = m.steps.map((s) => (s.count > 1 ? `${s.instruction} ×${s.count}` : s.instruction)).join(' → ');
    return `<div class="g-mission"><div class="head"><span class="tag">${tag}</span><b>${m.name}</b><span>${fmt(m.reward)}</span></div><p>${steps}</p></div>`;
  };
  $('guide-body').innerHTML = `
    <div class="guide-hero"><small>HOW TO PLAY</small><h2>狙って、弾いて、<br>任務を達成しよう。</h2>
      <p class="guide-note">持ち球は3球。ミッションを達成して階級を上げながら、ハイスコアを目指します。</p></div>
    ${section('基本操作',
      row('LAUNCH', '球を射出する', '下中央のボタン<span class="pc">（PCは <kbd>Space</kbd>）</span>を長押しして離すと射出。長く押すほど強く飛びます。') +
      row('L / R', 'フリッパーで打ち返す', '左右のボタン<span class="pc">（PCは <kbd>Z</kbd> / <kbd>/</kbd>、または <kbd>←</kbd> / <kbd>→</kbd>）</span>を押している間、フリッパーが上がります。同時押しもできます。押すたびに、上部と左側のレーンの点灯が左右に移動します。') +
      row('NUDGE', '台を揺らす', 'ミッション欄の右にある十字ボタン<span class="pc">（PCは <kbd>N</kbd>）</span>で台を揺らせます。揺らしすぎるとTILTになり、その球ではフリッパーが動かずボーナスもなくなります。') +
      row('PAUSE', '一時停止', '右上のボタン<span class="pc">（PCは <kbd>P</kbd> / <kbd>Esc</kbd>）</span>。設定や新しいゲームもここから選べます。'))}
    ${section('ミッションの流れ',
      row('1', '選ぶ', '左下のミッションターゲット（3個）に当てると任務を選択。3個すべてを点灯させると上位の任務になります。') +
      row('2', '受諾する', '左の紫の発射ランプに通すと任務開始。次に狙う部品は、盤面の琥珀色のリングと矢印、画面上部のミッション欄で案内します。') +
      row('3', '達成する', '達成すると報酬を獲得し、中央の階級リングが進みます。リングが一周すると昇進し、より難しい任務を選べるようになります。') +
      row('燃料', '燃料に注意', '任務中は燃料が減り、空になると任務は失敗です。燃料レーン、左上の燃料ターゲット3個、ボーナスレーンで補給できます。新しい球は満タンで始まります。'))}
    ${section('球を守る',
      bullet('SHOOT AGAIN', '射出してから10秒間は、落としても球を失いません（後半5秒は灯が点滅）。') +
      bullet('キックバック', '各球の開始時に左右のアウトレーンで点灯。落ちかけた球を1回だけ打ち返します。使ったあとは、同じ側のハザードターゲット3個で再点灯します。') +
      bullet('センターポスト', 'ハイパースペース3段階目で、フリッパーの間に一定時間ポストが立ちます。') +
      bullet('追加球・リプレイ', 'メダルターゲット3段階目、またはハイパースペース4段階目のあと点灯したアウトレーンで追加球。指定色のワームホールに入れると、次の落球が1回無効になります。'))}
    ${section('落球したら',
      bullet('ボーナス', '落球ごとにボーナスを加算。1球目は10,000点、以降は25,000点から始まり、ブースターで「BONUS」を点灯させると積み上がります。') +
      bullet('リセット', 'バンパーの強化・倍率・ターゲット・ハイパースペース段階など盤面の点灯と、選択中・実行中のミッションが終了します。得点と階級は残ります。ミッションを次の球へ引き継ぐ設定もあります。'))}
    ${section('得点を伸ばすコツ',
      bullet('スキルショット', '射出した球が通ったゲート数で得点。ゲート3個の75,000点が最高です。') +
      bullet('倍率', '上部の倍率ターゲット3個で×2→×3→×5→×10。30秒ごとに1段階下がります。') +
      bullet('ハイパースペース', '右上のトンネル。入るたびに段階が進み、ジャックポット・センターポスト・追加球・重力井戸を順に獲得します。') +
      bullet('ボーナスレーン', '任務を達成すると点灯。通すと現在のボーナス値をそのまま獲得します。') +
      bullet('スペースワープ', '左上で通すと左右のリターンレーンが点灯し、20,000点になります。') +
      bullet('リフレックスショット', '射出直後の5秒間にランプかハイパースペースへ入れる、またはランプ・ハイパースペースを抜けて5秒以内に同じ場所へもう一度入れると25,000点。'))}
    ${section('得点のめやす', `<div class="g-table">${
      score('上部バンパー', '500〜2,000') + score('左バンパー', '1,500〜4,500') + score('再突入レーン', '2,000') + score('発射ランプ', '5,000') +
      score('ブラックホール', '20,000') + score('アウトレーン', '20,000') + score('リターンレーン', '5,000（点灯時20,000）') +
      score('スキルショット', 'ゲート1〜6：15k / 30k / 75k / 30k / 15k / 7.5k') + score('ハイパースペース', '10k → ジャックポット → 20k → 50k → 150k')}</div>
      <p class="guide-note" style="margin-top:10px">倍率は通常得点にかかります。ミッションの受諾・達成、ジャックポット、ボーナスには倍率はかかりません。バンパーの強化は60秒ごとに1段階下がります。</p>`)}
    ${section('17のミッション', `<p class="guide-note" style="margin-bottom:12px">選べる任務は階級と、当てたミッションターゲット（上・中・下、または3個すべて）で決まります。</p>${
      tiers.map(([title, tier]) => `<div class="g-tier"><small>${title}</small>${SelectionRows[tier].map((id, i) => mission(id, ['上', '中', '下', '3個'][i])).join('')}</div>`).join('')}`)}
    <p class="guide-note" style="margin-top:24px">クラシックな3Dピンボールの遊び方を参考に作ったオリジナル作品です。画像・効果音・BGMはすべて本作のために制作しています。</p>`;
}
buildGuide();
void Missions;

// --- Boot ------------------------------------------------------------------------------------
const loadingManagerReady = new Promise((resolve) => setTimeout(resolve, 200));
loadingManagerReady.then(() => {
  $('loading').classList.add('hidden');
  $('start').classList.remove('hidden');
  updateUi();
});
requestAnimationFrame(frame);
