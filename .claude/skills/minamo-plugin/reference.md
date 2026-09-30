# MinaMo プラグイン API 早見表

正は `src/engine/api.ts`。ここは要点のみ。

## DrawContext `g`（すべての描画フックが受け取る）

| フィールド | 内容 |
|---|---|
| `ctx` | 描画先の Canvas 2D |
| `plate` | 文字の下地を描く層（`lib.onPlate(g, fn)` 経由で使う） |
| `W` `H` `u` | 出力サイズと単位（`u = min(W,H)/1080`） |
| `t` | 曲の時刻（秒） |
| `beat` | `bpm` `spb`（1拍の秒）`beatsPerBar` `beat`（小数の拍）`index` `phase`（拍内 0..1）`bar` `barPhase` `inBar` `pulse`（拍ごと 1→0）`downPulse`（小節頭）`halfPulse`（8分） |
| `audio` | `level` `bass` `high`（0..1）`spectrum`（64帯域 0..1、対数間隔 40Hz〜16kHz）`wave`（256点 -1..1） |
| `pal` | パレット `{ bg, text, accent, accent2 }`（色は必ずここから） |
| `box` | 今のテキスト領域 `{x,y,w,h}` |
| `style` `look` | 描画中のスタイル／ルックスタイル |
| `styleAge` `segIndex` | ルックのセクション開始からの秒数・番号 |
| `hasBackground` `hasCharacter` | 背景画像・キャラが出ているか |
| `rand(...n)` | 決定的な乱数 [0,1) |
| `lines` | 表示中の歌詞行（シーンのフックでは全部、`line`/`lyricFx` ではそのスタイルの行） |
| `duration` `title` `artist` | 曲の長さ・曲名・アーティスト |
| `intensity` | FX 強度の設定（0..2） |
| `exporting` | 書き出し中か |
| `lib` | `api.lib` と同じ |

## LineCtx `l`（`line(g, l)` の2番目）

`index` `text` `sub`（`|` の後ろ）`chunks[]`（`{ index, text, glyphs, t, tapped, gt[], gtap[] }`）`manualChunks`（作者が `/` で区切った）`glyphs` `start` `end`（退場開始）`age = t - start` `out = t - end`（退場前は負）`exitDur` `box`（行開始時のテキスト領域）`seed` `newerStarts` `lastHit`（最後に叩いた文字からの秒）`cache`（行ごとの保存領域）`total`

## MotionStyle

`id` `name` `description` `color`（タイムラインの色）`use`（'both' 既定 | 'lyric' 歌詞スタイル専用 | 'look' ルック専用）`post`（`PostParams` の一部）`camera`（`CameraPolicy` の一部）`exitDuration` `persist` `transition`（FX id）`fonts` `hideHud` `followCamera` `adaptText` と、フック `background` `backDecor` `frontDecor` `line`（`use: 'look'` 以外は必須）`overlay` `postFx(g, post)` `lyricFx(g, post)` `title(g, p)`

`PostParams`：`bloom` `bloomThreshold` `chroma`（px@1080p）`grain` `scanline` `vignette` `glitch` `contrast` `saturation` `brightness` `invert` `flash` `radialBlur` `mirror` `pixelate` `hue`（既定は `DEFAULT_POST`）

`CameraPolicy`（オート演出の癖）：`cut` `shotBars` `pool`（'full'|'bust'|'face'|'left'|'right'|'low'|'tilt'|'duo'|'hide'）`bounce` `drift` `tilt` `effects`（立ち絵がオートのときのエフェクト id：'shadow'|'outline'|'glow'|'slice'|'silhouette' やプラグインの id）`bgBlur` `bgDim` `grade` `center`

## カメラ：CameraPose / FramingDef / CameraMoveDef

`CameraPose`：`{ x, sy, fy, zoom, rot }`。画像の高さ `fy`（0=上端, 1=下端）の点を画面の高さ `sy`・横 `x`（W の割合）に置く。`zoom` 1 ≒ 全身が画面の高さ、2.7 ≒ 顔アップ。`rot` ラジアン。

`FramingDef`：`id` `name` `key?`（'z'|'x'|'c'|'v'|'b' のどれかを希望）`pose(c)` → `{ sy, fy, zoom, rot }`（`x` は無視）　`lookTilt?`（既定 true：ルックの `policy.tilt` による少しの傾きを後から足す。自分で傾けるフレーミングは false）

