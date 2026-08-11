import assert from "node:assert/strict";
import test from "node:test";
import { createAudioBufferData } from "./audioBufferData.ts";
import { PlaybackEngine, resolveScheduledSourceTiming } from "./playbackEngine.ts";
import type { PreparedPlaybackSchedule } from "./playbackPreparation.ts";
import {
  getEffectivePlaybackStartTick,
  getLoopRestartTick,
} from "./playbackMath.ts";
import type { ProjectDocument } from "../types/index.ts";

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? new Float32Array(this.length);
  }

  copyToChannel(source: Float32Array, channel: number): void {
    this.getChannelData(channel).set(source);
  }
}

class FakeAudioNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeStereoPannerNode extends FakeAudioNode {
  pan = { value: 0 };
}

interface FakeStartCall {
  when: number;
  offset: number;
  duration: number;
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer!: AudioBuffer;
  playbackRate = { value: 1 };
  readonly startCalls: FakeStartCall[] = [];
  stopped = false;

  start(when: number, offset = 0, duration = 0): void {
    this.startCalls.push({ when, offset, duration });
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  readonly destination = new FakeAudioNode() as unknown as AudioDestinationNode;
  readonly createdSources: FakeAudioBufferSourceNode[] = [];
  state: AudioContextState = "suspended";
  resumeCallCount = 0;
  private baseCurrentTime = 0;
  private currentTimeReadStep = 0;
  private currentTimeReadCount = 0;

  setCurrentTime(value: number): void {
    this.baseCurrentTime = value;
    this.currentTimeReadCount = 0;
  }

  setCurrentTimeReadStep(step: number): void {
    this.currentTimeReadStep = step;
    this.currentTimeReadCount = 0;
  }

  get currentTime(): number {
    const value = this.baseCurrentTime + this.currentTimeReadCount * this.currentTimeReadStep;
    this.currentTimeReadCount += 1;
    return value;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate) as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeAudioBufferSourceNode();
    this.createdSources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return new FakeGainNode() as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    return new FakeStereoPannerNode() as unknown as StereoPannerNode;
  }

  async resume(): Promise<void> {
    this.resumeCallCount += 1;
    this.state = "running";
  }
}

