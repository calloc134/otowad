# OTOWAD 包括仕様書

## この `spec-public/` の目的

このディレクトリは、**OTOWAD(おとわっど)** —— 音MAD 制作向けのブラウザ DAW —— の実装を、
新規開発者が素早く理解するための包括仕様書です。

- プロダクト要件だけでなく、現行コードがどう責務分離されているかを説明する
- リファクタ後の実装実態を前提に、どこが正本でどこが派生値かを明確にする
- `core/`、`ui/`、worker、persist、render、TD-PSOLA の関係を一続きで読めるようにする
- 将来拡張しやすい点と、まだ schema 先行または未完了の点を区別して記録する

この仕様書は「理想だけを書く文書」ではなく、実装に照らして書かれた実装仕様です。
どの記述がいつ確認されたかは下の「検証状況」を見てください。

## この仕様書の位置づけ

本書は実装に対する契約です。設計の経緯や過去のリファクタ記録は本書の対象外で、
**判断の根拠は常にこの `spec-public/` を正本とします。**

過去の監査レポートや段階的なリファクタ計画は、実装済みの内容が本書へ取り込まれた時点で
役目を終えています。それらを参照しなくても本書だけで実装判断ができるように書いています。
本書と実装が食い違う場合は、勝手に第三の挙動を作らず、先に指摘してください。

## 検証状況

かつてここには「2026-03-09 時点の実装」という単一の基準日が書かれていました。それは機能しません。
文書は別々のタイミングで更新されるので、**一つの日付は古い文書を新しい文書の陰に隠します。**
実際、この基準日が 3 月のままだった一方で `04` には 8 月の確認記録が入っていました。

日付は文書ごとに持たせます。

| 文書 | 最終検証 | 検証範囲 |
| --- | --- | --- |
| `01` 全体アーキテクチャ | 2026-08-11 | 保存正本の定義、worker envelope 参照 |
| `02` データモデリング | 2026-08-11 | track field の実装状況、gain/pan 値域、`render_enabled`、`preserve_formant` の既定 |
| `03` core / WASM 境界 | 2026-08-11 | WASM export 一覧(全量)、TD-PSOLA の所在 |
| `04` UI アーキテクチャ | 2026-08-11 | context 分割、`global.css`、inline style |
| `05` worker / persist / render | 2026-08-11 | envelope、cancellation の実効範囲、worker state 一覧(全量) |
| `06` TD-PSOLA と解析 | 2026-08-11 | 既定 backend、F0 API、formant preservation |
| `07` 時間とキャッシュ | 2026-03-09 | — |
| `08` 拡張性と現状 | 2026-08-11 | track gain/pan、cancellation の status |
| `09` 開発ガイド | 2026-08-11 | worker message ルール、`analysis_refs` 契約、入口ファイル一覧 |

**「検証範囲」は全文ではありません。** その日に実装と突き合わせた項目だけです。表に載っていない
記述は、書かれた時点では正しかったが再確認されていない、と読んでください。

### 更新のルール

- 挙動を変えたら、**その subsystem を所有する文書**を更新し、その行の日付を進める
- 概観文書(`README` / `01` / `03` / `08` / `09`)に事実を再記述しない。詳細文書を指す。
  2026-08-11 の監査で直した約 20 箇所のうち**最大の分類がこれ**で、半数近くを占めました。
  「他文書が所有する subsystem を一行で要約した箇所」が、その subsystem の変更時に
  見直されずに残る、という型です。残りは「自分の担当範囲について書いた記述が、
  移行完了を過大に評価していた」「列挙が全量でなかった」です
- 全文を再確認したのでない限り、他の行の日付は触らない

### 実コード

- `core/src/edit.rs`
- `core/src/commands.rs`
- `core/src/compiler.rs`
- `core/src/runtime.rs`
- `core/src/time.rs`
- `core/src/analysis.rs`
- `core/src/pitch.rs`
- `core/src/api.rs`
- `core/src/wasm_bridge.rs`
- `ui/src/store/useProjectStore.tsx`
- `ui/src/state/projectStores.ts`
- `ui/src/adapters/projectDocument.ts`
- `ui/src/app/deviceInteraction.ts`
- `ui/src/audio/*`
- `ui/src/worker/*`
- `ui/src/persist/*`
- `ui/src/render/*`

