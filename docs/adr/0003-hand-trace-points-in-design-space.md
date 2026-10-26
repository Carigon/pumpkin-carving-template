# 3. Hand-trace points are kept in design space, not original-photo space

Status: accepted

## Context

A hand-trace is placed over a photo the carver may clean up first: crop, rotate, and four-corner perspective
correction. Its points could be kept against the photo as loaded, with the cleanup applied on the way to the
`Design`, or against the photo as cleaned up, as the carver sees it. The stored record (ADR 0002) holds those points,
so the choice is hard to change once hand-traces exist. Decided in Path model for hand-traces (issue #10 in
`Carigon/pumpkin-carving-template`).

## Decision

- Points are kept in **design space**: the photo after cleanup, as the carver sees it, with one scale on both axes,
  y up, and coordinates relative to the photo's size (so ADR 0002's fallback to a shrunk copy of the photo still
  lines up).
- On a blank page (no photo), design space is the page: a square with the same conventions, points relative to its
  size and clamped to it. Added in Hand-tracing without a photo (issue #18).
- An SVG design edited as a hand-trace lands on a page shaped to the design's box plus a margin of 10% of its long
  side all round, the symmetry axis down its middle, so the axis runs through the box centre that placement centres
  on. Imported points stay where they come, even outside the page or photo, and are clamped only once moved. Added
  in Editing a loaded SVG as a hand-trace (issue #20).
- When the cleanup changes after points are placed, points can be carried along by undoing the old cleanup and
  applying the new one. Whether they are is for Photo cleanup before hand-tracing (issue #13).
- Points have a `kind`, `"corner"` or `"smooth"`, and optional `in` / `out` handles, each an offset from its point in
  design space. A corner point's handles are independent; a smooth point's stay on one line. A smooth point with no
  stored handles has automatic ones, worked out from its neighbours whenever the shape changes; dragging one stores
  both. Curves are in v1, decided in Curves in v1 (issue #19).

## Considered options

- **Original-photo space, cleanup applied on the way out**: a change of cleanup never disturbs a point. But live
  symmetry's vertical mirror (issue #12) is a plain reflection only in the space the carver sees; in original-photo
  space, under perspective, it isn't. And later smooth points, whose handles must lie on one line, wouldn't look lined
  up on screen once warped.

## Consequences

- Carrying points through a cleanup change is exact for crop, rotate and scale, even with handles, and exact for a
  four-corner perspective change on straight segments, since perspective keeps lines straight.
- A four-corner change can only approximate a curve's handles (the warped curve is no longer a Bézier). Each stored
  handle's tip is mapped through the same homography and its offset recomputed; a smooth point's two mapped
  directions are averaged so they stay on one line; automatic handles are simply recomputed. The approximation is
  silent. Straight edges are unaffected.
- Cleanup geometry must itself be stored relative to the photo's size, or the shrunk-copy fallback misaligns it.
  The frame corners are kept as fractions of the photo's size for this reason (the old auto-trace crop, in
  source-image pixels, is gone).
