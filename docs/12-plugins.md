# 12. プラグインを作る

歌詞スタイル・ルック・FX・オーディオビジュアライザー・テロップの型・カメラ（フレーミングと動き）・パレット、そして **歌詞・テロップ・立ち絵のエフェクトとモーション** は、**JavaScript の1ファイル** で追加できます。

> Claude Code を使う場合は、スキル [`.claude/skills/minamo-plugin`](../.claude/skills/minamo-plugin/SKILL.md) が自動で使われます。ひな形（`templates/`）と、フレーム画像と決定性を確かめるスクリプト（`scripts/check-plugin.mjs`）が入っています。

## 読み込み方

左パネル「プロジェクト → プラグイン → .js を読み込む」。読み込んだプラグインはブラウザに保存され、次回も自動で読み込まれます（一覧の「削除」で外せます）。

- スタイルは次の数字キーに、FX は空いているキー（`C` `V` `B` `N` `M`）に入ります。
- テロップの型は、テロップ一覧で `[名前] 本文` のように使えます。
- カメラのフレーミングは `Z` `X` `C` `V` `B`、動きは `P` `[` `]` `N` `M` `L`、パレットはルックトラックの `N` `M` に入ります。
- エフェクトは歌詞・テロップ・立ち絵トラックの `I` `O` `P` `[` `]`、モーションは `J` `K` `L` に入ります（3つのトラックで同じキー）。
- キーが足りない分も、キーパネルのクリック・タイムラインのダブルクリックのメニュー・インスペクタで選べます（FX も同じ）。

## 形

```js
export default function (api) {
  api.registerStyle({ id: 'my-style', name: 'MY STYLE', color: '#7cf6ff', line(g, l) { /* 歌詞1行を描く */ } });
  api.registerFx({ id: 'my-fx', name: 'マイFX', color: '#ff9ecb', duration: 1, unit: 'beat', apply(s) { s.post.flash += 0.3 * (1 - s.p); } });
  api.registerVisualizer({ id: 'my-viz', name: 'MY VIZ', color: '#9dff6b', draw(g, v) { /* g.audio.spectrum で描く */ } });
  api.registerTelop({ id: 'my-telop', name: 'マイテロップ', color: '#ffe600', bars: 4, draw(g, t) { /* t.text / t.sub */ } });
  api.registerFraming({ id: 'my-frame', name: 'マイ構図', pose(c) { return { sy: 0.36, fy: c.faceY, zoom: 1.5, rot: 0 }; } });
  api.registerCameraMove({ id: 'my-move', name: 'マイ動き', apply(pose, c) { pose.rot += 0.02 * Math.sin(c.t); } });
  api.registerPalette({ id: 'my-pal', name: 'Matcha', bg: '#0f1a12', text: '#f4fff2', accent: '#9be15d', accent2: '#ffd166' });
  api.registerEffect({ id: 'my-effect', name: 'マイ効果', under(g, e) { e.draw(e.silhouette(g.pal.accent2)); } });
  api.registerMotion({ id: 'my-motion', name: 'マイモーション', offsets: (c) => ({ dy: -12 * c.u * c.beat.pulse }) });
}
```

`api` には `registerStyle` `registerFx` `registerVisualizer` `registerTelop` `registerFraming` `registerCameraMove` `registerPalette` `registerEffect` `registerMotion`、描画用のヘルパー `api.lib`、歌詞のレイアウト用ヘルパー `api.helpers` が入っています。
型の定義は [`src/engine/api.ts`](../src/engine/api.ts)、完全なサンプルは [`plugins/example-typewriter.js`](../plugins/example-typewriter.js)。

## 何を書くか

