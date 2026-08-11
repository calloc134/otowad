# TD-PSOLA と分析アーティファクト

## 1. なぜこの領域がコアドメインなのか

このプロジェクトの差別化要素は、単にタイムラインを持つことではありません。

- AudioClip を MIDI ノートへ追従させる
- manual pitch と follow pitch を両立させる
- time stretch と pitch shift を破綻なく扱う
- そのために TD-PSOLA を自前実装する

このため、`TD-PSOLA`、F0、pitch marks、render plan は最重要の高リスク領域です。

## 2. 解析アーティファクトのモデル

解析アーティファクトは `core/src/analysis.rs` の `AnalysisArtifact` で表現されます。

- `waveform_peaks`
- `f0_track`
- `pitch_marks`

各 artifact は `kind` 付き envelope を持ち、`AnalysisId` で参照されます。

## 2.1 source-based identity

最重要ルールは「解析は source 基準であり、clip ローカルに埋め込まない」ことです。

- F0 は source frame 基準
- pitch marks も source frame 基準
- clip split 後も media 単位解析はやり直さない
- `analysis_refs` を持つのは clip ではなく `AudioContentEdit` で、clip は `content_id` 経由で
  そこへ辿る(モデルの正本は `02` §10)

これにより、clip 操作で解析 identity が壊れません。

## 3. F0 解析

## 3.1 core 側の実装

`core/src/analysis.rs` の `analyze_f0()` は `loqa_voice_dsp` を利用します。

- `VoiceAnalyzer`
- `PitchAlgorithm::PYIN`
- voiced probability を用いた無声音判定

出力は `F0TrackArtifact` です。

- `hop_src_frames`
- `f0_hz_x100`
- `voiced_prob_permille`
- `method`
- `params`

無声音は `-1` で表現されます。

## 3.2 UI 側での利用

`ui/src/audio/analysisStore.ts` は `analyze_f0_buffer_with_profile()` を WASM 経由で呼び、artifact を store に登録します。既定 profile は `tdpsola_monophonic_v2` です。profile 付きの API を使うのは、profile が解析結果の algorithm/version identity に入るためです。profile なしの `analyze_f0_buffer()` も export されていますが、通常経路では使いません。

重要なのは、UI 側で受け取った JSON をそのまま信用せず、`normalizeAnalysisArtifact()` を通して canonical 形へ整えていることです。

これは過去の `missing field 'kind'` バグ対策としても重要です。

## 4. pitch marks 生成

## 4.1 core 側の生成

`generate_pitch_marks()` は F0 track を入力に、pitch period 間隔で mark を置きつつ waveform peak へ寄せます。

生成方針は概ね以下です。

- voiced island を見つける
- F0 補間で周期を推定する
- 次 mark を予測する
- 近傍ピークへ refine する

出力は `PitchMarksArtifact` です。

## 4.2 UI 側での利用

`analysisStore.ensureForBuffer()` は、F0 が無ければ生成し、その後 pitch marks も生成します。

つまり現在の基本フローは以下です。

```text
AudioBuffer
  -> mono 化
  -> F0 解析
  -> pitch marks 生成
  -> AnalysisStore へ登録
```

## 5. `analysis_refs` と分析解決

`ui/src/audio/analysisResolution.ts` は、AudioContent が使う artifact を決める層です。

解決ルールは次の通りです。

1. content に明示された `analysis_refs` を優先
2. 同じ media に紐づく artifact を fallback 候補にする
3. kind ごとに F0 / pitch marks を選ぶ
4. 安定順で refs を並べる

つまり「media に関連する最新 artifact をなんとなく使う」のではなく、「explicit ref 優先 + fallback」という秩序を持っています。

## 5.1 source-domain artifact 契約

F0とpitch marksはclipのtrim後座標ではなく、media全体の`SrcFrame`座標で保持します。
再利用時は次をすべて満たす必要があります。

