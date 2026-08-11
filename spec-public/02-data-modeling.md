# データモデリング

## 1. このプロジェクトのモデリング思想

この DAW のデータモデリングは、次の 3 つを同時に満たすように設計されています。

- 編集中に意味が壊れにくいこと
- 保存形式が安定していて Git 差分に強いこと
- 再生やレンダリングに必要な情報を compile で決定的に導出できること

そのため、保存モデルは必要最小限の正規形に保ち、速度比や runtime cache のような派生量は保存しません。

## 2. 集約ルート

トップレベルの保存単位は `core/src/edit.rs` の `ProjectDocument` です。

```text
ProjectDocument
- schema_version
- meta: ProjectMeta
- edit: ProjectEdit
```

`ProjectEdit` は次の主要コレクションを持ちます。

- `tracks`
- `media`
- `contents`
- `clips`
- `routing`
- `automation`
- `pitch_links`

これらは `Vec` 相当の配列で保持され、順序自体が意味を持ちます。

### 2.1 現行 project schema

現行の `ProjectDocument` は schema v4 です。v4 では次を保存形式の契約に含めます。

- `TimePitchModeEdit` は tagged union で、`Voice` だけが `analysis` と `preserve_formant` を持つ
- `MidiNote` は stable `NoteId` を持ち、note command は配列 index ではなく ID を対象にする
- project と command の serde tree は未知フィールドを拒否する

既存ユーザー向けデータがないため、v1/v2/v3 project の migration や dual-read は提供せず、
current schema 以外は明示的に拒否します。これは analysis artifact の schema とは別契約です。
analysis artifact は schema v1 のままとし、将来の解析フィールドを失わないよう未知フィールドを保持します。

## 3. 配列順序が仕様である

`HashMap` や `Record` を正本にせず、配列順序を仕様にしている点が重要です。

- `tracks`: UI 上の上下順
- `clips`: 作成順
- `contents`: 作成順
- `media`: 作成順
- `automation`: 作成順
- `pitch_links`: 作成順

この設計の利点は以下です。

- JSON diff が安定する
- UI 順序と保存順序が一致しやすい
- compile 時に `Id -> index` を別途構築すればよい

## 4. ID モデル

主オブジェクトはすべて ID 参照です。

- `TrackId`
- `ClipId`
- `ContentId`
- `MediaId`
- `FxId`
- `AutomationId`
- `AnalysisId`
- `PitchLinkId`
- `NoteId`

実際には UUID 文字列として JSON 化されます。TypeScript 側では `ui/src/types/project.ts` が Rust serde 形式を mirror しています。

## 5. 時間モデル

## 5.1 3 種類の時間

時間は `core/src/time.rs` で分離されています。

- `Tick`
  - 音楽時間
  - Edit の主時間
- `TimelineFrame`
  - project sample rate 基準のフレーム
  - Runtime の主時間
- `SrcFrame`
  - media sample rate 基準のフレーム
  - 音声 source の時間

この分離は、split、warp、pitch follow、trim を安全にするための基礎です。

## 5.2 決定的な Tick -> Frame 変換

`core/src/time.rs` の `tick_to_frame_floor()` は整数演算で frame を求めます。

```text
N = sample_rate * 60_000_000
D = micro_bpm * ppq
frame = floor(tick * N / D)
```

ポイントは以下です。

- 浮動小数の丸め差を避ける
- 同じ入力なら常に同じ出力になる
- v1 は固定テンポのみを前提にしている

## 6. Track / Content / Clip の分離

このプロジェクトの核心は、素材と配置を分けることです。

### 6.1 Media

`MediaAsset` は WAV など実メディアのメタデータです。

- `id`
- `in_zip_path`
- `channels`
- `src_sample_rate`
- `length_src_frames`
- `hash`
- `original_name`

`hash` は decoded PCM を archive と同じ signed 24-bit PCM へ量子化し、
channel count / source sample rate / source frame length とともに chunked SHA-256 した
`sha256-pcm24-v1:<hex>` です。元ファイルの container bytes ではないため、正式保存で
WAVへ正規化して再度開いても同じ音声identityを保ちます。新規importでは必須で、同一
hashの `MediaAsset` が既にあれば新しいassetを作らず、その `media_id` を再利用します。
`hash` が同じmediaはrender cache上も同じsourceとして扱えます。

### 6.2 Content

`ContentEdit` は「クリップの中身」を表します。

- `AudioContentEdit`
  - `media_id`
  - `analysis_refs`
- `MidiContentEdit`
  - `notes`（各 `MidiNote` は stable `id` を持ち、`start >= 0`、`length > 0`、
    `key / vel` は `0..=127`）
  - `ccs`

### 6.3 Clip

`ClipEdit` は「タイムラインへの配置」です。

- `track_id`
- `start`
- `length`
- `lane`
- `muted`
- `gain_milli_db`
- `kind`

つまり、同じ content を複数 clip が参照できる設計です。

## 7. オーディオクリップの正規形

