import type { AnalysisArtifact, AnalysisId } from "../types/index.ts";
import {
  getAudioBufferChannelData,
  type AudioBufferSource,
} from "./audioBufferData.ts";

export interface RuntimeMemoryBucket {
  count: number;
  bytes: number;
}

export interface WorkerRuntimeMemorySnapshot {
  sourcePcm: RuntimeMemoryBucket;
  renderedPcm: RuntimeMemoryBucket;
  analysis: RuntimeMemoryBucket;
}

interface MainRuntimeMemorySnapshot {
  sourceAudioBuffers: RuntimeMemoryBucket;
  renderedAudioBuffers: RuntimeMemoryBucket;
  preparedRenderedPcm: RuntimeMemoryBucket;
  analysis: RuntimeMemoryBucket;
}

export interface TransferMemorySnapshot {
  pcmCloneInFlightBytes: number;
  pcmClonePeakBytes: number;
  pcmCloneCumulativeBytes: number;
  otherInFlightBytes: number;
  otherPeakBytes: number;
  otherCumulativeBytes: number;
}

export interface RuntimeMemoryDiagnosticsReport {
  capturedAt: string;
  workerGeneration: number;
  main: MainRuntimeMemorySnapshot;
  worker: WorkerRuntimeMemorySnapshot;
  transfer: TransferMemorySnapshot;
  userAgentSpecificBytes: number | null;
}

export interface MemoryScenarioEstimate {
  label: string;
  durationMinutes: number;
  sourceCount: number;
  sampleRate: number;
  channels: number;
  pcmBytesPerCopy: number;
}

export type TransferMemoryCategory = "pcm_clone" | "other";

export class TransferMemoryTracker {
  private pcmCloneInFlightBytes = 0;
  private pcmClonePeakBytes = 0;
  private pcmCloneCumulativeBytes = 0;
  private otherInFlightBytes = 0;
  private otherPeakBytes = 0;
  private otherCumulativeBytes = 0;

  begin(category: TransferMemoryCategory, bytes: number): void {
    if (category === "pcm_clone") {
      this.pcmCloneInFlightBytes += bytes;
      this.pcmClonePeakBytes = Math.max(this.pcmClonePeakBytes, this.pcmCloneInFlightBytes);
      this.pcmCloneCumulativeBytes += bytes;
      return;
    }
    this.otherInFlightBytes += bytes;
    this.otherPeakBytes = Math.max(this.otherPeakBytes, this.otherInFlightBytes);
    this.otherCumulativeBytes += bytes;
  }

  end(category: TransferMemoryCategory, bytes: number): void {
    if (category === "pcm_clone") {
      this.pcmCloneInFlightBytes = Math.max(0, this.pcmCloneInFlightBytes - bytes);
      return;
    }
    this.otherInFlightBytes = Math.max(0, this.otherInFlightBytes - bytes);
  }

  getSnapshot(): TransferMemorySnapshot {
    return {
      pcmCloneInFlightBytes: this.pcmCloneInFlightBytes,
      pcmClonePeakBytes: this.pcmClonePeakBytes,
      pcmCloneCumulativeBytes: this.pcmCloneCumulativeBytes,
      otherInFlightBytes: this.otherInFlightBytes,
      otherPeakBytes: this.otherPeakBytes,
      otherCumulativeBytes: this.otherCumulativeBytes,
    };
  }

  reset(): void {
    this.pcmCloneInFlightBytes = 0;
    this.pcmClonePeakBytes = 0;
    this.pcmCloneCumulativeBytes = 0;
    this.otherInFlightBytes = 0;
    this.otherPeakBytes = 0;
    this.otherCumulativeBytes = 0;
  }
}

export function measureAudioBufferSources(
  buffers: Iterable<AudioBufferSource>,
): RuntimeMemoryBucket {
  let count = 0;
  let bytes = 0;
  for (const buffer of buffers) {
    count += 1;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      bytes += getAudioBufferChannelData(buffer, channel).byteLength;
    }
  }
  return { count, bytes };
}

export function measureAnalysisArtifacts(
  artifacts: ReadonlyMap<AnalysisId, AnalysisArtifact>,
): RuntimeMemoryBucket {
  const entries = Array.from(artifacts.entries());
  return {
    count: entries.length,
    // This is the deterministic serialized payload size. Browser JS heap
    // overhead is reported separately by measureUserAgentSpecificMemory when
    // the platform exposes it.
    bytes: new TextEncoder().encode(JSON.stringify(entries)).byteLength,
  };
}

export function buildMemoryScenarioMatrix(): MemoryScenarioEstimate[] {
  const scenarios = [
    { label: "10m x1", durationMinutes: 10, sourceCount: 1 },
    { label: "30m x1", durationMinutes: 30, sourceCount: 1 },
    { label: "30m x2", durationMinutes: 30, sourceCount: 2 },
  ] as const;
  const sampleRates = [44_100, 48_000, 96_000] as const;
  const channels = 2;

  return scenarios.flatMap((scenario) => sampleRates.map((sampleRate) => ({
    label: `${scenario.label} @ ${sampleRate} Hz`,
    durationMinutes: scenario.durationMinutes,
    sourceCount: scenario.sourceCount,
    sampleRate,
    channels,
    pcmBytesPerCopy:
      scenario.durationMinutes * 60 *
      scenario.sourceCount *
      sampleRate *
      channels *
      Float32Array.BYTES_PER_ELEMENT,
  })));
}
