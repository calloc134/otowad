use std::collections::HashMap;

use crate::analysis::{median_f0_in_range, AnalysisResolver};
use crate::edit::*;
use crate::ids::*;
use crate::runtime::*;
use crate::time::*;
use crate::warp::FullWarp;

#[derive(Debug, Clone)]
struct NoteEvent {
    timeline_start: i64,
    timeline_end: i64,
    key: u8,
    note_length: i64,
    velocity: u8,
    clip_id: ClipId,
    content_id: ContentId,
}

#[derive(Debug, Clone)]
struct AudioClipInfo {
    clip_id: ClipId,
    start_tick: i64,
    end_tick: i64,
    clip_length: i64,
    content_id: ContentId,
    warp: FullWarp,
}

fn transpose_midi_key(key: u8, transpose_semitones: i16) -> u8 {
    (key as i16 + transpose_semitones).clamp(0, 127) as u8
}

fn quantize_frequency_to_nearest_tet_hz(hz: f64) -> f64 {
    if hz <= 0.0 {
        return hz;
    }
    let midi_note = 69.0 + 12.0 * (hz / 440.0).log2();
    let nearest_midi = midi_note.round();
    440.0 * f64::powf(2.0, (nearest_midi - 69.0) / 12.0)
}

fn collect_note_events(edit: &ProjectEdit, midi_track: TrackId) -> Vec<NoteEvent> {
    let mut note_events = Vec::new();

    for midi_clip in edit.clips.iter().filter(|clip| clip.track_id == midi_track) {
        let (content_id, midi_edit) = match &midi_clip.kind {
            ClipKind::Midi { content_id, midi } => (*content_id, midi),
            _ => continue,
        };

        let midi_content = edit.contents.iter().find_map(|content| match content {
            ContentEdit::Midi(midi_content) if midi_content.id == content_id => Some(midi_content),
            _ => None,
        });
        let Some(midi_content) = midi_content else {
            continue;
        };

        for note in &midi_content.notes {
            let note_end_tick = note.start.0 + note.length.0;
            if note_end_tick <= midi_edit.content_in.0 || note.start.0 >= midi_edit.content_out.0 {
                continue;
            }

            let visible_start = note.start.0.max(midi_edit.content_in.0);
            let visible_end = note_end_tick.min(midi_edit.content_out.0);
            note_events.push(NoteEvent {
                timeline_start: midi_clip.start.0 + (visible_start - midi_edit.content_in.0),
                timeline_end: midi_clip.start.0 + (visible_end - midi_edit.content_in.0),
                key: transpose_midi_key(note.key, midi_edit.transpose_semitones),
                note_length: note.length.0,
                velocity: note.vel,
                clip_id: midi_clip.id,
                content_id,
            });
        }
    }

    note_events.sort_by_key(latest_note_order_key);
    note_events
}

fn latest_note_order_key(note: &NoteEvent) -> (i64, u8, i64, u8, ClipId, ContentId) {
    (
        note.timeline_start,
        note.key,
        note.note_length,
        note.velocity,
        note.clip_id,
        note.content_id,
    )
}

