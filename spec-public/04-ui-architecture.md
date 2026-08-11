# UI アーキテクチャ

## 1. UI 層の位置づけ

このプロジェクトの `ui/` は、単なる React 画面ではありません。実態としては「ブラウザ上で動く DAW アプリケーション全体」です。

含まれているものは以下です。

- React component による表示
- pointer / keyboard / touch gesture 解釈
- project state の保持
- core WASM との接続
- Web Worker orchestration
- browser 保存
- offline render/export
- TD-PSOLA を含む frontend 側音声処理

したがって、`ui/` を「表示層」とだけ理解すると構造を見誤ります。より正確には「ブラウザ統合層」です。

## 2. ディレクトリごとの責務

| 場所 | 主な責務 |
| --- | --- |
| `ui/src/components` | 画面部品、editor surface、dialog |
| `ui/src/store` | `ProjectProvider` と actions API |
| `ui/src/state` | reducer、slice context、state 型 |
| `ui/src/intents` | UI 操作を semantic command に変換 |
| `ui/src/adapters` | WASM / import / project mutation 境界 |
| `ui/src/hooks` | audio、persist、export、import などの副作用オーケストレーション |
| `ui/src/audio` | 再生準備、analysis store、render plan、TD-PSOLA、media cache |
| `ui/src/worker` | worker client、protocol、worker 本体 |
| `ui/src/persist` | archive、browser save、autosave、File System Access |
| `ui/src/render` | offline mixdown、WAV encode |
| `ui/src/app` | global hotkeys、device interaction policy |
| `ui/src/design-system` | token、contracts、primitive |
| `ui/src/types` | Rust serde JSON 契約の TypeScript mirror |

## 3. UI の基本データフロー

現在の UI は、概ね次のように流れます。

```text
component
  -> hook / store slice
  -> intent
  -> actions.applyCommand(...)
  -> adapter
  -> wasm bridge
  -> core command apply
  -> 新しい ProjectDocument
  -> reducer / context 更新
```

この流れの狙いは、component が command literal を直接組み立てないことです。

## 4. 状態管理

## 4.1 `ProjectProvider` が統合入口

`ui/src/store/useProjectStore.tsx` の `ProjectProvider` が UI state を束ねます。

内部では `useReducer(projectReducer, initialProjectState)` を使い、次の context に分割して公開します。

- `DocumentStateContext`
- `SelectionStateContext`
- `ViewportStateContext`
- `TransportStateContext`
- `MidiEditorStateContext`
- `ProjectActionsContext`

この分離はリファクタ後に導入されたもので、full-state 購読による不要再レンダを抑える意図があります。

## 4.2 state slice の内容

`ui/src/state/projectStoreTypes.ts` では次の slice が定義されています。

### Document

- `document`
- `projectRevision`
- `undoStack`
- `redoStack`
- `hasUnsavedChanges`

### Selection

- `selectedTrackId`
- `selectedClipIds`
- `primaryClipId`
- `timeSelectionStartTick`, `timeSelectionEndTick`

### Viewport

- `zoom`
- `scrollX`, `scrollY`

zoom と scroll が Selection ではなく独立 slice なのは、購読者が違うからです。スクロールは
毎フレーム変わりうるのに対し選択は変わらないので、同じ context に置くと選択だけを見ている
コンポーネントがスクロールごとに再レンダされます。

### Transport

- `playheadTick`
- `loopEnabled`
- `isPlaying`
- `error`
- `busyTask`

### MIDI Editor

- `midiEditorTarget`

### Global

- `wasmReady`

media availability は persisted document state ではありません。decoded media cache と現在の document を突き合わせる runtime registry であり、missing/invalid media の件数と手動 Relink 操作は status bar に表示されます。

## 4.3 actions はアプリケーションサービスに近い

`useProjectActions()` は UI から見た command / state 更新の正規入口です。

主な責務は以下です。

- project 作成
- project 設定
- command apply
- undo/redo
- selection 更新
- transport 更新
- error / busy state 更新
- runtime cache の clear

内部では `analysisStore.clear()` や `mediaCache.clear()` も呼ぶため、単なる reducer dispatch より一段上の orchestration 層になっています。

## 5. intents と adapters による疎結合化

## 5.1 intents の役割

`ui/src/intents` は UI event を semantic command に変換する純関数群です。

代表例:

- `timeline.ts`
- `clipCommands.ts`
- `projectSettings.ts`
- `trackList.ts`
- `midiEditor.ts`
- `hotkeys.ts`
- `pitchLink.ts`

