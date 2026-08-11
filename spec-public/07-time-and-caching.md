# 時間モデルとキャッシュ

## 1. 先に結論

このプロジェクトには「時間のキャッシュ」という単一のサブシステムがあるわけではありません。

代わりに、時間依存の再生準備とレンダリングを再利用するための複数の cache が段階的に存在します。

- deterministic な時間変換そのものは基本的に都度計算する
- 重いものだけを cache する
  - analysis
  - decoded media
  - rendered clip buffer
  - prepared playback schedule

この設計は、時間変換の正しさと cache の有効性のバランスを取ったものです。

## 2. 時間モデル

## 2.1 3 ドメイン分離

`core/src/time.rs` の 3 つの時間型が前提です。

- `Tick`
- `TimelineFrame`
- `SrcFrame`

この型分離により、以下の誤りをコンパイル時に減らせます。

- project 時間と media 時間の混同
- warp 計算と timeline frame の混同
- F0/pitch marks の source frame を runtime frame と取り違えること

## 2.2 テンポ制約

`TempoMapEdit` は将来拡張を見越して `points` 配列ですが、現行 compiler は v1 として固定テンポしか受けません。

`core/src/compiler.rs` では `points.len() != 1` で `VariableTempoNotSupported` を返します。

つまり時間計算は今のところかなり単純です。

## 2.3 Tick -> Frame

`tick_to_frame_floor()` は整数演算ベースです。

この処理を memoize していないのは合理的です。理由は以下です。

- 計算コスト自体は小さい
- deterministic で cheap
- cache を入れると invalidation と複雑さが増える

したがって、現在の cache 戦略は「時間変換値」ではなく「時間変換を使って組み立てた重い成果物」を再利用する方向です。

## 3. compile 時に時間がどう使われるか

`core/src/compiler.rs` は clip を runtime に落とすとき、以下を決めます。

- clip start / end の `TimelineFrame`
- warp plan の dst/src 対応
- automation point の frame 化
- pitch segment の frame 範囲

`core/src/pitch.rs` はさらに、clip ローカル tick と source frame を対応付けます。

これは warp がある clip でも pitch follow の source span を決めるために必要です。

## 4. frontend での時間利用

frontend では `tickToSeconds()` が重要です。

主に以下で使われます。

- playback 開始位置の秒変換
- clip の再生位置計算
- render window の秒変換
- timeline / export の開始終了解釈

また `pitchPlan.ts` は frame ベース compile 結果を clip ローカル sample 範囲へ写像します。

## 5. warp と sample mapping

`ui/src/audio/tdpsolaWarp.ts` は時間キャッシュというより「時間写像ヘルパ」です。

提供する主な機能は以下です。

- `normalizeWarpPlan()`
- `mapOutputSampleToSourceSample()`
- `mapSourceSampleToOutputSample()`
- `intersectWarpPlanWithSourceRange()`
- `renderWarpedLinear()`

この層があることで、TD-PSOLA や fallback render が compile 側の warp 意味論と同じ時間写像を使えます。

## 6. 実際の cache 群

## 6.1 analysis cache

`ui/src/audio/analysisStore.ts` には以下があります。

- `artifactById`
- `f0Map`
- `pitchMarksMap`
- `f0IdByMediaId`
- `pitchMarksIdByMediaId`
- `signatureMap`

特に `signatureMap` は、media ごとの分析内容を短い signature にし、render key 再構築コストを抑えます。

## 6.2 media cache

`ui/src/audio/mediaCache.ts` は decoded `AudioBuffer` を `mediaId` 単位で保持します。

これは時間キャッシュではありませんが、時間依存 render を行う前提条件として最も基本の cache です。

worker側は512 MiB strict LRUです。LRUにない参照sourceはconsumer requestの `mediaEntries` へ必要分だけ添付し、job中はrequest-local lookupで保持します。job完了後にbudget内のentryだけをLRUへ昇格し、単体でbudgetを超えるsourceは保持しません。

## 6.3 rendered clip cache

rendered clip の steady owner は main thread のみです。

### main thread

`ui/src/audio/playbackEngine.ts`

- `processedClipCache: ByteBoundedLru<AudioBuffer>`

worker はrender結果をschedule responseでtransferした後に保持しません。mainのprepared scheduleもPCMを外してmetadataだけを保持します。

## 6.4 prepared playback schedule cache

`ui/src/audio/playbackRuntimeCaches.ts` はmetadata-onlyの `PreparedPlaybackSchedule` を再利用します。

ただし条件は厳しく、`canReusePreparedPlaybackSchedule()` は以下を要求します。

- `schedule.projectRevision === projectRevision`
- `schedule.startTick === startTick`

つまり exact `startTick` 一致です。

## 7. render key は何を表しているか

