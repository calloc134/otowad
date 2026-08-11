import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PitchLinkDialog } from "./PitchLinkDialog";
import { renderWithProject } from "@/test/renderWithProject";
import { createBaseTimelineProject } from "@/test/projectTestUtils";
import { useDocumentState } from "@/store";
import { applyCommand } from "@/test/projectTestUtils";

function PitchLinkProbe() {
  const { document } = useDocumentState();
  const link = document?.edit.pitch_links[0] ?? null;
  const audioClip = document?.edit.clips.find((clip) => clip.kind.clip_type === "audio") ?? null;

  return (
    <div>
      <div data-testid="pitch-link-count">{document?.edit.pitch_links.length ?? 0}</div>
      <div data-testid="pitch-link-summary">
        {link ? `${link.midi_track}:${link.audio_track}:${link.no_note_behavior}:${link.priority}` : "none"}
      </div>
      <div data-testid="audio-pitch-mode">
        {audioClip && audioClip.kind.clip_type === "audio"
          ? audioClip.kind.audio.pitch.mode
          : "none"}
      </div>
    </div>
  );
}

describe("PitchLinkDialog integration", () => {
  it("adds a pitch link through field rows and button rows", async () => {
    const project = createBaseTimelineProject();
    const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");

    if (!midiTrack || !audioTrack) {
      throw new Error("Expected base project to contain MIDI and audio tracks");
    }

    renderWithProject(
      <>
        <PitchLinkDialog open onClose={() => {}} />
        <PitchLinkProbe />
      </>,
      { project },
    );

    fireEvent.change(screen.getByLabelText("Pitch link MIDI source"), {
      target: { value: midiTrack.id },
    });
    fireEvent.change(screen.getByLabelText("Pitch link audio target"), {
      target: { value: audioTrack.id },
    });
    expect(
      screen.getByText("Prefer the overlapping note that started most recently."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Hold last"));
    fireEvent.click(screen.getByLabelText("Latest"));
    fireEvent.click(screen.getByRole("button", { name: "Add Link" }));

    await waitFor(() => {
      expect(screen.getByTestId("pitch-link-count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("pitch-link-summary")).toHaveTextContent(
      `${midiTrack.id}:${audioTrack.id}:HoldLast:Latest`,
    );
    expect(screen.getByTestId("audio-pitch-mode")).toHaveTextContent("FollowMidiOnly");
  });

  it("removes an existing pitch link through the active links panel", async () => {
    const project = createBaseTimelineProject();
    const midiTrack = project.edit.tracks.find((track) => track.kind.track_type === "midi");
    const audioTrack = project.edit.tracks.find((track) => track.kind.track_type === "audio");
    const audioClip = project.edit.clips.find((clip) => clip.kind.clip_type === "audio");

    if (!midiTrack || !audioTrack || !audioClip || audioClip.kind.clip_type !== "audio") {
      throw new Error("Expected base project to contain linked pitch test fixtures");
    }

    let projectWithLink = applyCommand(project, {
      command: "add_pitch_link",
      link: {
        id: crypto.randomUUID(),
        midi_track: midiTrack.id,
        audio_track: audioTrack.id,
        no_note_behavior: "KeepOriginal",
        no_pitch_behavior: "Bypass",
        priority: "Highest",
      },
    });
    projectWithLink = applyCommand(projectWithLink, {
      command: "set_pitch_mode",
      clip_id: audioClip.id,
      mode: "FollowMidiOnly",
    });

    renderWithProject(
      <>
        <PitchLinkDialog open onClose={() => {}} />
        <PitchLinkProbe />
      </>,
      { project: projectWithLink },
    );

    expect(
      screen.getByRole("option", { name: `${audioTrack.name} (already linked)` }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("pitch-link-count")).toHaveTextContent("0");
    });
    expect(screen.getByTestId("pitch-link-summary")).toHaveTextContent("none");
    expect(screen.getByTestId("audio-pitch-mode")).toHaveTextContent("ManualOnly");
  });
});