例えば以下のような責務を持ちます。

- split command の生成
- clip move batch の生成
- audio red trim / blue stretch command の生成
- grid settings / time signature command の生成
- pitch 調整 command の生成

つまり「UI で何が起きたか」を「domain で何をしたいか」に翻訳する層です。

## 5.2 adapters の役割

`ui/src/adapters/projectDocument.ts` は WASM との接続点です。

- `create_project`
- `apply_command_json`
- `apply_internal_command_json`

に対して、TypeScript 側の `ProjectDocument` / `Command` を受け渡します。

具体的には以下を行います。

- 読み込んだ `ProjectDocument` の clip tick 正規化
- semantic `Command` の JSON 化（値を補正せず core へ渡す）
- public command と internal inverse command の使い分け

この adapter があるため、component や hook が直接 wasm 関数を触らなくて済みます。
Command の tick は intents / interaction helper が整数として組み立て、domain invariant は
Rust core が検証します。adapter は不正値を丸めて成功へ変えません。

## 6. component / hook の責務分担

## 6.1 components

主要 component は次の通りです。

- `App.tsx`
- `Toolbar.tsx`
- `TrackList.tsx`
- `Timeline.tsx`
- `ClipView.tsx`
- `MidiEditor.tsx`

`App.tsx` は provider root と application wiring だけを持ちます。責務は次へ分離されています。

- `app/useAppBootstrap.ts` — WASM 初期化、autosave 復元、初期 project 作成
- `app/usePersistenceLifecycle.ts` — unsaved project の `beforeunload` guard
- `app/useAppGlobalInteraction.ts` — global hotkey、project dialog、portrait guidance、service worker update
- `components/app-shell/DawShell.tsx` — shell routing、editor surface、busy / portrait / update overlay

`DawLayout` は store と application service hook を接続して上記4責務へ渡す composition root です。
個別 lifecycle や表示実装を持ちません。

## 6.2 hooks

hooks は UI と副作用を橋渡しする層です。

- `useAudioEngine.ts`
- `usePersistence.ts`
- `useExport.ts`
- `useFileImport.ts`
- `useClipDrag.ts`
- `useClipResize.ts`
- `useMidiEditor.ts`
- `useWarpAnchor.ts`

これらは実質的に「frontend application service」です。React hook という形を取っていますが、責務としてはかなり重いです。

callback から最新 state を読む mutable ref は render 中に更新しません。commit 後の
`useLayoutEffect` で最新 render を反映し、command の連続適用など同一 event 内で次の操作へ
引き継ぐ必要がある値だけを event callback 内で同期更新します。破棄され得る concurrent render が
committed state の ref を先行して書き換えないための規則です。

## 6.3 まだ厚い部分

疎結合化は進んでいるものの、以下は依然として密度が高いです。

- `ui/src/components/Timeline.tsx`
- `ui/src/components/ClipView.tsx`
- `ui/src/components/MidiEditor.tsx`
- `ui/src/hooks/useAudioEngine.ts`
- `ui/src/hooks/usePersistence.ts`
- `ui/src/hooks/useExport.ts`

これらは editor surface、再生準備、保存、export の中心なので、今後も大きくなりやすい注意領域です。

## 6.4 Timeline の描画 window

`Timeline.tsx` は canvas の全幅・全高を scroll authority として維持しつつ、viewport と
overscan に交差する clip、track lane、ruler / grid step だけを mount します。clip の交差判定は
timeline の半開区間に従い、配列の source order を変えません。active drag clip は viewport 外でも
常に mount し、gesture 中の unmount を防ぎます。

表示集合の計算は `timeline/timelineVirtualization.ts` の pure 関数が正本です。

## 6.5 Shell の情報階層と短尺 clip

Desktop Toolbar は primary / secondary の2行です。primary は Project menu、project name、
transport、playhead / tempo / meter、Export を持ちます。secondary は Undo / Redo、Grid / Snap、
Pitch Link、Zoom、Fullscreen を持ち、制作の主動線と設定系操作を視覚的に分離します。
New / Save / Project Manager は Project menu に集約します。Touch shell は Stop / Play と現在位置を
常設し、Loop と同じ補助操作を More Tools disclosure から到達可能にします。phone 幅では Loop を
top row に重ねず disclosure へ移すことで、transport と More Tools の tap target を競合させません。

