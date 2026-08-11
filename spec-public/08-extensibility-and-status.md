# 拡張性と現在の到達点

## 1. 総合評価

大規模リファクタ後のこのプロジェクトは、次の意味でかなり良い位置にいます。

- データ正本と派生値の境界が明確になった
- core / UI / worker / persist / render の論理境界が見えるようになった
- `analysis_refs`、render plan、device policy など、将来拡張に効く中核概念が安定した
- テストが増え、回帰観測面が整った

一方で、「すべてが完成している」わけではありません。今後の拡張性は高いが、未完了や schema 先行の領域も残っています。

## 2. 何が拡張しやすくなったか

## 2.1 analysis artifact identity

`analysis_refs` が canonical になったことで、以下が伸ばしやすくなりました。

- 新しい analysis kind の追加
- archive による分析結果持ち運び
- content ごとの artifact 切り替え
- compile / render での artifact 解決一貫化

## 2.2 pitch mode / render plan

pitch follow と manual pitch が分離され、さらに frontend 側で shared clip render plan を持つようになったため、次のような拡張がしやすいです。

- pitch mode の追加
- render backend の差し替え
- direct render の条件調整
- formant preserve の改良

## 2.3 worker protocol family

worker message が envelope 化されているため、以下の追加がしやすいです。

- 新しい heavy job
- progress 付き long-running task

すでに入っているもの(拡張候補ではありません):

- **request cancellation** — `cancel_request` request と `REQUEST_CANCELED` error code が
  `projectWorkerProtocol.ts` にあり、worker / client 双方に実装済み。通常の audio engine
  経路からも使われます。ただし打ち切るのは**呼び出し元の待ち**だけで、実行中の計算は止まりません。
  正確な意味は `05` §3.4.1 が正本です
- **stale revision / stale worker の拒否** — `projectRevision` と `workerGeneration` による

## 2.4 device-aware interaction

device policy が導入されているため、desktop と touch の分岐を command semantics に混ぜずに拡張できます。

- mobile 用 affordance 追加
- tablet 向け threshold 調整
- keyboard / pointer / touch の差分制御

## 2.5 design-system primitive

shell 側 UI に関しては、semantic token と primitive があるため、見た目の改善を局所化しやすくなっています。

## 3. どこまで拡張に耐えるデータモデルか

## 3.1 十分に耐える部分

以下はかなり良い形です。

- `Track / Content / Clip` 分離
- audio clip の正規形
- MIDI clip の content window
- `analysis_refs`
- `pitch_links`
- `TempoMapEdit.points`
- automation target モデル

特に `TempoMapEdit.points` を最初から複数点形式にしているのは、現行 compiler が固定テンポでも将来の可変テンポ拡張に道を残しています。

## 3.2 schema 先行の部分

以下は「モデルはあるが実働は薄い」領域です。

- `AutomationLane` / `AutomationTarget`
- `WaveformPeaks`
- 可変テンポ
- `ClipEdit.fades`(保存モデルと compiler にはあるが runtime に対応フィールドがない)

つまり、将来拡張の受け皿としては悪くないが、機能として完成しているわけではありません。

## 4. 具体的な今後の拡張候補

## 4.1 track volume / pan — 実装済み

静的な track gain / pan は一通り通っています。

| 層 | 実体 |
| --- | --- |
| command | `Command::SetTrackGain`, `Command::SetTrackPan` |
| UI | `TrackListRowPresenterParts.tsx` の gain / pan slider |
| playback | `playbackEngine.ts` が `clipGain → trackGain → StereoPannerNode` を接続 |
| offline export | `projectMixdown.ts` が `gainMilliDbToLinear` / `panPermilleToUnit` を適用 |

残っているのは automation による**時間変化**です。`AutomationTarget::TrackParam::{Gain, Pan, Mute}`
と `AutomationTargetRt::{TrackGain, TrackPan}` は存在しますが、runtime 評価がないため
値は clip 全体に対して一定です。つまり未完成なのは track gain/pan そのものではなく automation です。

## 4.2 automation envelope

automation は設計上の準備はかなりあります。

すでにあるもの:

- lane モデル
- point モデル
- target 分離
- compile 時の target existence validation
- runtime への frame 化

まだ無いもの:

- 本格的な UI
- lane の追加削除編集 command
- runtime 補間評価
- playback / export への適用

したがって、「設計は悪くないが実装はまだ重い」が正確な評価です。

## 4.3 external control API

外部から操作できる API も比較的伸ばしやすいです。

理由:

- `core/src/api.rs` がすでにある
- `core/src/wasm_bridge.rs` と plain Rust API が分かれている
- `ui/src/adapters/projectDocument.ts` に mutation 入口が寄っている
- worker protocol も typed である

注意点:

- React hook をそのまま外部 API にしてはいけない
- browser ライフサイクル都合を背負わない service boundary を切るべき

## 4.4 waveform peaks の本格活用

現在は schema 先行に近いため、波形表示のための analysis artifact として本格接続する余地があります。

これは表示性能にも効く可能性があります。

## 4.5 variable tempo

最も大きい将来拡張の 1 つです。

今は schema だけが先行し、compiler が v1 制約で止めています。可変テンポを入れると以下すべてに影響します。

- Tick -> Frame 変換
- clip frame 計算
- automation frame 化
- pitch segment 化
- render window 計算
- timeline 表示

したがって実装価値は高いが、波及範囲も広い機能です。

## 5. 現時点で未完了と明記すべきこと

## 5.1 物理レイヤ分離は未完

論理境界は改善したが、物理配置は次のままです。

- `ui/src/worker`
- `ui/src/persist`
- `ui/src/render`

これは architectural debt ではあるが、現時点で最優先ではありません。

## 5.2 complex editor surface の design-system 化は未完

以下は shell primitive 化の対象外として残っています。

- `Timeline`
- `ClipView`
- `MidiEditor`

これらは canvas 的・absolute positioning 的・gesture 中心の UI なので、単純置換では済みません。

## 5.3 waveform peaks は未成熟

前述の通り、artifact 型はあるが運用パイプラインはまだ弱いです。

## 5.4 playback path は worker prepare へ単一化済み

`PlaybackEngine.play(...)` とmain-thread compile/render dispatchは削除済みです。
通常再生はworkerの `prepare_playback` と `PlaybackEngine.playPrepared()` だけを通ります。

## 5.5 autosave は完全復元ではない

これは仕様上重要です。新規開発者はここを誤解しやすいです。

## 6. 何を「完了」とみなすか

リファクタ資料の最終評価に沿うと、現在の状態は次のように整理できます。

- 大テーマの refactor ROI は回収済み
- boundary tightening も主要残件は閉じた
- 今後は polish と将来拡張の段階

つまり「構造の方向性は固まった」が、「機能拡張と磨き込みはまだ続く」です。

## 7. 将来の保守で崩してはいけないもの

- `ProjectDocument` 以外を保存正本にしない
- raw mutator を public bridge に戻さない
- `analysis_refs` を迂回して media 単位 implicit artifact を正本にしない
- playback と export で render plan 解釈を分岐させない
- domain invariant と UI policy を混ぜない
- high-risk 領域は必ず回帰テスト先行で触る

## 8. 一言での現状評価

このプロジェクトは、単発機能を足し続けるフェーズから、設計資産を再利用しながら伸ばすフェーズに入っています。

その意味で拡張性は高いです。ただし、それは「何をしても簡単」という意味ではなく、「正しい境界を守れば安全に伸ばしやすい」という意味です。
