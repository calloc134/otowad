# core と WASM 境界

## 1. core の責務

`core/` はこのプロジェクトのドメイン中核です。責務は大きく 5 つあります。

- 保存正本の型を定義する
- 編集 command の意味論を定義する
- compile 時に不変条件を検証する
- Runtime と pitch plan を決定的に導出する
- UI から利用できる WASM API を公開する

重要なのは、`core/` は React や IndexedDB や Web Worker を知らないことです。

## 2. 主要ファイルと責務

| ファイル | 責務 |
| --- | --- |
| `core/src/edit.rs` | `ProjectDocument`、`ProjectEdit`、各種 domain 型 |
| `core/src/commands.rs` | `Command`、`apply_command`、undo/redo の inverse 構成 |
| `core/src/compiler.rs` | compile、検証、`ProjectRuntime` 導出 |
| `core/src/runtime.rs` | runtime 型定義 |
| `core/src/time.rs` | 時間型と決定的な tick->frame 変換 |
| `core/src/analysis.rs` | F0 / pitch marks / waveform peaks artifact と解析処理 |
| `core/src/pitch.rs` | MIDI follow 用の `PitchSegmentRt` 生成 |
| `core/src/api.rs` | plain Rust API |
| `core/src/wasm_bridge.rs` | JSON と `JsValue` ベースの WASM 境界 |

## 3. Edit / Compile / Runtime の分離

## 3.1 Edit

Edit は保存される唯一の正本です。

- `ProjectDocument`
- `ProjectEdit`
- `TrackEdit`
- `ClipEdit`
- `ContentEdit`

## 3.2 Compile

Compile は単なる変換ではなく、「検証と導出」をまとめた境界です。

`core/src/compiler.rs` は以下を行います。

- schema version 検証
- tempo 制約検証
- ID 一意性検証
- reference 整合性検証
- clip / track kind 一致検証
- pitch link 制約検証
- routing cycle 検証
- frame 化
- warp plan 展開
- pitch segment 生成
- automation target 解決

## 3.3 Runtime

Runtime は再生用の一時データです。

- `ProjectRuntime`
- `TrackRuntime`
- `ClipRuntime`
- `WarpPlanRt`
- `PitchSegmentRt`
- `AutomationLaneRt`

Runtime は保存しません。ここがこの設計の大前提です。

## 4. command モデル

## 4.1 semantic command が public surface

`core/src/commands.rs` には多くの `Command` variant がありますが、設計上は以下の区別があります。

- public semantic command
  - 例: `move_clip`, `split_clip`, `audio_red_trim`, `midi_red_trim`, `set_grid_settings`
- internal inverse-only command
  - 例: `_restore_clip`, `_restore_track`, `_set_clip_state`, `_unsplit_clip`

public bridge から internal command を受けないのが現在のルールです。

## 4.2 なぜこの区別が必要か

理由は次の通りです。

- UI から意味論を壊す raw mutation を防ぐ
- undo/redo に必要な低レベル復元 command は持ちつつ、普段の public API には漏らさない
- semantic command を中心にしてテストしやすくする

`core/src/wasm_bridge.rs` の `is_public_command()` がこの境界を守っています。

MIDI note command は `content_id + note_id` で対象を指定し、配列 index を wire
contract にしません。`remove_midi_note` の inverse は note 配列全体の snapshot を
swap するため、保存前正規化で note 順が変わっても undo/redo は Edit JSON を完全復元します。
`add_midi_note` と MIDI `add_content` は mutation 前に `start >= 0`、`length > 0`、
`key / vel = 0..=127` を検証し、違反時は `INVALID_MIDI_NOTE` を返します。同じ検証を
compile 境界でも行うため、command を迂回した Edit JSON も runtime へ流れません。
MIDI content は複数 clip が異なる window で共有できるため、note と個別 clip window の
包含関係はこの検証へ含めません。

`split_clip` は audio fade を左右へ分配する前に、左 child の `fade_in` と右 child の
`fade_out` がそれぞれの新しい長さへ収まることを検証します。検証は mutation より先に行い、
失敗時は `INVALID_FADE_RANGE` を返して Edit JSON を一切変更しません。

## 4.3 Track 削除の cascade と inverse

`remove_track` は、その track が所有する clip に加え、`midi_track` または `audio_track` としてその track を参照する pitch link も同時に削除します。`_restore_track` は track、clip、pitch link とそれぞれの元の配列位置を保持し、undo で Edit JSON 全体を完全復元します。

## 4.4 Pitch link 作成時の検証

`add_pitch_link` は mutation 前に link ID の一意性、source / target track の存在、source が MIDI かつ target が Audio であること、同じ Audio track を target とする link が未登録であることを検証します。Compile 境界でも同じ制約を再検証し、command を経由しない不正な Edit JSON を runtime に流しません。

## 4.5 command の property-based contract

`core/src/commands.rs` の property test は、全 55 `Command` variant を生成した複数の
有効 Edit 状態へ適用し、次の不変条件を継続的に検査します。

