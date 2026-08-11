export interface MidiClipTimeMapping {
  clipStart: number;
  contentIn: number;
}

interface ProjectToContentTickArgs extends MidiClipTimeMapping {
  projectTick: number;
}

interface ContentToProjectTickArgs extends MidiClipTimeMapping {
  contentTick: number;
}

export function contentTickFromProjectTick(
  args: ProjectToContentTickArgs,
): number {
  return args.contentIn + (args.projectTick - args.clipStart);
}

export function projectTickFromContentTick(
  args: ContentToProjectTickArgs,
): number {
  return args.clipStart + (args.contentTick - args.contentIn);
}
