// 実行: node games/sudoku/test.js
// index.html の <script id="core"> を取り出して、Node.js で動かしてテストする。
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptOf = (id) => {
  const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'));
  assert(m, '<script id="' + id + '"> が見つからない');
  return m[1];
};
const S = new Function(scriptOf('core') + '\nreturn Sudoku;')();

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('OK   ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL ' + name + '\n     ' + (e && e.message));
  }
}

const parse = (s) => s.split('').map(Number);
// 有名な例題（答えは1つ）
const PUZZLE = parse('530070000600195000098000060800060003400803001700020006060000280000419005000080079');
const ANSWER = parse('534678912672195348198342567859761423426853791713924856961537284287419635345286179');
const SEEDS = [1, 2, 3, 42, 2024, 99999];
const LEVELS = ['easy', 'medium', 'hard'];
const rangeOk = (grid) => S.UNITS.every((u) => u.cells.every((c) => grid[c] >= 0 && grid[c] <= 9));
const clueCount = (g) => g.filter(Boolean).length;

// ---------- ソルバー ----------
test('既知の問題を正しく解ける', () => {
  assert.deepStrictEqual(S.solve(PUZZLE), ANSWER);
});
test('答えが1つの問題は countSolutions=1', () => {
  assert.strictEqual(S.countSolutions(PUZZLE, 2), 1);
});
test('答えが複数ある問題は 2 以上と判定できる', () => {
  // 完成盤面から「数字2種類が入れ替わる長方形」の4マスを空けると、答えが2つになる
  const idx = (r, c) => r * 9 + c;
  const p = ANSWER.slice();
  let found = false;
  for (let r1 = 0; r1 < 9 && !found; r1++) for (let r2 = r1 + 1; r2 < 9 && !found; r2++) {
    for (let c1 = 0; c1 < 9 && !found; c1++) for (let c2 = c1 + 1; c2 < 9 && !found; c2++) {
      const a = ANSWER[idx(r1, c1)], b = ANSWER[idx(r1, c2)];
      if (Math.floor(r1 / 3) === Math.floor(r2 / 3) && ANSWER[idx(r2, c1)] === b && ANSWER[idx(r2, c2)] === a) {
        [[r1, c1], [r1, c2], [r2, c1], [r2, c2]].forEach(([r, c]) => { p[idx(r, c)] = 0; });
        found = true;
      }
    }
  }
  assert(found, '入れ替え可能な長方形が見つからない');
  assert.strictEqual(S.countSolutions(p, 2), 2);
});
test('空の盤面は答えが沢山ある（limit で打ち切れる）', () => {
  assert.strictEqual(S.countSolutions(new Array(81).fill(0), 3), 3);
});
test('矛盾した盤面は答え0個', () => {
  const bad = PUZZLE.slice(); bad[1] = 5; // 1行目に 5 が2個
  assert.strictEqual(S.countSolutions(bad, 2), 0);
  assert.strictEqual(S.solve(bad), null);
});
test('入口で詰んでいる盤面（あるマスに入る数字が無い）は答え0個', () => {
  const g = new Array(81).fill(0);
  // 1行目の左上に入る数字が無い状況: 行に1-8、列に9
  for (let c = 1; c <= 8; c++) g[c] = c;
  g[9] = 9;
  assert.strictEqual(S.countSolutions(g, 2), 0);
});
test('isSolved は完成盤面だけ true', () => {
  assert.strictEqual(S.isSolved(ANSWER), true);
  assert.strictEqual(S.isSolved(PUZZLE), false);
  const broken = ANSWER.slice(); broken[0] = ANSWER[1];
  assert.strictEqual(S.isSolved(broken), false);
});

// ---------- 問題の自動生成 ----------
test('生成した問題: 答えが1つ・解と矛盾しない（全難易度×複数seed）', () => {
  for (const lv of LEVELS) for (const seed of SEEDS) {
    const g = S.generate(lv, seed);
    assert.strictEqual(g.puzzle.length, 81);
    assert(rangeOk(g.puzzle), lv + ' seed' + seed + ': 値が範囲外');
    assert.strictEqual(S.isSolved(g.solution), true, lv + ' seed' + seed + ': solution が不正');
    g.puzzle.forEach((d, i) => { if (d) assert.strictEqual(d, g.solution[i], '与えた数字が解と違う'); });
    assert.strictEqual(S.countSolutions(g.puzzle, 2), 1, lv + ' seed' + seed + ': 答えが1つじゃない');
    assert.deepStrictEqual(S.solve(g.puzzle), g.solution, 'solve の結果が solution と違う');
    assert.strictEqual(g.clues, clueCount(g.puzzle));
  }
});
test('難易度が上がるほど最初の数字が減る（easy > medium > hard）', () => {
  const avg = {};
  for (const lv of LEVELS) {
    const xs = SEEDS.map((s) => clueCount(S.generate(lv, s).puzzle));
    avg[lv] = xs.reduce((a, b) => a + b, 0) / xs.length;
  }
  assert(avg.easy > avg.medium, JSON.stringify(avg));
  assert(avg.medium > avg.hard, JSON.stringify(avg));
});
test('各難易度の数字の数が目標どおり（hardは目標+3まで許容）', () => {
  for (const lv of LEVELS) for (const seed of SEEDS) {
    const n = clueCount(S.generate(lv, seed).puzzle);
    assert(n <= S.TARGET_CLUES[lv] + (lv === 'hard' ? 3 : 0), lv + ' seed' + seed + ' 数字が' + n + '個');
    assert(n >= 17, '17個未満では答えが1つにならない');
  }
});
test('同じ seed なら同じ問題、違う seed なら違う問題', () => {
  assert.deepStrictEqual(S.generate('medium', 7), S.generate('medium', 7));
  assert.notDeepStrictEqual(S.generate('medium', 7).puzzle, S.generate('medium', 8).puzzle);
});
test('seed なしでも生成できる', () => {
  const g = S.generate('easy');
  assert.strictEqual(S.countSolutions(g.puzzle, 2), 1);
});
test('知らない難易度はエラー', () => {
  assert.throws(() => S.generate('nightmare', 1));
});