fn select_latest_note<'a>(active: &'a [&'a NoteEvent]) -> Option<&'a NoteEvent> {
    active
        .iter()
        .copied()
        .max_by_key(|note| latest_note_order_key(note))
}

fn resolve_priority(active: &[&NoteEvent], priority: &NotePriority) -> Option<u8> {
    if active.is_empty() {
        return None;
    }
    if active.len() == 1 {
        return Some(active[0].key);
    }

    match priority {
        NotePriority::Highest => active.iter().map(|note| note.key).max(),
        NotePriority::Lowest => active.iter().map(|note| note.key).min(),
        NotePriority::Latest => select_latest_note(active).map(|note| note.key),
    }
}

fn source_span_for_timeline_interval(
    clip_info: &AudioClipInfo,
    interval_start_tick: i64,
    interval_end_tick: i64,
) -> Option<(u64, u64)> {
    if interval_end_tick <= interval_start_tick {
        return None;
    }

    let local_start = (interval_start_tick - clip_info.start_tick).clamp(0, clip_info.clip_length);
    let local_end = (interval_end_tick - clip_info.start_tick).clamp(0, clip_info.clip_length);
    if local_end <= local_start {
        return None;
    }

    let src_start = clip_info.warp.interpolate(Tick(local_start)).0;
    let src_end = clip_info.warp.interpolate(Tick(local_end)).0;
    if src_end <= src_start {
        return None;
    }
    Some((src_start, src_end))
}

fn collect_audio_clip_infos(edit: &ProjectEdit, audio_track: TrackId) -> Vec<AudioClipInfo> {
    let mut clips: Vec<_> = edit
        .clips
        .iter()
        .filter(|clip| clip.track_id == audio_track)
        .filter_map(|clip| {
            if let ClipKind::Audio { content_id, audio } = &clip.kind {
                Some(AudioClipInfo {
                    clip_id: clip.id,
                    start_tick: clip.start.0,
                    end_tick: clip.start.0 + clip.length.0,
                    clip_length: clip.length.0,
                    content_id: *content_id,
                    warp: FullWarp::from_audio(clip.length, audio),
                })
            } else {
                None
            }
        })
        .collect();

    clips.sort_by(|left, right| {
        left.start_tick
            .cmp(&right.start_tick)
            .then(left.end_tick.cmp(&right.end_tick))
            .then(left.clip_id.0.cmp(&right.clip_id.0))
    });
    clips
}

fn get_source_ref_f0(
    edit: &ProjectEdit,
    analysis_resolver: Option<&AnalysisResolver<'_>>,
    clip_info: &AudioClipInfo,
    interval_start_tick: i64,
    interval_end_tick: i64,
) -> Option<f64> {
    let (mapped_src_start, mapped_src_end) =
        source_span_for_timeline_interval(clip_info, interval_start_tick, interval_end_tick)?;
    let resolver = analysis_resolver?;

    let content = edit.contents.iter().find_map(|candidate| match candidate {
        ContentEdit::Audio(content) if content.id == clip_info.content_id => Some(content),
        _ => None,
    })?;
    let f0_track = resolver.resolve_f0_for_content(content)?;
    median_f0_in_range(f0_track, mapped_src_start, mapped_src_end)
}

fn compute_shift_cents(key: u8, source_ref_f0: Option<f64>) -> i32 {
    let target_hz = 440.0 * f64::powf(2.0, (key as f64 - 69.0) / 12.0);
    match source_ref_f0 {
        Some(source_hz) if source_hz > 0.0 => {
            let source_ref_hz = quantize_frequency_to_nearest_tet_hz(source_hz);
            (1200.0 * (target_hz / source_ref_hz).log2()).round() as i32
        }
        _ => (key as i32 - 69) * 100,
    }
}

pub fn build_pitch_plan(
    edit: &ProjectEdit,
    tempo_rt: &TempoMapRt,
    sample_rate: u32,
    analysis_resolver: Option<&AnalysisResolver<'_>>,
) -> Vec<PitchSegmentRt> {
    let mut segments = Vec::new();

    for link in &edit.pitch_links {
        let note_events = collect_note_events(edit, link.midi_track);
        let audio_clip_infos = collect_audio_clip_infos(edit, link.audio_track);

        let mut boundaries = Vec::new();
        for event in &note_events {
            boundaries.push(event.timeline_start);
            boundaries.push(event.timeline_end);
        }
        for clip_info in &audio_clip_infos {
            boundaries.push(clip_info.start_tick);
            boundaries.push(clip_info.end_tick);
            for point in clip_info.warp.points() {
                if point.tick.0 > 0 && point.tick.0 < clip_info.clip_length {
                    boundaries.push(clip_info.start_tick + point.tick.0);
                }
            }
        }
        boundaries.sort();
        boundaries.dedup();

        let mut last_active_key = None;
        let mut last_valid_shift_cents: HashMap<ClipId, i32> = HashMap::new();

        for window in boundaries.windows(2) {
            let seg_start_tick = window[0];
            let seg_end_tick = window[1];
            if seg_start_tick >= seg_end_tick {
                continue;
            }

            let active_notes: Vec<_> = note_events
                .iter()
                .filter(|note| {
                    note.timeline_start < seg_end_tick && note.timeline_end > seg_start_tick
                })
                .collect();

            let resolved_key = resolve_priority(&active_notes, &link.priority);
            let effective_key = match resolved_key {
                Some(key) => {
                    last_active_key = Some(key);
                    Some(key)
                }
                None => match link.no_note_behavior {
                    NoNoteBehavior::KeepOriginal => None,
                    NoNoteBehavior::HoldLast => last_active_key,
                },
            };
            let Some(effective_key) = effective_key else {
                continue;
            };

            for clip_info in &audio_clip_infos {
                let intersect_start = seg_start_tick.max(clip_info.start_tick);
                let intersect_end = seg_end_tick.min(clip_info.end_tick);
                if intersect_start >= intersect_end {
                    continue;
                }

                let start_frame = tempo_rt.tick_to_frame(Tick(intersect_start), sample_rate).0;
                let end_frame = tempo_rt.tick_to_frame(Tick(intersect_end), sample_rate).0;
                if start_frame >= end_frame {
                    continue;
                }

                let source_ref_f0 = get_source_ref_f0(
                    edit,
                    analysis_resolver,
                    clip_info,
                    intersect_start,
                    intersect_end,
                );

                let shift_cents = match source_ref_f0 {
                    Some(_) => {
                        let shift = compute_shift_cents(effective_key, source_ref_f0);
                        last_valid_shift_cents.insert(clip_info.clip_id, shift);
                        shift
                    }
                    None => match link.no_pitch_behavior {
                        NoPitchBehavior::Bypass => continue,
                        NoPitchBehavior::HoldLast => {
                            let Some(held_shift) =
                                last_valid_shift_cents.get(&clip_info.clip_id).copied()
                            else {
                                continue;
                            };
                            held_shift
                        }
                    },
                };

                segments.push(PitchSegmentRt {
                    clip_id: clip_info.clip_id,
                    audio_track: link.audio_track,
                    start: TimelineFrame(start_frame),
                    end: TimelineFrame(end_frame),
                    shift_cents,
                });
            }
        }
    }

    segments.sort_by(|left, right| {
        left.audio_track
            .0
            .cmp(&right.audio_track.0)
            .then(left.start.0.cmp(&right.start.0))
            .then(left.end.0.cmp(&right.end.0))
            .then(left.clip_id.0.cmp(&right.clip_id.0))
    });
    segments
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn note_event(
        timeline_start: i64,
        key: u8,
        note_length: i64,
        velocity: u8,
        clip_id: u128,
        content_id: u128,
    ) -> NoteEvent {
        NoteEvent {
            timeline_start,
            timeline_end: timeline_start + note_length,
            key,
            note_length,
            velocity,
            clip_id: ClipId(Uuid::from_u128(clip_id)),
            content_id: ContentId(Uuid::from_u128(content_id)),
        }
    }

    fn assert_latest_prefers(preferred: &NoteEvent, other: &NoteEvent) {
        let active = [other, preferred];
        let selected = select_latest_note(&active).expect("select latest note");
        assert_eq!(selected.clip_id, preferred.clip_id);
        assert_eq!(selected.content_id, preferred.content_id);
    }

    #[test]
    fn transpose_midi_key_clamps_to_valid_range() {
        assert_eq!(transpose_midi_key(60, 2), 62);
        assert_eq!(transpose_midi_key(0, -4), 0);
        assert_eq!(transpose_midi_key(127, 4), 127);
    }

    #[test]
    fn compute_shift_cents_quantizes_detuned_reference_to_nearest_semitone() {
        assert_eq!(compute_shift_cents(69, Some(220.0)), 1200);
        assert_eq!(compute_shift_cents(69, Some(215.0)), 1200);
    }

    #[test]
    fn latest_note_uses_canonical_six_field_tie_breaker() {
        assert_latest_prefers(
            &note_event(2, 0, 1, 0, 1, 1),
            &note_event(1, 127, 999, 127, 9, 9),
        );
        assert_latest_prefers(
            &note_event(2, 61, 1, 0, 1, 1),
            &note_event(2, 60, 999, 127, 9, 9),
        );
        assert_latest_prefers(
            &note_event(2, 61, 2, 0, 1, 1),
            &note_event(2, 61, 1, 127, 9, 9),
        );
        assert_latest_prefers(
            &note_event(2, 61, 2, 2, 1, 1),
            &note_event(2, 61, 2, 1, 9, 9),
        );
        assert_latest_prefers(
            &note_event(2, 61, 2, 2, 2, 1),
            &note_event(2, 61, 2, 2, 1, 9),
        );
        assert_latest_prefers(
            &note_event(2, 61, 2, 2, 2, 2),
            &note_event(2, 61, 2, 2, 2, 1),
        );
    }
}
