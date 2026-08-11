import type {
  MidiCc,
  MidiNote,
  ProjectDocument,
  TrackId,
} from "@/types";

type MidiNoteData = Omit<MidiNote, "id">;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MIDI_HEADER_CHUNK = "MThd";
const MIDI_TRACK_CHUNK = "MTrk";

export const MIDI_DRUM_CHANNEL = 9;
export const MIDI_EXPORT_CHANNEL = 0;

interface Cursor {
  view: DataView;
  offset: number;
  limit: number;
}

interface ActiveNote {
  start: number;
  vel: number;
}

export interface ParsedSmfNote {
  start: number;
  length: number;
  key: number;
  vel: number;
  channel: number;
}

export interface ParsedSmfCc {
  at: number;
  cc: number;
  value: number;
  channel: number;
}

export interface ParsedSmfTrack {
  sourceTrackIndex: number;
  name: string | null;
  channelOrder: number[];
  notes: ParsedSmfNote[];
  ccs: ParsedSmfCc[];
}

export interface ParsedSmfFile {
  format: number;
  ppq: number;
  tracks: ParsedSmfTrack[];
}

export interface MidiImportGroup {
  sourceTrackIndex: number;
  midiChannel: number;
  trackName: string | null;
  sourcePpq: number;
  notes: MidiNoteData[];
  ccs: MidiCc[];
}

export interface MidiTrackExportData {
  notes: MidiNoteData[];
  ccs: MidiCc[];
}

export interface EncodeMidiTrackInput {
  ppq: number;
  notes: readonly MidiNoteData[];
  ccs?: readonly MidiCc[];
  channel?: number;
}

interface EncodedMidiEvent {
  tick: number;
  priority: number;
  sortA: number;
  sortB: number;
  bytes: number[];
}

function assertReadable(
  cursor: Cursor,
  length: number,
  context: string,
): void {
  if (cursor.offset + length > cursor.limit) {
    throw new Error(`Unexpected end of MIDI data while reading ${context}.`);
  }
}

function readTag(cursor: Cursor): string {
  assertReadable(cursor, 4, "chunk tag");
  const bytes = new Uint8Array(
    cursor.view.buffer,
    cursor.view.byteOffset + cursor.offset,
    4,
  );
  cursor.offset += 4;
  return textDecoder.decode(bytes);
}

function expectTag(cursor: Cursor, expected: string): void {
  const actual = readTag(cursor);
  if (actual !== expected) {
    throw new Error(`Expected ${expected} chunk, got ${actual}.`);
  }
}

function readUint8(cursor: Cursor, context: string): number {
  assertReadable(cursor, 1, context);
  const value = cursor.view.getUint8(cursor.offset);
  cursor.offset += 1;
  return value;
}

function readUint16(cursor: Cursor, context: string): number {
  assertReadable(cursor, 2, context);
  const value = cursor.view.getUint16(cursor.offset);
  cursor.offset += 2;
  return value;
}

function readUint32(cursor: Cursor, context: string): number {
  assertReadable(cursor, 4, context);
  const value = cursor.view.getUint32(cursor.offset);
  cursor.offset += 4;
  return value;
}

function readBytes(
  cursor: Cursor,
  length: number,
  context: string,
): Uint8Array {
  assertReadable(cursor, length, context);
  const bytes = new Uint8Array(
    cursor.view.buffer,
    cursor.view.byteOffset + cursor.offset,
    length,
  );
  cursor.offset += length;
  return bytes.slice();
}

function readVlq(cursor: Cursor, context: string): number {
  let value = 0;
  for (let i = 0; i < 4; i += 1) {
    const byte = readUint8(cursor, context);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return value;
    }
  }
  throw new Error(`Invalid variable-length quantity in ${context}.`);
}

function writeVlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`VLQ value must be a non-negative integer, got ${value}.`);
  }

  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
}

function encodeChunk(tag: string, body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + body.length);
  bytes.set(textEncoder.encode(tag), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, body.length);
  bytes.set(body, 8);
  return bytes;
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function noteBucketKey(channel: number, key: number): number {
  return channel * 128 + key;
}

