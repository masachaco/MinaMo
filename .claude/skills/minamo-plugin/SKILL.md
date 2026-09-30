---
name: minamo-plugin
description: MinaMo のプラグイン（歌詞スタイル・ルック・FX・オーディオビジュアライザー・テロップ・カメラのフレーミングと動き・パレット・歌詞／テロップ／立ち絵のエフェクトとモーション）を作る・直すときに使う。実行時に読み込む .js プラグインを書く、src/plugins に組み込みの演出を足す、FX やビジュアライザーやテロップのテンプレートやエフェクト・モーションを追加する、作ったプラグインをフレーム画像と決定性チェックで確かめる、といった作業全般。Use when creating or editing MinaMo plugins (registerStyle / registerFx / registerVisualizer / registerTelop / registerFraming / registerCameraMove / registerPalette / registerEffect / registerMotion).
---

# minamo-plugin

MinaMo（キーを叩いて作るリリックMVアプリ）の演出プラグインを作るためのスキルです。

プロジェクト: このリポジトリ（MinaMo）。API の正は **`src/engine/api.ts`**（型とレジストリ）で、ヘルパーは `src/engine/lib.ts`（`api.lib`）と `src/engine/helpers.ts`（`api.helpers`）。作業の最初にこの3ファイルを読み、このスキルの内容より実際のコードを優先すること。早見表は [reference.md](reference.md)。

## 準備（最初に1回）

```bash
npm ci                                  # 依存のインストール（package-lock.json どおり）
npx playwright-core install chromium    # 確認スクリプト用のブラウザ（CHROMIUM_PATH=<chrome> で既存のものも使える）
npm run dev                             # 開発サーバー（http://localhost:5178）。確認スクリプトはこれに接続する
```

作ったプラグインは `plugins/<name>.js` に置く（開発サーバーから配信されるので、確認スクリプトもアプリもそのまま読める）。できたら、利用者はアプリの左パネル「プロジェクト → プラグイン → .js を読み込む」で読み込む。

## プラグインの種類と置き場所

| 作るもの | 実行時プラグイン（.js、利用者向け） | 組み込み（このリポジトリに足す） |
|---|---|---|
| モーションスタイル（歌詞・ルック両方） | `api.registerStyle({...})` | `src/plugins/styles/NN-name.ts`（`_template.ts` をコピー。ファイル名の数字順が数字キー順。`_` 始まりは登録されない） |
| 歌詞スタイル専用 | `api.registerStyle({ use: 'lyric', ... })` | 同上に `use: 'lyric'` |
| ルック専用 | `api.registerStyle({ use: 'look', ... })`（`line` 不要） | 同上に `use: 'look'` |
| FX（ワンショット・トランジション） | `api.registerFx({...})` | `src/plugins/fx/NN-id.ts`（トランジションは `src/plugins/transitions/`） |
| オーディオビジュアライザー | `api.registerVisualizer({...})` | `src/plugins/visualizers/NN-id.ts`（番号順が 1〜9 キー） |
| テロップのテンプレート | `api.registerTelop({...})` | `src/plugins/telops/NN-id.ts` |
| カメラのフレーミング | `api.registerFraming({...})` | `src/plugins/framings/NN-id.ts` |
| カメラの動き | `api.registerCameraMove({...})` | `src/plugins/camera-moves/NN-id.ts` |
| パレット | `api.registerPalette({...})` | `src/plugins/palettes/NN-id.ts`（最初のパレットが新規プロジェクトの既定） |
| エフェクト（歌詞・テロップ・立ち絵） | `api.registerEffect({...})` | `src/plugins/effects/NN-id.ts`（番号順が重なり順。キーは定義の `key`） |
| モーション（歌詞・テロップ・立ち絵） | `api.registerMotion({...})` | `src/plugins/motions/NN-id.ts`（キーは登録順：立ち絵は Z 行、歌詞・テロップは A 行） |