`FramingCtx c`：`faceY`（顔の位置、画像の高さの割合）`p`（次のフレーミングまで・最大8小節の進み 0..1）`seed` `policy`（ルックの `CameraPolicy`）

`CameraMoveDef`：`id` `name` `key?`（'p'|'['|']'|'n'|'m'|'l'）`apply(pose, c)` → ポーズを書き換えて何も返さないか、新しいポーズを返す

`CameraMoveCtx c`：`p`（進み 0..1）`t`（秒）`beat` `drift`（ルックの揺れの量、1 が標準）`seed`

組み込み（同じ id で登録すると置き換わる。`auto` は予約）：フレーミング `wide` `full` `knee` `bust` `face` `low` `tilt`、動き `static` `push` `pull` `pan` `rise` `handheld` `roll` `beat`

## Palette

`registerPalette({ id, name, bg, text, accent, accent2 })`。色は `#rrggbb`。組み込みは `midnight` `cyber` `sakura` `sunset` `lemon` `ocean` `mono` `paper`（同じ id で登録すると置き換わる）。`custom` `auto` は予約で使えない。描画側では `g.pal`。

## FxDef / FxState

`FxDef`：`id` `name` `key?`（希望キー 1文字）`color` `duration` `unit?`（'sec'|'beat'）`lead?`（前倒し秒、トランジション用）`holdable?`（長押しで延長）`hidden?`（キーに出さない＝トランジション専用。スタイルの `transition: 'id'` で、そのルックのセクションが始まるときに出る）`apply?(s)` `draw?(g, s)`

`FxState s`：`age` `p`（0..1）`dur` `post`（足し込む）`camera`（`{x,y,zoom,rot}` に足し込む）`elements`（`{ lyrics, telop, chara }` それぞれ `MotionOffsets`：その要素だけ動かす。`dx dy rot` は足す、`sx sy alpha` は掛ける）`beat` `intensity` `seed` `rand(...)`

プラグインの FX は FX トラックの空きキー `c v b n m`、それより多い分はキーなし（キーパネル・メニュー・インスペクタから）。

## エフェクト：EffectDef / EffectCtx（歌詞・テロップ・立ち絵）

`EffectDef`：`id`（空白・カンマ不可、`auto` `none` 予約）`name` `key?`（'i'|'o'|'p'|'['|']'。歌詞・テロップは 'u' も）`targets?`（`['lyrics','telop','chara']` の一部。省略時は全部）`flat?`（立ち絵の色なじませを切る）と、フック（1つ以上）`image?(g, e)` → 差し替え画像 / `under?(g, e)` 後ろ / `body?(g, e)` 本体を描く（最後に登録されたもの）/ `over?(g, e)` 上。重なりは登録順（組み込み：glow → shadow → outline → slice(body) / silhouette(image)）

`EffectCtx e`：`target` `img`（立ち絵のスプライト／歌詞・テロップの文字だけの全画面層。image() の後は差し替え後）`x` `y` `w` `h`（g.ctx 上の描く位置）`scale`（画像1px の描画サイズ）`age`（オンにしてからの秒）`seed` `silhouette(色)` → canvas `outline(色, 太さ?)` → `{ c, pad }` `glow(色)` → `{ c, pad }` `mask((ctx, w, h) => 塗り, key?)` → 形で切り抜いた canvas `draw(画像, pad?)`（要素の位置に描く）

- `g.ctx` は各フックの描き先（位置合わせ済み、save / restore 済み）。部分反転オン時：under → 下地層、body / over → 文字層。
- `silhouette` / `outline` / `glow` は色ごとに保存される（1要素16枚まで）。毎フレーム色が変わる塗りは `mask(fn, key)`。
- 組み込み id：`shadow`（影）`outline`（縁取り）`glow`（グロー）`slice`（スライス）`silhouette`（シルエット）

## モーション：MotionDef / MotionCtx / MotionOffsets

`MotionDef`：`id`（空白・カンマ不可、`auto` 予約）`name` `key?`（'j'|'k'|'l'。立ち絵は 'h' も）`targets?` `offsets(c)` → `Partial<MotionOffsets>`

