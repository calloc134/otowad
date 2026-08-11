//! Warp anchor expansion and interpolation.
//!
//! A "full warp" is the anchor list with implicit start `(0, src_in)` and end
//! `(clip_length, src_out)` prepended/appended around any user-defined interior
//! anchors. All three callers — pitch plan builder, command validators, and the
//! compiler — must agree on this expansion and its linear interpolation.

use crate::edit::{AudioClipEdit, WarpMapEdit};
use crate::time::{SrcFrame, Tick};

/// A single expanded warp anchor point in clip-local coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WarpPoint {
    pub tick: Tick,
    pub src: SrcFrame,
}

/// The full expanded anchor list for one audio clip.
///
/// Always non-empty and always contains at least the implicit `(0, src_in)` and
/// `(clip_length, src_out)` endpoints.
#[derive(Debug, Clone)]
pub struct FullWarp {
    points: Vec<WarpPoint>,
}

impl FullWarp {
    /// Build the full anchor list from a clip length, endpoints, and a warp map.
    ///
    /// Interior anchors at tick `<= 0` or `>= clip_length` are silently dropped;
    /// this matches the pre-refactor behavior in the three sites this function
    /// consolidates. Validation of anchor structure lives with each caller
    /// (`compiler` enforces endpoint match + monotonicity; `commands` enforces
    /// insertion-time constraints).
    pub fn build(
        clip_length: Tick,
        src_in: SrcFrame,
        src_out: SrcFrame,
        warp: &WarpMapEdit,
    ) -> Self {
        let mut points = Vec::new();
        points.push(WarpPoint {
            tick: Tick(0),
            src: src_in,
        });
        if let WarpMapEdit::Anchors { anchors } = warp {
            for a in anchors {
                if a.at_in_clip.0 <= 0 || a.at_in_clip.0 >= clip_length.0 {
                    continue;
                }
                points.push(WarpPoint {
                    tick: a.at_in_clip,
                    src: a.src_frame,
                });
            }
        }
        points.push(WarpPoint {
            tick: clip_length,
            src: src_out,
        });
        Self { points }
    }

    /// Convenience: build from an `AudioClipEdit` and its clip length.
    pub fn from_audio(clip_length: Tick, audio: &AudioClipEdit) -> Self {
        Self::build(clip_length, audio.src_in, audio.src_out, &audio.warp)
    }

    /// Access the expanded anchor list (immutable).
    pub fn points(&self) -> &[WarpPoint] {
        &self.points
    }

    /// Linearly interpolate a clip-local tick to a source frame.
    ///
    /// Ticks before the first anchor clamp to its src; ticks after the last
    /// anchor clamp to its src. Interior spans use integer-arithmetic linear
    /// interpolation with `i128` to avoid overflow. If two adjacent anchors
    /// share the same tick, the later anchor's src wins.
    pub fn interpolate(&self, local_tick: Tick) -> SrcFrame {
        let anchors = &self.points;
        debug_assert!(!anchors.is_empty(), "FullWarp should never be empty");
        if local_tick.0 <= anchors[0].tick.0 {
            return anchors[0].src;
        }

        let last_index = anchors.len() - 1;
        for (pair_index, pair) in anchors.windows(2).enumerate() {
            let (tick_start, src_start) = (pair[0].tick.0, pair[0].src.0);
            let (tick_end, src_end) = (pair[1].tick.0, pair[1].src.0);
            let is_last_pair = pair_index + 1 == last_index;

            if local_tick.0 < tick_end || (is_last_pair && local_tick.0 <= tick_end) {
                if tick_end <= tick_start {
                    return SrcFrame(src_end);
                }

                let span_ticks = (tick_end - tick_start) as i128;
                let rel_ticks = (local_tick.0 - tick_start).clamp(0, tick_end - tick_start) as i128;
                let span_src = src_end as i128 - src_start as i128;
                let mapped = src_start as i128 + span_src * rel_ticks / span_ticks;
                return SrcFrame(mapped.clamp(0, u64::MAX as i128) as u64);
            }
        }

        anchors[last_index].src
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::WarpAnchorEdit;

    fn no_warp() -> WarpMapEdit {
        WarpMapEdit::None
    }

    fn anchors(entries: &[(i64, u64)]) -> WarpMapEdit {
        WarpMapEdit::Anchors {
            anchors: entries
                .iter()
                .map(|&(t, s)| WarpAnchorEdit {
                    at_in_clip: Tick(t),
                    src_frame: SrcFrame(s),
                })
                .collect(),
        }
    }

    #[test]
    fn build_includes_implicit_endpoints_when_no_warp() {
        let full = FullWarp::build(Tick(100), SrcFrame(0), SrcFrame(200), &no_warp());
        assert_eq!(full.points().len(), 2);
        assert_eq!(full.points()[0].tick, Tick(0));
        assert_eq!(full.points()[0].src, SrcFrame(0));
        assert_eq!(full.points()[1].tick, Tick(100));
        assert_eq!(full.points()[1].src, SrcFrame(200));
    }

    #[test]
    fn build_drops_interior_anchors_at_or_outside_endpoints() {
        // 0, 100, and 200 (== clip_length) get dropped; only interior 50 remains.
        let warp = anchors(&[(0, 999), (50, 90), (100, 999), (200, 999)]);
        let full = FullWarp::build(Tick(100), SrcFrame(0), SrcFrame(180), &warp);
        assert_eq!(full.points().len(), 3);
        assert_eq!(
            full.points()[0],
            WarpPoint {
                tick: Tick(0),
                src: SrcFrame(0)
            }
        );
        assert_eq!(
            full.points()[1],
            WarpPoint {
                tick: Tick(50),
                src: SrcFrame(90)
            }
        );
        assert_eq!(
            full.points()[2],
            WarpPoint {
                tick: Tick(100),
                src: SrcFrame(180)
            }
        );
    }

    #[test]
    fn interpolate_linear_between_endpoints() {
        let full = FullWarp::build(Tick(100), SrcFrame(0), SrcFrame(200), &no_warp());
        assert_eq!(full.interpolate(Tick(0)), SrcFrame(0));
        assert_eq!(full.interpolate(Tick(25)), SrcFrame(50));
        assert_eq!(full.interpolate(Tick(50)), SrcFrame(100));
        assert_eq!(full.interpolate(Tick(100)), SrcFrame(200));
    }

    #[test]
    fn interpolate_clamps_out_of_range_ticks() {
        let full = FullWarp::build(Tick(100), SrcFrame(10), SrcFrame(210), &no_warp());
        assert_eq!(full.interpolate(Tick(-50)), SrcFrame(10));
        assert_eq!(full.interpolate(Tick(500)), SrcFrame(210));
    }

    #[test]
    fn interpolate_switches_slopes_at_interior_anchor() {
        // 0..50 maps 0..30 (slower); 50..100 maps 30..200 (faster).
        let warp = anchors(&[(50, 30)]);
        let full = FullWarp::build(Tick(100), SrcFrame(0), SrcFrame(200), &warp);
        assert_eq!(full.interpolate(Tick(25)), SrcFrame(15));
        assert_eq!(full.interpolate(Tick(50)), SrcFrame(30));
        assert_eq!(full.interpolate(Tick(75)), SrcFrame(115));
    }
}
