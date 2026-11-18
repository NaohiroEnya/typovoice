# TYPO VOICE

声が文字になって、空間に浮かぶ。ARボイスメッセージのプロトタイプ。

短いメッセージを話すと、その言葉が3D文字としてAR空間に現れ、ふわふわ浮遊します。文字の見た目と動きは声の出し方で変わります。大きな声なら大きく太く弾み、ささやき声なら小さく丸くゆっくり漂います。

[TYPO CAM](https://github.com/NaohiroEnya/typocam) の8th Wall構成(6DoF SLAM + three.js + opentype.jsによる3D文字)をそのまま流用しています。

## 使い方

1. スマホのブラウザで開く(iOS Safari / Android Chrome)。カメラとマイクを許可
2. 左の丸ボタンで文字の色を選ぶ(TYPO CAMと同じ10色。選んだ色は次回も保持)
3. 下のマイクボタンをタップして話す。認識された言葉が、その場でカメラの正面の空間に1文字ずつ現れていく(声が大きい瞬間の文字ほど大きく弾んで出る)
4. 話し終える(またはもう一度タップ)と、文字が声の印象に合わせたフォント・見た目に変わって浮かぶ。空間に固定されるので、周りを歩いて見られる
5. 置いた文字はタップで選択でき、色を変えたり、ドラッグで移動、ピンチで拡大縮小・回転できる。右上のゴミ箱で全部消す

音声認識に未対応のブラウザでは、マイクボタンで文字入力になります(「!」が多いほど大きな声扱い)。

## 開発フェーズ

- [x] **Phase 1** — 音声入力 → 文字認識 → AR空間に文字表示 → 浮遊アニメーション
- [x] **Phase 2** — 声の特徴で文字の見た目・動きを変える
- [ ] **Phase 3** — AR表示と音声を一緒に録画・保存
- [ ] **Phase 4** — 録画結果を共有しやすい形にする

### 声 → 文字の対応(Phase 2)

声の一番目立つ特徴でフォントが決まります(上から順に判定)。

| 声 | 判定 | フォント |
| --- | --- | --- |
| 大きな声 | 平均音量が大きい | 太ゴシック(Dela Gothic One) |
| 小さな声 | 平均音量が小さい | 細字(Noto Sans CJK JP Thin) |
| 早口 | 1秒あたりの文字数(実際に声が出ていた時間で割る)が多い | コンデンス |
| ハキハキした声 | 音の立ち上がりが鋭く(attack)、明るい音色 | ポップ(Mochiy Pop One) |
| 落ち着いた声 | 抑揚が少なく、立ち上がりが穏やかで、ゆっくり | 明朝(Noto Serif JP) |
| やわらかい声 | スペクトル重心が低い(こもった・息っぽい音色) | 丸ゴシック(Zen Maru Gothic) |
| それ以外 | | ゴシック(Noto Sans JP) |

あわせて、音量でサイズと厚み(叫ぶと少し発光)、抑揚で揺れ幅、やわらかさと話す速さで浮遊の速さが変わります。大きくて抑揚のある声は弾みます(POP)。色はユーザーが選んだものを使います。

声の印象とフォント(「ハキハキした声 · ポップ」など)は、文字が出た直後に小さなタグで表示されます。判定のしきい値は仮の値で、実機の声で調整する前提です。

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 8th Wall エンジン/XRExtras/LandingPage の読み込み(TYPO CAMのまま)と、マイクボタン・字幕のDOM |
| `src/app.js` | 8th Wall パイプラインの起動(TYPO CAMのまま)、音声認識・声の解析・ARシーンの接続、メッセージの折り返し |
| `src/live-text.js` | 話している最中の文字。1文字ずつの3Dグリフをポップさせて並べ、認識結果が書き換わったら変わった所から作り直す。話し終えると溶けて消え、完成メッセージに置き換わる |
| `src/wrap.js` | メッセージの折り返し(ライブ表示と完成メッセージで共通) |
| `src/speech.js` | Web Speech API(`SpeechRecognition`, `ja-JP`)で1メッセージを認識。途中経過と確定結果を返す |
| `src/voice-analyser.js` | 認識と並行してマイクを Web Audio の AnalyserNode で解析し、大きさ・やわらかさ・抑揚・立ち上がり(0..1)と発声時間を求める |
| `src/voice-style.js` | 声の特徴(+話す速さ)→ フォント・質感・サイズ・モーションのパラメータ |
| `src/colors.js` | 文字色の選択肢(TYPO CAMと同じ) |
| `src/scene.js` | TYPO CAMの8th Wallカメラパイプラインモジュール。`startLive`(話しながら文字を出す)・`spawnInFront`(カメラ正面に文字を出す)・`clearAll`を追加 |
| `src/text-plane.js` | opentype.js + three.js で押し出した3D文字。改行(複数行)と、1文字ずつ並べるためのベースライン基準モードに対応 |
| `src/motion.js` | FLOAT / POP など。メッセージごとの速さ・振れ幅を受け取れるようにした |
| `src/pose-filter.js` / `run-recorder.js` / `fonts.js` | TYPO CAMのまま(録画はPhase 3で使用) |

## 開発

```bash
npm install
npm run serve
```

スマホ実機で確認するにはHTTPSが必要です(ngrokなど。`vite.config.js` で `.ngrok-free.dev` を許可済み)。デスクトップでは8th WallのLandingPage(QRコード)が表示されます。

## デプロイ

`main`ブランチにpushすると、GitHub Actions経由でGitHub Pagesに自動デプロイされます(`.github/workflows/deploy.yml`)。

## 既知の制約

- 音声認識はブラウザの機能を使うため、iOS SafariではAppleのサーバ、ChromeではGoogleのサーバに音声が送られます
- 一部のブラウザでは、音声認識と声の解析が同時にマイクを使えないことがあります。その場合は解析を自動で止め、標準の見た目で表示します
- フォントはTYPO CAMと同じく常用/教育漢字・かな・ASCIIのサブセットです(範囲外の文字は表示されません)

## フォントについて

`src/assets/fonts/` のフォントはいずれも [SIL Open Font License](https://openfontlicense.org) です(Noto Sans JP / Noto Sans CJK JP Thin / Noto Serif JP / Dela Gothic One / Mochiy Pop One / Zen Maru Gothic / Yusei Magic / Zen Antique)。いずれも常用/教育漢字・かな・ASCIIの範囲にサブセット化しています。
