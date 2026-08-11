# worker / persist / render

## 1. 基本原則

この領域の中心原則は一貫しています。

- open / save / export / playback prepare はすべて canonical project から派生する仕事である
- 正本は常に `ProjectDocument`
- cache は派生値であり、project switch や revision で説明可能に invalidation されるべき

この方針は、リファクタ資料と現行コードの両方で一貫しています。

## 2. worker の責務

worker 実装は `ui/src/worker/projectWorker.ts`、protocol は `ui/src/worker/projectWorkerProtocol.ts` にあります。

worker が担う主な処理は以下です。

- project archive の parse
- media / analysis artifact の worker-side cache 同期
- decoded media の content hash 計算と重複 import 解決
- playback prepare
- project archive の build
- offline WAV export
- stale request reject と cancel 処理

つまり worker は「ブラウザ版バックグラウンド処理基盤」です。

## 3. worker protocol

## 3.1 envelope 構造

すべての request / response は以下を持ちます。

- `type`
- `version`
- `workerGeneration`
- `projectRevision`
- `requestId`
- `payload`

これは repository 契約とも一致しています。

## 3.2 主な request type

- `parse_project_archive`
- `replace_media`
- `replace_analysis_artifacts`
- `import_audio_buffer`
- `hash_audio_buffer`
- `clear_project_cache`
- `measure_runtime_memory`
- `prepare_playback`
- `build_project_archive`
- `render_wav_export`
- `cancel_request`

## 3.3 response / progress

response も request に対応した typed result を返します。さらに以下の progress family があります。

- `prepare_playback`
- `render_wav_export`

`ProjectWorkerClient` は response type、version、revision、progress operation を検証します。ここは初期の refactor idea で指摘されていた弱点が、現在はコード上でかなり補強されています。

`workerGeneration` は worker instance の世代です。request と response の世代が一致しない応答は、`requestId` が一致しても旧 worker 由来として拒否します。現行 protocol version は `8` です。`prepare_playback` は`outputSampleRate`を必須とし、worker内でprepared PCMをそのrateへmaterializeします。`parse_project_archive_result` は hydrated media に加えて `missing` / `invalid` の media issue を返し、`measure_runtime_memory` は worker cache の source PCM / rendered PCM / analysis bucket を返します。

`import_audio_buffer` はchannelごとのPCM `ArrayBuffer`をtransferし、24-bit canonical
content hashと解析artifactを同じjobで生成します。requestの `existingMediaByHash` に
一致するhashがあれば、その既存 `mediaId` を `resolvedMediaId` として返します。
`hash_audio_buffer` もchannel PCMをtransferしますが、候補ファイルをworker media cacheへ
admitせずhash文字列だけを返すため、relink検証に使います。どちらもproject documentを
読まないcache/identity jobなのでrevision gateの対象外ですが、response envelopeの
`projectRevision` 一致はclientが検証します。

`prepare_playback` / `build_project_archive` / `render_wav_export` は、worker LRU が持たない参照 source だけを `mediaEntries` で request-local に transfer します。consumer result は実際にworker LRUへ残った `cachedMediaIds` と `sourcePcmBytes` を返し、main thread は推測ではなくこの集合を次回再送判定に使います。

## 3.4 lifecycle recovery

worker の `error` / `messageerror` は cache 復元ではなく world reset として扱います。

- 同世代の pending request を `WORKER_TERMINATED` で一括 reject
- 失敗した worker を terminate
- `workerGeneration` を進め、次の request まで再生成しない
- main thread の prepared playback schedule と rendered buffer cache を同時に破棄
- replacement worker へは analysis を次回要求前に再送し、media は次のconsumer requestへ必要分だけ添付

main thread の render key を残したまま replacement worker へ `knownRenderKeys` として送ることは禁止します。replacement worker は対応する buffer を持たないため、metadata-only schedule が無音になります。`cancelRequest` は pending request がない場合に worker を生成しません。

### 3.4.1 cancellation は client が確定させる