Status Bar は選択対象、Time/Pitch mode、busy / render、missing media、error / warning などの
contextual information だけを表示します。BPM、Grid、Zoom、Pitch Link count、track / clip count の
定常メトリクスは Toolbar と重複させません。

Timeline 上の幅が 52px 未満の clip は波形または MIDI preview だけを描画し、name、pitch、gain、
in-clip action strip を描画しません。選択中 clip の素材名、coarse / fine pitch、gain、
Time/Pitch mode は Status Bar の Inspector が表示します。

## 6.6 MIDI editor の content window

`MidiEditor` は対象 clip の `content_in` / `content_out` を半開区間
`[content_in, content_out)` として扱います。共有 MIDI Content の note のうち、start と end が
この区間へ完全に収まるものだけを描画・hit test・marquee / Select All の対象にします。

note 作成、move、duplicate、resize は同じ window 内へ制約します。playhead と ruler seek も
対象 clip の window 外では表示・更新しません。editor の horizontal geometry は `content_out` を
必ず含み、現在の window を左右境界付き overlay で示します。座標は Content Tick のまま保持し、
Project Tick との変換は `clipStart` と `contentIn` を使う既存の変換関数を経由します。
3,000 clip fixture を naive pixel rectangle と比較する unit test と、実際の DOM mount 数を
検査する component test があります。`ClipView` は `React.memo` で parent の scroll rerender を
遮断しますが、内部 hook の interaction state 更新は従来どおり受け取ります。

## 6.7 SMF import boundary

`ui/src/utils/midiSmf.ts` は Standard MIDI File を project command へ変換する前の
敵対的入力境界です。truncated `MThd` / `MTrk`、4 byte を超える VLQ、未対応 status、
prior status のない running status、宣言 chunk 群の後ろに残る未解析 byte を拒否します。
track count と chunk length で定義された領域を完全に消費しないファイルを、部分成功として
受け入れません。

## 7. UI と WASM の境界

## 7.1 UI 側の責務

UI が持つ責務は以下です。

- gesture と入力解釈
- selection / zoom / scroll / dialog state
- browser API 利用
- media decode と cache
- worker orchestration
- compile 済み plan の frontend 音声処理への橋渡し

## 7.2 WASM 側の責務

WASM 側は以下までです。

- project document 生成
- command apply
- validation
- save 用 serialize
- F0 / pitch marks 生成
- pitch / warp compile plan 生成

したがって境界線は次のように整理できます。

- project の意味を決めるのは WASM/core
- project をどう操作させるか、どう見せるかを決めるのは UI

## 7.3 audio import decoder boundary

音声 import は `ui/src/audio/audioFileDecoder.ts` を単一入口とし、次の順序で decode します。

1. `AudioContext.decodeAudioData()` を native fast path として試す
2. native が codec 非対応を示す `EncodingError` を返した場合だけ、single-thread の
   FFmpeg/WASM compatibility decoder を dynamic import する
3. `InvalidStateError` / `DataCloneError` など codec 以外の失敗は、そのまま呼び出し元へ返す

両経路の結果は `DecodedAudioSource` に揃えます。`decode({ startSrcFrame, endSrcFrame })` は
source frame の half-open range を受け取り、PCM chunk の async iterable を返します。現時点では
全量 decode 後に1 chunkを返しますが、consumer は全量 `AudioBuffer` を前提にしない契約です。
native 経路の `toAudioBuffer()` は `decodeAudioData()` が返した buffer identity を維持します。

FFmpeg 経路は入力ごとに仮想 FS を清掃し、同一 instance の job を直列化して、24-bit PCM WAV
へ変換します。FFmpeg の WAV muxer はこれを `WAVE_FORMAT_EXTENSIBLE` として出力するため、
compatibility 経路だけ `allowExtensiblePcm` を指定し、PCM SubFormat GUID を検証して読みます。
project archive の PCM reader は opt-in せず、従来どおり basic PCM 以外を拒否します。

展開前 32MB の core WASM は Cloudflare Workers Assets の 25MiB/file 上限を超えるため、build
時に version 固定の gzip asset へ変換して self-host します。dev server は gzip を HTTP 層で
透過展開する一方、Cloudflare Workers Assets は gzip body を未展開で返すため、loader は先頭の
WASM / gzip magic を判定し、必要な場合だけ `DecompressionStream("gzip")` で復元した Blob URL
を FFmpeg に渡します。外部 CDN と CSP 例外は追加しません。

## 8. デバイス差分とレスポンシブ

## 8.1 capability-based policy

このプロジェクトの device 対応は、単なる CSS breakpoint 中心ではありません。