- 実行時プラグインは ES モジュール1ファイル：`export default function (api) { ... }`。アプリの左パネル「Project → プラグイン → .js を読み込む」で読み込み、ブラウザに保存されて次回も自動で読み込まれる。サンプル：`plugins/example-typewriter.js`。
- **組み込みのエフェクト・モーション・FX・トランジション・ビジュアライザー・テロップは、実行時プラグインと同じ形**（`export default (api) => { api.registerXxx({...}) }`、使うのは `api` だけ）で `src/plugins/<種類>/NN-id.ts` に1つずつある。似たものを作るときの見本にする（TypeScript の型注釈を外せばそのまま .js プラグインになる。`_shared.ts` の関数は実行時プラグインからは読めないのでコピーする）。
- `api` = `{ registerStyle, registerFx, registerVisualizer, registerTelop, registerFraming, registerCameraMove, registerPalette, registerEffect, registerMotion, listStyles, listLyricStyles, listLookStyles, listFramings, listCameraMoves, listPalettes, listTelops, listFx, listVisualizers, listEffects, listMotions, lib, helpers, DEFAULT_POST, DEFAULT_CAMERA }`（`src/plugin-loader.ts`、型は `PluginApi`）。`window.MinaMo` にも同じものがある。
- スタイル・FX・ビジュアライザー・テロップ・エフェクト・モーションは同じ `id` で登録すると上書きになる（組み込みの id: kinetic / glitch / neon / emotional / pop / impact / minimal、shadow / outline / glow / slice / silhouette、idle / bounce / sway / float / hop / shake など）。フレーミング・動き・パレットも同じで、組み込みの id（wide / push / midnight など）で登録すると置き換わる（予約はイベントで別の意味を持つ `auto`、パレットは `custom` も）。エフェクト・モーションの id に空白とカンマは使えず、`auto`（エフェクトは `none` も）は予約。新規は固有の id にする。
- ひな形は `templates/`（style.js＝歌詞とルック両方 / lyric-style.js＝歌詞専用 / look.js＝ルック専用 / fx.js（1要素だけ動かす FX も）/ visualizer.js / telop.js / camera.js＝フレーミングと動き / palette.js / effect.js / motion.js）。新しく作るときはここからコピーして始める。実行時プラグインは `plugins/<name>.js` に置くと確認スクリプトでそのまま使える。

## 必ず守るルール

1. **描画は時刻の純関数**。`Math.random()`・`Date.now()`・`performance.now()`・フレーム間で持ち越す変数を使わない。乱数は `g.rand(a, b, ...)` / `lib.hash(...)` / `l.seed`。シークしても書き出しても同じ絵になること（確認スクリプトが検査する）。
2. **キャッシュは `l.cache` だけ**（行ごとのレイアウト。プロジェクトや解像度が変わると自動で破棄される）。キャッシュの中身は行のデータと解像度だけから決まるものにする。
3. **サイズは `g.u` 倍**（`u = min(W,H)/1080`）。px を直書きしない。テキスト領域は `l.box`（歌詞）/ `g.box`（現在）で、キャラと重ならないようカメラ演出が決めている。
4. **文字は塗りで描く**。線だけの文字（strokeText のみ）は使わない（このアプリの方針。文字色の部分反転は塗りを切り替えるため）。ネオン管のようにどうしても線にする場合は、そのスタイルに `adaptText: false` を付ける。
5. **文字の下地は `lib.onPlate(g, (pl) => { ... })`** で描く（ステッカー・帯・箱など）。「文字色の部分反転」がオンのとき、文字は下地や背景と比べて塗りが切り替わる。下地を `g.ctx` に描くと文字として扱われて崩れる。歌詞・テロップのエフェクト（影・縁取り…）も文字だけにかかり、下地にはかからない（下地を `g.ctx` に描くと下地にも影が付く）。
6. **叩いたタイミングを活かす**（利用者は歌に合わせて1文字ずつ Space、1行ずつ Enter で出す）：1文字ごとの出現時刻（`helpers.lineGlyphs(l, stagger)` の `tg`、`l.chunks[].gt`）で出し、`helpers.hitPulse(l)` で叩いた直後を強調する。拍は `g.beat`（`pulse` / `downPulse` / `phase`）。
7. **フォント**は `fonts: ['900 "Noto Sans JP"', ...]` に書いて事前読み込みさせる。使えるのは index.html で読み込んでいるもの：Noto Sans JP、Zen Kaku Gothic New、M PLUS Rounded 1c、Mochiy Pop One、Dela Gothic One、DotGothic16、Shippori Mincho B1、Montserrat、Anton、Orbitron、Share Tech Mono、Cormorant Garamond。組み込みで別のフォントが要るなら index.html の Google Fonts の URL に足す。
8. **重くしない**：毎フレーム全文字を測り直さない（測定は `lib.fitSize` / `lib.glyphRun` を `l.cache` の中で）。`ctx.filter`（blur 等）や大量の `shadowBlur` は避け、発光はポストエフェクト（`post.bloom`）に任せる。

