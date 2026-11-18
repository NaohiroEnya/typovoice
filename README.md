# TYPO CAM

空間に言葉を置いて、思い出を残すARタイポカメラ。

スマートフォンのブラウザで開くとすぐARカメラが起動し、好きな言葉・フォント・色を選んで現実空間に立体文字を置き、写真や動画として保存できます。
[Font Photo AR](https://github.com/NaohiroEnya/Font-Photo-AR) の8th Wall構成(6DoF SLAM + three.js)をそのままベースにしており、iOS Safari(WebXR未対応)でもネイティブアプリなしで空間固定ができます。

## 機能

右側の縦ツールバーに6つの項目があります。

| 項目 | 役割 | 選択肢 |
| --- | --- | --- |
| **TEXT** | 何を置くか | 任意テキスト(20文字まで) |
| **PRESET** | 下の4項目を一括設定 | Plain / Pop / Cute / Cool / Elegant / Emotional / Natural / Bold / Retro |
| **FONT** | 文字の声色 | 明朝 / 太ゴシック / ゴシック / 丸ゴシック / 手書き / コンデンス / レトロ |
| **COLOR** | 世界観 | 白 / クリーム / 黒 / 朱 / オレンジ / 黄 / 緑 / 青 / ピンク / ゴールド |
| **PLACE** | 空間との関係 | GROUND(地面に置く) / AIR(空中に浮かべる) |
| **MOTION** | 文字の振る舞い | STATIC / FLOAT(ふわふわ) / POP(弾む) / DRAW(書き出す) |

- 起動時は Plain(ゴシック・白・AIR・STATIC)のプレーンな状態
- プリセットを選ぶと FONT / COLOR / PLACE / MOTION と立体感(厚み・質感・発光)がまとめて切り替わり、そこから各項目を個別に変更できる
- 空間をタップするとその位置に3D文字を配置(各項目のシートが開いている間は、シートの外をタップするとまずシートが閉じる)。GROUNDはタップした地面の上に立て、AIRはタップした方向の空中(最大1.6m先)に浮かべる
- 配置後は文字をドラッグで移動(GROUNDは地面に沿って、AIRは画面の上下左右に)、ピンチで拡大・縮小、2本指でひねって回転。何もない所をタップで選択解除、ゴミ箱で削除
- 文字を選択中に各項目を変えると、その文字がその場で更新される(PLACEを切り替えると地面に降りる/浮き上がる)
- フォント・プリセット・モーションの選択肢は、入力中の言葉そのものでプレビュー(モーションはCSSアニメーションで動きも確認できる)
- **写真** — カメラ映像+AR文字だけを撮影(ツールUI・ガイド・選択リングは含まない)。撮影後のプレビューから保存
- **動画** — 写真/動画を切り替えてシャッターで録画開始・停止(最大60秒)。録画中はシャッター以外のUIを非表示
- **レシピ共有** — 左上「レシピ」から、今の文字設定(テキスト・フォント・カラー・スタイル・サイズ)をURLで共有。開いた人は同じ設定で自分の場所に置いて撮影できる

## 使い方

1. `npm install`
2. `npm run serve`
3. スマホ実機で確認する場合は[こちらの手順](https://8th.io/test-on-mobile)に従ってHTTPS経由で接続してください

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 8th Wall エンジン/XRExtras/LandingPage の読み込み(既存のまま)と、カメラ上に重ねるUIのDOM |
| `src/app.js` | 8th Wall パイプラインの起動(既存のまま)、現在の文字設定の保持、UI・ARシーン・録画の接続 |
| `src/scene.js` | 8th Wall カメラパイプラインモジュール。タップ配置(GROUND/AIR)・ドラッグ・ピンチ/回転・選択・モーションの毎フレーム更新・写真キャプチャ・録画フレームフック |
| `src/pose-filter.js` | カメラ姿勢の手ブレ・トラッキングノイズを抑えるフィルタ |
| `src/motion.js` | MOTION(STATIC / FLOAT / POP / DRAW)のアニメーション |
| `src/text-plane.js` | opentype.js でフォントのアウトラインを取り出し、three.js で押し出した3D文字メッシュを生成 |
| `src/ui.js` | ツールバー・各シート・文字入力・シャッター・撮影結果・レシピ画面(DOMのみ、XRには依存しない) |
| `src/run-recorder.js` | [Font AR](https://github.com/NaohiroEnya/Font-AR) の録画モジュール。ARキャンバスを毎フレーム2Dキャンバスへ写して MediaRecorder で録画 |
| `src/fonts.js` / `colors.js` / `presets.js` | フォント・カラー・PLACE/MOTIONの選択肢・プリセットの定義 |
| `src/recipe.js` | レシピ ⇔ URLクエリ(`?text=&preset=&font=&color=&place=&motion=&size=`)の変換 |

### 仕組み

- **文字配置** — タップ方向のレイと地面(y=0)の交点を求め、GROUNDならそこに、AIRならレイ上の1.6m先(地面が近ければそこまで)に3D文字のグループを置く。向きはその時のカメラの水平方向だけを使い、文字は常に直立する。SLAMで空間に固定される。地面には影だけ映す透明な平面があり、AIRの文字も足元に影が落ちる
- **ライティング・質感** — 文字は表面と側面(押し出しの厚み)で別マテリアルにし、側面は表面色を暗くして発光も抑えているため、厚みが陰として見える。縁には細いベベルを付けて光を拾わせている。光源は空間に固定したキーライト(影を落とす)+空/地面の照り返し+カメラ側からの弱い補助光、さらに室内の環境マップ(RoomEnvironment)で面ごとの陰影と反射を付けている。地面に接する部分には柔らかい接地影を敷き、空中の文字では高さに応じて薄く広がる
- **姿勢の安定化** — 8th Wall のSLAMが出すカメラ姿勢には毎フレーム数mmのノイズがあり、XR8.Threejs はそれをそのままカメラに反映するため、静止した文字が細かく震えて見える。自前のパイプラインモジュールの `onUpdate`(XR8.Threejs がカメラを更新した直後・描画前)で One Euro フィルタをかけ、静止時は強く平滑化、動いている時はほぼ素通しにしている。ノイズの大きい位置を主に平滑化し、ジャイロ由来で安定している回転は軽くだけ。トラッキングのリセットなど大きなジャンプはそのまま反映する
- **モーション** — 各文字は「グループ(ユーザーの移動・拡大・回転) → モーション用ノード(アニメーション) → 文字メッシュ」の三層構造で、パイプラインの `onUpdate` で毎フレームモーション用ノードだけを動かす。DRAW は文字のマテリアルにクリッピング平面を付けて左から右へ掃引している(影も一緒に切れる)。配置時・モーション変更時は弾むように出現する。写真・動画にもそのまま写る
- **写真** — `scene.js` のパイプラインモジュールを XR8.Threejs の後に登録しているため、その `onRender` 時点でキャンバスにはカメラ映像+ARシーンが描画済み。そこで `toDataURL()` するので DOM の UI は写らない。選択リングだけはシーン内のオブジェクトなので撮影の瞬間だけ非表示にする
- **動画** — 同じ `onRender` から毎フレーム `run-recorder.js` の `captureFrame()` を呼んで録画用キャンバスへ描画。iOS Safari では MP4、それ以外は WebM
- **保存** — Web Share API でファイル共有できる環境(iOS Safari など)では共有シートから「画像を保存」/「ビデオを保存」、それ以外はダウンロード
- **レシピ** — 配置座標は含めず、文字・プリセット・フォント・カラー・PLACE・MOTION・サイズをURLクエリに載せる。省略・未知の値はプリセットの値(なければ既定値)で補う

## デプロイ

`main`ブランチにpushすると、GitHub Actions経由でGitHub Pagesに自動デプロイされます(`.github/workflows/deploy.yml`、リポジトリ設定で Pages のソースを GitHub Actions にする必要があります)。
手動でビルドする場合は `npm run build` を実行し、`dist`フォルダを任意のホスティング先に配置してください。

## フォントについて

`src/assets/fonts/`に同梱しているフォントは、いずれも常用/教育漢字・かな・ASCIIの範囲でサブセット化しています(範囲外の文字は表示されません)。「コンデンス」は Noto Sans JP を横方向に62%に縮めて作っています。

- Noto Serif JP(明朝) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/notoserifjp/OFL.txt)
- Dela Gothic One(太ゴシック) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/delagothicone/OFL.txt)
- Noto Sans JP(ゴシック/コンデンス) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/notosansjp/OFL.txt)
- Zen Maru Gothic(丸ゴシック) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/zenmarugothic/OFL.txt)
- Yusei Magic(手書き) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/yuseimagic/OFL.txt)
- Zen Antique(レトロ) — [SIL Open Font License](https://github.com/google/fonts/blob/main/ofl/zenantique/OFL.txt)

## 既知の制約

- SLAM部分はコンパイル済みバイナリとして配布されており、ソースは非公開。将来のOS/ブラウザ更新で不具合が出た場合、自前での修正はできない
- 文字は地面(推定された床面)の上に立てるか、空中に浮かべる。壁や机の面への貼り付けには対応していない
- 「ゴシック」は通常ウェイト(400)。極細のゴシックや Didone 系の書体は同梱していない(Elegant は明朝で代用)
- DRAW は文字全体を左から右へ現す表現で、一画ずつの書き順アニメーションではない
- 動画は映像のみ(音声なし)、最大60秒
- 現状は無料・非収益のコンテンツとしての利用を前提としている(利用ライセンスの詳細は配布元の [LICENSE](https://github.com/8thwall/engine/blob/main/LICENSE) を参照)