## 先に要点だけ知りたい人向けの要約

- この DAW の保存正本は常に `ProjectDocument` / `ProjectEdit` であり、再生用 Runtime やキャッシュは保存しない
- 音声編集の意味論は `core/` にあり、UI は command を組み立てて WASM 経由で core に渡す
- `Tick`、`TimelineFrame`、`SrcFrame` を型で分離し、時間ドメインの混線を防いでいる
- `analysis_refs` によって F0 / pitch marks などの解析アーティファクトを content に結び付ける
- 実際の TD-PSOLA 合成は frontend 側にあり、compile された pitch/warp plan を使ってレンダする。既定は `ui/src/audio/tdpsolaV2/v2Adapter.ts` の `source_native_v2`(詳細は `06`)
- 重い処理は worker に逃がし、保存・再生準備・WAV 書き出しをメインスレッドから切り離している
- UI は React だが、`intents`、`adapters`、`state`、`hooks`、`design-system` に分けて疎結合化を進めている
- 将来拡張の土台はかなり整っているが、可変テンポ、automation 実行、fade の playback 接続などはまだ完全ではない

## 推奨読書順

1. `spec-public/01-architecture-overview.md`
2. `spec-public/02-data-modeling.md`
3. `spec-public/03-core-and-wasm-boundary.md`
4. `spec-public/04-ui-architecture.md`
5. `spec-public/05-worker-persist-render.md`
6. `spec-public/06-tdpsola-and-analysis.md`
7. `spec-public/07-time-and-caching.md`
8. `spec-public/08-extensibility-and-status.md`
9. `spec-public/09-development-guide.md`

## 全体の見取り図

```text
UI event
  -> intents
  -> adapters
  -> WASM bridge
  -> core command apply / compile
  -> ProjectDocument 更新

ProjectDocument + media + analysis
  -> worker prepare_playback
  -> clip render plan
  -> direct render or TD-PSOLA
  -> prepared playback schedule
  -> PlaybackEngine

ProjectDocument + media + analysis
  -> worker build_project_archive
  -> project.json + media/*.wav + optional analysis/*.json

ProjectDocument + media + analysis
  -> worker render_wav_export
  -> projectMixdown
  -> wavEncoder
  -> WAV bytes
```

## 各文書の役割

- `spec-public/01-architecture-overview.md`
  - リポジトリ全体像、層、責務分離、処理フローの鳥瞰図
- `spec-public/02-data-modeling.md`
  - Project/Edit/Clip/Track/Analysis のデータモデリングと単一正本設計
- `spec-public/03-core-and-wasm-boundary.md`
  - core の責務、command semantics、compile、WASM 境界
- `spec-public/04-ui-architecture.md`
  - React 側の責務分離、状態管理、デバイス差分、疎結合化
- `spec-public/05-worker-persist-render.md`
  - 重い処理のオフロード、保存、archive、export の設計
- `spec-public/06-tdpsola-and-analysis.md`
  - F0、pitch marks、TD-PSOLA、render plan の実装詳細
- `spec-public/07-time-and-caching.md`
  - 時間モデル、決定的変換、時間派生キャッシュ
- `spec-public/08-extensibility-and-status.md`
  - 拡張性の評価、未完了点、今後の設計余地
- `spec-public/09-development-guide.md`
  - 新規開発者向けの実装導線、変更時のルール、検証コマンド

## この仕様書で強調する立場

- 正本は `project.json` 相当の Edit モデルである
- runtime、prepared playback、rendered buffer、analysis cache は派生値である
- UI は「見た目」だけではなく、ブラウザ上で動く統合フロントエンドである
- ただしドメイン意味論の最終決定者は `core/` であり、UI はそれを迂回しない
- 現状の物理ディレクトリ配置よりも、論理責務境界を優先して理解する
