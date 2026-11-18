# TYPO VOICE

声が文字になって、空間に浮かぶ。ARボイスメッセージのプロトタイプ。

短いメッセージを話すと、その言葉が3D文字としてAR空間に現れ、ふわふわ浮遊します。文字の見た目と動きは声の出し方で変わります。大きな声なら大きく太く弾み、ささやき声なら小さく丸くゆっくり漂います。

[TYPO CAM](https://github.com/NaohiroEnya/typocam) の8th Wall構成(6DoF SLAM + three.js + opentype.jsによる3D文字)をそのまま流用しています。

## 使い方

1. スマホのブラウザで開く(iOS Safari / Android Chrome)。カメラとマイクを許可
2. 下のマイクボタンをタップして話す。話している間は字幕が出る
3. 話し終える(またはもう一度タップ)と、カメラの正面に文字が現れて浮かぶ。空間に固定されるので、周りを歩いて見られる
4. 文字はドラッグで移動、ピンチで拡大縮小・回転できる。右上のゴミ箱で全部消す

音声認識に未対応のブラウザでは、マイクボタンで文字入力になります(「!」が多いほど大きな声扱い)。

## 開発フェーズ

- [x] **Phase 1** — 音声入力 → 文字認識 → AR空間に文字表示 → 浮遊アニメーション
- [x] **Phase 2** — 声の特徴で文字の見た目・動きを変える
- [ ] **Phase 3** — AR表示と音声を一緒に録画・保存
- [ ] **Phase 4** — 録画結果を共有しやすい形にする

### 声 → 文字の対応(Phase 2)

| 声の特徴 | 測り方 | 文字への反映 |
| --- | --- | --- |
| 大きさ (loudness) | 発話中の平均音量(dBFS) | サイズ・厚み。大きいと太ゴシックになり、叫ぶと黄色く光る。大きくて抑揚があると弾む(POP) |
| やわらかさ (softness) | スペクトル重心が低いほどやわらかい | 丸ゴシック・マットな質感・ゆっくりした浮遊。小さくやわらかいと淡いパステル |
| 抑揚 (liveliness) | 音量の変動係数 | 浮遊の振れ幅・揺れの大きさ・速さ |

声の印象(「大きな声」「ささやき声」など)は、文字が出た直後に小さなタグで表示されます。

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 8th Wall エンジン/XRExtras/LandingPage の読み込み(TYPO CAMのまま)と、マイクボタン・字幕のDOM |
| `src/app.js` | 8th Wall パイプラインの起動(TYPO CAMのまま)、音声認識・声の解析・ARシーンの接続、メッセージの折り返し |
| `src/speech.js` | Web Speech API(`SpeechRecognition`, `ja-JP`)で1メッセージを認識。途中経過と確定結果を返す |
| `src/voice-analyser.js` | 認識と並行してマイクを Web Audio の AnalyserNode で解析し、大きさ・やわらかさ・抑揚(0..1)を求める |
| `src/voice-style.js` | 声の特徴 → フォント・色・質感・サイズ・モーションのパラメータ |
| `src/scene.js` | TYPO CAMの8th Wallカメラパイプラインモジュール。`spawnInFront`(カメラ正面に文字を出す)と`clearAll`を追加 |
| `src/text-plane.js` | opentype.js + three.js で押し出した3D文字。改行(複数行)に対応 |
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

`src/assets/fonts/` のフォントはいずれも [SIL Open Font License](https://openfontlicense.org) です(Noto Sans JP / Noto Serif JP / Dela Gothic One / Zen Maru Gothic / Yusei Magic / Zen Antique)。