function rememberChannel(
  seenChannels: Set<number>,
  channelOrder: number[],
  channel: number,
): void {
  if (!seenChannels.has(channel)) {
    seenChannels.add(channel);
    channelOrder.push(channel);
  }
}

function decodeText(bytes: Uint8Array): string {
  // oxlint-disable-next-line no-control-regex -- SMF text fields are NUL-padded
  return textDecoder.decode(bytes).replace(/\u0000+$/g, "").trim();
}

function clampMidiByte(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite, got ${value}.`);
  }
  return Math.max(0, Math.min(127, Math.round(value)));
}

function normalizeNoteVelocity(value: number): number {
  return Math.max(1, clampMidiByte(value, "Note velocity"));
}

function sanitizeTick(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Tick must be finite, got ${value}.`);
  }
  return Math.max(0, Math.round(value));
}

function sortMidiNotes(notes: readonly MidiNoteData[]): MidiNoteData[] {
  return [...notes].sort(
    (left, right) =>
      left.start - right.start ||
      left.key - right.key ||
      left.length - right.length ||
      left.vel - right.vel,
  );
}

function sortMidiCcs(ccs: readonly MidiCc[]): MidiCc[] {
  return [...ccs].sort(
    (left, right) =>
      left.at - right.at ||
      left.cc - right.cc ||
      left.value - right.value,
  );
}

function sortParsedNotes(notes: readonly ParsedSmfNote[]): ParsedSmfNote[] {
  return [...notes].sort(
    (left, right) =>
      left.start - right.start ||
      left.channel - right.channel ||
      left.key - right.key ||
      left.length - right.length ||
      left.vel - right.vel,
  );
}

function sortParsedCcs(ccs: readonly ParsedSmfCc[]): ParsedSmfCc[] {
  return [...ccs].sort(
    (left, right) =>
      left.at - right.at ||
      left.channel - right.channel ||
      left.cc - right.cc ||
      left.value - right.value,
  );
}

function closeActiveNote(
  activeNotes: Map<number, ActiveNote[]>,
  notes: ParsedSmfNote[],
  channel: number,
  key: number,
  absoluteTick: number,
): void {
  const bucketKey = noteBucketKey(channel, key);
  const bucket = activeNotes.get(bucketKey);
  const activeNote = bucket?.shift();
  if (!activeNote) {
    return;
  }

  notes.push({
    start: activeNote.start,
    length: Math.max(1, absoluteTick - activeNote.start),
    key,
    vel: activeNote.vel,
    channel,
  });

  if (bucket && bucket.length === 0) {
    activeNotes.delete(bucketKey);
  }
}

function convertTick(
  tick: number,
  sourcePpq: number,
  targetPpq: number,
): number {
  return Math.max(0, Math.round((tick * targetPpq) / sourcePpq));
}

function convertNoteToProjectPpq(
  note: ParsedSmfNote,
  sourcePpq: number,
  targetPpq: number,
): MidiNoteData {
  const start = convertTick(note.start, sourcePpq, targetPpq);
  const end = convertTick(note.start + note.length, sourcePpq, targetPpq);
  return {
    start,
    length: Math.max(1, end - start),
    key: note.key,
    vel: note.vel,
  };
}