// ---------- ヒント ----------
test('ヒントを繰り返し使うと必ず完成する（全部、正しい数字を教える）', () => {
  for (const lv of LEVELS) {
    const g = S.generate(lv, 11);
    const grid = g.puzzle.slice();
    const rnd = S.makeRng(5);
    let steps = 0;
    for (;;) {
      const h = S.getHint(grid, g.solution, rnd);
      if (!h) break;
      assert(['naked', 'hidden', 'reveal'].includes(h.type), 'type=' + h.type);
      assert.strictEqual(grid[h.index], 0, '空きマスを指していない');
      assert.strictEqual(h.value, g.solution[h.index], 'ヒントの数字が解と違う');
      grid[h.index] = h.value;
      assert(++steps <= 81);
    }
    assert.strictEqual(steps, 81 - clueCount(g.puzzle));
    assert.strictEqual(S.isSolved(grid), true);
  }
});
test('naked single を見つける', () => {
  const grid = ANSWER.slice(); grid[0] = 0;
  const h = S.getHint(grid, ANSWER);
  assert.strictEqual(h.type, 'naked');
  assert.strictEqual(h.index, 0);
  assert.strictEqual(h.value, ANSWER[0]);
});
test('hidden single を見つける（難しめの問題をヒントだけで解く途中で出る）', () => {
  let hidden = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = S.generate('hard', seed);
    const grid = g.puzzle.slice();
    for (let step = 0; step < 81; step++) {
      const h = S.getHint(grid, g.solution);
      if (!h) break;
      if (h.type === 'hidden') {
        hidden++;
        const unit = S.UNITS.find((u) => u.kind === h.unit && u.index === h.unitIndex);
        assert(unit.cells.includes(h.index), 'そのマスは指定のユニットの中にある');
        assert.strictEqual(h.digit, h.value);
        // そのユニットで h.digit を置ける空きマスは本当に1つだけか
        const spots = unit.cells.filter((c) => grid[c] === 0 && (S.candidates(grid, c) & (1 << h.digit)));
        assert.deepStrictEqual(spots, [h.index]);
      }
      grid[h.index] = h.value;
    }
    assert.strictEqual(S.isSolved(grid), true);
  }
  assert(hidden > 0, 'hidden のヒントが一度も出なかった');
});
test('間違った数字があると mistake を最優先で返す', () => {
  const g = S.generate('easy', 4);
  const grid = g.puzzle.slice();
  const i = grid.indexOf(0);
  grid[i] = (g.solution[i] % 9) + 1; // わざと違う数字
  const h = S.getHint(grid, g.solution);
  assert.strictEqual(h.type, 'mistake');
  assert.strictEqual(h.index, i);
});
test('完成していたらヒントは null', () => {
  assert.strictEqual(S.getHint(ANSWER, ANSWER), null);
});
test('ヒントの説明文が作れる', () => {
  const g = S.generate('easy', 4);
  const h = S.getHint(g.puzzle, g.solution);
  assert(S.describeHint(h).length > 5);
  assert(S.describeHint({ type: 'mistake', index: 0 }).length > 5);
});

// ---------- index.html ----------
test('index.html は1枚で完結（外部ファイル・外部ライブラリを読まない）', () => {
  assert(!/<script[^>]*\ssrc=/i.test(html), 'script src がある');
  assert(!/<link[^>]*rel=["']?stylesheet/i.test(html), '外部CSSがある');
  assert(!/https?:\/\//i.test(html), '外部URLが含まれている');
  assert(!/\bimport\s*\(|\bimport\s+.*from\s/.test(html), 'import がある');
});
test('画面用スクリプトに構文エラーがない', () => {
  new Function(scriptOf('ui')); // 実行せず、パースだけ
});
test('画面が使う要素IDがすべて HTML にある', () => {
  const ids = [...scriptOf('ui').matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert(ids.length > 5);
  ids.forEach((id) => assert(html.includes('id="' + id + '"'), 'id=' + id + ' が無い'));
});

console.log('\n' + passed + ' 件OK / ' + failures.length + ' 件NG');
if (failures.length) {
  console.log('NG: ' + failures.join(', '));
  process.exit(1);
}
console.log('全部OK！');
