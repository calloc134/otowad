import { useCallback } from "react";
import { analysisStore, mediaAvailabilityRegistry, mediaCache } from "@/audio";
import { decodeAudioFile } from "@/audio/audioFileDecoder.ts";
import {
  buildImportedAudioCommands,
  buildImportedMidiGroupCommands,
  createImportedAudioTrack,
  createImportedMidiTrack,
} from "@/adapters/importFactories.ts";
import { buildMediaArchivePath } from "@/persist/projectArchive.ts";
import {
  useDocumentState,
  useProjectActions,
  useTransportState,
  type BusyTask,
} from "@/store";
import { projectWorkerClient } from "@/worker";
import type {
  Command,
} from "@/types";
import { toCommandBatch } from "@/utils/clipPlacement";
import { classifyImportableFile } from "@/utils/fileDrop.ts";
import { coerceTrackName } from "@/utils/trackName.ts";
import {
  buildMidiImportGroups,
  midiChannelLabel,
  parseMidiSmf,
  type MidiImportGroup,
} from "@/utils/midiSmf.ts";
import { useAudioEngine } from "./useAudioEngine.ts";
import type { WorkerAnalysisArtifactEntry } from "@/worker";

interface AudioImportArgs {
  file: File;
  trackId: string;
  startTick: number;
}

interface MidiImportArgs {
  file: File;
  trackId: string;
  startTick: number;
}

interface ImportToTrackOptions {
  createTrack?: boolean;
}

type AudioImportBusyStage =
  | "preparing"
  | "decoding"
  | "analyzing"
  | "applying";

function pickImportFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;

    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => {
      resolve(null);
    });

    input.click();
  });
}

function stripFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "MIDI Track";
  }
  const withoutExtension = trimmed.replace(/\.[^.]+$/u, "");
  return withoutExtension.trim() || "MIDI Track";
}

function buildImportedMidiTrackName(
  fileName: string,
  group: MidiImportGroup,
): string {
  const baseName = group.trackName?.trim() || stripFileExtension(fileName);
  const channelLabel = midiChannelLabel(group.midiChannel);
  return coerceTrackName(
    `${baseName} ${channelLabel}`,
    `MIDI Track ${channelLabel}`,
  );
}

function hydrateImportedAnalysisEntries(entries: WorkerAnalysisArtifactEntry[]): string[] {
  for (const entry of entries) {
    switch (entry.artifact.kind) {
      case "f0_track":
        analysisStore.setF0(entry.artifact.media_id, entry.artifact, entry.analysisId);
        break;
      case "pitch_marks":
        analysisStore.setPitchMarks(entry.artifact.media_id, entry.artifact, entry.analysisId);
        break;
      case "waveform_peaks":
        break;
    }
  }

  return [...entries]
    .sort((left, right) => {
      return left.artifact.kind.localeCompare(right.artifact.kind) ||
        left.analysisId.localeCompare(right.analysisId);
    })
    .map((entry) => entry.analysisId);
}

function createAudioImportBusyTask(
  stage: AudioImportBusyStage,
  createTrack: boolean,
): BusyTask {
  switch (stage) {
    case "preparing":
      return {
        kind: "importing",
        title: "Importing audio",
        detail: "Preparing import pipeline.",
        progress: 0.05,
      };
    case "decoding":
      return {
        kind: "importing",
        title: "Importing audio",
        detail: "Reading and decoding source file.",
        progress: 0.25,
      };
    case "analyzing":
      return {
        kind: "importing",
        title: "Importing audio",
        detail: "Analyzing source audio in the background.",
        progress: 0.7,
      };
    case "applying":
      return {
        kind: "importing",
        title: "Importing audio",
        detail: createTrack
          ? "Creating a track and adding the imported clip."
          : "Adding the imported clip to the selected track.",
        progress: 0.92,
      };
  }
}

