# 全体アーキテクチャ概要

## 1. このプロジェクトが目指しているもの

**OTOWAD(おとわっど)** は、ブラウザ上で動作する DAW です。主な対象機能は以下です。

- プロジェクトの新規作成、保存、再読込
- オーディオクリップと MIDI クリップのタイムライン編集
- split、trim、stretch、warp 対応の音声編集
- MIDI から Audio への pitch follow
- TD-PSOLA ベースのピッチ処理
- WAV エクスポート

v1 の思想は「保存モデルを堅く定義し、実行時データはそこから決定的に導出する」です。したがって、このアプリの中心は UI ではなく `ProjectDocument` とその command / compile 契約にあります。

## 2. 大きなレイヤ分離

### 2.1 現在の実装上の層

| 層 | 主な場所 | 主な責務 |
| --- | --- | --- |
| ドメイン正本 | `core/src/edit.rs` | 永続化される project/edit モデル |
| 編集意味論 | `core/src/commands.rs` | command apply、undo/redo 用 inverse command |
| 検証と導出 | `core/src/compiler.rs`, `core/src/pitch.rs`, `core/src/runtime.rs` | Edit から Runtime と pitch plan を導出 |
| Rust API / WASM 境界 | `core/src/api.rs`, `core/src/wasm_bridge.rs` | Rust 型 API と JSON/JS 向け bridge |
| フロントエンド統合層 | `ui/src` 全体 | React UI、worker、persist、render、audio engine |
| 表示と操作 | `ui/src/components`, `ui/src/hooks`, `ui/src/intents` | React 描画、gesture、intent 構築 |
| ブラウザ実行基盤 | `ui/src/worker`, `ui/src/persist`, `ui/src/render` | worker、保存、archive、WAV export |
| 音声処理 | `ui/src/audio` | playback 準備、TD-PSOLA、media/analysis cache |

### 2.2 重要な設計姿勢

- 物理ディレクトリより先に論理責務を分離する
- `core/` はブラウザ UI を知らない
- `ui/` は project mutation を直接書き換えず、command で core を通す
- worker / persist / render は現在 `ui/src` 配下だが、論理的には UI 表示層ではない

## 3. 一番重要なアーキテクチャ原則

### 3.1 保存正本は Edit だけ

**編集状態の正本は `ProjectDocument` だけです。** archive にはそれ以外も入りますが、
それらは正本ではなく、正本が参照している素材です(§5.3)。

- 正本: `ProjectDocument`, `ProjectEdit`, `TrackEdit`, `ClipEdit`, `ContentEdit`
- 正本が参照する素材として archive に同梱: `media/*.wav`, 参照された `analysis/*.json`
- 派生。保存しない: `ProjectRuntime`, `PitchSegmentRt`, prepared playback schedule, rendered clip buffer
- UI 専用。保存しない: playhead、選択状態、ズーム、スクロール、dialog 開閉

区別の基準は「復元に必要か」ではなく **「編集意味論を決めているか」** です。media と analysis は
無いと復元できませんが、意味を決めているのは `ProjectDocument` だけです。だから command が
書き換える対象も `ProjectDocument` だけになります。

この区別が、二重管理による破綻を防ぐ中心です。

### 3.2 Command 経由でしか意味を変えない

Edit は「直接好きに書き換える JSON」ではなく、`Command` の適用対象です。

- UI は semantic command を組み立てる
- core が command を適用し、不変条件を守る
- undo/redo は inverse command を replay する

### 3.3 Compile 境界を持つ

再生・レンダリングに必要な Runtime は compile で導出します。

- Edit: 保存用、可読、安定した JSON
- Compile: 検証と導出
- Runtime: 再生や export のための一時データ

### 3.4 時間ドメインを混ぜない

この設計は時間型の分離を非常に重視しています。

- `Tick`: 編集時間
- `TimelineFrame`: プロジェクト sample rate の再生時間
- `SrcFrame`: メディア sample rate のソース時間

この分離が、warp、pitch follow、split、trim を破綻させない土台です。

