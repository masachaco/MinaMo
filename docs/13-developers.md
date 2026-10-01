# 13. 開発者向け

コードを読む・直す人向けの入口です。実装する前に、下の「守る設計」を読んでください。

## 技術

- Vite + TypeScript（strict）。UI フレームワークは使わず素の DOM（`src/ui/dom.ts` の `h()`）。
- 描画は Canvas 2D と自前の WebGL2 ポストエフェクト。アニメーション用のライブラリは使っていない。
- 実行時の依存：mediabunny（WebCodecs で MP4 / WebM 書き出し）。MMD を使うときだけ three.js・@moeru/three-mmd・@moeru/three-mmd-physics-springbone を遅延読み込み。

## コマンド

```bash
npm ci               # 依存のインストールは必ず npm ci
npm run dev          # http://localhost:5178
npm run build        # 型チェック + ビルド（dist/）
npm run typecheck
```

テスト（Playwright。**開発サーバー起動中** に実行）。ブラウザは最初に1回 `npx playwright-core install chromium` で入れます（すでにある Chrome / Chromium を使うなら `CHROMIUM_PATH=<実行ファイル>`）。
テストが使う曲は、プロジェクト直下に `music_bgm_200.wav` があればそれ、なければデモ曲（`public/demo/`）です（開発サーバーの `/test-song`）。

| コマンド | 内容 |
|---|---|
| `npm run test:logic` | 歌詞タップ・移行・チャンネル・行分けなどのロジック（速い） |
| `npm run test:cursor` | 歌詞の入力位置 |
| `npm run test:e2e` | 録音の通しテスト（数分） |
| `npm run test:edit` | REC なしの編集（ダブルクリック配置・キーで書き換え）、一括クオンタイズ、立ち絵の画像の差し替え、再生速度 |
| `npm run test:plugin` | プラグイン（歌詞スタイル専用・ルック専用・カメラ・パレット・エフェクト・モーション・FX）のキー割り当て・メニュー・パネル・描画 |
| `npm run test:demo` | 初回表示のデモ（曲・立ち絵の読み込み、再読み込みで取り直さない）、デモを開く・新規、旧名（MV Otoge Creator）の保存データの引き継ぎ |
| `npm run test:tutorial` | 初回のチュートリアル（再生 → 歌詞トラック → `Space` で1文字ずつ → `Enter` で1行 → エフェクト → 立ち絵の切り替え・位置 → FX → カメラ → 新規）、スキップ、「？」 |
| `npm run test:mobile` | スマホ版（`mobile/`）：スマホの画面サイズでデモを開く、トラックごとのパッド、チュートリアル（再生中のスピン＝試し弾き → REC でスピンを記録）、パッドで録音（歌詞・FX の長押し・立ち絵）、PC 版のページが変わらないこと |
| `npm run test:export` | 1秒の MP4 書き出し |
| `npm run test:mmd` | MMD（手元の素材の場所を `MMD_MODEL` / `MMD_MOTION`（任意で `MMD_CAMERA`）か、`models/mmd-test.json` で指定したときだけ。素材はコミットしない） |
| `node scripts/shot.mjs test-out "style=neon&bg=1" "4,5.3"` | テスト用ページ（`test.html`）でフレームを PNG に |

アプリを開くテストは `http://localhost:5178/?demo=0` を開きます（`?demo=0` で初回のデモを読み込まず、見本の歌詞だけの空のプロジェクトから始まる）。

見た目を変えたら、必ず `scripts/shot.mjs` で画像を出して目で確認します。ヘッドレスの Chromium はオーディオの時計が遅れたり止まったりすることがあり、e2e は負荷が高いと時刻がらみの項目がまれに落ちます。

## データの流れ

```
Project（JSON、localStorage）+ 素材（IndexedDB）
  → compileProject()   src/engine/compile.ts    歌詞・スタイル区間・トラックのステップを時刻順に解決
  → Renderer.render(t) src/engine/renderer.ts   ルック背景 → 立ち絵 → 歌詞 → FX → テロップ → HUD を Canvas 2D に
  → PostFX             src/engine/post.ts       WebGL2（ブルーム・色収差・グリッチ・文字色の部分反転の合成…）
書き出し：同じ Renderer を1フレームずつ回して mediabunny でエンコード（src/export/exporter.ts）
```

## 主なファイル