`ui/src/app/deviceInteraction.ts` が、以下を元に capability を解決します。

- `matchMedia("(pointer: coarse)")`
- `matchMedia("(hover: hover)")`
- `navigator.maxTouchPoints`
- `viewportWidth`, `viewportHeight`

その結果として次の policy を返します。

- `TimelineInteractionPolicy`
- `MidiEditorInteractionPolicy`
- `TrackListInteractionPolicy`
- `DialogInteractionPolicy`

## 8.2 device によって変わること

変化するのは domain 意味論ではなく、主に入力条件です。

- drag 開始閾値
- split の long press 条件
- modifier shortcut の許可可否
- wheel の挙動
- clip action のサイズ
- rename / reorder の explicit action 表示
- dialog action のサイズ

つまり「PC とスマホで別の DAW を作る」のではなく、「同じ機能を異なる入力 affordance で露出する」設計です。

補足として desktop timeline shell では、wheel / modifier の扱いを UI 契約として次のように固定します。

- bare `Alt` はブラウザ/アプリメニューへ渡さず、DAW shell 内で抑止する
- timeline と track list は同じ wheel resolver を使い、`Shift + wheel` は縦スクロール、`Alt + wheel` は横スクロールとして統一する
- zoom を解釈した wheel は native scroll を起こさない
- `Escape` は main timeline で clip / track / time selection をまとめて解除する
- file drop preview が見えている領域は実 drop hit area と一致しなければならない

すべての pointer session で `pointercancel` は rollback として扱います。Clip drag / resize、
Timeline marquee、Track reorder、MIDI note drag は transient preview と pointer capture を消し、
semantic command を発行しません。cancel 後に遅れて届く `pointerup` も commit しません。

## 8.3 portrait guidance

`App.tsx` と `global.css` は、touch-like device かつ縦長表示時に portrait guidance overlay を出します。

これは「完全に mobile 非対応」ではなく、「タイムライン編集は landscape 前提に近い」という現実的な制約を UI に反映したものです。

## 8.4 CSS レスポンシブ

CSS 側でも以下の対応があります。

- toolbar の折り返し
- project management dialog の 1 カラム化
- busy overlay / portrait overlay のレイアウト

ただし全体の差分は CSS breakpoint よりも interaction policy 側が主体です。

## 8.5 フルスクリーン表示

`html / body / #root` は `height: 100%; overflow: hidden` で、ページは一切
スクロールしません。モバイルブラウザのアドレスバー自動格納はスクロールで
発動するため、**CSS だけではブラウザ UI を減らせません**。経路は 2 つです。

### Fullscreen API

`ui/src/hooks/useFullscreen.ts` が document 単位の出入りを扱い、
`ui/src/components/toolbar/FullscreenToggle.tsx` がツールバーに露出します。

- 判定は `requestFullscreen` の有無ではなく `fullscreenEnabled` を見ます。
  権限を渡さない iframe 内ではメソッドだけ生えているためです。
- **iPhone Safari は要素フルスクリーン非対応**（`<video>` のみ）。iPad は可。
  非対応端末ではボタン自体を描画しません。無反応なボタンより無いほうがましです。
- 状態はローカル boolean ではなく `fullscreenchange` から復元します。Escape や
  システムジェスチャでの離脱をミラーした boolean は追随できません。

### PWA インストール

`ui/public/manifest.webmanifest` が `display: fullscreen` を宣言します。
ホーム画面から起動するとブラウザ UI が完全に消えるため、**iPhone で
フルスクリーンにする唯一の手段**です。

- `orientation` は意図的に指定していません。portrait は `8.3` のとおり
  「dismiss できる助言」であり、manifest で landscape に固定すると
  その判断を打ち消します。
- iOS が manifest の `display` を尊重するのは 16.4 以降です。それ以前向けに
  `index.html` の `apple-mobile-web-app-capable` を併記しています。
- `apple-mobile-web-app-status-bar-style: black-translucent` は
  `viewport-fit=cover` と safe-area inset が既にある前提の設定です。
- アイコンは `ui/scripts/icons/*.svg` が正本で、PNG は
  `ui/scripts/icons/render.sh` で再生成します（要 librsvg）。

## 8.6 オフライン起動 (Service Worker)

`vite-plugin-pwa` (`generateSW`) が `dist/sw.js` を生成し、app shell を
プリキャッシュします。`ui/vite.config.ts` の設定で意図があるのは次の点です。