| 作るもの | 主に書くもの |
|---|---|
| **歌詞スタイル** | `line(g, l)`：1行ぶんの歌詞を描く。`l.chunks[].gt` や `api.helpers.lineGlyphs()` で1文字ごとの出現時刻、`api.helpers.hitPulse(l)` で叩いた直後。`lyricFx(g, post)` で叩いた文字に合わせたフラッシュなど |
| **ルック** | `background` `backDecor` `frontDecor` `overlay`（描画の層）、`post` / `postFx`（ポストエフェクト）、`camera`（オート演出の癖）、`transition`（切替の FX） |
| **カメラのフレーミング** | `pose(c)`：キャラをどこにどの大きさで映すか（下の「カメラ」） |
| **カメラの動き** | `apply(pose, c)`：フレーミングの上に足す動き（ズーム・揺れ・回転など） |
| **パレット** | 4色（`bg` `text` `accent` `accent2`）を `#rrggbb` で |
| **FX** | `apply(s)`：`s.post`（フラッシュ・色収差・グリッチ…）や `s.camera`（揺れ・ズーム）に足し込む。`s.elements` で歌詞・テロップ・立ち絵の1つだけを動かすこともできる。`draw(g, s)`：画面に重ねて描く |
| **ビジュアライザー** | `draw(g, v)`：`v.area` の中に `g.audio.spectrum`（64帯域）や `g.audio.wave` で描く |
| **テロップ** | `draw(g, t)`：`t.text` `t.sub` `t.age` `t.dur` `t.outK`（退場の進み）で描く |
| **エフェクト**（歌詞・テロップ・立ち絵） | `under(g, e)`（後ろ）／`over(g, e)`（上）／`body(g, e)`（本体を自分で描く）／`image(g, e)`（本体の画像を差し替え）。`e.img` が要素の画像（下の「エフェクトとモーション」） |
| **モーション**（歌詞・テロップ・立ち絵） | `offsets(c)`：その瞬間のずらし量 `{ dx, dy, rot, sx, sy, alpha }` を返す |

## 歌詞スタイル専用・ルック専用

`registerStyle` で足したスタイルは、そのままだと **歌詞スタイルにもルックにも** 出ます。片方だけにしたいときは `use` を書きます。

```js
// 歌詞の動きだけ（line / lyricFx だけ書けばよい）。ルックの一覧には出ない
api.registerStyle({ id: 'my-lyric', name: 'MY LYRIC', color: '#ffb35c', use: 'lyric', line(g, l) { /* ... */ } });

// 画面の世界観だけ（line は書かなくてよい）。歌詞スタイルの一覧には出ない
api.registerStyle({ id: 'my-look', name: 'MY LOOK', color: '#5c7cff', use: 'look', backDecor(g) { /* ... */ }, post: { bloom: 0.3 } });
```

| `use` | 出る場所 | 必須 |
|---|---|---|
| 省略 / `'both'` | 歌詞スタイルとルックの両方 | `line` |
| `'lyric'` | 歌詞トラックの数字キー・左パネル「歌詞スタイル」・行ごとの歌詞スタイル | `line` |
| `'look'` | ルックトラックの数字キー・左パネル「ルック」 | なし |

数字キーは歌詞側・ルック側で別々に数えます（歌詞専用を足しても、ルックのキーはずれません）。
ひな形はスキルの `templates/lyric-style.js`（歌詞専用）と `templates/look.js`（ルック専用）。

## カメラ（フレーミングと動き）

カメラトラックの「フレーミング」と「動き」を足せます。どちらも **キャラの映し方** を決めるもので、次の5つの数（ポーズ）で表します。

| ポーズ | 意味 |
|---|---|
| `fy` | キャラ画像の中の高さ（0 = 画像の上端、1 = 下端。顔の位置は `c.faceY`） |
| `sy` | その点を置く画面の高さ（0 = 上端、1 = 下端） |
| `x` | 画面の横位置（0〜1）。キャラの位置（左・中央・右）で決まるので、フレーミングでは書かない |
| `zoom` | 1 で全身が画面の高さくらい、2.7 で顔のアップ |
| `rot` | 回転（ラジアン） |

組み込みの例：全身 `{ sy: 1.02, fy: 1, zoom: 1 }`、バスト `{ sy: 0.3, fy: faceY, zoom: 1.75 }`、アップ `{ sy: 0.4, fy: faceY, zoom: 2.7 }`。

