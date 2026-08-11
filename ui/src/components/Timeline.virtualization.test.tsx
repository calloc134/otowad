import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { renderWithProject } from "@/test/renderWithProject";
import { Timeline } from "./Timeline";

function createThreeThousandClipProject() {
  const project = createBaseTimelineProject();
  const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio")!;
  const midiClip = project.edit.clips.find((clip) => clip.kind.clip_type === "midi")!;
  const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio")!;
  const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi")!;

  project.edit.clips = Array.from({ length: 3_000 }, (_, index) => {
    const template = index % 2 === 0 ? audioClip : midiClip;
    return {
      ...template,
      id: `virtual-clip-${index}`,
      track_id: index % 2 === 0 ? audioTrack.id : midiTrack.id,
      start: index * 960,
      length: 480,
    };
  });
  return project;
}

describe("Timeline virtualization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts only the overscanned clip window and updates it on scroll", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid === "timeline-scroll") {
        return {
          left: 0,
          top: 0,
          width: 800,
          height: 400,
          right: 800,
          bottom: 400,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
      return originalRect.call(this);
    });

    const { container } = renderWithProject(<Timeline />, {
      project: createThreeThousandClipProject(),
    });
    const scroll = await screen.findByTestId("timeline-scroll");
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });

    await waitFor(() => {
      const clipRoots = container.querySelectorAll("[data-clip-root='true']");
      expect(clipRoots).toHaveLength(42);
      expect(screen.getByTestId("timeline-canvas")).toHaveAttribute(
        "data-rendered-clip-count",
        "42",
      );
      expect(screen.getByTestId("timeline-canvas")).toHaveAttribute(
        "data-total-clip-count",
        "3000",
      );
    });
    expect(screen.getByTestId("clip-virtual-clip-0")).toBeInTheDocument();
    expect(screen.queryByTestId("clip-virtual-clip-2999")).not.toBeInTheDocument();

    scroll.scrollLeft = 80_000;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(screen.queryByTestId("clip-virtual-clip-0")).not.toBeInTheDocument();
      expect(container.querySelectorAll("[data-clip-root='true']").length).toBeLessThan(100);
    });
  });
});