- `globPatterns` に **`wasm` を明示追加**。Workbox の既定 glob に wasm は
  含まれず、そのままだと「オフライン対応を名乗るが起動時に落ちる」ビルドが
  できあがります。
- `maximumFileSizeToCacheInBytes` を 8MB に引き上げ。既定の 2MB を超えた
  ファイルはビルドログの警告だけで**黙ってプリキャッシュから外れます**。
  core wasm は現在 ~1.2MB で、DSP 作業とともに増えます。
- `globIgnores` で optional な FFmpeg compatibility asset を明示除外します。通常の
  import は `decodeAudioData()` を使い、`EncodingError` で拒否された形式だけ dynamic import した
  single-thread FFmpeg/WASM で 24-bit PCM WAV へ変換します。app shell と通常形式は
  offline で扱えますが、互換経路の初回利用にはネットワークが必要です。production build は
  32MB 級 WASM を 25MiB 未満の gzip asset にし、raw WASM と gzip asset のどちらも precache に
  入っていないことを検査します。`public/third-party/` のライセンスと正確な対応ソース情報が
  配布物に入ることも同じ gate で確認します。
- `manifest: false` — manifest は `public/` の手書き版が正本。プラグインにも
  生成させると `rel="manifest"` を 2 つが奪い合います。
- `devOptions.enabled: false` — dev で SW が編集中のファイルをキャッシュします。

### 更新戦略: 自動リロードしない

`registerType: "prompt"` を使い、`ui/src/hooks/useServiceWorkerUpdate.ts` が
新版の待機を検知して `UpdatePrompt` に出します。**`skipWaiting` による自動
入れ替えは採用しません。**

理由は autosave の性質です。リロードはメモリ上のデコード済みメディアバッファを
破棄しますが、autosave が復元できるのは project JSON だけで、メディアは
`AUTOSAVE_RESTORE_CONFIRM_MESSAGE` が明言するとおり復元しきれません。編集中の
DAW が黙って再読込することは許容できないので、実行はユーザーの明示操作に限り、
プロンプト自身が失われるものを警告します。

### 実機で確認済みのこと

- SW が `activated` かつページを制御した状態で `crossOriginIsolated === true`
  を維持（キャッシュされた index.html が COOP/COEP ヘッダを保持するため）
- ディスク上の実ファイルを書き換えても、ページはキャッシュ側の内容を受け取る
  = ネットワークに触れずに応答している

テストは `virtual:pwa-register` を `src/test/pwaRegisterStub.ts` に alias して
（`vitest.config.ts`）、ライフサイクルを手で駆動しています。

### cross-origin isolation の serving parity

`ui/vite.config.ts` の `server.headers` / `preview.headers` と、Cloudflare assets が読む
`ui/public/_headers` は、いずれも次を返します。

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

2026-08-11 に Vite dev server、PR preview Worker、production Worker の `/` を直接取得し、
3環境で一致することを確認しました。したがって dev だけ `SharedArrayBuffer` 要件が異なる状態には
なっていません。threaded WASM を有効化するときは、header の存在に加えて実行時の
`crossOriginIsolated` を capability gate として扱います。

## 9. デザインシステム

## 9.1 現在の方向性

`ui/src/design-system` は shell 系 UI の再利用単位を提供します。

- `contracts.ts`
- `tokens.ts`
- `primitives.tsx`
- `trackKindColors.ts` — audio/midi/other 別の色パレットとタイムラインオーバーレイ色を一元化

主要 primitive は以下です。

- `Button`
- `IconButton`
- `Panel`
- `Dialog`
- `ToolbarGroup`
- `FieldRow`
- `MetricChip`
- `StatusPill`

## 9.2 PandaCSS との関係

`ui/package.json` の build は `panda:codegen` を含みます。PandaCSS/styled-system が build に組み込まれ、shell UI・dense editor surface・dialog 群のすべてが Panda `css()` / recipe で構造化されています。