キャンセルは **client 側で完結し、worker の協力に依存しません。** 順序は次の通りです。

1. `projectWorkerClient.cancelRequest()` が pending promise を即座に `REQUEST_CANCELED` で
   reject し、pending map から entry を削除する
2. entry が無くなるので、その requestId に対する遅れて届いた response は `onmessage` で捨てられる
3. best-effort として `cancel_request` を worker へ送る

**worker 側は実行中の処理を止めません。** `canceledRequests` を読むのは `validateEnvelope()`
だけで、これは request 受理時に一度しか走りません。`cancel_request` が対象を記録できるのは
対象が既に `inflightRequestIds` にあるときだけなので、記録された時点で対象の検査は終わっています。
したがって進行中の request がこの set によって短絡されることはありません。

加えて `prepare_playback` や `render_wav_export` の DSP ループは同期実行で yield しないため、
worker はループが終わるまで `cancel_request` の message 自体を読みません。

**「キャンセルできる」の意味は、呼び出し元が待たされないこと**です。計算はループ完了まで走り、
結果は破棄されます。CPU とメモリはその間解放されません。真に打ち切るには DSP ループを
チャンク分割して yield させ、途中で取り消しを観測する必要があります。

## 4. worker 側の状態と cache

`projectWorker.ts` には以下の worker-side state があります(module 直下の全量)。

- `workerMediaCache`
- `workerAnalysisStore`
- `canceledRequests`
- `inflightRequestIds` — 処理中の requestId。`cancel_request` が対象を記録するかの判定に使う
- `latestProjectRevision`
- `activeWorkerGeneration` — 受理する世代。不一致の request は `STALE_WORKER_GENERATION` で拒否
- `wasmReadyPromise`

特に重要なのは以下です。

### media cache

`mediaId -> AudioBufferData` を byte-bounded LRU で保持します。steady budget は 512 MiB です。budgetを超える複数entryはLRU順にevictし、単体で512 MiBを超えるsourceはcacheへ保持しません。

consumer開始時に、参照中sourceを「既存LRU entry + requestの `mediaEntries`」からrequest-local lookupへ固定します。このlookupはjob中のevictionに影響されず、job完了後に新規entryだけをLRUへ昇格します。oversized sourceもjob中は利用できますが完了後は残らないため、次回consumerでmainから再送されます。したがって `worker.sourcePcm.bytes` はconsumer完了後に512 MiBを超えません。

### analysis store

F0 / pitch marks の artifact registry を保持します。

### rendered playback ownership

worker は clip 単位の render 済み `AudioBufferData` を schedule response で transfer し、保持しません。main thread は受領直後に `PlaybackEngine` の byte-bounded `AudioBuffer` LRU へ取り込み、prepared schedule から PCM payload を外して metadata のみ保持します。

main が worker へ渡す `knownRenderKeys` は、prepared schedule の記録ではなく `PlaybackEngine` LRU が実際に所有する key だけです。既知 key の clip は worker render 自体を省略します。LRU eviction 後の key を既知と申告して metadata-only schedule を受け取ってはいけません。

### stale revision reject

worker は `latestProjectRevision` より古い request を reject します。これにより、古い playback prepare 結果が UI に逆流するのを防ぎます。

## 5. playback prepare

## 5.1 なぜ worker に逃がしているか

再生直前の処理は重くなりやすいです。

- analysis ensure
- pitch compile
- clip 候補列挙
- render key 構築
- cache lookup
- missing clip の direct render / TD-PSOLA render
- schedule 組み立て

これを main thread でやると UI が止まりやすいため、現在は worker 経由が本命になっています。

## 5.2 具体的なフロー

`useAudioEngine.ts` から `projectWorkerClient.preparePlayback()` を呼ぶと、worker 側で `preparePlaybackSchedule()` が走ります。

その結果、`PreparedPlaybackSchedule` が返ります。