| ファイル | 役割 |
|---|---|
| `src/app.ts` | 状態・再生・REC（重ね録り / 上書き）・試し弾き・REC なしの編集・キー処理 |
| `src/perform.ts` | トラックごとのキー割り当て（キーボード・キーパネル・ダブルクリックのメニューの唯一の定義） |
| `src/core/` | 型、歌詞のパースとタップ、既定値と移行、拍の格子、保存 |
| `src/engine/api.ts` | プラグイン API と登録簿 |
| `src/engine/compile.ts` / `channels.ts` / `director.ts` | 記録とオート演出のマージ、ショット計画、エフェクト・モーションのキー |
| `src/engine/renderer.ts` / `post.ts` | 描画 |
| `src/engine/elements.ts` | 歌詞・テロップ・立ち絵のエフェクト・モーションを描画時に適用 |
| `src/engine/mmd.ts` | MMD モデルの描画・ポーズ / モーション・物理・カメラ VMD |
| `src/audio/` | Web Audio の再生時計、音声の事前解析、再生速度用の時間伸縮（Worker） |
| `src/plugins/` | 組み込みの演出すべて（スタイル・エフェクト・モーション・FX・トランジション・ビジュアライザー・テロップ・フレーミング・カメラの動き・パレット）。実行時プラグインと同じ書き方で1つ1ファイル |
| `src/plugin-loader.ts` | プラグイン API と実行時 .js プラグインの読み込み |
| `src/ui/` | 左パネル、キーパネル / インスペクタ、タイムライン |
| `mobile/index.html` / `src/mobile/` | スマホ版のページ。パッドは `perform.ts` のキーをそのまま並べ、押すと `App.handleKeyDown` / `handleKeyUp` にキーとして渡す（長押し・REC の扱いはキーボードと同じ） |

## 守る設計（抜粋）

- **描画は時刻 t の純関数**。`Math.random()` / `Date` / フレーム間の状態を render 経路で使わない。シークと書き出しで同じ絵になること。
- **キー演奏の記録は REC 中だけ**。REC なしの編集（ダブルクリック配置・選択中の要素の書き換え）は可。
- **既定は重ね録り、オート演出なし**（未録音区間は固定）。
- **組み込みの演出はすべてプラグイン**（`src/plugins/`、最初に登録されるだけ）。エンジンに組み込み専用の分岐や一覧を作らない。同じ id の登録は置き換え。キーはどのトラックも「登録順に、希望の `key` が空いていればそれ、なければ次の空き」（`assignKeys()`）。
- **歌詞スタイルとルックは独立**：同じスタイルを歌詞側（`line` / `lyricFx`）とルック側（背景・装飾・ポスト・カメラ・トランジション）で使い分ける。
- **テロップは歌詞と別物**：一覧（`telopText`）が本文の正、タイミングは `telops[].start` / `dur`。
- **文字色の部分反転**（既定オフ）：歌詞・テロップを別レイヤーに描き、背景と同化するピクセルだけ塗りを切り替える。文字の下地は `lib.onPlate()` で plate 層へ。
- **新しいトラックを足すとき**は `types.ts`（イベント型）→ `project.ts`（既定値・移行）→ `compile.ts` → `renderer.ts` → `app.ts`（`TRACK_LIST` / `TRACK_MODE`）→ `perform.ts`（キー）→ `timeline.ts` / `perform-panel.ts` の順に通す。
- **MMD** のポーズ・モーションは時刻 t でサンプリングする（毎フレーム基本姿勢に戻してから適用）。three の PropertyMixer は変わった値しか書かないので、サンプルごとに action を stop → play し直す。触ったら `npm run test:mmd`。
- 古い保存データは `normalizeProject()` で移行する。型を変えたら移行も書く。

## 依存パッケージの扱い（サプライチェーン対策）

- `.npmrc`：`ignore-scripts=true`（インストール時スクリプトを実行しない）、`save-exact=true`。
- 追加・更新は公開直後の版を避ける：`npm install <pkg>@<ver> --before=<7日前>`。その後 `npm audit` と `npm audit signatures`。
- 休眠していたのに突然更新されたパッケージなど、怪しいものは入れない。

## 公開用のビルド

`npm run build` の `dist/` をそのまま静的サイトとして置けます（GitHub Pages など）。パスは相対（`vite.config.ts` の `base: './'`）なので、`/<リポジトリ名>/` の下でも動きます。ページは PC 版（`index.html`）とスマホ版（`mobile/index.html` → `dist/mobile/`）の2つです（`build.rollupOptions.input`）。
`dist/` には `LICENSE` と `THIRD_PARTY_LICENSES.txt`（ビルドに入った npm パッケージのライセンス文。ビルド時に自動生成）が入ります。デモ素材の扱いは `public/demo/LICENSE.md`。
フォントは Google Fonts から読み込みます（Anton・Cormorant Garamond・Dela Gothic One・DotGothic16・M PLUS Rounded 1c・Mochiy Pop One・Montserrat・Noto Sans JP・Orbitron・Share Tech Mono・Shippori Mincho B1・Zen Kaku Gothic New。すべて SIL Open Font License）。
共有カード（Open Graph / X のカード）は `index.html` の `og:` / `twitter:` のメタタグと `public/og.jpg`（1200×630）です。画像は開発サーバー起動中に `node scripts/og-card.mjs` で作り直せます。スマホ版（`mobile/index.html`）のカードは `public/og-mobile.jpg`（`node scripts/og-card.mjs --mobile`。スマホ版の画面を端末の枠に入れたもの）。`og:image` は公開 URL（GitHub Pages）の絶対パスです。

## 演出の追加

[12. プラグインを作る](12-plugins.md) と、スキル [`.claude/skills/minamo-plugin`](../.claude/skills/minamo-plugin/SKILL.md)。
