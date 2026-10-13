// 実行: node games/shooter/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = (id) => {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
  assert(m, id + ' スクリプトが見つからない');
  return m[1];
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  OK  ' + name); }
  catch (e) { failed++; console.log('  NG  ' + name + '\n      ' + (e && e.message)); }
}

const Core = vm.runInNewContext(script('core') + ';ShooterCore', {});
const STEP = 1 / 60;
function run(g, sec, inputFn) {
  for (let i = 0; i < sec * 60 && g.state === 'playing'; i++) Core.update(g, STEP, inputFn ? inputFn(g) : {});
}
function fresh(seed) { const g = Core.createGame(seed || 1); Core.start(g); return g; }
// ボスや敵の方向へ動くボット
function bot(g) {
  const t = g.boss || g.enemies.slice().sort((a, b) => b.y - a.y)[0];
  return { target: { x: t ? t.x : g.W / 2, y: g.H - 90 } };
}

console.log('--- HTML ---');
test('index.html 1枚で完結（外部ファイル・URLを読まない）', () => {
  assert(!/<script[^>]+src=/i.test(html), '外部scriptあり');
  assert(!/<link[^>]+href=/i.test(html), '外部linkあり');
  assert(!/https?:\/\//i.test(html), '外部URLあり');
  assert(!/\bimport\s+.+from\b|\brequire\(/.test(script('ui')), 'ui が import/require を使っている');
});
test('スマホ対応（viewport / pointer操作 / touch-action）', () => {
  assert(/name="viewport"[^>]*width=device-width/.test(html));
  assert(/touch-action:\s*none/.test(html));
  assert(/pointerdown/.test(html) && /pointermove/.test(html));
});
test('キーボード操作もある', () => assert(/keydown/.test(html) && /ArrowLeft/.test(html)));
test('スコア・ボス・ゲームオーバー表示がある', () => {
  const ui = script('ui');
  assert(/SCORE/.test(ui) && /GAME OVER/.test(ui) && /BOSS/.test(ui));
});

console.log('--- ロジック ---');
test('開始前は title、start で playing', () => {
  const g = Core.createGame(1);
  assert.strictEqual(g.state, 'title');
  Core.start(g);
  assert.strictEqual(g.state, 'playing');
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.lives, 3);
});
test('キー入力で自機が動き、画面外に出ない', () => {
  const g = fresh();
  run(g, 0.5, () => ({ left: true }));
  assert(g.player.x < g.W / 2 - 50);
  run(g, 5, () => ({ left: true, up: true }));
  assert(g.player.x >= 0 && g.player.y >= 0);
  run(g, 5, () => ({ right: true, down: true }));
  assert(g.player.x <= g.W && g.player.y <= g.H);
});
test('タッチ目標へ自機が移動する', () => {
  const g = fresh();
  run(g, 1, () => ({ target: { x: 80, y: 400 } }));
  assert(Math.abs(g.player.x - 80) < 1 && Math.abs(g.player.y - 400) < 1);
});
test('弾が自動で出る', () => {
  const g = fresh();
  run(g, 0.5);
  assert(g.pBullets.length > 0);
});
test('敵が次々出現する', () => {
  const g = fresh();
  g.player.invuln = 999;
  let max = 0;
  for (let i = 0; i < 60 * 10; i++) { Core.update(g, STEP, {}); max = Math.max(max, g.enemies.length); }
  assert(g.spawned >= 8, 'spawned=' + g.spawned);
  assert(max >= 2, 'max=' + max);
});
test('弾で敵を倒すとスコアが増える', () => {
  const g = fresh();
  g.enemies.push({ type: 'grunt', x: g.player.x, y: 300, hp: 1, r: 14, vy: 0, score: 100, age: 0, baseX: g.player.x, phase: 0, shootT: 9 });
  g.spawned = 0; g.spawnTimer = 99;
  run(g, 1);
  assert(g.score >= 100, 'score=' + g.score);
  assert.strictEqual(g.kills, 1);
});
test('敵弾に当たるとライフが減り、無敵時間が付く', () => {
  const g = fresh();
  g.eBullets.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 4 });
  Core.update(g, STEP, {});
  assert.strictEqual(g.lives, 2);
  assert(g.player.invuln > 0);
  g.eBullets.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 4 });
  Core.update(g, STEP, {});
  assert.strictEqual(g.lives, 2, '無敵中は減らない');
});
test('ライフ0でゲームオーバー', () => {
  const g = fresh();
  for (let i = 0; i < 3; i++) {
    g.player.invuln = 0;
    g.eBullets.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 4 });
    Core.update(g, STEP, {});
  }
  assert.strictEqual(g.state, 'gameover');
  const s = g.score;
  Core.update(g, STEP, {});
  assert.strictEqual(g.score, s);
});
test('パワーアップで弾が増える', () => {
  const g = fresh();
  g.items.push({ x: g.player.x, y: g.player.y, vy: 0, r: 11 });
  Core.update(g, STEP, {});
  assert.strictEqual(g.player.weapon, 2);
  g.pBullets = []; g.player.cool = 0;
  Core.update(g, STEP, {});
  assert.strictEqual(g.pBullets.length, 2);
});
test('決まった数の敵のあとにボスが出る', () => {
  const g = fresh();
  g.player.invuln = 1e9;
  let bossSeen = false;
  for (let i = 0; i < 60 * 120 && !bossSeen; i++) { Core.update(g, STEP, bot(g)); bossSeen = !!g.boss; }
  assert(bossSeen, 'ボスが出ない');
  assert(g.spawned >= g.quota);
  assert.strictEqual(g.boss.hp, Core.bossHpFor(1));
});
test('ボスが弾を撃つ', () => {
  const g = fresh();
  g.player.invuln = 1e9;
  for (let i = 0; i < 60 * 120 && !g.boss; i++) Core.update(g, STEP, bot(g));
  g.eBullets = [];
  run(g, 6, () => ({ target: { x: 10, y: g.H - 40 } }));
  assert(g.eBullets.length > 0);
});
test('ボスを倒すとボーナス得点・次のステージへ', () => {
  const g = fresh();
  g.player.invuln = 1e9;
  for (let i = 0; i < 60 * 120 && !g.boss; i++) Core.update(g, STEP, bot(g));
  const before = g.score;
  for (let i = 0; i < 60 * 120 && g.boss; i++) { g.player.invuln = 1e9; Core.update(g, STEP, bot(g)); }
  assert.strictEqual(g.boss, null, 'ボスを倒せない');
  assert.strictEqual(g.stage, 2);
  assert.strictEqual(g.bossesDefeated, 1);
  assert(g.score >= before + 2000);
  assert.strictEqual(g.spawned, 0);
  assert.strictEqual(g.quota, Core.quotaFor(2));
  assert.strictEqual(g.eBullets.length, 0);
});
test('ステージが進むほど難しい（ボスHPが増える）', () => {
  assert(Core.bossHpFor(2) > Core.bossHpFor(1));
  assert(Core.quotaFor(2) > Core.quotaFor(1));
});
test('同じ seed なら同じ展開（再現性）', () => {
  const a = fresh(42), b = fresh(42);
  run(a, 20, bot); run(b, 20, bot);
  assert.strictEqual(a.score, b.score);
  assert.strictEqual(a.enemies.length, b.enemies.length);
});
test('長時間ランダム操作でも NaN・配列の肥大化がない', () => {
  const g = fresh(7);
  let seed = 1;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60 * 60 * 5; i++) {
    if (g.state !== 'playing') Core.start(g);
    Core.update(g, STEP, { left: r() < 0.3, right: r() < 0.3, up: r() < 0.2, down: r() < 0.2 });
    assert(Number.isFinite(g.player.x) && Number.isFinite(g.player.y) && Number.isFinite(g.score), 'NaN');
    assert(g.eBullets.length <= 401 && g.pBullets.length < 200 && g.enemies.length < 100, '配列が増えすぎ');
  }
});
test('ゲームオーバー後に start でやり直せる', () => {
  const g = fresh();
  g.lives = 1;
  g.eBullets.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 4 });
  Core.update(g, STEP, {});
  assert.strictEqual(g.state, 'gameover');
  Core.start(g);
  assert.strictEqual(g.state, 'playing');
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.lives, 3);
});