`MotionOffsets`：`dx` `dy`（px）`rot`（ラジアン）`sx` `sy`（拡大）`alpha`（0..1）。中心：歌詞＝テキスト領域の中央、テロップ＝`TelopDef.pivot`（省略時は画面中央）、立ち絵＝フレーミングの基準点

`MotionCtx c`：`target` `t` `age`（そのモーションになってからの秒）`beat` `audio` `u` `amount`（録音値 1.5、立ち絵のオートはルックの bounce）`seed`

- 組み込み id：`idle`（静止）`bounce`（バウンス）`sway`（ゆらゆら）`float`（ふわふわ）`hop`（ジャンプ）`shake`（ブルブル）
- キー（組み込み）：立ち絵 Z行（`M` オート）、歌詞・テロップ A行。エフェクトは3トラックとも `Q`〜`T`・`Y` なし（立ち絵は `U` オート）

## VisualizerDef / VizCtx

`VisualizerDef`：`id` `name` `color` `draw(g, v)`

`VizCtx v`：`area`（描く範囲 px）`cx` `cy`（中心。'around' ではキャラ）`pos`（'bottom'|'center'|'top'|'around'|'full'）`size`（0.65/1/1.45）`alpha` `color(k)`（位置 k=0..1 の色）`flip`（上に置いたとき下向きに伸ばす）`age` `seed`

## TelopDef / TelopCtx

`TelopDef`：`id` `name` `color` `bars`（既定の長さ・小節）`exitDur?` `pivot?`（`{ x, y }` W / H の割合。テロップのモーションの中心、省略時は画面中央）`draw(g, t)`

`TelopCtx t`：`text`（{title}/{artist} 置換済み）`sub` `lines`（本文を " / " で分割）`age` `dur` `out`（退場からの秒、表示中は負）`outK`（0→1）`index` `seed`

一覧の書き方：`[型] 本文 | サブ`。型は id か名前（登録した `name` でも可）。

## api.lib（`src/engine/lib.ts`）

- 数値：`clamp(v, a=0, b=1)` `lerp(a, b, t)` `invLerp` `smoothstep` `prog(age, dur)`（= clamp(age/dur)）`TAU` `deg`
- イージング：`ease.linear` `inQuad` `outQuad` `inOutQuad` `inCubic` `outCubic` `inOutCubic` `inQuart` `outQuart` `inOutQuart` `outQuint` `inExpo` `outExpo` `inOutExpo` `inSine` `outSine` `inOutSine` `outBack(x, s?)` `inBack` `outElastic` `outBounce`
- 決定的な乱数：`hash(...n)` `hashStr(s)` `rng(seed)` `pick(arr, r)` `range(r, a, b)` `noise1(x, seed?)`（-1..1 のなめらかなノイズ）
- 色：`hexToRgb` `rgbToHex` `rgba(hex, a)` `mix(a, b, t)` `luminance` `onColor(bg, dark?, light?)`（背景の上で読める文字色）
- 文字：`graphemes(s)` `isCJKChar` `isCJK` `font(weight, size, family)` `width100` `fitSize(ctx, text, weight, family, maxW, maxSize, minSize?, spacingEm?)` `glyphRun(ctx, text, weight, family, size, spacing?)` → `{ glyphs:[{g,x,w,cx}], width }` `verticalRun`（縦書き）`drawGlyph`
- 図形：`roundRect(ctx, x, y, w, h, r)`（パスを作るだけ。fill は自分で）`polygon` `star` `softDot(size?, hardness?)`（ぼけ玉の画像）`tinted(img, color, key)` `makeCanvas`
- 層：`onPlate(g, (pl) => ...)`（文字の下地を plate 層へ）`scoped(ctx, fn)`（save/restore）
- その他：`resolveTimes` `fmtTime`

## api.helpers（`src/engine/helpers.ts`）

- `lineGlyphs(l, stagger)` → チャンクごとの `[{ g, chunk, j, k, tg }]`（叩いた文字は叩いた時刻、未入力は stagger 間隔で補完）
- `makeRows(l, { maxRows, maxLen, perChunk, stagger })` → 行の配列（`perChunk: true` は幅が揃うよう分割、`/` の行は維持）
- `rowText(row)` → 行の文字列
- `exitK(l)` → 退場の進み 0..1
- `hitPulse(l, decay?)` → 叩いた直後 1 から減衰
- `latestLine(g)` → いちばん新しい表示中の行
