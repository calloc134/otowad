import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BpmDialog } from "./BpmDialog";
import { GridDialog } from "./GridDialog";
import { TimeSignatureDialog } from "./TimeSignatureDialog";
import { TrackCreateDialog } from "./TrackCreateDialog";
import { renderWithProject } from "@/test/renderWithProject";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { useDocumentState } from "@/store";

function ProjectProbe() {
  const { document } = useDocumentState();
  const tempoPoint = document?.edit.tempo.points[0];
  const grid = document?.edit.grid;

  return (
    <div>
      <div data-testid="tempo-readout">
        {tempoPoint ? (tempoPoint.micro_bpm / 1_000_000).toFixed(1) : "none"}
      </div>
      <div data-testid="timesig-readout">
        {tempoPoint ? `${tempoPoint.time_sig.num}/${tempoPoint.time_sig.den}` : "none"}
      </div>
      <div data-testid="grid-readout">
        {grid
          ? `${grid.snap_enabled ? "on" : "off"}:${typeof grid.division === "string" ? grid.division : "compound"}:${grid.magnet_range_permille}`
          : "none"}
      </div>
    </div>
  );
}

describe("Dialog primitive migration", () => {
  it("applies BPM changes through the shared dialog row primitives", async () => {
    const onClose = vi.fn();
    const project = createBaseTimelineProject();

    renderWithProject(
      <>
        <BpmDialog open onClose={onClose} />
        <ProjectProbe />
      </>,
      { project },
    );

    fireEvent.change(screen.getByLabelText("BPM value"), {
      target: { value: "132.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByTestId("tempo-readout")).toHaveTextContent("132.5");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies time signature changes through the shared dialog row primitives", async () => {
    const onClose = vi.fn();
    const project = createBaseTimelineProject();

    renderWithProject(
      <>
        <TimeSignatureDialog open onClose={onClose} />
        <ProjectProbe />
      </>,
      { project },
    );

    fireEvent.change(screen.getByLabelText("Time signature numerator"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Time signature denominator"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByTestId("timesig-readout")).toHaveTextContent("3/8");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies grid changes through the shared dialog row primitives", async () => {
    const onClose = vi.fn();
    const project = createBaseTimelineProject();

    renderWithProject(
      <>
        <GridDialog open onClose={onClose} />
        <ProjectProbe />
      </>,
      { project },
    );

    fireEvent.click(screen.getByLabelText("Toggle grid and snap"));
    fireEvent.change(screen.getByLabelText("Grid division"), {
      target: { value: "Sixteenth" },
    });
    fireEvent.change(screen.getByLabelText("Grid snap range"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByTestId("grid-readout")).toHaveTextContent("off:Sixteenth:500");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes track type actions and cancel through shared dialog rows", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    render(
      <TrackCreateDialog open onClose={onClose} onCreate={onCreate} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create audio track" }));
    fireEvent.click(screen.getByRole("button", { name: "Create MIDI track" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCreate).toHaveBeenNthCalledWith(1, "audio");
    expect(onCreate).toHaveBeenNthCalledWith(2, "midi");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