```js
// フレーミング：pose(c) でポーズを返す。c.p はそのフレーミングの進み（0→1、次のフレーミングまで・最大8小節）
api.registerFraming({
  id: 'my-reveal', name: 'リビール', key: 'x',
  pose(c) {
    const k = api.lib.ease.inOutCubic(c.p); // アップから全身へ引いていく
    return { sy: api.lib.lerp(0.4, 1.02, k), fy: api.lib.lerp(c.faceY, 1, k), zoom: api.lib.lerp(2.6, 1, k), rot: 0 };
  },
});

// 動き：apply(pose, c) でポーズを書き換える（または新しいポーズを返す）
api.registerCameraMove({
  id: 'my-kick', name: 'キック', key: '[',
  apply(pose, c) { pose.zoom *= 1 + 0.05 * c.beat.pulse; }, // 拍ごとにズーム
});
```

- フレーミングの `c`：`faceY`（顔の位置）`p`（進み 0..1）`seed`（キャラごとの乱数の種）`policy`（ルックのカメラの癖）
- 動きの `c`：`p`（進み 0..1）`t`（曲の時刻）`beat`（拍）`drift`（ルックの揺れの量、1 が標準）`seed`
- `key` は希望のキー（フレーミングは `Z` `X` `C` `V` `B`、動きは `P` `[` `]` `N` `M` `L` のどれか）。空いていなければ別の空きキーに入ります。
- 組み込みと同じ id（`wide` `push` など）は使えません。
- 歌詞の表示領域はキャラの位置（左・中央・右）だけで決まり、フレーミングでは変わりません。中央のキャラを下の方まで大きく映すフレーミングは、歌詞（中央のときは画面の下寄り）と重なりやすいので確かめてください。
- ひな形はスキルの `templates/camera.js`。

## パレット

```js
api.registerPalette({ id: 'my-matcha', name: 'Matcha', bg: '#0f1a12', text: '#f4fff2', accent: '#9be15d', accent2: '#ffd166' });
```

- 色は `#rrggbb`。`bg` は背景の基調、`text` は歌詞の色、`accent` / `accent2` は強調と飾り。`text` は `bg` の上で読める色に。
- 左パネル「ルック → パレット」、インスペクタ、ルックトラックの `N` `M`（最初の2つ）に出ます。
- 組み込みと同じ id（`midnight` など）と `custom` `auto` は使えません。
- ひな形はスキルの `templates/palette.js`。

## エフェクトとモーション（歌詞・テロップ・立ち絵）

歌詞・テロップ・立ち絵は、どれも同じ2種類の演出を持っています。1つのプラグインが3つの要素すべてで使えます。

| 種類 | 選び方 | 例（組み込み） |
|---|---|---|
| **エフェクト** | トグルで重ねがけ | 影・縁取り・グロー・スライス・シルエット |
| **モーション** | 1つだけ選ぶ | 静止・バウンス・ゆらゆら・ふわふわ・ジャンプ・ブルブル |

組み込みのエフェクト5つ・モーション6つもこの API で登録されていて、歌詞とテロップにも使えます（キーは [キー一覧](keymap.md)）。

### エフェクト

```js
api.registerEffect({
  id: 'my-rgb', name: 'RGBずれ', key: 'i',
  under(g, e) {                              // 要素の後ろに描く
    const d = (3 + 7 * g.beat.pulse) * g.u;
    g.ctx.globalCompositeOperation = 'lighter';
    g.ctx.translate(-d, 0);
    e.draw(e.silhouette('#ff2050'));         // 要素の形を赤一色にして、要素の位置に描く
    g.ctx.translate(2 * d, 0);
    e.draw(e.silhouette('#20e0ff'));
  },
});
```

| フック（どれか1つ以上） | 描く場所 |
|---|---|
| `image(g, e)` | 本体の画像を差し替える（同じ大きさの画像を返す。例：`e.silhouette(色)`） |
| `under(g, e)` | 要素の後ろ（影・縁取り・グローの仲間） |
| `body(g, e)` | 要素そのものを自分で描く（スライスの仲間。いちばん後に登録されたものが使われる） |
| `over(g, e)` | 要素の上 |

