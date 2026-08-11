export { encodeWav } from "./wavEncoder.ts";
export { renderProjectToAudioBufferData } from "./projectMixdown.ts";
export interface RenderProgress {
  phase: "preparing" | "rendering" | "done";
  progress: number;
}
export type {
  RenderMixdownOptions,
  RenderMixdownProgress,
} from "./projectMixdown.ts";