- artifact `schema_version` は1
- `media_id` が対象mediaと一致する
- `src_sample_rate` が実際のsource bufferと一致する
- F0の`hop_src_frames`は正、voiced probabilityがある場合はF0と同じ要素数
- pitch markはsource範囲内で狭義単調増加
- `mark_features`は空、またはpitch markと同じ要素数
- pitch marksの生成version / params lineageが参照F0と一致する

source契約が不一致のartifactは、profile更新指定の有無にかかわらず
`AnalysisStore.ensureForBuffer()`で再生成します。共通renderer入口でも同じ契約を検査し、
不一致artifactを合成へ渡しません。

mediaのcontent hashは`MediaAssetEdit.hash`が正本です。artifactへ同じhashを重複保存せず、
`media_id`でmediaへ解決します。解析channel policyは全channelの算術平均によるmono化、
artifact座標は常にそのmono化前sourceと同じsample rate / frame長です。

`PitchMarkFeature`は基本5値に加えて、次のsource-native v2 hintを保持できます。

- `epoch_strength`
- `gci_quality`
- `left_period_samples` / `right_period_samples`
- `excitation_balance`
- `expression_baseline_hz_x100`
- `expression_deviation_cents`

これらはanalysis signatureへ含め、変更時にrender cacheを無効化します。
旧artifactで`mark_features`が無い場合は空配列へ正規化しますが、feature内を含む
未知フィールドは正規化時に削除しません。

## 6. compile 側の pitch plan

## 6.1 core の役割

`core/src/pitch.rs` は MIDI -> Audio follow の pitch segment を生成します。

大まかな流れは以下です。

- MIDI track 上の visible note を集める
- audio track 上の audio clip を集める
- note 境界、clip 境界、warp anchor 境界から segment 境界を作る
- segment ごとに source span を求める
- F0 median を取り、target note との差から `shift_cents` を計算する
- `PitchSegmentRt` を生成する

## 6.2 no-note / no-pitch policy

pitch link には以下の policy があります。

- `NoNoteBehavior`
  - `KeepOriginal`
  - `HoldLast`
- `NoPitchBehavior`
  - `Bypass`
  - `HoldLast`
- `NotePriority`
  - `Highest`
  - `Lowest`
  - `Latest`

`Latest` は配列順や作成順ではなく、active note のうち timeline 上の開始位置が最も遅い note を選びます。同時開始の場合は `timeline_start -> key -> length -> velocity -> clip_id -> content_id` の降順で一意に決定し、保存時の note 正規化で compile 結果が変わらないようにします。

このため、pitch follow は単に「ノートに合わせる」ではなく、compile 済みセグメント列として厳密化されています。

## 7. frontend 側の pitch / warp plan

`ui/src/audio/pitchPlan.ts` は `compile_pitch_plan_json()` の結果を frontend 用に変換します。

変換内容は主に以下です。

- frame ベース segment を clip ローカル sample 範囲へ写像
- compiled warp plan を `ClipWarpPlan` へ変換
- manual pitch と follow pitch を合成

結果として `buildClipPitchRenderPlan()` は以下を返します。

- `totalPitchSemitones`
- `pitchSegments?`
- `warpPlan?`

## 8. shared clip render plan

`ui/src/audio/clipRenderPlan.ts` は playback prepare と export の両方で使う shared plan builder です。

ここで以下を決めます。

- `time_pitch` の解決
  - `Voice + Local` は `legacy_local` analysis policy
  - `Voice + Source` は `voice_monophonic_v2` analysis policy
  - `Music` は `music_phase_vocoder` backend
- `tdPsolaCore`
  - 既定は `source_native_v2`
  - `legacy_v1` は回帰比較と明示的なロールバック用に残す
- `backend` / `backendVersion`
- `analysisPolicy`
- `preserveFormant`
- `renderOperation`
  - `bypass`
  - `stretch_only`
  - `pitch_only`
  - `combined`
- `useDirectRender`

この共有化が重要です。以前は playback / export / prepare の解釈差が問題でしたが、現在はここが一本化の中心です。

## 9. direct render と TD-PSOLA render の分岐