function parseTrackChunk(
  view: DataView,
  start: number,
  limit: number,
  sourceTrackIndex: number,
): ParsedSmfTrack {
  const cursor: Cursor = { view, offset: start, limit };
  const notes: ParsedSmfNote[] = [];
  const ccs: ParsedSmfCc[] = [];
  const activeNotes = new Map<number, ActiveNote[]>();
  const seenChannels = new Set<number>();
  const channelOrder: number[] = [];
  let trackName: string | null = null;
  let absoluteTick = 0;
  let runningStatus: number | null = null;

  while (cursor.offset < cursor.limit) {
    absoluteTick += readVlq(cursor, "delta time");
    const statusOrData = readUint8(cursor, "event status");
    let status = statusOrData;
    let data1: number;

    if (statusOrData < 0x80) {
      if (runningStatus === null) {
        throw new Error(
          `Running status encountered without a prior status byte on track ${sourceTrackIndex}.`,
        );
      }
      status = runningStatus;
      data1 = statusOrData;
    } else {
      if (statusOrData < 0xf0) {
        runningStatus = statusOrData;
      } else {
        runningStatus = null;
      }

      if (statusOrData === 0xff) {
        const metaType = readUint8(cursor, "meta event type");
        const metaLength = readVlq(cursor, "meta event length");
        const metaData = readBytes(cursor, metaLength, "meta event payload");
        if (metaType === 0x03) {
          trackName = decodeText(metaData) || null;
        }
        if (metaType === 0x2f) {
          cursor.offset = cursor.limit;
          break;
        }
        continue;
      }

      if (statusOrData === 0xf0 || statusOrData === 0xf7) {
        const sysexLength = readVlq(cursor, "sysex event length");
        readBytes(cursor, sysexLength, "sysex event payload");
        continue;
      }

      data1 = readUint8(cursor, "MIDI event data byte 1");
    }

    const eventType = status & 0xf0;
    const channel = status & 0x0f;
    rememberChannel(seenChannels, channelOrder, channel);

    switch (eventType) {
      case 0x80: {
        const key = clampMidiByte(data1, "Note key");
        readUint8(cursor, "note off velocity");
        closeActiveNote(activeNotes, notes, channel, key, absoluteTick);
        break;
      }
      case 0x90: {
        const key = clampMidiByte(data1, "Note key");
        const velocity = clampMidiByte(
          readUint8(cursor, "note on velocity"),
          "Note velocity",
        );
        if (velocity === 0) {
          closeActiveNote(activeNotes, notes, channel, key, absoluteTick);
          break;
        }
        const bucketKey = noteBucketKey(channel, key);
        const bucket = activeNotes.get(bucketKey) ?? [];
        bucket.push({ start: absoluteTick, vel: velocity });
        activeNotes.set(bucketKey, bucket);
        break;
      }
      case 0xa0:
        readUint8(cursor, "poly pressure value");
        break;
      case 0xb0: {
        const ccNumber = clampMidiByte(data1, "CC number");
        const value = clampMidiByte(readUint8(cursor, "CC value"), "CC value");
        ccs.push({ at: absoluteTick, cc: ccNumber, value, channel });
        break;
      }
      case 0xc0:
      case 0xd0:
        break;
      case 0xe0:
        readUint8(cursor, "pitch bend data byte 2");
        break;
      default:
        throw new Error(
          `Unsupported MIDI status byte 0x${status.toString(16)} on track ${sourceTrackIndex}.`,
        );
    }
  }

  for (const [bucketKey, bucket] of activeNotes.entries()) {
    const channel = Math.floor(bucketKey / 128);
    const key = bucketKey % 128;
    for (const activeNote of bucket) {
      notes.push({
        start: activeNote.start,
        length: Math.max(1, absoluteTick - activeNote.start),
        key,
        vel: activeNote.vel,
        channel,
      });
    }
  }

  return {
    sourceTrackIndex,
    name: trackName,
    channelOrder,
    notes: sortParsedNotes(notes),
    ccs: sortParsedCcs(ccs),
  };
}