```text
PreparedPlaybackSchedule
- startTick
- startOffsetSec
- projectRevision
- clips[]
  - clipId
  - trackId
  - mediaId
  - renderKey
  - whenRelativeSec
  - clipDurationSec
  - gain
  - optional buffer
```

ここで重要なのは、schedule は「再生用の派生値」であり、保存しないことです。

## 5.3 metadata-only reuse

`knownRenderKeys` により、main thread がすでに持っている rendered buffer を worker から再送しないようにしています。

これにより以下を削減します。

- worker から main への転送量
- structured clone / transfer 負荷
- 同じ clip buffer の再送

## 5.4 playback 経路の単一化

`PlaybackEngine` は `playPrepared()` でworker生成scheduleを消費する役割に限定します。
compile、analysis解決、backend dispatch、clip renderをmain threadで再実装する
`play(...)` 経路はありません。これによりplaybackのdispatch siteはworker prepareへ収束し、
offline exportだけが同じ `ClipRenderPlan` を使う別consumerとして残ります。

playback preparationとoffline exportは、どちらも
`ui/src/audio/clipRenderDispatch.ts` の `renderClipFromPlan()` を呼び出します。
consumer側でbackendごとのrender引数やanalysis policyを分岐させてはいけません。

## 5.5 renderer parity

direct、legacy TD-PSOLA、source-native TD-PSOLA、music phase vocoderの各backendは、
playback preparationとoffline exportで同じrender済みPCMを生成しなければなりません。
この契約はpan / gainをidentityにした相対比較で検証し、特定backendの絶対goldenには
依存しません。

## 5.6 product mix parity

renderer後の製品経路は、playbackとoffline exportで次の順序を共有します。

1. rendered clip PCMを出力sample rateへ線形resample
2. clip gain
3. track gain
4. Web Audio `StereoPannerNode`と同じequal-power pan

playbackはprepared PCMを`AudioContext.sampleRate`へ明示的にmaterializeしてから
`AudioBuffer`を作ります。sample-rate変換をブラウザ実装へ暗黙委譲するとofflineの線形変換と
一致を保証できないためです。offlineは同じ線形補間をmix時に適用します。