## スタイルの2つの顔

1つの `MotionStyle` は「歌詞スタイル」と「ルックスタイル」を独立に選べる。片方だけに出したいときは `use: 'lyric'`（歌詞の一覧・歌詞トラックの数字キーだけ）か `use: 'look'`（ルックの一覧・ルックトラックの数字キーだけ、`line` 不要）。数字キーは歌詞側・ルック側で別々に数える（10個を超えた分はキーなしでキーパネル・メニュー・インスペクタから選ぶ）。ユーザーが「歌詞スタイル」「LYRIC STYLE」を作りたいと言ったら `use: 'lyric'`、背景や世界観だけなら `use: 'look'` にする。
- 歌詞スタイルとして使われる部分：`line(g, l)`（必須・1行ずつ）、`lyricFx(g, post)`（叩いた文字でフラッシュ等）、`exitDuration`、`persist`、`adaptText`、`followCamera`。
- ルックスタイルとして使われる部分：`background` / `backDecor` / `frontDecor` / `overlay`（描画の層）、`post` / `postFx`（ポストエフェクト）、`camera`（オート演出の癖）、`transition`（セクション切替の FX id）、`title`（タイトルカード）、`hideHud`。
- 描画の順：背景 → `background` → `backDecor` → ビジュアライザー（後ろ）→ 立ち絵（立ち絵トラックのエフェクト・モーション込み）→ `frontDecor` → 歌詞（`line`。歌詞トラックのモーションで動かし、エフェクトを重ねる）→ `overlay` → FX の `draw` → テロップ（テロップトラックのエフェクト・モーション込み）→ HUD。

## カメラとパレット

- **ポーズ** `{ x, sy, fy, zoom, rot }`：キャラ画像の高さ `fy`（0=上端, 1=下端, 顔は `faceY`）の点を画面の高さ `sy`（H の割合）・横 `x`（W の割合）に置く。`zoom` 1 ≒ 全身が画面の高さ、2.7 ≒ 顔アップ。`rot` はラジアン。組み込み：全身 `{sy:1.02, fy:1, zoom:1}`、バスト `{sy:0.3, fy:faceY, zoom:1.75}`、アップ `{sy:0.4, fy:faceY, zoom:2.7}`、ワイド `{sy:0.97, fy:1, zoom:0.78}`。
- **フレーミング** `pose(c)` はポーズを返す（`x` は無視される＝キャラの位置で決まる）。`c = { faceY, p, seed, policy }`、`p` は次のフレーミングまで（最大8小節）の進み 0..1。動くフレーミング（パンアップ等）は `p` で補間する。
- **動き** `apply(pose, c)` はポーズを書き換えるか新しいポーズを返す。`c = { p, t, beat, drift, seed }`。揺れの量は `c.drift`（ルックの癖、1 が標準）を掛ける。拍に乗せるなら `c.beat.pulse` / `downPulse`。
- どちらも純関数（乱数は `seed` と `lib.hash` / `lib.noise1`）。NaN や例外は既定のポーズに置き換えられ、コンソールに警告が出る。
- 歌詞の表示領域はキャラの位置だけで決まる（フレーミングでは変わらない）。中央のキャラを大きく下まで映すと歌詞と重なるので、確認画像で見る。
- キー：フレーミングは CAMERA トラックの `z x c v b`、動きは `p [ ] n m l`（`key` で希望、埋まっていれば空きへ）。
- **パレット** `{ id, name, bg, text, accent, accent2 }`（`#rrggbb`）。`text` は `bg` の上で読める色に。左パネル・インスペクタ・LOOK トラックの `n` `m`（最初の2つ）に出る。

## エフェクトとモーション（歌詞・テロップ・立ち絵）