export function parseMidiSmf(source: ArrayBuffer): ParsedSmfFile {
  const cursor: Cursor = {
    view: new DataView(source),
    offset: 0,
    limit: source.byteLength,
  };

  expectTag(cursor, MIDI_HEADER_CHUNK);
  const headerLength = readUint32(cursor, "header length");
  if (headerLength < 6) {
    throw new Error(`Invalid MIDI header length ${headerLength}.`);
  }

  const headerStart = cursor.offset;
  const format = readUint16(cursor, "format");
  const trackCount = readUint16(cursor, "track count");
  const division = readUint16(cursor, "time division");
  cursor.offset = headerStart + headerLength;

  if ((division & 0x8000) !== 0) {
    throw new Error("SMPTE MIDI time division is not supported.");
  }
  if (trackCount <= 0) {
    throw new Error("MIDI file contains no tracks.");
  }

  const ppq = division;
  const tracks: ParsedSmfTrack[] = [];

  for (let sourceTrackIndex = 0; sourceTrackIndex < trackCount; sourceTrackIndex += 1) {
    expectTag(cursor, MIDI_TRACK_CHUNK);
    const trackLength = readUint32(cursor, "track length");
    const trackStart = cursor.offset;
    const trackLimit = trackStart + trackLength;
    if (trackLimit > cursor.limit) {
      throw new Error(`Track ${sourceTrackIndex} exceeds MIDI file length.`);
    }
    tracks.push(parseTrackChunk(cursor.view, trackStart, trackLimit, sourceTrackIndex));
    cursor.offset = trackLimit;
  }

  if (cursor.offset !== cursor.limit) {
    throw new Error(
      `Unexpected trailing MIDI data after ${trackCount} declared track chunk(s).`,
    );
  }

  return { format, ppq, tracks };
}

export function midiChannelLabel(channel: number): string {
  return `Ch ${channel + 1}`;
}

export function buildMidiImportGroups(
  parsed: ParsedSmfFile,
  projectPpq: number,
): MidiImportGroup[] {
  if (!Number.isInteger(parsed.ppq) || parsed.ppq <= 0) {
    throw new Error(`Invalid source PPQ ${parsed.ppq}.`);
  }
  if (!Number.isInteger(projectPpq) || projectPpq <= 0) {
    throw new Error(`Invalid project PPQ ${projectPpq}.`);
  }

  const groups: MidiImportGroup[] = [];

  for (const track of parsed.tracks) {
    const channelData = new Map<number, {
      notes: ParsedSmfNote[];
      ccs: ParsedSmfCc[];
    }>();

    const ensureChannelData = (channel: number) => {
      const existing = channelData.get(channel);
      if (existing) {
        return existing;
      }
      const created = { notes: [] as ParsedSmfNote[], ccs: [] as ParsedSmfCc[] };
      channelData.set(channel, created);
      return created;
    };

    for (const note of track.notes) {
      ensureChannelData(note.channel).notes.push(note);
    }
    for (const cc of track.ccs) {
      ensureChannelData(cc.channel).ccs.push(cc);
    }

    const orderedChannels = [...track.channelOrder];
    const seenChannels = new Set(orderedChannels);
    for (const channel of channelData.keys()) {
      if (!seenChannels.has(channel)) {
        orderedChannels.push(channel);
        seenChannels.add(channel);
      }
    }

    for (const midiChannel of orderedChannels) {
      if (midiChannel === MIDI_DRUM_CHANNEL) {
        continue;
      }

      const channel = channelData.get(midiChannel);
      if (!channel) {
        continue;
      }

      const notes = sortMidiNotes(
        channel.notes.map((note) =>
          convertNoteToProjectPpq(note, parsed.ppq, projectPpq)
        ),
      );
      if (notes.length === 0) {
        continue;
      }

      const ccs = sortMidiCcs(
        channel.ccs.map((cc) => ({
          at: convertTick(cc.at, parsed.ppq, projectPpq),
          cc: cc.cc,
          value: cc.value,
        })),
      );

      groups.push({
        sourceTrackIndex: track.sourceTrackIndex,
        midiChannel,
        trackName: track.name,
        sourcePpq: parsed.ppq,
        notes,
        ccs,
      });
    }
  }

  return groups;
}

