import {
  createNativeDecodedAudioSource,
  type DecodedAudioSource,
} from "./audioDecoder.ts";

type CompatibilityDecoder = (file: File) => Promise<DecodedAudioSource>;
type CompatibilityDecoderLoader = () => Promise<CompatibilityDecoder>;

class AudioFileDecodeError extends Error {
  readonly causes: readonly unknown[];

  constructor(fileName: string, causes: readonly unknown[]) {
    const [nativeError, compatibilityError] = causes;
    super(
      `Could not decode ${fileName} with Web Audio or FFmpeg/WASM. ` +
      `Native: ${describeDecodeError(nativeError)}. ` +
      `Compatibility: ${describeDecodeError(compatibilityError)}.`,
    );
    this.name = "AudioFileDecodeError";
    this.causes = causes;
  }
}

function describeDecodeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function isUnsupportedCodecError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "EncodingError";
}

/**
 * Decode one user-selected file. Native Web Audio remains the fast path; the
 * compatibility fallback is layered here without leaking into import hooks.
 */
export function createAudioFileDecoder(
  loadCompatibilityDecoder: CompatibilityDecoderLoader,
): (file: File, context: AudioContext) => Promise<DecodedAudioSource> {
  return async (file, context) => {
    const encodedBytes = await file.arrayBuffer();
    try {
      const audioBuffer = await context.decodeAudioData(encodedBytes);
      return createNativeDecodedAudioSource(audioBuffer);
    } catch (nativeError) {
      if (!isUnsupportedCodecError(nativeError)) {
        throw nativeError;
      }
      try {
        const decodeCompatibilityFile = await loadCompatibilityDecoder();
        return await decodeCompatibilityFile(file);
      } catch (compatibilityError) {
        throw new AudioFileDecodeError(file.name, [nativeError, compatibilityError]);
      }
    }
  };
}

export const decodeAudioFile = createAudioFileDecoder(async () => {
  const module = await import("./ffmpegCompatDecoder.ts");
  return module.decodeAudioFileWithFfmpeg;
});
