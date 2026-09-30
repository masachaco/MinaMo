# MinaMo

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MinaMo は、楽曲に合わせてキーボードを演奏するように操作し、リリックモーションビデオを制作するブラウザアプリケーションです。
歌詞の表示やエフェクトをリアルタイムに入力し、トラックごとに重ねて記録して、一本の映像に仕上げます。

- **Web 版**：<https://masachaco.github.io/MinaMo/>
- **ドキュメント**：[docs/](docs/README.md)  

名称は「水面（みなも）」と **M**us**I**c **MO**vie に由来します。水面に石を落とすと波紋が広がるように、キー入力に応じて演出が即座に広がることを表しています。

## 主な機能

- **歌詞のリアルタイム入力**：歌に合わせて1文字ずつ（`Space`）、単語ごと（`N`）、1行ずつ（`Enter`）表示できます。
- **キーによる演出操作**：歌詞スタイル、エフェクト、FX、カメラワーク、背景、パレットをキー入力で切り替えます。
- **マルチトラック録音**：歌詞・テロップ・立ち絵・カメラ・FX・ビジュアライザー・ルックの各トラックを、個別に重ね録り・上書きできます。
- **タイムライン編集**：記録したイベントの移動・追加・削除、値の書き換え、クオンタイズに対応します。
- **立ち絵**：透過 PNG に加え、MMD モデル（PMX / PMD）とポーズ・モーション（VPD / VMD）を利用できます。
- **動画書き出し**：WebCodecs により MP4 / WebM を書き出します。フレーム単位で描画するため、プレビューと同一の映像が得られます。
- **プラグイン**：スタイル、FX、トランジション、ビジュアライザー、テロップ、カメラ、パレット、エフェクト、モーションを JavaScript で追加できます。

## 動作環境

- Google Chrome または Microsoft Edge（最新版）
  - 動画の書き出しに WebCodecs を使用します。
- ローカルで実行する場合：Node.js 22 以降

## クイックスタート

### Web 版を使う

[Web 版](https://masachaco.github.io/MinaMo/) を開きます。初回はデモプロジェクトとチュートリアルが表示され、歌詞の入力とエフェクトの追加を順に体験できます。自分の楽曲で制作する場合は、画面右上の「新規」から空のプロジェクトを作成します。

### ローカルで実行する

```bash
git clone https://github.com/masachaco/MinaMo.git
cd MinaMo
npm ci
npm run dev
```

ブラウザで <http://localhost:5178> を開きます。

## 基本的な使い方

1. 楽曲・背景・立ち絵をウィンドウにドロップします。
2. 左パネルで BPM と歌詞を設定します（1行が1フレーズ、`/` で単語を区切ります）。
3. `Tab` で録音するトラックを選び、`Shift+R` で録音を開始してキーを入力します。
4. タイムラインで記録を調整します（ドラッグで移動、ダブルクリックで追加、`Ctrl+Z` で取り消し）。
5. 画面右上の「書き出し」から動画を保存します。

録音していない区間は、立ち絵を中央に表示した固定の構図になります。自動演出は「オート」を録音した区間にのみ適用されます。

詳しくは [はじめての1本](docs/01-quickstart.md) と [キー一覧](docs/keymap.md) を参照してください。

## ドキュメント

| 目的 | ドキュメント |
|---|---|
| 初めて使う | [はじめての1本](docs/01-quickstart.md)、[画面の見方](docs/02-screen.md) |
| 制作の流れを理解する | [歌詞](docs/03-lyrics.md)、[トラックと録音](docs/04-recording.md)、[タイムラインで編集](docs/05-editing.md)、[書き出し](docs/09-export.md) |
| 見た目を作り込む | [見た目](docs/06-look.md)、[テロップ](docs/07-telop.md)、[立ち絵と MMD](docs/08-characters.md) |
| 演出を自作する | [プラグインを作る](docs/12-plugins.md) |
| 開発に参加する | [開発者向け](docs/13-developers.md) |
| 問題を解決する | [困ったとき・FAQ](docs/14-troubleshooting.md) |

## プラグイン

プラグインは、既定のエクスポートで API を受け取る ES モジュールです。アプリの「プロジェクト → プラグイン」から読み込むと、ブラウザに保存され、次回以降も自動で読み込まれます。

```js
export default function (api) {
  api.registerFx({
    id: 'my-flash',
    name: 'MY FLASH',
    color: '#ff00ff',
    duration: 0.4,
    apply(s) {
      s.post.flash = Math.max(s.post.flash, 1 - s.p);
    },
  });
}
```

組み込みの演出はすべて同じ形式で [`src/plugins/`](src/plugins/) に1ファイルずつ収録されており、実装例として参照できます。API の詳細は [プラグインを作る](docs/12-plugins.md) を参照してください。

[Claude Code](https://claude.com/claude-code) を利用する場合は、スキル [`.claude/skills/minamo-plugin`](.claude/skills/minamo-plugin/SKILL.md) がプラグイン作成の手順、テンプレート、描画の検証スクリプトを提供します。

## 開発

```bash
npm run dev         # 開発サーバー
npm run build       # 型チェックと本番ビルド（dist/）
npm run test:logic  # テスト（開発サーバーの起動中に実行）
```

ブラウザテストには Chromium が必要です（`npx playwright-core install chromium`）。ソースコードの構成、設計上の規約、テストの一覧は [開発者向け](docs/13-developers.md) を参照してください。

`npm run build` の出力は静的ファイルのみで構成され、GitHub Pages などにそのまま配置できます。

## ライセンス

ソースコードは [MIT License](LICENSE) で公開しています。

ただし、次のものはこのライセンスの対象外です。

- **デモ素材**（`public/demo/` の楽曲・歌詞・立ち絵）：アプリのデモとしての利用に限り許可しています。詳細は [public/demo/LICENSE.md](public/demo/LICENSE.md) を参照してください。
- **MMD のモデル・モーション**：本リポジトリには含まれていません。利用する場合は、各素材の利用規約に従ってください。

## 謝辞

MinaMo は次のオープンソースソフトウェアを利用しています。

- [three.js](https://github.com/mrdoob/three.js)（MIT）
- [@moeru/three-mmd](https://github.com/moeru-ai/three-mmd)（MIT）
- [@pixiv/three-vrm-springbone](https://github.com/pixiv/three-vrm)（MIT）
- [Mediabunny](https://github.com/Vanilagy/mediabunny)（MPL-2.0）
- [Google Fonts](https://fonts.google.com/) の各書体（SIL Open Font License）
- [Octicons](https://github.com/primer/octicons) の GitHub マーク（MIT、GitHub へのリンクのアイコンとして使用）

ビルド時に、同梱するライブラリのライセンス全文を `dist/THIRD_PARTY_LICENSES.txt` に出力します。