`ui/src/audio/directClipRender.ts` は、TD-PSOLA を使わずに済むケースを見分けます。

基本的な考え方は以下です。

- pitch 処理が実質ゼロ
- warp が線形で単純
- source と target の長さ関係が単純

この条件なら、単純コピーまたは stretch-only 処理で済みます。

TD-PSOLA を無条件で毎回通さないことは、速度面でも重要です。

## 10. TD-PSOLA backend の実装方針

既定の音声変形エンジンは`ui/src/audio/tdpsolaV2/v2Adapter.ts`から入る
`source_native_v2`です。`ui/src/audio/tdpsola.ts`の`legacy_v1`は回帰比較と明示的な
ロールバック用に残します。playback prepare、worker prepare、offline exportは
`buildClipRenderPlan()`の同じ既定値を使い、呼び出し元ごとにbackendを決め直しません。

### 10.1 単純な「ピッチシフト関数」ではない

このファイルは以下をまとめて扱います。

- local pitch tracking
- provided F0 / pitch marks の取り込み
- local/provided 候補比較
- warp-aware time mapping
- one-pass synthesis schedule 構築
- channel ごとの overlap-add
- formant preservation
- diagnostics 収集
- render key 生成

### 10.2 one-pass schedule

コメントにある通り、non-bypass rendering は「stretch してから pitch shift」ではなく、source-domain analysis と final output intent から 1 つの synthesis schedule を作って overlap-add します。

これにより以下を狙っています。

- stretch と pitch を別段で重ねたときのズレを減らす
- warp と pitch segment を同じ時間写像上で扱う
- export / playback で同じ schedule 意味を保つ

### 10.3 source-native v2 の clip 端契約

`ui/src/audio/tdpsolaV2/v2Adapter.ts` はclipの`src_in` / `src_out`を変えず、media全体から
前後contextを内部取得します。context量は`max(frameSize / 2, 3 * maximum pitch period)`で、
media端だけclampします。解析とgrain readはcontext込み、返却するPCMはclip output範囲だけです。

`regionCompositor.ts`はvoiced region内のmarkに加え、周期間隔が連続する前後最大2個のguard
markを利用します。guard grainをclip output外まで合成してからcropし、有効なguard contextが
ある物理clip端ではlinear fallbackへfadeしません。guard付きならregion内markが1個の短い
有声区間も合成でき、無声区間をまたぐ離れたmarkはguardとして採用しません。

未確認の無声区間と解析不能区間は`tdpsolaV2/unvoicedTimeStretch.ts`のbase rendererで扱います。
非identity warpでは、grain内部をunit stepで読むOLA/WSOLA scheduleを1つ構築し、全channelで共有します。
warpはgrain間のsource cursorへだけ反映し、grain内部のread rateへ掛けないため、青ストレッチで
周波数軸を移動させません。identity warpでは元PCMを維持します。voicedと確認でき、かつguard
contextを持つclip端をこのbaseへ戻してはいけません。

解析frameの先頭／末尾coverageは、隣接する有声frameまでの欠落がanalysis policyの
`maximumGapSeconds`（現在60 ms）以内で、各frameがedge continuation threshold（現在0.45）
以上の有声根拠を持つ場合だけ、最寄りF0を端へbounded extrapolationします。
さらにedge sample窓のDC成分を除いたRMSが解析の`minRms`以上であることを要求し、定常DCや
実質無音をlocal周期性の偽陽性だけで有声化しません。
frame window中心がmedia端から内側にあることだけを理由に短い端区間をlinear fallbackへ
落としません。上限を超える長い無声区間はextrapolateせず、従来どおりfallbackに残します。
provided F0を選択した場合もF0値はartifactのものを維持し、端を延長してよいかの周期性根拠
だけを同じtimestamp gridのlocal解析で補完します。これはcandidate間のF0選択やscore比較では
なく、RMS gateを通った端frameのcoverage判定に限定します。