`AudioClipEdit` は以下を持ちます。

- `src_in`
- `src_out`
- `warp`
- `pitch`
- `fades`
- `time_pitch`

ここで重要なのは、再生速度や stretch 比を保存していないことです。

`time_pitch` は利用者の意図と解析元を保存する tagged union です。

- `Voice { analysis: Local | Source, preserve_formant }`
- `Music`

wire JSON では各 variant を `mode` で識別します。`analysis: Local` は clip 内で解析し、
`analysis: Source` は source-based artifact を要求して、不在時だけ local へ fallback します。
新規 audio import の既定は `Voice + Source + preserve_formant: true` です。ただし
`preserve_formant` は**保存されるが現在レンダに影響しません**(理由と正本は `06` §13)。
ここに書いてあるのは保存される既定値であって、聞こえ方の既定ではありません。

`preserve_formant` は pitch 値そのものではなく voice backend の処理optionなので
`PitchControlEdit` には置きません。`Music` variant は `analysis` も `preserve_formant` も
持たず、これらを含む JSON は未知フィールドとして拒否します。`source_native_v2` / `legacy_v1`
のような renderer implementation は runtime policy であり、project には保存しません。

### 7.1 赤 trim と青 stretch

- 赤 trim
  - `src_in` / `src_out` を動かす
  - 再生速度は維持
- 青 stretch
  - `clip.length` を変える
  - `src_in` / `src_out` は維持

この正規形により、見た目上の長さと source 範囲の関係が明快になります。

### 7.2 warp

`warp` は `WarpMapEdit` として保持されます。

- `none`
- `anchors`

アンカーは `at_in_clip` と `src_frame` の対応です。暗黙の始端・終端アンカーを前提に compile / render で piecewise mapping を構成します。

## 8. MIDI クリップの内容窓

`MidiClipEdit` は `content_in` と `content_out` を持ちます。

- clip 自体は timeline 上の窓
- note 本体は `MidiContentEdit.notes`
- note の identity は配列 index ではなく `NoteId`
- split や trim は note を破壊せず窓だけを動かす

この設計の利点は以下です。

- MIDI split が non-destructive になる
- クリップ複製時に note 群を毎回コピーしなくてよい
- note crossing を command で検証できる

## 9. Track モデル

`TrackEdit` は以下を持ちます。

- `id`
- `name`
- `kind`
- `mute`
- `solo`
- `gain_milli_db`
- `pan_permille`
- `fx_chain`
- `routing`

ポイントは以下です。

- Audio と MIDI は track kind で明示分離される
- MIDI track の `audition_instrument` は試聴用であり、本番レンダとは別扱い
- `TrackKind::Midi` は `audition_instrument` の他に **`render_enabled`** も持つ。ただし
  **この field は現在どこからも読まれていない**(§9.2)
- `gain_milli_db` と `pan_permille` は command / UI / playback / offline export まで実装済み

### 9.1 `gain_milli_db` / `pan_permille` の値域

**`pan_permille` は定義済み、`gain_milli_db` は未定義です。** これは記述漏れではなく、
実際に契約が揃っていない箇所なので、揃っていないことをそのまま書きます。

| field | UI が出す範囲 | core の不変条件 | 変換層 (`trackMix.ts`) |
| --- | --- | --- | --- |
| `pan_permille` | −1000 〜 +1000 | `SetTrackPan` が `.clamp(-1000, 1000)` | `panPermilleToUnit()` が再度 ±1 に clamp |
| `gain_milli_db` | −24000 〜 +12000<br>(= −24 dB 〜 +12 dB) | **なし。`SetTrackGain` は値をそのまま入れる** | **なし。`gainMilliDbToLinear()` は `10^(g/20000)` を返すだけ** |

pan は二重に守られていて、gain はどこにも境界がありません。この非対称は偶然ではなく、pan の
境界が意図的に置かれた一方で gain には誰も置かなかった、ということです。UI を経由しなければ
任意の値が入り、たとえば `+100000` は linear ゲイン 10^5 になって mixdown が飽和します。

**未決定の点**: 外部 API や automation から範囲外の値が来たときに何を正とするか。

- core で clamp する(pan と対称。ただし値が黙って書き換わる)
- core で reject する(`CommandError` を増やす。undo/redo の inverse command 生成に影響)
- 上限を設けない(UI が唯一のガードであり続ける)

決めるまでは、**UI の範囲を「推奨範囲」以上のものとして扱わないこと**。とくに core の
`SetTrackGain` に UI 由来でない値を渡す経路を足す場合は、この節を先に更新してください。

### 9.2 `render_enabled` は現在死んでいる

`TrackKind::Midi { audition_instrument, render_enabled }` の `render_enabled` は、schema には
あるが**読み出し箇所がありません。** 出現するのは型宣言(`core/src/edit.rs:190`,
`ui/src/types/project.ts:211`)と `false` の代入だけです
(`importFactories.ts:63`, `intents/trackList.ts:34`、および core のテスト fixture 群)。

