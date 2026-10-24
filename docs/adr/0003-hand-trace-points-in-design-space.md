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
- When the cleanup changes after points are placed, points can be carried along by undoing the old cleanup and
  applying the new one. Whether they are is for Photo cleanup before hand-tracing (issue #13).

## Considered options

- **Original-photo space, cleanup applied on the way out**: a change of cleanup never disturbs a point. But live
  symmetry's vertical mirror (issue #12) is a plain reflection only in the space the carver sees; in original-photo
  space, under perspective, it isn't. And later smooth points, whose handles must lie on one line, wouldn't look lined
  up on screen once warped.

## Consequences

- Carrying points through a cleanup change is exact for crop, rotate and scale, even with handles, and exact for a
  four-corner perspective change on straight segments, since perspective keeps lines straight.
- Once curves arrive, a four-corner change can only approximate a curve's handles (the warped curve is no longer a
  Bézier). Straight-only v1 hand-traces are unaffected.
- Cleanup geometry must itself be stored relative to the photo's size, or the shrunk-copy fallback misaligns it.
  The existing auto-trace crop (`TraceSettings.crop`, in source-image pixels) doesn't do this yet.