- shell UI (Toolbar/StatusBar/Dialog/AppShell) は primitive + recipe で管理
- dense editor surface (Timeline/ClipView/MidiEditor/TrackList) の `surfaceStyles.ts` は `css()` で className を返す形式に統一済み
- dialog 群 (Bpm/TimeSignature/Grid/PitchLink/TrackCreate/TrackDelete/ProjectManagement*) はローカル `Record<string, CSSProperties>` パターンを廃止し、各要素が `css()` classNameを持つ形式に統一
- `global.css` は **CSS 変数(`:root`)、2 種の keyframe (`busy-pulse`, `toolbar-spin`)、そして
  base reset** を保持する。クラス定義は残っていない(`.foo {}` 形式の選択子は 0)が、
  141 行目以降に element / pseudo-element の base rule が約 13 ブロックある
  (`*`, `html, body, #root`, `body`, `button, input, select, textarea`,
  `button:hover:not(:disabled)`, `button:disabled`, `input:focus, select:focus, textarea:focus`,
  `::-webkit-scrollbar` 系)。**これは Panda 移行の残骸ではなく意図的な reset 層**で、
  component 側で打ち消す前提の既定値を置いている
- 全体で `Record<string, CSSProperties>` のスタイル束は撲滅済み(`design-system/tokens.ts` の `typeStyles` のみが authoritative な例外として `satisfies CSSProperties` を使用)
- inline `style` prop の主用途は「実行時に決まるジオメトリ(width, left, top)」「Button/IconButton
  primitive の recipe を越えるための個別 override」「テストが `element.style` を直接読む
  overscroll behavior」だが、**限定されてはいない。** 単一行で書かれた inline style 19 箇所のうち
  11 箇所はこの 3 分類の外にあり、内訳は次の2つに寄っている。
  - **状態依存の見た目**(8) — `opacity: cond ? 1 : 0.45`、`color: isNameInvalid ? …`、
    `boxShadow: isPlaying ? …`、`backgroundColor: typeBg`。ジオメトリではなく boolean 由来の
    視覚状態で、Panda の条件付き style や `data-*` 属性へ移せる種類
  - **静的値の置き忘れ**(3) — `flex: "0 0 72px"`(2 箇所)、`accentColor: "var(--accent-green)"`。
    実行時入力がないので `css()` に入れられる

  複数行で書かれた `style={{` 60 箇所は分類していない。したがって上の数は下限であり、
  「移行完了」と読まないこと

## 9.3 現在の UI デザイン言語

`ui/src/global.css` と `ui/src/design-system/tokens.ts` から読み取れる方向性は次の通りです。

- ダークシェル基調
- 青を主アクセント、緑/アンバー/赤を feedback に使用
- グラデーションと panel shadow を多用
- UI フォントは `Avenir Next` 系、mono は `JetBrains Mono` 系
- shell と dialog は glassy すぎず、密度高めのツール UI に寄せている

## 9.4 適用範囲の限界

design-system が十分効いているのは主に shell 側です。

- `Toolbar`
- `StatusBar`
- dialog 群
- project management 系 UI

editor surface(`Timeline`/`ClipView`/`MidiEditor`/`TrackList`)は 2026-07 の PandaCSS 完全移行で `css()` ベースになりましたが、静的スタイル(container / ruler / grid)と動的ジオメトリ(width / left / top)の分離という構造は各 `surfaceStyles.ts` に集約されています。dense editor 特有のロジック(ドラッグ・ワープ・分割・ピッチ追従)はそのままの複雑さで残っており、design-system primitive でラップできる shell UI とは性質が異なります。

## 10. フロントエンドは疎結合か

## 10.1 Yes と言える点

- intent 層で command 組み立てを分離している
- adapter 層で wasm 境界を閉じ込めている
- state slice を分けて再購読を減らしている
- worker protocol が typed envelope で固定されている
- design-system contracts により shell UI の surface が安定している

## 10.2 まだ No と言うべき点

- `Timeline`, `ClipView`, `MidiEditor` が大きい
- singleton が多い
  - `PlaybackEngine`
  - `analysisStore`
  - `mediaCache`
  - `projectWorkerClient`
- `ui/` 配下に worker / persist / render が同居している
- audio 処理と UI hook の境界はまだ厚い

したがって結論は「かなり疎結合化されたが、完全に薄い frontend ではない」です。

## 11. 新規開発者向けの読み順

UI を理解するときは次の順が良いです。

1. `ui/src/App.tsx`
2. `ui/src/store/useProjectStore.tsx`
3. `ui/src/state/projectStores.ts`
4. `ui/src/adapters/projectDocument.ts`
5. `ui/src/intents/clipCommands.ts`
6. `ui/src/intents/projectSettings.ts`
7. `ui/src/components/Toolbar.tsx`
8. `ui/src/components/Timeline.tsx`
9. `ui/src/components/MidiEditor.tsx`
10. `ui/src/hooks/useAudioEngine.ts`

この順で追うと、UI がどこまで domain に近づいていて、どこから browser orchestration になるかが見えます。
