import assert from "node:assert/strict";
import test from "node:test";

import { buildClipPitchRenderPlan } from "./pitchPlan.ts";
import type { CompiledPitchPlan } from "../types/index.ts";

test("buildClipPitchRenderPlan exposes local warp plan segments from compiled payload", () => {
  const compiledPlan: CompiledPitchPlan = {
    sample_rate: 44_100,
    audio_clips: [{
      clip_id: "clip-a",
      track_id: "track-a",
      start_frame: 1_000,
      end_frame: 5_000,
      src_in_frame: 10_000,
      src_out_frame: 14_000,
      warp_plan: {
        kind: "piecewise",
        segments: [
          {
            dst_start_frame: 1_000,
            dst_end_frame: 3_000,
            src_start_frame: 10_000,
            src_end_frame: 11_000,
          },
          {
            dst_start_frame: 3_000,
            dst_end_frame: 5_000,
            src_start_frame: 11_000,
            src_end_frame: 14_000,
          },
        ],
      },
    }],
    pitch_plan: [],
  };

  const plan = buildClipPitchRenderPlan({
    compiledPlan,
    clipId: "clip-a",
    trackId: "track-a",
    outputSamples: 4_000,
    manualCents: 0,
    storedMode: "ManualOnly",
  });

  assert.equal(plan.totalPitchSemitones, 0);
  assert.deepEqual(plan.warpPlan, {
    kind: "piecewise",
    segments: [
      {
        outputStartSample: 0,
        outputEndSample: 2_000,
        sourceStartSample: 0,
        sourceEndSample: 1_000,
      },
      {
        outputStartSample: 2_000,
        outputEndSample: 4_000,
        sourceStartSample: 1_000,
        sourceEndSample: 4_000,
      },
    ],
  });
});

test("buildClipPitchRenderPlan keeps follow segments clip-scoped for overlapping same-track clips", () => {
  const compiledPlan: CompiledPitchPlan = {
    sample_rate: 44_100,
    audio_clips: [
      {
        clip_id: "clip-a",
        track_id: "track-a",
        start_frame: 1_000,
        end_frame: 5_000,
        src_in_frame: 0,
        src_out_frame: 4_000,
        warp_plan: {
          kind: "linear",
          segments: [{
            dst_start_frame: 1_000,
            dst_end_frame: 5_000,
            src_start_frame: 0,
            src_end_frame: 4_000,
          }],
        },
      },
      {
        clip_id: "clip-b",
        track_id: "track-a",
        start_frame: 1_000,
        end_frame: 5_000,
        src_in_frame: 4_000,
        src_out_frame: 8_000,
        warp_plan: {
          kind: "linear",
          segments: [{
            dst_start_frame: 1_000,
            dst_end_frame: 5_000,
            src_start_frame: 4_000,
            src_end_frame: 8_000,
          }],
        },
      },
    ],
    pitch_plan: [
      {
        clip_id: "clip-a",
        audio_track: "track-a",
        start_frame: 1_000,
        end_frame: 5_000,
        shift_cents: 100,
      },
      {
        clip_id: "clip-b",
        audio_track: "track-a",
        start_frame: 1_000,
        end_frame: 5_000,
        shift_cents: 700,
      },
    ],
  };

  const clipAPlan = buildClipPitchRenderPlan({
    compiledPlan,
    clipId: "clip-a",
    trackId: "track-a",
    outputSamples: 4_000,
    manualCents: 0,
    storedMode: "FollowMidiOnly",
  });
  const clipBPlan = buildClipPitchRenderPlan({
    compiledPlan,
    clipId: "clip-b",
    trackId: "track-a",
    outputSamples: 4_000,
    manualCents: 0,
    storedMode: "FollowMidiOnly",
  });

  assert.equal(clipAPlan.totalPitchSemitones, 1);
  assert.equal(clipBPlan.totalPitchSemitones, 7);
});

test("buildClipPitchRenderPlan preserves ManualPlusFollow on linked tracks", () => {
  const compiledPlan: CompiledPitchPlan = {
    sample_rate: 44_100,
    audio_clips: [{
      clip_id: "clip-a",
      track_id: "track-a",
      start_frame: 0,
      end_frame: 4_000,
      src_in_frame: 0,
      src_out_frame: 4_000,
      warp_plan: {
        kind: "linear",
        segments: [{
          dst_start_frame: 0,
          dst_end_frame: 4_000,
          src_start_frame: 0,
          src_end_frame: 4_000,
        }],
      },
    }],
    pitch_plan: [{
      clip_id: "clip-a",
      audio_track: "track-a",
      start_frame: 0,
      end_frame: 4_000,
      shift_cents: 200,
    }],
  };

  const plan = buildClipPitchRenderPlan({
    compiledPlan,
    clipId: "clip-a",
    trackId: "track-a",
    outputSamples: 4_000,
    manualCents: 100,
    storedMode: "ManualPlusFollow",
  });

  assert.equal(plan.totalPitchSemitones, 3);
});
