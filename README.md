# OTOWAD

**OTOWAD(おとわっど)** は、音MAD 制作のためのブラウザ DAW です。音声を音節単位に刻み、断片ごとに音程を変え、数百個の短いクリップをグリッドに並べる——そういう編集を対象にしています。

多くの DAW ではこの作業は例外的な使い方として扱われます。このプロジェクトはそれを中心に設計しています。ピッチシフトは汎用のタイムストレッチではなく source-native な TD-PSOLA を使い、クリップは MIDI のメロディに追従でき、非常に短いクリップが画面上に数千個並んでもタイムラインは応答性を保ちます。

すべてブラウザ内で動作します。バックエンド、アップロード、アカウントはありません。プロジェクトはブラウザのストレージか、自分で保存したファイルとして存在します。

## できること

- **タイムライン編集** — オーディオクリップと MIDI クリップの split / trim / stretch / warp
- **ピッチシフト** — source-native TD-PSOLA(音声素材向け)
- **MIDI pitch follow** — MIDI のメロディでオーディオクリップの音程を駆動する
- **Phase vocoder モード** — TD-PSOLA が向かない素材(音楽、和音)向け
- **WAV エクスポート** — 再生タイミングとは独立にオフラインでレンダリング
- **プロジェクトファイル** — 自己完結アーカイブ(project JSON + メディア + 解析結果)
- **オフライン動作** — PWA としてインストールでき、ネットワークなしで起動する

### 対応する入力

| 種類 | 拡張子 |
| --- | --- |
| Audio | `wav` `wave` `aif` `aiff` `flac` `ogg` `mp3` `m4a` `aac` |
| MIDI | `mid` `midi` |

オーディオのデコードはまずブラウザ標準のデコーダを使います。ブラウザがデコードできなかった場合は、同梱の FFmpeg/WASM フォールバックが処理します。これにより、各ブラウザのコーデック対応状況に依存せず、どのブラウザでも同じようにプロジェクトが開きます。フォールバックはこの失敗経路でのみ遅延取得されるので、一般的なフォーマットでは読み込まれません。

動画ファイルには未対応です。

## 試す

<https://otomad-daw.calloc134personal.workers.dev>

## ローカルで動かす

Node.js、Rust、[`wasm-pack`](https://rustwasm.github.io/wasm-pack/) が必要です。

```bash
cd ui
npm install
npm run dev
```

`predev` が Rust core を WASM にビルドし、FFmpeg アセットを準備するので初回は時間がかかります。以降は `core/` を変更しない限り `npm run dev` だけで足ります。

### チェック

```bash
# Rust
cd core
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --all

# UI
cd ui
npm run typecheck
npm run lint
npm run lint:deadcode
npm run test:unit
npm run test:components
npm run build
```

`npm run build` はデプロイ不変条件も検証します。FFmpeg の WASM が self-host されていること、ホスティングのファイルサイズ上限内に圧縮されていること、PWA の precache から除外されていること、ライセンス通知が同梱されていること。**通知が欠けている場合はビルドが失敗します** — 黙って出荷されることはありません。

## 構成

このコードベースの中心は UI ではありません。`ProjectDocument` と、それを取り巻く command / compile 契約です。

```
UI event → intent → adapter → WASM bridge → core command apply → ProjectDocument
                                                                      │
                                              派生。保存はしない      ▼
                              runtime · pitch plan · prepared playback · caches
```

| 層 | 場所 | 責務 |
| --- | --- | --- |
| ドメイン正本 | `core/src/edit.rs` | 永続化される project モデル |
| 編集意味論 | `core/src/commands.rs` | command apply、undo/redo 用の inverse command |
| 検証と導出 | `core/src/compiler.rs`, `pitch.rs`, `runtime.rs` | Edit から runtime と pitch plan を導出 |
| WASM 境界 | `core/src/wasm_bridge.rs` | JSON/JS bridge |
| フロントエンド統合 | `ui/src` | React UI、worker、永続化、render、audio engine |
| 音声処理 | `ui/src/audio` | 再生準備、TD-PSOLA、media/analysis キャッシュ |

全体を通して2つの規則が成立しています。

1. **保存されるのは edit モデルだけです。** runtime state、prepared playback、レンダリング済みバッファ、解析キャッシュはすべて派生値であり、プロジェクトの正本として保存されることはありません。
2. **ドメイン意味論は `core/` が持ちます。** UI は command を組み立てて WASM 境界を越えて渡すだけで、core の検証を再実装したり回避したりしません。

Rust core の不変条件は、全 command バリアントに対する property-based テストで担保しています。apply → inverse の往復、拒否時に変更が残らないこと、バッチ失敗時に完全にロールバックすること。

詳細な仕様は [`spec-public/`](spec-public/) にあります。[`spec-public/README.md`](spec-public/README.md) から読み始めてください。

## 既知の制約

以下は**既知の意図的な制約であり、未診断のバグではありません。**

- **重いレンダリングをキャンセルできません。** キャンセル経路自体は存在しますが、長い同期 DSP ループが yield しないため、worker はループが終わるまでキャンセルメッセージを読めません。クリップ数が非常に多いプロジェクトで顕在化します。
- **pitch-only の端点品質。** ストレッチなしでピッチだけを変える場合、クリップ端点の無声音がほぼ未処理で通過することがあります。端点処理が扱うのは前後それぞれ約 50 ms なので、非常に短いクリップではこれが無視できない割合になります。
- **長尺素材のメモリ使用。** ソースはストリーミングではなく全量デコードします。そのため1時間の録音から作ったプロジェクトは、実際に使うのが数秒だとしても、それに見合わない量のメモリを消費します。
- **fade が playback に配線されていません。** edit モデルと compiler は fade 値を保持していますが、runtime に対応するフィールドがなく、非ゼロ値を設定する UI もありません。
- **フォルマント保持の設定が効きません。** `preserve_formant` は保存モデルにあり、import した clip には `true` が入りますが、実装されているのは `legacy_v1` 合成コアだけです。出荷経路は常に既定の `source_native_v2` を使い、そちらはこのフラグを受け取って無視します。つまり値は保存されるが音は変わりません。
- **動画インポート未対応。** 動画ファイルから音声を取り出すのはこのワークフローに自然に馴染む機能ですが、未実装です。

## ライセンス

GPL-3.0-or-later です。[LICENSE](LICENSE) を参照してください。

コーデックのフォールバックとして GPL-2.0-or-later の FFmpeg/WASM ビルドを同梱しているため、プロジェクト全体が GPL になります。どの依存が build-time のみで配布物に含まれないかを含めた全体像は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) にあります。
