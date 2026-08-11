import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { livePlayheadStore } from "@/audio/livePlayheadStore.ts";
import { usePlayheadMarker, usePlayheadReadout } from "@/hooks/usePlayheadMarker.ts";
import { useProjectActions, useTransportState } from "@/store";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { renderWithProject } from "@/test/renderWithProject";

const PIXELS_PER_TICK = 0.5;

function PlayheadMarkerProbe() {
  const markerRef = usePlayheadMarker(PIXELS_PER_TICK);
  const actions = useProjectActions();
  const transport = useTransportState();

  return (
    <div>
      <div data-testid="playhead-marker" ref={markerRef} />
      <span data-testid="playhead-tick">{transport.playheadTick}</span>
      <button type="button" onClick={() => actions.setPlayhead(1920)}>
        seek
      </button>
    </div>
  );
}

function renderProbe(playheadTick?: number) {
  return renderWithProject(<PlayheadMarkerProbe />, {
    project: createBaseTimelineProject(),
    playheadTick,
  });
}

describe("playhead marker", () => {
  beforeEach(() => {
    livePlayheadStore._reset();
  });

  it("moves to the seeked position while playback is stopped", () => {
    renderProbe(960);

    expect(screen.getByTestId("playhead-tick")).toHaveTextContent("960");
    expect(screen.getByTestId("playhead-marker").style.left).toBe("480px");
  });

  it("follows a seek that happens after mount", () => {
    renderProbe(0);

    expect(screen.getByTestId("playhead-marker").style.left).toBe("0px");

    fireEvent.click(screen.getByRole("button", { name: "seek" }));

    expect(screen.getByTestId("playhead-tick")).toHaveTextContent("1920");
    expect(screen.getByTestId("playhead-marker").style.left).toBe("960px");
  });

  it("still tracks the per-frame store that playback writes to", () => {
    renderProbe(0);

    act(() => {
      livePlayheadStore.set(2400);
    });

    expect(screen.getByTestId("playhead-marker").style.left).toBe("1200px");
  });
});

function PlayheadReadoutProbe() {
  const readoutRef = usePlayheadReadout(formatTick);
  return <span data-testid="readout" ref={readoutRef} />;
}

function formatTick(tick: number) {
  return `tick ${tick}`;
}

describe("playhead readout", () => {
  beforeEach(() => {
    livePlayheadStore._reset();
  });

  it("keeps counting while playback advances the per-frame store", () => {
    renderWithProject(<PlayheadReadoutProbe />, {
      project: createBaseTimelineProject(),
    });

    expect(screen.getByTestId("readout")).toHaveTextContent("tick 0");

    // Playback writes only the live store; the reducer stays where it was.
    act(() => {
      livePlayheadStore.set(4800);
    });
    expect(screen.getByTestId("readout")).toHaveTextContent("tick 4800");

    act(() => {
      livePlayheadStore.set(9600);
    });
    expect(screen.getByTestId("readout")).toHaveTextContent("tick 9600");
  });

  it("shows the seeked position while playback is stopped", () => {
    renderWithProject(<PlayheadReadoutProbe />, {
      project: createBaseTimelineProject(),
      playheadTick: 1440,
    });

    expect(screen.getByTestId("readout")).toHaveTextContent("tick 1440");
  });
});