panは単純な左右独立cos/sin gainではありません。Web Audio標準の
[`StereoPannerNode` algorithm](https://www.w3.org/TR/webaudio-1.1/#stereopanner-algorithm)に従い、
mono入力はequal-powerで左右へ配分し、stereo入力はcenterでidentity、左右へ振ると反対側channelを
cross-mixします。これによりplaybackのnative nodeとoffline PCMの規則を一致させます。

現行runtime planにfade envelopeは無く、UIから非ゼロfadeを設定する経路もありません。
したがってこのparity契約でのfadeは`fade_in = fade_out = 0`のidentityに限定します。
非ゼロfadeはruntime planへの配線を含む別featureであり、実装前に製品parity済みとは扱いません。

## 6. persist の責務

persist 実装は主に以下です。

- `ui/src/persist/projectArchive.ts`
- `ui/src/persist/browserProjectStore.ts`
- `ui/src/persist/autosave.ts`
- `ui/src/persist/fileAccess.ts`
- `ui/src/persist/persistenceDb.ts`

## 6.1 archive 形式

archive は ZIP で、以下の構成を取ります。

```text
project.zip
  /project.json
  /media/<media_id>.wav
  /analysis/<analysis_id>.json  (optional)
```

この構成は `projectArchive.ts` が管理します。

## 6.2 canonical serialization

保存前には `prepareCanonicalProjectArchivePayload()` を通します。

ここで行うこと:

- `analysis_refs` 解決済み document へ揃える
- `media/<id>.wav` 形式の `in_zip_path` へ整える
- `serialize_project_for_save()` で save 用 pretty JSON にする

つまり、save 系経路は ad-hoc JSON を吐かない方針です。

## 6.3 ZIP 実装

`projectArchive.ts` は store-only ZIP を手書きで組み立てます。

- local file header
- central directory
- EOCD
- CRC32

読込は archive 全体 2 GiB、4096 entries、1 entry 1 GiB を上限とします。central directory を
全件検証して local header / path / size / CRC の対応を解決し、local file range に重複がないことを
確認してから payload をコピーします。同じ local header を複数 path から参照する entry aliasing、
traversal path、multi-disk / Zip64、data descriptor、圧縮 entry は拒否します。

ライブラリ任せではなく、自前で扱っている点は実装理解上の特徴です。

## 6.4 analysis archive の扱い

`analysis/` は optional です。

- あれば reopen 後の初回表示・初回再生が速い
- なくても再生成可能であることが前提

読込時には `parseProjectArchiveAnalysisFiles()` が `normalizeAnalysisArtifact()` を通すため、過去の `kind` 欠落 archive にも一定の互換があります。
`analysis/<analysis_id>.json` の ID は archive 境界で UUID 形式を検証し、非 UUID の path
fragment を analysis registry へ入れません。

archive 内の参照 media が欠落または不正でも、project JSON 自体が妥当なら document は開けます。media の状態は `ProjectDocument` へ書き戻さず、UI runtime の availability registry が次の4状態で管理します。

- `available`
- `missing`
- `relinking`
- `invalid`

availability は現在の document と decoded media cache から再構築されます。別環境で保存された古い `missing` 状態を canonical JSON へ持ち越してはいけません。

参照中の media が unavailable の場合、browser save、再生、WAV 書き出しは同じ preflight で停止し、status bar から手動 relink を要求します。relink候補はまず channels / source sample rate / source frame length を確認し、保存済み `hash` があればworkerで計算したhashの完全一致を必須にします。`hash` が `null` の場合は自動同一視せず、この三つ組に加えて `original_name` の完全一致を必須にします。検証が終わる前にmain/worker media cacheを更新してはいけません。

## 6.5 browser save

`browserProjectStore.ts` は IndexedDB に 2 種類の store を持ちます。

- metadata store
- archive bytes store

つまり browser 保存は full archive snapshot を持ちます。JSON だけではありません。

## 6.6 autosave

autosave は別です。`ui/src/persist/autosave.ts` は raw JSON を IndexedDB に保存します。

これは crash recovery 用であり、完全復元用ではありません。

`App.tsx` の復元確認文言も次を明記しています。

- autosave は JSON-only crash recovery
- imported media buffer は fully recoverable ではない

したがって保存ポリシーは次の二段です。

- 正式保存: full archive
- 自動保存: JSON-only crash recovery

autosave の parse 失敗または復元拒否では、`current` を即削除しません。同じ IndexedDB transaction 内で quarantine キーへ移し、次回起動の復元候補から外しつつ開発中の crash-recovery JSON を保持します。正常な手動保存後の `clearAutoSave()` だけが current snapshot を削除します。

`ui/src/persist/persistenceRoundTrip.test.ts` は、import factory と実 WASM command bridge から
始め、edit → autosave → reload / restore → edit → canonical archive → browser save → reopen →
media hydrate → offline render を1本で連結します。reopen 前後の canonical project JSON と
24-bit WAV bytes が一致することを検査し、autosave が JSON-only、browser save が media 込みの
正式 snapshot である境界を固定します。

## 6.7 ファイルアクセス

`fileAccess.ts` は File System Access API があるブラウザではネイティブ保存を使い、ない場合は download / file input にフォールバックします。

つまり UI は Chromium 系 API に依存しすぎない構成です。

## 7. render の責務

render 実装の中心は以下です。

- `ui/src/render/projectMixdown.ts`
- `ui/src/render/wavEncoder.ts`
- `ui/src/render/index.ts`

## 7.1 offline render は `projectMixdown` が正規経路

現在の export は `projectMixdown` ベースへ一本化されています。

`projectMixdown.ts` は以下を行います。

- analysis ensure
- compile 済み pitch/warp plan 取得
- clip ごとの render plan 構築
- bounded render window 計算
- `renderClipFromPlan()` による共通backend dispatch
- target buffer へ mix

最後に `wavEncoder.ts` が WAV bytes にします。

## 7.2 track 単位 export

`useExport.ts` は project 全体 WAV だけでなく、audio track 単位 WAV export もサポートしています。`projectMixdown` の `trackIds` option を使って対象を絞ります。

MIDI track については別経路で `.mid` 書き出しもありますが、これは audio render とは別機能です。

## 8. cache boundary

この領域では cache 境界が重要です。

memory baseline は `runtimeMemoryDiagnostics.ts` の logical payload bytes を使います。main source/rendered `AudioBuffer`、main prepared PCM、worker source/rendered PCM、main/worker analysis、transfer clone peak を別bucketで計測し、対応ブラウザでは `measureUserAgentSpecificMemory()` の全体値も併記します。

### 6.x 長尺素材の memory scenario

同一 PCM が同時に何コピー存在し得るかで天井が決まります。source steady は 2 コピー
(main + worker)、rendered steady は 3 コピー、両方が生きている combined steady は
5 コピーとして見積もります。stereo / 32-bit float 換算の代表値は次のとおりです。

| scenario | PCM/copy | source steady | rendered steady | combined steady |
| --- | ---: | ---: | ---: | ---: |
| 10分 @ 44.1 kHz | 201.87 MiB | 403.75 MiB | 605.62 MiB | 1,009.37 MiB |
| 10分 @ 96 kHz | 439.45 MiB | 878.91 MiB | 1.287 GiB | 2.146 GiB |
| 30分 @ 44.1 kHz | 605.62 MiB | 1.183 GiB | 1.774 GiB | 2.957 GiB |
| 30分 @ 96 kHz | 1,318.36 MiB | 2.575 GiB | 3.862 GiB | 6.437 GiB |
| 30分 × 2本 @ 44.1 kHz | 1,211.24 MiB | 2.366 GiB | 3.549 GiB | 5.914 GiB |

worker 側 source PCM は 512 MiB の strict LRU に収めるため、steady state は上表の
source 列より小さくなります。**未対応なのは request 実行中の peak** で、これは
streaming / partial rendering を導入するまで残ります。

計測手順は `runtimeMemoryDiagnostics.ts` の診断 API を使い、同一 scenario を
allocation-free(新規確保を伴わない状態)で採取して比較します。

| cache | 主な場所 | key | 消える条件 |
| --- | --- | --- | --- |
| media cache | `ui/src/audio/mediaCache.ts`, worker 512 MiB LRU | `mediaId` | project switch、replace_all、worker byte-budget eviction |
| analysis cache | `ui/src/audio/analysisStore.ts`, worker side | `AnalysisId`, `mediaId` | project switch、replace_all、artifact 更新 |
| rendered playback cache | `PlaybackEngine` | `renderKey` | byte budget eviction、project switch、worker generation 変更 |
| prepared playback metadata | `useAudioEngine.ts` | `projectRevision + startTick` | revision 変更、startTick 変更、worker generation 変更、render key eviction |
| browser project metadata | IndexedDB | `projectId` | delete 時 |

この設計により、「何が正本で何が派生か」を説明しやすくしています。

## 9. 現在の長所

- heavy work を main thread から逃がせる
- protocol が typed envelope で明確
- save / reopen / browser save / download の整形規則が揃っている
- archive に optional analysis artifact を持てる
- export path が `projectMixdown` に収束している

## 10. 現在の注意点

- worker / persist / render は物理的には `ui/src` 配下にある
- waveform peaks は analysis artifact としてはあるが worker hydrate では実質未利用
- playback prepare は exact `startTick` 再利用なので、seek 変更時の固定コストはまだある

## 11. 新規開発者が守るべきこと

- archive を再構築するときは `prepareCanonicalProjectArchivePayload()` を通す
- worker message を増やすときは `type/version/workerGeneration/projectRevision/requestId` を必須にする
- `analysis_refs` を無視して media 単位の暗黙 artifact を正本にしない
- export と playback で clip render 解釈を分岐させない
- autosave を full save の代替と誤解しない
