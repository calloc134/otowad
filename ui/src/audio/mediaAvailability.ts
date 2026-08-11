import type { MediaAsset, ProjectDocument } from "@/types";

type MediaAvailabilityStatus =
  | "available"
  | "missing"
  | "relinking"
  | "invalid";

export interface MediaAvailabilityEntry {
  mediaId: string;
  status: MediaAvailabilityStatus;
  message: string | null;
}

export function validateRelinkContentIdentity(
  asset: MediaAsset,
  selectedFileName: string,
  selectedContentHash: string,
): string | null {
  if (asset.hash !== null) {
    return asset.hash === selectedContentHash
      ? null
      : "The selected file has a different content hash.";
  }

  const expectedFileName = asset.original_name?.trim();
  if (!expectedFileName) {
    return "The original file name is unavailable, so this media cannot be verified.";
  }
  return expectedFileName === selectedFileName.trim()
    ? null
    : `Expected file name ${expectedFileName}, but ${selectedFileName} was selected.`;
}

type MediaAvailabilityOperation = "save" | "play" | "export";

export class MediaAvailabilityError extends Error {
  readonly operation: MediaAvailabilityOperation;
  readonly mediaIds: string[];

  constructor(
    operation: MediaAvailabilityOperation,
    mediaIds: string[],
    mediaNames: string[],
  ) {
    const label = operation === "play"
      ? "play"
      : operation === "save"
        ? "save"
        : "export audio";
    const names = mediaNames.join(", ");
    super(`Cannot ${label}: relink unavailable media first (${names}).`);
    this.name = "MediaAvailabilityError";
    this.operation = operation;
    this.mediaIds = mediaIds;
  }
}

export class MediaAvailabilityRegistry {
  private entries = new Map<string, MediaAvailabilityEntry>();
  private snapshot: readonly MediaAvailabilityEntry[] = [];
  private readonly listeners = new Set<() => void>();

  get(mediaId: string): MediaAvailabilityEntry | undefined {
    return this.entries.get(mediaId);
  }

  getSnapshot = (): readonly MediaAvailabilityEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reconcile(
    document: ProjectDocument,
    isAvailable: (mediaId: string) => boolean,
  ): void {
    const nextEntries = new Map<string, MediaAvailabilityEntry>();
    for (const asset of document.edit.media) {
      const current = this.entries.get(asset.id);
      const next = isAvailable(asset.id)
        ? makeEntry(asset.id, "available")
        : current?.status === "invalid" || current?.status === "relinking"
          ? current
          : makeEntry(asset.id, "missing");
      nextEntries.set(asset.id, next);
    }
    this.replaceEntries(nextEntries);
  }

  markAvailable(mediaId: string): void {
    this.setEntry(makeEntry(mediaId, "available"));
  }

  markMissing(mediaId: string, message: string | null = null): void {
    this.setEntry(makeEntry(mediaId, "missing", message));
  }

  markRelinking(mediaId: string): void {
    this.setEntry(makeEntry(mediaId, "relinking"));
  }

  markInvalid(mediaId: string, message: string): void {
    this.setEntry(makeEntry(mediaId, "invalid", message));
  }

  clear(): void {
    if (this.entries.size === 0) {
      return;
    }
    this.replaceEntries(new Map());
  }

  collectUnavailableReferencedMedia(
    document: ProjectDocument,
    trackIds?: ReadonlySet<string>,
  ): MediaAvailabilityEntry[] {
    const contentById = new Map(
      document.edit.contents
        .filter((content) => content.type === "audio")
        .map((content) => [content.id, content] as const),
    );
    const referencedMediaIds = new Set<string>();
    for (const clip of document.edit.clips) {
      if (
        clip.kind.clip_type !== "audio" ||
        (trackIds && !trackIds.has(clip.track_id))
      ) {
        continue;
      }
      const content = contentById.get(clip.kind.content_id);
      if (content) {
        referencedMediaIds.add(content.media_id);
      }
    }

    return document.edit.media
      .filter((asset) => referencedMediaIds.has(asset.id))
      .map((asset) => this.entries.get(asset.id) ?? makeEntry(asset.id, "missing"))
      .filter((entry) => entry.status !== "available");
  }

  assertReferencedMediaAvailable(
    document: ProjectDocument,
    operation: MediaAvailabilityOperation,
    trackIds?: ReadonlySet<string>,
  ): void {
    const unavailable = this.collectUnavailableReferencedMedia(document, trackIds);
    if (unavailable.length === 0) {
      return;
    }
    const assets = new Map(document.edit.media.map((asset) => [asset.id, asset]));
    throw new MediaAvailabilityError(
      operation,
      unavailable.map((entry) => entry.mediaId),
      unavailable.map((entry) => {
        const asset = assets.get(entry.mediaId);
        return asset?.original_name?.trim() || entry.mediaId;
      }),
    );
  }

  private setEntry(entry: MediaAvailabilityEntry): void {
    const current = this.entries.get(entry.mediaId);
    if (
      current?.status === entry.status &&
      current.message === entry.message
    ) {
      return;
    }
    const next = new Map(this.entries);
    next.set(entry.mediaId, entry);
    this.replaceEntries(next);
  }

  private replaceEntries(entries: Map<string, MediaAvailabilityEntry>): void {
    if (entriesEqual(this.entries, entries)) {
      return;
    }
    this.entries = entries;
    this.snapshot = Array.from(entries.values());
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function makeEntry(
  mediaId: string,
  status: MediaAvailabilityStatus,
  message: string | null = null,
): MediaAvailabilityEntry {
  return { mediaId, status, message };
}

function entriesEqual(
  left: ReadonlyMap<string, MediaAvailabilityEntry>,
  right: ReadonlyMap<string, MediaAvailabilityEntry>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [mediaId, leftEntry] of left) {
    const rightEntry = right.get(mediaId);
    if (
      !rightEntry ||
      rightEntry.status !== leftEntry.status ||
      rightEntry.message !== leftEntry.message
    ) {
      return false;
    }
  }
  return true;
}

export const mediaAvailabilityRegistry = new MediaAvailabilityRegistry();