export function useFileImport() {
  const documentState = useDocumentState();
  const transportState = useTransportState();
  const actions = useProjectActions();
  const { engine } = useAudioEngine();

  const applyCommands = useCallback(
    (commands: Command[]) => {
      const batch = toCommandBatch(commands);
      if (!batch) {
        throw new Error("No import commands were generated.");
      }
      actions.applyCommand(batch);
    },
    [actions],
  );

  const runAudioImport = useCallback(
    async (
      file: File,
      startTick: number,
      options: { createTrack: boolean; trackId: string | null },
    ) => {
      try {
        const doc = documentState.document;
        if (!doc) {
          throw new Error("No project loaded.");
        }

        let trackId = options.trackId;
        if (options.createTrack) {
          trackId = crypto.randomUUID();
        } else {
          if (!trackId) {
            throw new Error("Audio import requires a destination track.");
          }
          const track = doc.edit.tracks.find((candidate) => candidate.id === trackId);
          if (!track) {
            throw new Error(`Track ${trackId} was not found.`);
          }
          if (track.kind.track_type !== "audio") {
            throw new Error("Audio files can only be imported into audio tracks.");
          }
        }
        if (!trackId) {
          throw new Error("Audio import requires a destination track.");
        }
        const resolvedTrackId = trackId;

        actions.setBusyTask(createAudioImportBusyTask("preparing", options.createTrack));
        const audioContext = engine.ensureAudioContext();

        const proposedMediaId = crypto.randomUUID();
        const contentId = crypto.randomUUID();
        const clipId = crypto.randomUUID();

        actions.setBusyTask(createAudioImportBusyTask("decoding", options.createTrack));
        const decodedSource = await decodeAudioFile(file, audioContext);
        const audioBuffer = decodedSource.toAudioBuffer(audioContext);

        actions.setBusyTask(createAudioImportBusyTask("analyzing", options.createTrack));
        const importResult = await projectWorkerClient.importAudioBuffer(
          proposedMediaId,
          audioBuffer,
          documentState.projectRevision,
          doc.edit.media.flatMap((asset) => asset.hash
            ? [{ mediaId: asset.id, contentHash: asset.hash }]
            : []),
        );
        if (importResult.analysisError) {
          console.warn("Source analysis failed for", file.name, importResult.analysisError);
        }
        const mediaId = importResult.mediaId;
        const reuseMediaAsset = mediaId !== proposedMediaId;
        mediaCache.set(mediaId, audioBuffer);
        mediaAvailabilityRegistry.markAvailable(mediaId);
        const analysisRefs = hydrateImportedAnalysisEntries(importResult.analysisEntries);

        actions.setBusyTask(createAudioImportBusyTask("applying", options.createTrack));
        actions.setError(null);
        const importCommands = buildImportedAudioCommands({
          mediaId,
          contentId,
          clipId,
          fileName: file.name,
          trackId: resolvedTrackId,
          startTick,
          audioBuffer,
          analysisRefs,
          contentHash: importResult.contentHash,
          reuseMediaAsset,
          microBpm: doc.edit.tempo.points[0]?.micro_bpm ?? 120_000_000,
          ppq: doc.edit.tempo.ppq,
        }, buildMediaArchivePath);
        if (options.createTrack) {
          applyCommands([
            {
              command: "add_track",
              track: createImportedAudioTrack(resolvedTrackId, "Audio Track"),
            },
            ...importCommands,
          ]);
        } else {
          applyCommands(importCommands);
        }
        actions.selectTrack(resolvedTrackId);
      } catch (error) {
        actions.setError(error instanceof Error ? error.message : String(error));
      } finally {
        actions.clearBusyTask();
      }
    },
    [actions, applyCommands, documentState.document, documentState.projectRevision, engine],
  );

  const importAudioFromFile = useCallback(
    async ({ file, trackId, startTick }: AudioImportArgs) => {
      await runAudioImport(file, startTick, { createTrack: false, trackId });
    },
    [runAudioImport],
  );

  const importAudioToNewTrack = useCallback(
    async (file: File, startTick: number) => {
      await runAudioImport(file, startTick, { createTrack: true, trackId: null });
    },
    [runAudioImport],
  );

  const importMidiFromFile = useCallback(
    async ({ file, trackId, startTick }: MidiImportArgs) => {
      try {
        const doc = documentState.document;
        if (!doc) {
          throw new Error("No project loaded.");
        }

        const track = doc.edit.tracks.find((candidate) => candidate.id === trackId);
        if (!track) {
          throw new Error(`Track ${trackId} was not found.`);
        }
        if (track.kind.track_type !== "midi") {
          throw new Error("MIDI files can only be imported into MIDI tracks.");
        }

        const parsed = parseMidiSmf(await file.arrayBuffer());
        const groups = buildMidiImportGroups(parsed, doc.edit.tempo.ppq);
        if (groups.length === 0) {
          throw new Error(`No non-drum MIDI notes were found in ${file.name}.`);
        }
        const firstGroup = groups[0];
        if (!firstGroup) {
          throw new Error(`No importable MIDI groups were found in ${file.name}.`);
        }

        const targetTrackIndex = doc.edit.tracks.findIndex(
          (candidate) => candidate.id === trackId,
        );
        if (targetTrackIndex < 0) {
          throw new Error(`Track ${trackId} was not found.`);
        }

        const commands: Command[] = [
          ...buildImportedMidiGroupCommands(firstGroup, trackId, startTick),
        ];

        groups.slice(1).forEach((group, groupIndex) => {
          const newTrackId = crypto.randomUUID();
          commands.push({
            command: "add_track",
            track: createImportedMidiTrack(
              newTrackId,
              buildImportedMidiTrackName(file.name, group),
            ),
          });
          commands.push({
            command: "move_track",
              id: newTrackId,
              new_index: targetTrackIndex + groupIndex + 1,
            });
          commands.push(...buildImportedMidiGroupCommands(group, newTrackId, startTick));
        });

        actions.setError(null);
        applyCommands(commands);
        actions.selectTrack(trackId);
      } catch (error) {
        actions.setError(error instanceof Error ? error.message : String(error));
      }
    },
    [actions, applyCommands, documentState.document],
  );

  const importMidiToNewTrack = useCallback(
    async (file: File, startTick: number) => {
      try {
        const doc = documentState.document;
        if (!doc) {
          throw new Error("No project loaded.");
        }

        const parsed = parseMidiSmf(await file.arrayBuffer());
        const groups = buildMidiImportGroups(parsed, doc.edit.tempo.ppq);
        if (groups.length === 0) {
          throw new Error(`No non-drum MIDI notes were found in ${file.name}.`);
        }
        const firstGroup = groups[0];
        if (!firstGroup) {
          throw new Error(`No importable MIDI groups were found in ${file.name}.`);
        }

        const firstTrackId = crypto.randomUUID();
        const commands: Command[] = [
          {
            command: "add_track",
            track: createImportedMidiTrack(
              firstTrackId,
              buildImportedMidiTrackName(file.name, firstGroup),
            ),
          },
          ...buildImportedMidiGroupCommands(firstGroup, firstTrackId, startTick),
        ];

        groups.slice(1).forEach((group, groupIndex) => {
          const newTrackId = crypto.randomUUID();
          commands.push({
            command: "add_track",
            track: createImportedMidiTrack(
              newTrackId,
              buildImportedMidiTrackName(file.name, group),
            ),
          });
          commands.push({
            command: "move_track",
            id: newTrackId,
            new_index: groupIndex + 1,
          });
          commands.push(...buildImportedMidiGroupCommands(group, newTrackId, startTick));
        });

        actions.setError(null);
        applyCommands(commands);
        actions.selectTrack(firstTrackId);
      } catch (error) {
        actions.setError(error instanceof Error ? error.message : String(error));
      }
    },
    [actions, applyCommands, documentState.document],
  );

  const importAudioFile = useCallback(
    async (trackId: string) => {
      const file = await pickImportFile("audio/*");
      if (!file) {
        return;
      }
      await importAudioFromFile({
        file,
        trackId,
        startTick: transportState.playheadTick,
      });
    },
    [importAudioFromFile, transportState.playheadTick],
  );

  const importMidiFile = useCallback(
    async (trackId: string) => {
      const file = await pickImportFile(
        ".mid,.midi,audio/midi,audio/x-midi,application/midi,application/x-midi",
      );
      if (!file) {
        return;
      }
      await importMidiFromFile({
        file,
        trackId,
        startTick: transportState.playheadTick,
      });
    },
    [importMidiFromFile, transportState.playheadTick],
  );

  const importFileToTrack = useCallback(
    async (
      file: File,
      trackId: string | null,
      startTick: number,
      options?: ImportToTrackOptions,
    ) => {
      const kind = classifyImportableFile(file);
      if (!kind) {
        actions.setError(`Unsupported file type: ${file.name}.`);
        return;
      }

      if (options?.createTrack || trackId === null) {
        if (kind === "audio") {
          await importAudioToNewTrack(file, startTick);
          return;
        }

        await importMidiToNewTrack(file, startTick);
        return;
      }

      if (kind === "audio") {
        await importAudioFromFile({ file, trackId, startTick });
        return;
      }

      await importMidiFromFile({ file, trackId, startTick });
    },
    [actions, importAudioFromFile, importAudioToNewTrack, importMidiFromFile, importMidiToNewTrack],
  );

  return {
    importAudioFile,
    importMidiFile,
    importAudioFromFile,
    importMidiFromFile,
    importFileToTrack,
  };
}
