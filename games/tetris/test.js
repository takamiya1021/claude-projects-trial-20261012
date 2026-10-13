// 実行: node games/tetris/test.js
// index.html の <script> をそのまま取り出してテストする（コピーではなく本物のコードを検証）
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
assert(m, 'index.html に <script> が見つからない');
assert(!/<script[^>]+src=/i.test(html), '外部スクリプトを使っている');
const mod = { exports: {} };
new Function('module', m[1])(mod); // document が無いので画面処理は動かない
const T = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  OK   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function memStorage(init) {
  const d = Object.assign({}, init);
  return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, d };
}
function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function fillRow(board, y, gap) {
  for (let x = 0; x < T.COLS; x++) board[y][x] = x === gap ? 0 : 'I';
}
const count = b => b.reduce((a, r) => a + r.filter(Boolean).length, 0);

console.log('テトリス テスト');

test('盤面は 10x20 で空', () => {
  const b = T.createBoard();
  assert.strictEqual(b.length, 20); assert.strictEqual(b[0].length, 10); assert.strictEqual(count(b), 0);
});
test('全ブロックは4マスで、4回転すると元に戻る', () => {
  for (const n of T.NAMES) {
    const base = T.PIECES[n].m;
    assert.strictEqual(base.flat().filter(Boolean).length, 4, n);
    let r = base; for (let i = 0; i < 4; i++) r = T.rotateCW(r);
    assert.deepStrictEqual(r, base, n);
  }
});
test('回転は時計回り（T: 上向き→右向き）', () => {
  assert.deepStrictEqual(T.rotateCW(T.PIECES.T.m), [[0,1,0],[0,1,1],[0,1,0]]);
});
test('壁・床・既存ブロックと衝突判定できる', () => {
  const b = T.createBoard(); const o = T.PIECES.O.m;
  assert(!T.collides(b, o, 0, 0));
  assert(T.collides(b, o, -1, 0));
  assert(T.collides(b, o, 9, 0));
  assert(T.collides(b, o, 0, 19));
  assert(!T.collides(b, o, 0, 18));
  b[5][5] = 'I'; assert(T.collides(b, o, 4, 4));
});
test('揃った行だけ消えて、上の行が落ちる', () => {
  const b = T.createBoard();
  fillRow(b, 19, -1); fillRow(b, 18, 3); b[17][0] = 'T';
  const r = T.clearLines(b);
  assert.strictEqual(r.cleared, 1);
  assert.strictEqual(r.board.length, 20);
  assert.strictEqual(r.board[19][0], 'I');   // 18行目が19行目へ
  assert.strictEqual(r.board[19][3], 0);
  assert.strictEqual(r.board[18][0], 'T');   // 17行目が18行目へ
  assert.strictEqual(r.board[0].filter(Boolean).length, 0);
});
test('4行同時に消せる', () => {
  const b = T.createBoard(); for (let y = 16; y < 20; y++) fillRow(b, y, -1);
  assert.strictEqual(T.clearLines(b).cleared, 4);
});
test('レベルは10ラインごとに上がり、落下は速くなる（下限あり）', () => {
  assert.strictEqual(T.levelFor(0), 1); assert.strictEqual(T.levelFor(9), 1);
  assert.strictEqual(T.levelFor(10), 2); assert.strictEqual(T.levelFor(25), 3);
  assert(T.intervalFor(2) < T.intervalFor(1));
  assert.strictEqual(T.intervalFor(99), 100);
});
test('7種1セットで出る（同じ袋の中に重複なし）', () => {
  const g = new T.Game(seeded(1));
  const seen = [g.type, g.next];
  for (let i = 0; i < 5; i++) seen.push(g.takeFromBag());
  assert.strictEqual(new Set(seen).size, 7);
});
test('左右移動と、壁で止まる', () => {
  const g = new T.Game(seeded(2)); const x0 = g.x;
  assert(g.move(-1)); assert.strictEqual(g.x, x0 - 1);
  for (let i = 0; i < 20; i++) g.move(-1);
  assert(!g.move(-1));
  assert(!T.collides(g.board, g.m, g.x, g.y));
  assert(g.m.some(r => r[0]) ? g.x === 0 : g.x < 0); // 左端に到達している
});
test('回転できる。壁際でも押し戻して回転する', () => {
  const g = new T.Game(seeded(3)); g.type = 'I'; g.m = T.PIECES.I.m.map(r => r.slice()); g.x = 3; g.y = 5;
  assert(g.rotate()); assert.strictEqual(g.m[0][2], 1); // 縦向きになった
  for (let i = 0; i < 20; i++) g.move(1);
  assert(g.rotate()); assert(!T.collides(g.board, g.m, g.x, g.y));
});
test('ソフトドロップで1マス下がり、着地でロックされて次が出る', () => {
  const g = new T.Game(seeded(4)); const y0 = g.y, nextType = g.next;
  assert(g.softDrop()); assert.strictEqual(g.y, y0 + 1);
  let guard = 0; while (g.softDrop() && guard++ < 50);
  assert.strictEqual(count(g.board), 4);
  assert.strictEqual(g.type, nextType);
});
test('ハードドロップで底まで落ちる（+2点/マス）', () => {
  const g = new T.Game(seeded(5)); const d = g.hardDrop();
  assert(d > 10); assert.strictEqual(g.score, d * 2); assert.strictEqual(count(g.board), 4);
});
test('ライン消去でスコアが増える（1行=100×レベル）', () => {
  const g = new T.Game(seeded(6));
  fillRow(g.board, 19, 4);                       // x=4 だけ空き
  g.type = 'I'; g.m = [[1],[1],[1],[1]]; g.x = 4; g.y = 16; // 縦の棒（テスト用）
  g.lock();
  assert.strictEqual(g.lines, 1); assert.strictEqual(g.score, 100);
});
test('10ライン消すとレベル2になり、スコア倍率も上がる', () => {
  const g = new T.Game(seeded(7)); g.lines = 9;
  fillRow(g.board, 19, 4);
  g.m = [[1]]; g.type = 'I'; g.x = 4; g.y = 19; g.lock();
  assert.strictEqual(g.level, 2);
  fillRow(g.board, 19, 4); g.m = [[1]]; g.x = 4; g.y = 19; g.lock();
  assert.strictEqual(g.score, 100 + 200);
});
test('積み上がるとゲームオーバー、操作は無効', () => {
  const g = new T.Game(seeded(8)); let guard = 0;
  while (!g.over && guard++ < 200) g.hardDrop();
  assert(g.over); assert(!g.move(1)); assert(!g.rotate()); assert(!g.softDrop());
});
test('ハイスコアが保存され、次回起動で読み込まれる', () => {
  const st = memStorage();
  const g = new T.Game(seeded(9), st);
  fillRow(g.board, 19, 4); g.m = [[1]]; g.type = 'I'; g.x = 4; g.y = 19; g.lock();
  assert.strictEqual(g.highScore, 100);
  assert.strictEqual(st.d[T.HI_KEY], '100');
  const g2 = new T.Game(seeded(9), st);
  assert.strictEqual(g2.highScore, 100);
});
test('ハイスコアは下回っても更新されない／リセットでも消えない', () => {
  const st = memStorage({ [T.HI_KEY]: '5000' });
  const g = new T.Game(seeded(10), st);
  assert.strictEqual(g.highScore, 5000);
  g.hardDrop(); g.reset();
  assert.strictEqual(g.highScore, 5000); assert.strictEqual(st.d[T.HI_KEY], '5000');
  assert.strictEqual(g.score, 0);
});
test('壊れた保存値や使えない storage でも落ちない', () => {
  assert.strictEqual(T.loadHighScore(memStorage({ [T.HI_KEY]: 'abc' })), 0);
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.strictEqual(T.loadHighScore(bad), 0);
  const g = new T.Game(seeded(11), bad); g.hardDrop();
  assert.strictEqual(count(g.board), 4); // 保存に失敗してもゲームは進む
});

console.log(`\n${passed} 件OK / ${failed} 件NG`);
process.exit(failed ? 1 : 0);