## 4. リポジトリ全体の現在地

## 4.1 `core/`

`core/` は Rust で書かれたドメイン中核です。

- `edit.rs`: 正本データ構造
- `commands.rs`: 編集意味論
- `compiler.rs`: 検証と runtime 導出
- `analysis.rs`: F0 / pitch marks 生成
- `pitch.rs`: MIDI follow の pitch segment 生成
- `api.rs`: plain Rust API
- `wasm_bridge.rs`: JS/WASM 向け境界

## 4.2 `ui/`

`ui/` は単なる React 画面ではありません。ブラウザアプリ全体です。

- `components/`: Timeline、TrackList、MidiEditor などの主要画面
- `store/`, `state/`: React Context と reducer/slice
- `intents/`: UI event を command に変換
- `adapters/`: WASM との接続
- `audio/`: 再生準備、分析解決、TD-PSOLA
- `worker/`: 重い処理のオフロード
- `persist/`: archive、IndexedDB、autosave、File System Access
- `render/`: offline mixdown と WAV encode
- `design-system/`: shell 系 UI primitive と token

## 5. 典型的な処理フロー

## 5.1 編集フロー

```text
ユーザー操作
  -> component / hook
  -> intent
  -> adapter
  -> wasm bridge
  -> core apply_command
  -> 新しい ProjectDocument
  -> store 更新
```

この経路により、UI から raw mutator を直接触らない方針が保たれています。

## 5.2 再生フロー

```text
ProjectDocument + media cache + analysis store
  -> worker prepare_playback
  -> compile pitch/warp plan
  -> clip render plan
  -> direct render or TD-PSOLA render
  -> prepared playback schedule
  -> PlaybackEngine.playPrepared()
```

## 5.3 保存フロー

```text
ProjectDocument
  -> analysis_refs 解決済みの canonical document に整形
  -> serialize_project_for_save
  -> project.json
  + media/*.wav
  + optional analysis/*.json
  -> ZIP archive
```

## 5.4 WAV export フロー

```text
ProjectDocument
  -> worker render_wav_export
  -> projectMixdown
  -> shared clip render plan
  -> direct render or TD-PSOLA render
  -> wavEncoder
```

再生準備と export で render plan を共有することが、挙動差の縮小に効いています。

## 6. 現在の構造が持つ強み

初期実装から段階的なリファクタを経て、次の点が現在の構造の要になっています。

- `analysis_refs` が実際に compile/render の正本になった
- semantic command surface が明確になった
- `core/src/api.rs` と `core/src/wasm_bridge.rs` が分離された
- `ui/src/intents`, `ui/src/adapters`, `ui/src/state` が導入された
- worker protocol の envelope が揃った(全フィールドは `05` が正本)
- playback/export で shared clip render plan を使うようになった
- device capability ベースの interaction policy が導入された
- shell 系の design-system primitive が整備された

## 7. 現在のアーキテクチャの評価

## 7.1 強い点

- 正本と派生値の区別が明確
- core が UI に引きずられず、意味論を保持している
- worker により重い処理を逃がせる
- TD-PSOLA の高リスク領域が render plan と diagnostics で観測しやすくなった
- device ごとの差分が「別 UI」ではなく policy で表現されている

## 7.2 注意点

- `ui/src/worker`, `ui/src/persist`, `ui/src/render` は物理的にはまだ `ui/` 配下にある
- complex editor surface (`Timeline`, `ClipView`, `MidiEditor`) は design-system 適用が限定的
- 可変テンポや automation 実行など、schema はあるが実機能が薄い領域がある

## 8. 新規開発者が最初に持つべき理解

このプロジェクトでは、見た目の React コンポーネントより先に以下を理解するのが重要です。

1. `ProjectDocument` が唯一の保存正本である
2. command apply は core で行う
3. compile が Edit から Runtime を作る
4. worker は UI の裏にある計算基盤である
5. TD-PSOLA は UI/audio 側にあるが、入力契約は core compile の結果に従う

この 5 点を押さえると、コードベース全体の見通しが急に良くなります。
