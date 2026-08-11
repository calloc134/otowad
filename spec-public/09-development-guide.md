# 新規開発者向け開発ガイド

## 1. 最初に読むべきファイル

実装に入る前に、最低限次を読むのが推奨です。

### ドメイン側

- `core/src/edit.rs`
- `core/src/commands.rs`
- `core/src/compiler.rs`
- `core/src/pitch.rs`
- `core/src/analysis.rs`

### フロントエンド側

- `ui/src/store/useProjectStore.tsx`
- `ui/src/adapters/projectDocument.ts`
- `ui/src/intents/clipCommands.ts`
- `ui/src/intents/projectSettings.ts`
- `ui/src/hooks/useAudioEngine.ts`
- `ui/src/hooks/usePersistence.ts`

### コアドメイン側

- `ui/src/audio/pitchPlan.ts`
- `ui/src/audio/clipRenderPlan.ts`
- `ui/src/audio/tdpsolaV2/v2Adapter.ts`(既定の合成コア)

## 2. 変更箇所の選び方

## 2.1 core を触るべきケース

- 保存 JSON の意味が変わる
- command semantics が変わる
- split / trim / stretch / warp の挙動が変わる
- pitch follow の意味が変わる
- compile エラー条件が変わる

## 2.2 UI を触るべきケース

- gesture / shortcut / dialog の挙動を変える
- state slice の持ち方を変える
- component のレイアウトを変える
- busy overlay や device policy を変える

## 2.3 worker / persist / render を触るべきケース

- heavy job を offload したい
- archive の read/write を変えたい
- export path を変えたい
- browser 保存と復元の挙動を変えたい

## 3. 実装時の鉄則

## 3.1 command literal を component に戻さない

新しい操作を足すときは、まず `intents` に置くべきかを考えます。

悪い例:

- component の onClick 内で直接巨大 command object を組む

良い例:

- `buildXxxCommand()` を `ui/src/intents` に置く
- component ではその結果を `actions.applyCommand()` に渡すだけにする

## 3.2 TypeScript mirror を忘れない

Rust 側の serde 形式を変えたら、`ui/src/types/project.ts` も更新が必要です。

ここを忘れると、実行時 JSON parse で壊れます。

## 3.3 runtime cache を保存正本に混ぜない

以下を `ProjectDocument` に足してはいけません。

- rendered buffer
- prepared playback schedule
- worker state
- decoded media cache
- transport UI state

## 3.4 worker message を足すときのルール

envelope の必須フィールドは **`05` §3.1 が正本**です。ここでは重複させません。以前この節は
`workerGeneration` を落とした一覧を持っていて、`05` の記述と食い違っていました。

やることは3つです。

- `05` §3.1 の envelope をそのまま満たす(`workerGeneration` を含む)
- client / worker 両方の型と validation を更新する
- `workerGeneration` を落とさない。これは worker instance の世代で、世代が一致しない応答は
  `requestId` が一致しても `STALE_WORKER_GENERATION` として拒否されます。worker を差し替えた
  直後に旧 worker から届く応答を弾いているのがこのフィールドです

## 3.5 archive を触るときのルール

- `prepareCanonicalProjectArchivePayload()` を通す
- `project.json + media/ + optional analysis/` を崩さない
- `analysis_refs` と archive 内容が矛盾しないようにする

## 3.6 runtime dependency の配布物を足すときのルール

browser へ配布する第三者バイナリには、package 名・固定 version・license・取得元・対応ソースを
配布成果物の notice に含めます。FFmpeg/WASM の正本は
`ui/public/third-party/ffmpeg-wasm-NOTICE.txt` と `GPL-2.0.txt` です。
`npm audit` は脆弱性の gate であって license 確認の代替ではありません。runtime asset を
更新した場合は notice と build-time 同梱検査も同じ変更で更新します。

## 4. 変更テーマごとのおすすめ入口

## 4.1 クリップ操作

まず見る:

- `core/src/commands.rs`
- `ui/src/intents/clipCommands.ts`
- `ui/src/hooks/useClipDrag.ts`
- `ui/src/hooks/useClipResize.ts`

## 4.2 プロジェクト設定

まず見る:

- `core/src/commands.rs`
- `ui/src/intents/projectSettings.ts`
- `ui/src/components/Toolbar.tsx`
- `ui/src/components/dialogs/GridDialog.tsx`
- `ui/src/components/dialogs/TimeSignatureDialog.tsx`

## 4.3 pitch / TD-PSOLA

まず見る:

- `core/src/pitch.rs`
- `core/src/analysis.rs`
- `ui/src/audio/pitchPlan.ts`
- `ui/src/audio/clipRenderPlan.ts`
- `ui/src/audio/tdpsolaV2/v2Adapter.ts`

`ui/src/audio/tdpsola.ts` は `legacy_v1` です。production からは選択されないので、
既定の挙動を追うときに読む必要はありません(`06` §10)。

## 4.4 保存 / 読込

まず見る:

- `ui/src/persist/projectArchive.ts`
- `ui/src/persist/browserProjectStore.ts`
- `ui/src/hooks/usePersistence.ts`
- `ui/src/worker/projectWorker.ts`