- **`e.img` が要素の画像** です。立ち絵ならその立ち絵（MMD はそのフレームの描画）、歌詞・テロップならそのフレームに描かれた **文字だけ** の画像（画面全体の大きさ）。ステッカーや帯・箱などの下地は含まれず、そのまま下に残ります。
- `g.ctx` は位置合わせ済みです。`e.draw(画像, pad)` で要素と同じ位置に描けます（`e.x` `e.y` `e.w` `e.h` が描く位置、`e.scale` が画像1px あたりの画面上の大きさ）。立ち絵では反転・回転も合わせてあります。
- ヘルパー：`e.silhouette(色)`（要素の形の単色画像）、`e.outline(色, 太さ?)` → `{ c, pad }`（形を太らせた単色）、`e.glow(色)` → `{ c, pad }`（ぼかした単色。低解像度）、`e.mask((ctx, w, h) => 塗り, key?)`（塗りを要素の形で切り抜く。グラデーションで塗り替える等）。どれも `e.draw(c, pad)` で描きます。
- `silhouette` / `outline` / `glow` は色ごとに画像を保存します。虹色のように毎フレーム色が変わる塗りは `e.mask` で描いてください（同じ `key` のキャンバスを使い回します）。
- `e.target`（`'lyrics'` `'telop'` `'chara'`）で要素ごとに描き分けられます。組み込みの影・縁取りも、文字では短く・細くしています。
- `e.age` はそのエフェクトをオンにしてからの秒数、`e.seed` は要素ごとの乱数の種。
- `targets: ['chara']` のように書くと、その要素のトラックにだけ出ます（省略時は3つとも）。
- `flat: true` は立ち絵の色なじませ（グレード）を切ります（シルエットのように単色にするもの向け）。
- 重ねがけの順番（奥 → 手前）は **登録順** です。組み込みはグロー → 影 → 縁取り、プラグインはその手前。トグルした順番には関係なく、同じ組み合わせなら同じ見た目になります。
- [文字色の部分反転](06-look.md#文字色の部分反転) がオンのとき、`under` は文字の下地（判定の背景）の扱い、本体と `over` は文字の扱いです。

### モーション

```js
api.registerMotion({
  id: 'my-pulse', name: 'パルス', key: 'j',
  offsets(c) {
    const k = 1 + 0.05 * c.beat.pulse + 0.05 * c.beat.downPulse;
    return { sx: k, sy: k };                 // 拍ごとに大きくなる
  },
});
```

- `offsets(c)` はその瞬間のずらし量を返します（省略した項目は変えない）：`dx` `dy`（px。`c.u` を掛ける）、`rot`（ラジアン）、`sx` `sy`（拡大）、`alpha`（不透明度 0..1）。
- 中心（回転や拡大の軸）：歌詞はテキスト領域の中央、テロップは型ごとの位置（`registerTelop` の `pivot`、省略時は画面中央）、立ち絵はフレーミングの基準点（足元や顔）。
- `c` の中身：`target` `t` `age`（そのモーションになってからの秒数）`beat` `audio` `u` `amount`（録音した値は 1.5、立ち絵のオートではルックの `bounce`）`seed`（立ち絵ごと・要素ごとに固定）。
- `alpha` を 1 より下げる間は、歌詞・テロップをいったん別の画像に描いてから重ねます（少し重くなります）。
- 例：`templates/motion.js` の「スライドイン」は `c.age` を使って、モーションを切り替えた瞬間に左から入ってきます。

### キー

| トラック | エフェクト | モーション |
|---|---|---|
| 歌詞・テロップ | 組み込み `Q`〜`T`、なし `Y`、プラグイン `I` `O` `P` `[` `]`（6つ目は `U`） | 組み込み `A`〜`H`、プラグイン `J` `K` `L` |
| 立ち絵 | 組み込み `Q`〜`T`、なし `Y`、オート `U`、プラグイン `I` `O` `P` `[` `]` | 組み込み `Z`〜`N`、オート `M`、プラグイン `J` `K` `L`（4つ目は `H`） |

`key` で希望のキーを書けます（埋まっていれば空きへ）。キーが足りない分は、キーパネルのクリック・タイムラインのダブルクリックのメニュー・インスペクタから選べます。
ひな形はスキルの `templates/effect.js` と `templates/motion.js`。

## FX で1つの要素だけ動かす

FX の `apply(s)` で `s.elements.lyrics` / `s.elements.telop` / `s.elements.chara` を書き換えると、その要素だけが動きます（モーションに足されます）。`dx` `dy` `rot` は足し、`sx` `sy` `alpha` は掛けます。

```js
api.registerFx({
  id: 'my-lyric-punch', name: '歌詞パンチ', color: '#08d9d6', duration: 0.5,
  apply(s) {
    const k = Math.pow(1 - s.p, 2) * s.intensity;
    s.elements.lyrics.sx *= 1 + 0.12 * k;   // 歌詞だけ跳ねて揺れる（画面全体はそのまま）
    s.elements.lyrics.sy *= 1 + 0.12 * k;
    s.elements.lyrics.dy -= 24 * k;
  },
});
```

## 守ること

1. **描画は時刻だけで決める**。`Math.random()` や `Date.now()` を使わず、乱数は `g.rand(...)` / `api.lib.hash(...)`。シークしても書き出しても同じ絵になるように。
2. レイアウトの計算結果は `l.cache` に入れて使い回す（行ごと・自動で破棄される）。
3. サイズは `g.u`（1080p を 1 とする単位）を掛ける。
4. 文字は **塗り** で描く。線だけの文字は読みにくいので避ける（どうしても使うならスタイルに `adaptText: false`）。
5. 文字の下の帯や箱は `api.lib.onPlate(g, (pl) => { ... })` で描く（[文字色の部分反転](06-look.md#文字色の部分反転) の判定の背景になる）。
6. 色は `g.pal`（パレット）から取る。

## 確かめ方

- アプリで読み込んで、再生しながら数字キーや FX キーで試す。
- 開発環境があるなら、テスト用ページで画像にして確認できます（開発サーバー起動中）：
  ```bash
  node .claude/skills/minamo-plugin/scripts/check-plugin.mjs plugins/my-style.js "style=my-style&bg=1&notitle=1" 4.3,5,5.6
  # 歌詞スタイル専用： "style=neon&lyric=my-lyric&bg=1&notitle=1"
  # カメラ：          "style=kinetic&notitle=1&frame=my-reveal&move=my-kick"
  # パレット：        "style=pop&notitle=1&pal=my-matcha"
  # エフェクト：      "style=kinetic&notitle=1&bg=1&leffect=my-rgb&ceffect=my-rgb"（歌詞 l・テロップ t・立ち絵 c）
  # モーション：      "style=kinetic&tel=lower&lmotion=my-pulse&tmotion=my-pulse&cmotion=my-pulse"
  ```
  `test-out/plugin-check/` に PNG が出て、ページのエラーと「同じ時刻で同じ絵になるか」を検査します。

## 組み込みとして足す（リポジトリへの貢献）

| 作るもの | 置き場所 |
|---|---|
| スタイル | `src/plugins/styles/08-name.ts`（`_template.ts` をコピー。ファイル名の数字順がキー順） |
| カメラのフレーミング・動き | `src/plugins/framings/NN-id.ts` / `src/plugins/camera-moves/NN-id.ts` |
| パレット | `src/plugins/palettes/NN-id.ts` |
| FX | `src/plugins/fx/NN-id.ts`（トランジションは `src/plugins/transitions/`） |
| エフェクト・モーション | `src/plugins/effects/NN-id.ts` / `src/plugins/motions/NN-id.ts` |
| ビジュアライザー | `src/plugins/visualizers/NN-id.ts`（番号順がキー順） |
| テロップの型 | `src/plugins/telops/NN-id.ts` |

組み込みの演出はすべて `src/plugins/` にあり、実行時プラグインと **同じ書き方**（`export default (api) => { api.registerXxx({...}) }`）で1つ1ファイルになっているので、そのまま見本になります（型注釈を外せば .js プラグインとして読み込めます。フォルダの `_shared.ts` にある小さな関数は、コピーして使ってください）。ファイル名の番号順に登録されます。

組み込みは「最初に登録されるプラグイン」なので、プラグインで同じ id を登録すると組み込みを置き換えられます（一覧の位置とキーはそのまま）。キーはどのトラックも同じ規則で、登録順に「希望の `key` が空いていればそれ、なければ次の空き、なければキーなし（キーパネル・メニューから選ぶ）」です。

詳しくは [13. 開発者向け](13-developers.md)。