3つの要素は同じ粒度の演出を持つ：**エフェクト**（トグルで重ねがけ）と **モーション**（1つ選ぶ）。ユーザーが「歌詞に効果」「テロップを揺らす」「立ち絵のエフェクト」と言ったらここ。スタイルやテロップの型を作り直すのではなく、どのスタイル・型にも重ねられるものとして作る。
- **エフェクト** `registerEffect({ id, name, key?, targets?, flat?, image?, under?, body?, over? })`。`e.img` は要素の画像：立ち絵はスプライト、歌詞・テロップは **文字だけ** の全画面層（下地はそのまま下に残る）。`g.ctx` は位置合わせ済みで、`e.draw(画像, pad)` か `e.x e.y e.w e.h`（`e.scale` = 画像1px の描画サイズ）で描く。ヘルパー `e.silhouette(色)` / `e.outline(色, 太さ?)` / `e.glow(色)` / `e.mask(fn, key?)`。`e.target` で要素ごとに描き分けてよい（文字は細く・短く、など）。
- 重なり順は登録順（組み込み：グロー → 影 → 縁取り、プラグインはその手前）。各フックは save / restore の中で呼ばれるので、合成モードや平行移動は戻さなくてよい。
- **モーション** `registerMotion({ id, name, key?, targets?, offsets(c) })` → `{ dx, dy, rot, sx, sy, alpha }`（px は `c.u` 倍）。中心は歌詞＝テキスト領域の中央、テロップ＝`TelopDef.pivot`、立ち絵＝フレーミングの基準点。`c.age`（そのモーションになってからの秒数）で入りの動きを作れる。
- FX の `apply(s)` で `s.elements.lyrics / telop / chara` に足すと、その要素だけ動く（`dx dy rot` は足す、`sx sy alpha` は掛ける）。
- キー：エフェクトは `i o p [ ]`、モーションは `j k l`（3トラック共通。`key` で希望）。
- 確認：`leffect` `lmotion`（歌詞）`teffect` `tmotion`（テロップ、`tel=lower` などと一緒に）`ceffect` `cmotion`（立ち絵）をテスト用ページに渡す。

## 作業の流れ

1. `src/engine/api.ts` と `templates/` の該当ひな形を読む。似た組み込み（`src/plugins/styles/01-kinetic.ts`、`src/plugins/fx/` `src/plugins/effects/` など。組み込みはすべて実行時プラグインと同じ形）を参考にする。
2. `plugins/<name>.js`（実行時）または `src/plugins/<種類>/NN-id.ts`（組み込み。`export default (api: PluginApi) => {...}`、使うのは `api` だけ）を書く。
3. **確認スクリプトで絵と決定性を見る**（開発サーバー `npm run dev` が起動している状態で）：
   ```bash
   node .claude/skills/minamo-plugin/scripts/check-plugin.mjs plugins/my-style.js "style=my-style&bg=1&notitle=1" 4.3,5,5.6
   # FX:            ... plugins/my-fx.js "style=kinetic&notitle=1&fx=my-fx@4.5" 4.6,4.8
   # トランジション: ... plugins/my-wipe.js "style=kinetic&notitle=1&fx=my-wipe@4.5" 4.55,4.7,4.9（hidden でも fx= で置ける。ルックの transition に書けばセクションの頭で出る）
   # ビジュアライザー: ... plugins/my-viz.js "style=kinetic&notitle=1&char=0&viz=my-viz&audio=1" 5,6
   # テロップ:       ... plugins/my-telop.js "style=kinetic&notitle=1&tel=[my-telop] 本文 | サブ" 1,2
   # 歌詞スタイル専用: ... plugins/my-lyric.js "style=neon&lyric=my-lyric&bg=1&notitle=1" 4.1,4.4,5.2
   # ルック専用:     ... plugins/my-look.js "style=my-look&lyric=kinetic&notitle=1" 4.3,5.1
   # カメラ:         ... plugins/my-camera.js "style=kinetic&notitle=1&frame=my-reveal&move=my-kick" 1,6,15
   # パレット:       ... plugins/my-palette.js "style=pop&notitle=1&pal=my-matcha" 4.5
   # エフェクト:     ... plugins/my-effect.js "style=kinetic&notitle=1&bg=1&leffect=my-rgb&ceffect=my-rgb" 4.4,5.2
   # モーション:     ... plugins/my-motion.js "style=kinetic&tel=lower&lmotion=my-pulse&tmotion=my-pulse&cmotion=my-pulse" 1,4.4
   # 組み込み（ファイル不要）: 第1引数を - にする
   ```
   `test-out/plugin-check/` に PNG が出る。**画像を開いて目で確認する**（はみ出し・読みにくさ・キャラとの重なり・線だけの文字になっていないか）。スクリプトはページエラーと「同じ時刻が同じ絵か」を検査し、問題があれば終了コード 1。
   - テスト用ページ（`test.html`）のパラメータ：`style`（ルック）`lyric`（歌詞スタイル、省略時は style と同じ）`char=0`（キャラなし）`bg=1|bright`（背景画像／明るい背景）`adapt=mid`（文字色の部分反転）`pal`（パレット id）`w` `h`（解像度）`tel`（テンプレート名かテロップ1行）`notitle=1`（既定のタイトルテロップを消す。スタイルの確認では付ける）`viz` `vpos` `vcolor` `vsize` `vlayer` `fx=id@秒` `frame` `move`（カメラのフレーミング・動きの id を 0 秒から）`leffect` `lmotion` `teffect` `tmotion` `ceffect` `cmotion`（歌詞・テロップ・立ち絵のエフェクト（カンマ区切り）・モーションを 0 秒から）`audio=1`（テスト曲の解析を使う。手元に `music_bgm_200.wav` がなければデモ曲）`lyrics=行1~行2`（歌詞の差し替え、`~` 区切り）。歌詞の i 行目は 4 + 2i 秒に出る。テロップは 0.5 秒に出る。