function assertApprox(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function setAudioContext(engine: PlaybackEngine, ctx: FakeAudioContext): void {
  (engine as unknown as { ctx: AudioContext | null }).ctx = ctx as unknown as AudioContext;
}

test("ensureAudioContext skips autoplay resume while init resumes playback", async () => {
  const engine = new PlaybackEngine();
  const ctx = new FakeAudioContext();
  setAudioContext(engine, ctx);

  assert.equal(engine.ensureAudioContext(), ctx as unknown as AudioContext);
  assert.equal(ctx.resumeCallCount, 0);

  await engine.init();
  assert.equal(ctx.resumeCallCount, 1);
  assert.equal(ctx.state, "running");
});

function createPreparedClip(
  id: string,
  whenRelativeSec: number,
  clipDurationSec = 1,
): PreparedPlaybackSchedule["clips"][number] {
  return {
    clipId: id,
    trackId: "track-a",
    mediaId: "media-1",
    renderKey: `render-${id}`,
    whenRelativeSec,
    clipDurationSec,
    clipGain: 1,
    trackGain: 1,
    trackPan: 0,
    buffer: createAudioBufferData(1, 48_000, 48_000),
  };
}

function createPreparedSchedule(
  clips: PreparedPlaybackSchedule["clips"],
  startOffsetSec = 0,
): PreparedPlaybackSchedule {
  return {
    startTick: Math.round(startOffsetSec * 1_920),
    startOffsetSec,
    projectRevision: 1,
    clips,
  };
}

function createTransportProject(): ProjectDocument {
  return {
    schema_version: 4,
    meta: {
      name: "transport-test",
      created_at: "2026-03-16T00:00:00Z",
      app_version: "0.1.0",
      project_sample_rate: 48_000,
      ppq: 960,
    },
    edit: {
      tempo: {
        ppq: 960,
        points: [{ at: 0, micro_bpm: 120_000_000, time_sig: { num: 4, den: 4 } }],
      },
      grid: {
        snap_enabled: true,
        division: "Quarter",
        swing_permille: 0,
        magnet_range_permille: 250,
        snap_strength_permille: 1_000,
      },
      tracks: [],
      media: [],
      contents: [],
      clips: [],
      routing: { schema_hint: null },
      automation: [],
      pitch_links: [],
    },
  };
}

test("loop-enabled playback starts from the selected range start", () => {
  assert.equal(getEffectivePlaybackStartTick(960, true, 240, 720), 240);
  assert.equal(getEffectivePlaybackStartTick(960, false, 240, 720), 960);
});

test("loop restart helper only rewinds after crossing the loop end", () => {
  assert.equal(getLoopRestartTick(719.99, true, 240, 720), null);
  assert.equal(getLoopRestartTick(720, true, 240, 720), 240);
  assert.equal(getLoopRestartTick(720, false, 240, 720), null);
});

test("playback engine can clear processed clip cache independently", () => {
  const engine = new PlaybackEngine();
  const internal = engine as unknown as {
    processedClipCache: { set(key: string, value: unknown): void };
  };
  // Stub buffer with the minimum shape audioBufferByteSize() reads.
  internal.processedClipCache.set("render-key", {
    numberOfChannels: 1,
    length: 100,
  });

  assert.equal(engine.getKnownRenderKeys().has("render-key"), true);
  engine.clearProcessedClipCache();
  assert.equal(engine.getKnownRenderKeys().size, 0);
});

test("resolveScheduledSourceTiming keeps overlapping clips on one base time", () => {
  assert.deepEqual(
    resolveScheduledSourceTiming(5, -0.25, 1, 1),
    { whenSec: 5, offsetSec: 0.25, durationSec: 0.75 },
  );
  assert.deepEqual(
    resolveScheduledSourceTiming(5, 0.3, 1, 0.8),
    { whenSec: 5.3, offsetSec: 0, durationSec: 0.8 },
  );
  assert.equal(resolveScheduledSourceTiming(5, -1.1, 1, 1), null);
});

test("playPrepared anchors overlapping clips to one future base time", () => {
  const engine = new PlaybackEngine();
  const ctx = new FakeAudioContext();
  ctx.setCurrentTime(10);
  ctx.setCurrentTimeReadStep(0.004);
  setAudioContext(engine, ctx);

  engine.playPrepared(createPreparedSchedule([
    createPreparedClip("clip-1", -0.35),
    createPreparedClip("clip-2", -0.1),
    createPreparedClip("clip-3", 0.25, 0.6),
  ]));

  assert.equal(ctx.createdSources.length, 3);
  const first = ctx.createdSources[0]?.startCalls[0];
  const second = ctx.createdSources[1]?.startCalls[0];
  const third = ctx.createdSources[2]?.startCalls[0];
  assert.ok(first);
  assert.ok(second);
  assert.ok(third);

  assertApprox(first.when, second.when);
  assertApprox(first.offset, 0.35);
  assertApprox(first.duration, 0.65);
  assertApprox(second.offset, 0.1);
  assertApprox(second.duration, 0.9);
  assertApprox(third.when, first.when + 0.25);
  assertApprox(third.offset, 0);
  assertApprox(third.duration, 0.6);
});

test("getCurrentTick clamps until the scheduled base time becomes audible", () => {
  const engine = new PlaybackEngine();
  const ctx = new FakeAudioContext();
  ctx.setCurrentTime(1);
  setAudioContext(engine, ctx);

  engine.playPrepared(createPreparedSchedule([
    createPreparedClip("clip-1", -0.1),
  ], 0.5));

  const scheduledStart = ctx.createdSources[0]?.startCalls[0]?.when;
  assert.ok(scheduledStart !== undefined);

  ctx.setCurrentTime(scheduledStart - 0.005);
  assertApprox(engine.getCurrentTick(createTransportProject()), 960);

  ctx.setCurrentTime(scheduledStart + 0.125);
  assertApprox(engine.getCurrentTick(createTransportProject()), 1_200);
});