有声根拠はあるがmedia外contextを取得できない物理端では、最初／最後の有効source周期を
`nearest_cycle`としてoutput端へ配置します。先頭は最初の有効markを位相anchorとしてtarget
周期単位でoutput端より前へ投影し、末尾は最後のgrain centerをoutput外まで1周期延長してから
cropします。物理media外へ出るgrain readは最寄りの完全なsource周期へ折り返し、ゼロ埋めで
周期端を欠損させません。この端ではlinear fallbackへのfadeを行いません。内部の
voiced/unvoiced境界は従来どおりcrossfadeします。

voiced regionは従来どおりsource-native TD-PSOLAでbaseを上書きし、内部境界は少なくとも24 ms、
または局所target periodの長い方でequal-power blendします。`fallbackSampleCount`は引き続き
「voiced TD-PSOLAで上書きされなかったsample数」であり、linear resampleのsample数ではありません。
長い無声区間は有声化せず、このbase rendererに残します。

端窓の入力相関、spectral scale、LSDは有声coverageとは別gateです。time-stretchの品質は
「入力をそのまま伸ばしていないこと」で判定します。具体的には、固定の1.5倍stretch fixtureで
末尾窓のspectral scaleが**期待伸縮比から±100 cents以内**に収まり、`-4096`/`-2048`窓の
LSD meanが**baseline実装の値を超えない**ことを要求します。

spectral scaleを見るのは、無声区間で時間軸だけを伸ばす実装が周波数軸も一緒に引き伸ばして
しまう(= 単なるresample)典型的な失敗を捕らえるためです。期待値は1.0近傍であり、
`2/3`付近へ落ちていればresampleが露出しています。

これはformant controlを要求しません。一方、identity warpのpitch-only無声区間を変換する処理は
このtime-stretch baseの対象外で、別のgranular/noise-domain policyが必要です。

## 11. provided analysis を盲信しない設計

この実装の大きな特徴は、provided F0 / pitch marks をそのまま盲信しないことです。

### 11.1 local candidate と provided candidate

legacy v1の`renderAudioClipTdPsolaData()`は次の 2 系統を作れます。

- `analysisSource: "local"`
- `analysisSource: "provided"`

provided F0 は local grid に再整列されます。provided pitch marks も slice / validate されます。

### 11.2 backend ごとの selection policy

legacy v1の`tdpsolaDiagnostics.ts`のdefault policyはlocal-firstです。

- tie break は `local`
- provided coverage inflation には hard reject guard がある
- divergence guard により、Jaccard や F0 誤差、相関、epoch 差が悪い provided 候補を reject できる

つまり provided artifact は「使えれば使うヒント」であって、「絶対の真実」ではありません。

source-native v2の既定policyは`voice_monophonic_v2`で、source契約を満たすprovided artifactを
利用します。通常経路では`buildClipRenderPlan()`が保存済みの`time_pitch`からpolicyを一度だけ
解決します。`Voice + Source`は`voice_monophonic_v2`、`Voice + Local`は`legacy_local`を選び、
adapterを直接呼ぶ省略時にも同じvoice policyへ寄せます。synthesis core の
`source_native_v2` / `legacy_v1` は保存モデルに含めません。

## 12. warp-aware 実装

`ui/src/audio/tdpsolaWarp.ts` は warp 付き clip の time map を frontend で扱う補助層です。

主な責務:

- warp plan 正規化
- output sample -> source sample 変換
- source sample -> output sample 変換
- source range と warp segment の交差
- pitch marks の local 化
- warped linear fallback render

これにより TD-PSOLA schedule が compile 側の piecewise mapping と同じ時間意味を共有できます。

## 13. formant preservation

**現在この設定は音に影響しません。** 実装されているのは `legacy_v1` 合成コアだけで、
出荷経路はそこを通りません。`buildClipRenderPlan()` は `tdPsolaCore` を常に
`DEFAULT_TDPSOLA_CORE`(= `source_native_v2`)へ既定し、production から `legacy_v1` を
選ぶ呼び出しはありません。`v2Adapter.ts` は `preserveFormant` を options 型に持ちますが
読み出しません。つまり値は保存され、レンダには使われません。

