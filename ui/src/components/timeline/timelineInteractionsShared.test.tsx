import { describe, expect, it } from "vitest";

import { createBaseTimelineProject } from "@/test/projectTestUtils";
import {
  hasTimelineMarqueeMoved,
  resolveTimelineMarqueeSelection,
} from "./timelineInteractionsShared";

describe("timeline interaction shared helpers", () => {
  it("treats sub-threshold marquee moves as insignificant", () => {
    expect(
      hasTimelineMarqueeMoved({
        startX: 10,
        startY: 10,
        currentX: 13,
        currentY: 13,
        union: false,
        baseSelection: [],
        basePrimaryClipId: null,
      }),
    ).toBe(false);
  });

  it("keeps union marquee selection within the existing clip kind", () => {
    const project = createBaseTimelineProject();
    const [audioClip, midiClip] = project.edit.clips;
    expect(audioClip?.kind.clip_type).toBe("audio");
    expect(midiClip?.kind.clip_type).toBe("midi");

    const selection = resolveTimelineMarqueeSelection({
      document: project,
      marquee: {
        startX: 0,
        startY: 0,
        currentX: 2_000,
        currentY: 200,
        union: true,
        baseSelection: [audioClip!.id],
        basePrimaryClipId: audioClip!.id,
      },
      pixelsPerTick: 1,
      trackHeight: 80,
      selectedClipKind: "audio",
    });

    expect(selection).toContain(audioClip!.id);
    expect(selection).not.toContain(midiClip!.id);
  });
});