`buildPreparedClipRenderKey()` および `makeTdPsolaClipKey()` は、クリップの音響結果に影響する入力を key 化します。

主な構成要素:

- `mediaIdentity` (`MediaAsset.hash ?? mediaId`)
- `sourceIn / sourceOut`
- `lengthTick`
- `totalPitchSemitones`
- `pitchSegmentsKey`
- `warpPlanKey`
- `analysisKey`
- `renderOperation`
- `preserveFormant`
- `bpm`
- `ppq`
- `mediaSampleRate`

この key が意味するのは、「同じ key なら同じ render 結果になるはず」ということです。
配置identityである `clipId` は音響結果を変えないため含めません。新規importしたmediaは
canonical 24-bit PCM content hashをidentityに使うので、同一素材を再importした場合や
clipを複製した場合もrender bufferを共有できます。hashのないmediaだけは、誤った共有を
避けるため `mediaId` へフォールバックします。analysis signatureもartifactの
`media_id` ではなく解析内容だけを表し、同じsource analysisのID差でkeyを分断しません。

## 8. `時間のキャッシュ` はどこに現れているか

ユーザーの観点で言う `時間のキャッシュ` は、実装上は次の複合物です。

### 8.1 startTick 単位の schedule 再利用

同じ revision、同じ `startTick` なら prepared schedule を再利用します。

### 8.2 startTick が変わっても clip render は再利用

seek により schedule は作り直しになるが、clip 単位 render buffer は `renderKey` が同じなら再利用できます。

### 8.3 analysis signature による時間依存処理の安定化

analysis が変わらなければ、pitch/warp/render plan に必要な artifact identity も同じと見なせます。

### 8.4 known render keys による転送省略

main がすでに保持している clip buffer は worker から再送しません。

通知するkeyは `PlaybackEngine` LRUが実際に所有するものだけです。prepared metadataにkeyが残っていても、LRUからevict済みなら既知として申告しません。

つまり「時間のキャッシュ」は、単一 cache ではなく、

- schedule
- render buffer
- analysis signature
- revision
- startTick

の複合戦略です。

## 9. invalidation の考え方

## 9.1 projectRevision

project mutation が起きたら `projectRevision` が進みます。

これにより以下が無効化されます。

- prepared playback schedule
- stale worker result

## 9.2 project switch / replace_all / source budget

worker で `replace_media(mode=replace_all)` が来ると、media / analysis cache をまとめてクリアします。worker source PCM は512 MiBのstrict LRUで、consumer resultの `cachedMediaIds` をmain側の再送判定に使います。

LRUにない参照sourceは `prepare_playback` / `build_project_archive` / `render_wav_export` の `mediaEntries` へ必要分だけ添付します。job中はrequest-local lookupがsourceを保持し、job完了後にbudget内のentryだけをLRUへ昇格します。

`replace_analysis_artifacts(mode=replace_all)` は analysis cache をクリアします。rendered bufferはworkerが所有しないため、worker側のrendered invalidationは存在しません。

## 9.3 artifact 更新

analysis artifact が変わると `analysisSignature` も変わるため、render key が変わり、clip render 再利用が止まります。

これは正しい invalidation です。

## 9.4 startTick 変更

seek で `startTick` が変わると schedule cache は外れますが、rendered clip cache までは必ずしも外れません。

この分離が、完全な再計算を避けるための現行戦略です。

## 10. 現在の性能上の論点

過去レポートと現行コードを見ると、現在の prepare path は次の固定費を持ちます。

- worker request/response
- `ProjectDocument` の structured clone
- pitch compile 再実行
- clip candidate 列挙
- render key 再構築
- progress 通知と UI 更新

そのため、render cache が効いていても seek miss 時には prepare 全体コストが残ります。

## 10.1 現在ある観測面

`ProjectWorkerClient` と `preparePlaybackSchedule()` は measurement をかなり持っています。

- request payload size
- compile duration
- candidate enumeration duration
- render key build duration
- cache hit/miss count
- buffer bytes
- progress message counts

さらに measurement は `window.__OTOMAD_PREPARE_PLAYBACK_MEASUREMENT__` にも露出されます。

## 11. 今後の改善余地

現状の exact `startTick` 再利用は単純で安全ですが、将来的には以下が有力です。

- revision 単位の compiled project snapshot
- startTick 依存の軽量 scheduling 層の分離
- compile cache
- progress flood のさらなる抑制

ただし、どの改善でも「保存正本に runtime cache を混ぜない」原則は維持すべきです。

## 12. 新規開発者への要点

この領域で一番大事なのは次の理解です。

- 時間変換自体は cheap なので cache の主対象ではない
- expensive なのは、その変換結果を使った render / schedule / transfer
- したがって cache は「時間そのもの」より「時間に依存する派生成果物」を持つ

この視点を持つと、現在の cache 戦略も将来の改善方針も理解しやすくなります。