4. 組み込みを足した場合は `npm run build`（型チェック）と `npm run test:logic`。`docs/06-look.md` のスタイルの表にも1行足す。エフェクト・モーションを組み込みに足したら、キー（エフェクトは定義の `key`、モーションは登録順）と `docs/keymap.md`・`docs/03-lyrics.md`・`docs/07-telop.md`・`docs/08-characters.md` のキー表も直し、`npm run test:plugin` を通す。
5. 実行時プラグインは、アプリで実際に読み込んで数字キー・FX キー・カメラ／ルック・エフェクト／モーションのキーで試してもらう（左パネル「Project → プラグイン」）。
6. 組み込みやプラグイン API を変えたら、`docs/12-plugins.md`（利用者向けマニュアル）とこのスキルの reference.md も直す。

## よくある落とし穴

- `line()` で `ctx.save()` / `ctx.restore()` を対にしないと、後の描画の状態が崩れる。
- `textBaseline` / `textAlign` / `font` は毎回設定する（前の描画の状態を当てにしない）。
- 行の退場：`l.out >= 0` から `exitDuration` 秒かけて消える。`helpers.exitK(l)`（0→1）でアルファや位置を動かす。
- 文字数の多い行だけ小さくならないように：行ごとに幅へフィットさせるなら、サイズの比に上限を付けるか1行で同じサイズにする（KINETIC は1行同サイズ＋字間で揃える）。行分けは `helpers.makeRows(l, { maxRows, maxLen, perChunk, stagger })`（`/` で区切られた行はそのまま行になる）。
- FX の `apply(s)` は `s.post` / `s.camera` に**足し込む**（上書きすると他の FX を消す）。強さは `s.intensity` を掛ける。
- ビジュアライザーは `v.area` の中に `v.alpha` を掛けて描き、色は `v.color(k)`（0..1）を使う。
- テロップの退場は `t.outK`（0→1）。下地（帯・箱）は `onPlate`。モーションの中心にしたい位置があれば `pivot: { x, y }`（W / H の割合）。
- エフェクトの `e.img` は歌詞・テロップでは全画面の層（`e.x = e.y = 0`、`e.scale = 1`）。文字の位置が要るなら `g.box`（歌詞のテキスト領域）を使う。
- `e.silhouette(色)` / `e.outline` / `e.glow` は **色ごとに画像を保存** する。色が毎フレーム変わる塗り（虹色・色相の回転など）は `e.mask((ctx, w, h) => 塗り, 'my-key')` で描く（同じ `key` のキャンバスを使い回す）。保存は1要素あたり16枚までで、古いものから捨てて作り直すので、色を変え続けると重くなる。
- モーションの `alpha` を 1 未満にすると、歌詞・テロップは毎フレームいったん別の層に描いてから重ねる（重い）。点滅などに限る。