「MIDI track は本番レンダに出ない」という挙動自体は成立していますが、それを決めているのは
この field ではなく `selectTracksForOfflineRender()` の
`track.kind.track_type === "audio"` フィルタです。つまり `render_enabled` を `true` にしても
MIDI track はレンダされません。

MIDI の本番レンダを実装するときは、この field を活かすか消すかを先に決めてください。
放置すると「設定できるのに効かない」項目が増えます。

## 10. Analysis artifact モデル

解析データは Edit に埋め込まず、ID 参照で外出しされています。

`core/src/analysis.rs` では以下を定義しています。

- `WaveformPeaks`
- `F0Track`
- `PitchMarks`

共通 envelope は `AnalysisArtifact` で、`kind` タグ付きです。

### 10.1 `analysis_refs` の意味

`AudioContentEdit.analysis_refs` は、その content に対して使う解析アーティファクト ID の配列です。

これは非常に重要です。

- media 単位の「なんとなく最新の解析」を使うのではない
- content がどの artifact を使うかを明示する
- compile / render はこの参照を解決して動く

リファクタ以前はここが曖昧だったが、現在は `analysis_refs` が canonical です。

## 11. Automation と pitch link

### 11.1 Automation

Automation モデル自体は `edit.rs` にあります。

- `AutomationLane`
- `AutomationPoint`
- `AutomationTarget`
  - `TrackParam`
  - `FxParam`
  - `ClipParam`

ただし、これは「完全に使い切られている機能」ではありません。schema と compile-time validation はあるが、UI と runtime 評価はまだ薄い部分があります。

### 11.2 MIDI -> Audio pitch link

`MidiToAudioPitchLink` は track-to-track リンクです。

- `midi_track`
- `audio_track`
- `no_note_behavior`
- `no_pitch_behavior`
- `priority`

リンクは clip 単位ではなく track 単位です。したがって、1 つの MIDI ノートが同じ audio track 上の複数クリップにまたがって効けます。

## 12. 二重の値による不整合を防ぐ具体策

このプロジェクトは、かなり意識的に二重管理を避けています。

### 12.1 具体的な単一正本ルール

| 問題になりやすい概念 | 単一正本 |
| --- | --- |
| clip の所属 track | `clip.track_id` |
| track 上の clip 一覧 | `track` 側には持たない |
| audio 速度比 | 保存しない。`start/length/src_in/src_out/warp` から導出 |
| MIDI split の分割結果 | note 複製ではなく `content_in/out` の窓 |
| analysis の結び付き | `analysis_refs` |
| save 用 JSON 形 | Rust serde 形式を正本にし、TS は mirror |
| playhead / zoom / 選択 | UI state のみ。保存しない |

### 12.2 数値表現の工夫

固定小数系の整数を多用しています。

- BPM: `micro_bpm`
- gain: `milli_db`
- pan: `permille`
- pitch: `cents`

これにより JSON diff のノイズを減らし、再現性を高めています。

### 12.3 保存前正規化

`ProjectEdit.normalize_for_save()` により以下を正規化します。

- MIDI notes の `start -> key -> length -> id` ソート
- automation points のソート
- warp anchors のソート

この処理は「同じ意味だが順番だけ違う JSON」が量産されるのを防ぎます。

### 12.4 compile 時の検証

`core/src/compiler.rs` は以下を検証します。

- ID 重複
- MIDI note の start / length / key / velocity
- 参照存在
- track kind と clip kind の一致
- audio src range
- MIDI window
- warp anchor の妥当性
- fade range
- duplicate pitch link
- routing cycle
- tempo 制約

つまり、Edit を保存正本にしていても「何でも保存してよい」わけではありません。

## 13. このデータモデリングは目的を十分に満たしているか

## 13.1 結論

v1 の対象範囲に対しては、かなり良い形になっています。

特に強い点は以下です。

- split / trim / stretch / warp を非破壊で扱える
- MIDI content と clip window を分離できている
- pitch follow と manual pitch を分離できている
- analysis artifact を source-based identity で扱える
- runtime を保存しないため、保存形式が暴走しにくい

## 13.2 ただし「モデルはあるが機能は薄い」領域もある

- automation
  - lane と target はあるが runtime 評価・UI 編集は未完成
- waveform peaks
  - artifact type はあるが実運用パイプラインはまだ弱い
- variable tempo
  - schema は `points` だが compiler は固定テンポ前提

したがって、現在のデータモデルは「v1 に必要な中心機能には十分強い」が、「将来機能の一部は schema 先行」と理解するのが正確です。

## 14. 新規開発者向けの理解ポイント

データモデルを読むときは、次の順で理解するとよいです。

1. `ProjectDocument` が保存単位
2. `Track / Content / Clip` の三分離
3. `Tick / TimelineFrame / SrcFrame` の時間分離
4. `analysis_refs` と `pitch_links`
5. compile でしか Runtime を作らないこと

この順番で読むと、「なぜ UI 側に直接ロジックを書かないのか」が自然に理解できます。