注意すべき誤解が1つあります。`time_pitch.analysis` を `Local` にしても legacy 合成には
なりません。`analysis` が選ぶのは analysis policy(`legacy_local` / `voice_monophonic_v2`)
だけで、合成 backend を決めるのは `tdPsolaCore` です。

以下は `legacy_v1` を明示的に選んだ場合の挙動として読んでください。`tdpsola.ts`の処理は
単なるon/offフラグではありません。

edit上の指定は`PitchControlEdit`ではなく`TimePitchModeEdit::Voice`が
`preserve_formant`として所有します。`TimePitchModeEdit::Music`はこのfieldを持ちません。
renderer planは`mode`をbackend identityへ、variant fieldを`preserveFormant`へ分離してから
backendへ渡します。

実装は概ね以下です。

- voiced mask を使って有声部分を重点処理
- LPC 係数を source と rendered から推定
- rendered 側を inverse filter して residual を得る
- source 側 spectral envelope で synthesis filter をかけ直す
- ピッチシフト量に応じた blend で混合する

つまり「声らしさの包絡」を source に寄せる後処理です。

source-native v2では`preserveFormant`を合成へ反映せず、render cache identityにも含めません。
同じsource-native入力がlegacy専用フラグの違いだけで重複renderされないことを契約とします。

## 14. 安全リミッタ

source-native v2では、`applyFinalSafetyLimiter()`を各TD-PSOLA voiced regionの合成直後、
linear fallbackとのcomposite前に適用します。DSPが生成したpeakが1を超える場合は全channelを
0.98基準でスケールダウンしますが、未処理の無声／解析不能fallbackまで巻き込んでclip全体の
gainを変えてはいけません。legacy v1は従来どおりclip render後の最終保険として適用します。

## 15. diagnostics と観測面

この領域は高リスクなので、診断情報がかなり豊富です。

- coverage
- voiced interior fallback
- epoch counts
- local/provided candidate 比較
- selection decision
- analysis source

これらは診断値なので、合否判定ではなく「どの経路が選ばれ、どこで fallback したか」を後から追うためのものです。

## 16. waveform peaks の現在地

`WaveformPeaks` は型としては存在しますが、現行の analysis store / worker hydrate / playback/export パイプラインでは主役ではありません。

現状の理解としては以下が正確です。

- schema には存在する
- normalize もできる
- archive に含めることは可能
- しかし F0 / pitch marks ほど中核パイプラインに乗っていない

新規開発者は「analysis artifact = 全部同じ完成度」と思わない方がよいです。

## 17. 現在の強み

- analysis artifact identity が `analysis_refs` に戻った
- compile 側と render 側が分離されている
- local/provided 併用で品質と互換性の両立を狙っている
- playback と export が shared render plan を使う
- formant preserve や diagnostics まで含め、単純な toy 実装ではない

## 18. 現在の制約と今後

- TD-PSOLA 本体がまだ大きい
- waveform peaks は未成熟
- provided/local 二重系は品質面で強いが、複雑さも高い
- 現在は主に事前 render 型で、低遅延リアルタイム worklet 連携の本格化はこれから

## 19. 新規開発者への助言

この領域を触るときは、次の順で理解するとよいです。

1. `core/src/analysis.rs`
2. `core/src/pitch.rs`
3. `ui/src/audio/analysisStore.ts`
4. `ui/src/audio/analysisResolution.ts`
5. `ui/src/audio/pitchPlan.ts`
6. `ui/src/audio/clipRenderPlan.ts`
7. `ui/src/audio/directClipRender.ts`
8. `ui/src/audio/tdpsolaWarp.ts`
9. `ui/src/audio/tdpsolaV2/v2Adapter.ts`
10. `ui/src/audio/tdpsola.ts`（legacy比較が必要な場合）

特に、いきなりbackend実装だけを読むより、compileとanalysisの契約を先に理解した方が圧倒的に楽です。