export function collectTrackMidiExportData(
  document: ProjectDocument,
  trackId: TrackId,
): MidiTrackExportData {
  const track = document.edit.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new Error(`Track ${trackId} was not found.`);
  }
  if (track.kind.track_type !== "midi") {
    throw new Error(`Track ${track.name} is not a MIDI track.`);
  }

  const contentById = new Map(
    document.edit.contents.map((content) => [content.id, content] as const),
  );
  const notes: MidiNoteData[] = [];
  const ccs: MidiCc[] = [];

  const trackClips = document.edit.clips
    .filter((clip) => clip.track_id === trackId)
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));

  for (const clip of trackClips) {
    if (clip.kind.clip_type !== "midi") {
      continue;
    }
    const content = contentById.get(clip.kind.content_id);
    if (!content) {
      throw new Error(
        `MIDI clip ${clip.id} references missing content ${clip.kind.content_id}.`,
      );
    }
    if (content.type !== "midi") {
      throw new Error(
        `MIDI clip ${clip.id} references non-MIDI content ${clip.kind.content_id}.`,
      );
    }

    const visibleStart = clip.kind.midi.content_in;
    const visibleEnd = clip.kind.midi.content_out;

    for (const note of content.notes) {
      const noteStart = note.start;
      const noteEnd = note.start + note.length;
      if (noteEnd <= visibleStart || noteStart >= visibleEnd) {
        continue;
      }
      if (noteStart < visibleStart || noteEnd > visibleEnd) {
        throw new Error(
          `MIDI clip ${clip.id} contains a note crossing its visible window.`,
        );
      }
      notes.push({
        start: clip.start + (noteStart - visibleStart),
        length: note.length,
        key: Math.max(
          0,
          Math.min(127, note.key + clip.kind.midi.transpose_semitones),
        ),
        vel: note.vel,
      });
    }

    for (const cc of content.ccs) {
      if (cc.at < visibleStart || cc.at >= visibleEnd) {
        continue;
      }
      ccs.push({
        at: clip.start + (cc.at - visibleStart),
        cc: cc.cc,
        value: cc.value,
      });
    }
  }

  return {
    notes: sortMidiNotes(notes),
    ccs: sortMidiCcs(ccs),
  };
}

export function encodeSingleTrackSmf(
  input: EncodeMidiTrackInput,
): Uint8Array {
  if (!Number.isInteger(input.ppq) || input.ppq <= 0 || input.ppq > 0x7fff) {
    throw new Error(`PPQ must be an integer between 1 and 32767, got ${input.ppq}.`);
  }

  const channel = input.channel ?? MIDI_EXPORT_CHANNEL;
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) {
    throw new Error(`MIDI channel must be between 0 and 15, got ${channel}.`);
  }

  const events: EncodedMidiEvent[] = [];

  for (const note of sortMidiNotes(input.notes)) {
    const start = sanitizeTick(note.start);
    const end = Math.max(start + 1, sanitizeTick(note.start + note.length));
    const key = clampMidiByte(note.key, "Note key");
    const velocity = normalizeNoteVelocity(note.vel);

    events.push({
      tick: end,
      priority: 0,
      sortA: key,
      sortB: 0,
      bytes: [0x80 | channel, key, 0],
    });
    events.push({
      tick: start,
      priority: 2,
      sortA: key,
      sortB: velocity,
      bytes: [0x90 | channel, key, velocity],
    });
  }

  for (const cc of sortMidiCcs(input.ccs ?? [])) {
    const tick = sanitizeTick(cc.at);
    const ccNumber = clampMidiByte(cc.cc, "CC number");
    const value = clampMidiByte(cc.value, "CC value");
    events.push({
      tick,
      priority: 1,
      sortA: ccNumber,
      sortB: value,
      bytes: [0xb0 | channel, ccNumber, value],
    });
  }

  events.sort(
    (left, right) =>
      left.tick - right.tick ||
      left.priority - right.priority ||
      left.sortA - right.sortA ||
      left.sortB - right.sortB,
  );

  const trackBody: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    trackBody.push(...writeVlq(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  trackBody.push(0x00, 0xff, 0x2f, 0x00);

  const headerBody = new Uint8Array(6);
  const headerView = new DataView(headerBody.buffer);
  headerView.setUint16(0, 0);
  headerView.setUint16(2, 1);
  headerView.setUint16(4, input.ppq);

  return concatChunks([
    encodeChunk(MIDI_HEADER_CHUNK, headerBody),
    encodeChunk(MIDI_TRACK_CHUNK, Uint8Array.from(trackBody)),
  ]);
}