- `apply(command)` → `apply(inverse)` が元の Edit JSON を完全復元する
- 復元後に同じ command を再適用すると、最初の適用後と同じ Edit JSON になる
- reject された command は Edit JSON を変更しない
- `Batch` 内の途中で reject された場合、それ以前に成功した command もすべて rollback される

variant 数と kind の集合を harness で明示し、列挙した往復ケースとの一致も検査します。
Command を追加したら kind の exhaustive match、期待集合、往復ケースのすべてを更新しなければ
テストを通せません。

## 5. plain Rust API と WASM API の分離

## 5.1 `core/src/api.rs`

`api.rs` は Rust 型を直接扱う内部 API です。

- `create_project_document`
- `serialize_project_document`
- `serialize_project_document_for_save`
- `validate_project_document`
- `compile_project_runtime`
- `apply_project_command`
- `analyze_f0_samples`
- `generate_pitch_marks_from_samples`

この層は Rust の型安全を保ったまま利用できます。

## 5.2 `core/src/wasm_bridge.rs`

`wasm_bridge.rs` は JS から使う JSON / buffer ベースの橋渡しです。

- `create_project`
- `validate_project`
- `load_project`
- `serialize_project_for_save`
- `apply_command_json`
- `apply_internal_command_json`
- `compile_pitch_plan_json`
- `analyze_f0_json`
- `analyze_f0_buffer`
- `analyze_f0_buffer_with_backend`
- `analyze_f0_buffer_with_profile`
- `generate_pitch_marks_buffer`

これは全量です。増減したときは `core/src/lib.rs` の `#[wasm_bindgen]` 関数と突き合わせてください。F0 系が4つあるのは、backend と profile の指定方法が異なるためです。通常経路が使うのは `analyze_f0_buffer_with_profile` です(`06` §3.2)。

ここでは Rust 型をそのまま公開するのではなく、JSON や `Float32Array` へ落として受け渡します。

## 5.3 なぜ `compile_pitch_plan_json` なのか

現状の UI が必要としているのは、core 全体 Runtime よりも「audio clip の warp/pitch 計画」です。

そのため WASM 側は以下を返します。

- `sample_rate`
- `audio_clips`
- `pitch_plan`

この payload を `ui/src/audio/pitchPlan.ts` が clip render plan に変換します。

## 6. core が担当するもの / しないもの

## 6.1 core が担当するもの

- 保存正本の構造
- command semantics
- split / trim / stretch / pitch follow の意味決定
- deterministic な時間変換
- compile-time validation
- F0 / pitch marks 生成

## 6.2 core が担当しないもの

- React state
- gesture 解釈
- IndexedDB 保存
- zip build のブラウザ実装
- Web Worker orchestration
- WebAudio node の接続
- 実際の TD-PSOLA 合成処理

最後の点は重要です。TD-PSOLA 本体は frontend にあります。つまり、pitch 処理の「意味決定」は core だが、「音をどう変形するか」は frontend/audio 側です。

どのファイルが本体かは backend によって変わります。既定は `ui/src/audio/tdpsolaV2/v2Adapter.ts` の `source_native_v2` で、`ui/src/audio/tdpsola.ts` の `legacy_v1` は回帰比較と明示的ロールバック用です。backend の選択規則は `06` が正本なので、ここでは列挙しません。

## 7. WASM の責務はどこまでか

現行実装に即して言うと、WASM の責務は以下までです。

- project document の生成、検証、保存用 serialize
- command の適用
- F0 解析と pitch marks 生成
- pitch / warp compile plan の導出

ここから先は UI 側の責務です。

- command をいつ発行するか
- どの UI 状態をどう見せるか
- media をどう decode / cache するか
- heavy job を worker にどう逃がすか
- compile 済み plan をどう TD-PSOLA / direct render に流すか

## 8. TypeScript mirror の重要性

`ui/src/types/project.ts` は Rust serde 形式を mirror する型ファイルです。

これは単なる補助型ではありません。実質的な JSON 契約です。

- Rust の enum tag と TS の discriminated union が一致している必要がある
- 数値型の意味を TS 側も共有する必要がある
- command 名を変えたら TS 側も追従が必要

リファクタ以前はこの drift が問題になっていました。現在はこの mirror を契約として強く意識する方針です。

## 9. core 側で変更すべきテーマの例

以下の変更は UI ではなく core で扱うべきです。

- clip split / trim / stretch の意味変更
- warp anchor の意味変更
- MIDI note crossing 禁止規則の変更
- pitch follow セグメント生成ルールの変更
- Tick -> Frame 丸め規則の変更
- analysis artifact 契約の変更

逆に、次のような変更は主に UI 側です。

- long-press の時間
- touch 向けボタン表示
- dialog の見た目
- busy overlay の表示方法

## 10. 新規開発者への指針

「この機能は UI で頑張るべきか、core で直すべきか」で迷ったら、次の基準で判断できます。

- 保存 JSON の意味が変わるなら core
- command の意味が変わるなら core
- compile 結果が変わるなら core
- 単に入力方法や表示方法が変わるだけなら UI

この判断を誤らないことが、長期保守で最も重要です。
