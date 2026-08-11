import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileImport } from "./useFileImport.ts";
import { renderWithProject } from "@/test/renderWithProject";
import { createAudioBufferStub, createBaseTimelineProject } from "@/test/projectTestUtils";
import { useDocumentState, useTransportState } from "@/store";

const fileImportMocks = vi.hoisted(() => ({
  useAudioEngine: vi.fn(),
  clearAudioEngineRuntimeCaches: vi.fn(),
  decodeAudioData: vi.fn(),
  setMedia: vi.fn(),
  importAudioBuffer: vi.fn(),
  setF0: vi.fn(),
  setPitchMarks: vi.fn(),
}));

vi.mock("./useAudioEngine.ts", () => ({
  useAudioEngine: () => fileImportMocks.useAudioEngine(),
  clearAudioEngineRuntimeCaches: () => fileImportMocks.clearAudioEngineRuntimeCaches(),
}));

vi.mock("@/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/audio")>();
  return {
    ...actual,
    mediaCache: {
      set: (...args: unknown[]) => fileImportMocks.setMedia(...args),
      clear: vi.fn(),
    },
    analysisStore: {
      setF0: (...args: unknown[]) => fileImportMocks.setF0(...args),
      setPitchMarks: (...args: unknown[]) => fileImportMocks.setPitchMarks(...args),
      clear: vi.fn(),
    },
  };
});

vi.mock("@/worker", () => ({
  projectWorkerClient: {
    importAudioBuffer: (...args: unknown[]) => fileImportMocks.importAudioBuffer(...args),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function FileImportHarness({ trackId }: { trackId: string }) {
  const { importFileToTrack } = useFileImport();
  const transportState = useTransportState();
  const documentState = useDocumentState();
  const file = new File([new Uint8Array([0, 1, 2, 3])], "voice.wav", {
    type: "audio/wav",
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void importFileToTrack(file, trackId, 0);
        }}
      >
        Import
      </button>
      <div data-testid="busy-title">{transportState.busyTask?.title ?? "idle"}</div>
      <div data-testid="busy-detail">{transportState.busyTask?.detail ?? ""}</div>
      <div data-testid="clip-count">{documentState.document?.edit.clips.length ?? 0}</div>
      <div data-testid="media-count">{documentState.document?.edit.media.length ?? 0}</div>
      <div data-testid="last-audio-media-id">
        {documentState.document?.edit.contents
          .filter((content) => content.type === "audio")
          .slice(-1)[0]?.media_id ?? ""}
      </div>
    </div>
  );
}

describe("useFileImport", () => {
  beforeEach(() => {
    const audioContext = {
      decodeAudioData: (...args: unknown[]) => fileImportMocks.decodeAudioData(...args),
    } as AudioContext;
    fileImportMocks.useAudioEngine.mockReturnValue({
      engine: {
        init: vi.fn().mockResolvedValue(undefined),
        ensureAudioContext: vi.fn(() => audioContext),
        audioContext,
      },
    });
    fileImportMocks.decodeAudioData.mockReset();
    fileImportMocks.setMedia.mockReset();
    fileImportMocks.importAudioBuffer.mockReset();
    fileImportMocks.clearAudioEngineRuntimeCaches.mockReset();
    fileImportMocks.setF0.mockReset();
    fileImportMocks.setPitchMarks.mockReset();
  });

  it("publishes a busy task while audio import decoding and worker analysis are in flight", async () => {
    const project = createBaseTimelineProject();
    const audioTrackId = project.edit.tracks.find((track) => track.kind.track_type === "audio")?.id;
    if (!audioTrackId) {
      throw new Error("expected base project to include an audio track");
    }

    const decodeDeferred = createDeferred<AudioBuffer>();
    const analyzeDeferred = createDeferred<{
      analysisEntries: [];
      analysisError: null;
      contentHash: string;
      mediaId: string;
    }>();
    fileImportMocks.decodeAudioData.mockReturnValueOnce(decodeDeferred.promise);
    fileImportMocks.importAudioBuffer.mockReturnValueOnce(analyzeDeferred.promise);

    renderWithProject(<FileImportHarness trackId={audioTrackId} />, { project });

    fireEvent.click(screen.getByText("Import"));

    await waitFor(() => {
      expect(screen.getByTestId("busy-title")).toHaveTextContent("Importing audio");
      expect(screen.getByTestId("busy-detail")).toHaveTextContent(
        "Reading and decoding source file.",
      );
    });

    decodeDeferred.resolve(createAudioBufferStub());

    await waitFor(() => {
      expect(screen.getByTestId("busy-detail")).toHaveTextContent(
        "Analyzing source audio in the background.",
      );
    });

    const proposedMediaId = fileImportMocks.importAudioBuffer.mock.calls[0]?.[0] as string;
    analyzeDeferred.resolve({
      analysisEntries: [],
      analysisError: null,
      contentHash: "sha256-pcm24-v1:test",
      mediaId: proposedMediaId,
    });

    await waitFor(() => {
      expect(screen.getByTestId("busy-title")).toHaveTextContent("idle");
      expect(screen.getByTestId("clip-count")).toHaveTextContent("3");
    });

    expect(
      fileImportMocks.useAudioEngine.mock.results[0]?.value.engine.init,
    ).not.toHaveBeenCalled();
    expect(
      fileImportMocks.useAudioEngine.mock.results[0]?.value.engine.ensureAudioContext,
    ).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing media asset when the worker resolves a duplicate hash", async () => {
    const project = createBaseTimelineProject();
    const audioTrackId = project.edit.tracks.find((track) => track.kind.track_type === "audio")?.id;
    const existingMedia = project.edit.media[0];
    if (!audioTrackId || !existingMedia) {
      throw new Error("expected base project audio fixtures");
    }
    existingMedia.hash = "sha256-pcm24-v1:existing";
    const buffer = createAudioBufferStub();
    fileImportMocks.decodeAudioData.mockResolvedValueOnce(buffer);
    fileImportMocks.importAudioBuffer.mockResolvedValueOnce({
      analysisEntries: [],
      analysisError: null,
      contentHash: existingMedia.hash,
      mediaId: existingMedia.id,
    });

    renderWithProject(<FileImportHarness trackId={audioTrackId} />, { project });
    fireEvent.click(screen.getByText("Import"));

    await waitFor(() => {
      expect(screen.getByTestId("busy-title")).toHaveTextContent("idle");
      expect(screen.getByTestId("media-count")).toHaveTextContent("1");
      expect(screen.getByTestId("last-audio-media-id")).toHaveTextContent(existingMedia.id);
    });

    expect(fileImportMocks.importAudioBuffer).toHaveBeenCalledWith(
      expect.any(String),
      buffer,
      expect.any(Number),
      [{ mediaId: existingMedia.id, contentHash: existingMedia.hash }],
    );
    expect(fileImportMocks.setMedia).toHaveBeenCalledWith(existingMedia.id, buffer);
  });
});