## 4.5 再生 / export

まず見る:

- `ui/src/hooks/useAudioEngine.ts`
- `ui/src/audio/playbackPreparation.ts`
- `ui/src/render/projectMixdown.ts`
- `ui/src/hooks/useExport.ts`

## 5. テストと確認

このリポジトリで最低限使う確認コマンドは次です。

### core

```bash
cd core && cargo test
```

### ui

```bash
cd ui && npm run typecheck
cd ui && npm run lint
cd ui && npm run lint:deadcode
cd ui && npm run test:unit
cd ui && npm run test:components
cd ui && npm run audit:dependencies
cd ui && npm run build
```

### WASM 再生成が必要なとき

```bash
cd ui && npm run wasm
```

## 6. 実装中に起きやすい誤解

## 6.1 `ui/` は見た目だけ、ではない

worker / persist / render / audio が同居しています。UI はブラウザ統合層です。

## 6.2 `analysis_refs` は飾りではない

`AudioContentEdit.analysis_refs` は compile/render の正本です。ただし「明示 ref が無ければ何も
使わない」わけではありません。正確な契約は次の通りです。

- **明示された `analysis_refs` があればそれが優先される**
- 足りない kind (F0 / pitch marks) は、**同じ `media_id` に紐づく artifact から決定的に補完される**
  (`analysisResolution.ts` の `resolvePreferredAnalysisRefs`)
- 補完した結果は `buildProjectWithResolvedAnalysisRefs()` が document の clone へ**書き戻してから**
  compile / archive に渡す。つまり derived な選択が暗黙のまま残ることはない

禁止されているのは、**この経路を通さずに「その media の最新っぽい解析」を掴むこと**です。順序が
非決定的になり、保存物と再生結果が一致しなくなります。fallback 自体は禁止されていません。

以前この節は「implicit media cache で代用してはいけません」とだけ書いており、fallback 全体を
禁じているように読めました。その読み方に従うと、正しく動いている解決経路を削ってしまいます。
詳細は `06` §5 です。

## 6.3 `ProjectDocument` を直接 mutable にいじれば早い、は危険

必ず command semantics を確認してください。特に split、warp、MIDI trim は invariant が多いです。

## 6.4 autosave は full save ではない

復元保証の意味を取り違えないことが重要です。

## 7. 次に理解すると役立つ実装順

一通り読んだ後は、次の順で掘ると理解が深まります。

1. `Timeline` での clip 操作
2. `MidiEditor` での note 操作
3. `useAudioEngine` から worker prepare まで
4. `projectArchive` の save/open
5. `tdpsolaV2/` の diagnostics と analysis policy

## 8. デプロイ (継続的デプロイ)

デプロイは手動 `npm run deploy` ではなく、`.github/workflows/ci.yml` が自動で行います。

| きっかけ | 対象 Worker | URL |
| --- | --- | --- |
| `main` への push / `workflow_dispatch` | `otomad-daw` | https://otomad-daw.calloc134personal.workers.dev |
| PR の作成・更新 | `otomad-daw-preview` | https://otomad-daw-preview.calloc134personal.workers.dev |

### 動作の前提

- `deploy-production` / `deploy-preview` は `dependency-audit`、`core-test`、`ui-check` の
  `needs` になっています。監査またはテストが落ちた変更は配信されません。
- `dependency-audit` は full npm graph を high threshold で検査し、RustSec の `cargo audit` も
  実行します。transitive dependency の安全版固定は `ui/package.json` の `overrides` に明記します。
  監査除外を暗黙にせず、新規 runtime dependency はこの gate の下で追加します。
- 配信するのは `ui-check` が `npm run build` で作り、artifact `ui-dist` に
  上げた成果物そのものです。deploy 側で再ビルドはしません。検証した中身と
  配信する中身をずらさないためです。
- preview Worker は 1 つを全 PR で共有します。複数 PR が同時に走ると後勝ちに
  なるので、確認したい PR の CI を再実行してから見てください。
- fork からの PR と dependabot PR では preview デプロイをスキップします。
  これらには secrets が渡らず、実行しても必ず失敗するためです。

### 必要な secrets

リポジトリ設定の `Settings > Secrets and variables > Actions` に登録します。

- `CLOUDFLARE_API_TOKEN` (必須) — Cloudflare の API トークン。
  `Edit Cloudflare Workers` テンプレート、または `Workers Scripts: Edit` 権限。
- `CLOUDFLARE_ACCOUNT_ID` (任意) — トークンが複数アカウントを見られる場合のみ必要。

トークン未設定のまま `main` に push すると、deploy job の
`Verify Cloudflare credentials` で明示的に失敗します。

### 手元から直接デプロイしたいとき

```bash
cd ui && npm run deploy          # 本番
cd ui && npm run deploy:preview  # preview
```

通常は CI に任せてください。手元デプロイは CI が通っていない中身を本番に
上げられてしまいます。

## 9. 最後に

このプロジェクトで一番大事なのは、速く機能を足すことより、正本と派生値の境界を壊さないことです。

その境界を守れれば、今のアーキテクチャはかなり拡張しやすくできています。