console.log('--- 画面（DOMをニセモノにして動かす） ---');
test('ui が実際に動く（開始→ドラッグ→キー操作→描画を数百フレーム）', () => {
  const listeners = {};
  let raf = null, now = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const canvasListeners = {};
  const canvas = {
    width: 360, height: 640, style: {}, getContext: () => ctx,
    addEventListener: (n, f) => { canvasListeners[n] = f; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  };
  const sandbox = {
    document: { getElementById: () => canvas },
    window: { innerWidth: 360, innerHeight: 640, devicePixelRatio: 1, addEventListener: (n, f) => { listeners[n] = f; } },
    localStorage: { getItem: () => null, setItem: () => {} },
    performance: { now: () => now },
    requestAnimationFrame: (f) => { raf = f; },
    Date, Math, console,
  };
  sandbox.ShooterCore = Core;
  vm.runInNewContext(script('ui'), sandbox);
  const ev = (extra) => Object.assign({ preventDefault() {}, pointerId: 1, clientX: 180, clientY: 550 }, extra);
  const frames = (n) => { for (let i = 0; i < n; i++) { now += 16; raf(now); } };
  frames(5);
  canvasListeners.pointerdown(ev());
  canvasListeners.pointermove(ev({ clientX: 100, clientY: 500 }));
  frames(300);
  listeners.keydown({ code: 'ArrowLeft', preventDefault() {} });
  frames(60);
  listeners.keyup({ code: 'ArrowLeft' });
  canvasListeners.pointerup(ev());
  frames(30);
});

console.log('\n' + passed + ' 件OK / ' + failed + ' 件NG');
if (failed) process.exit(1);
console.log('ALL OK');
