# 4. Mirrored shapes are generated from a per-shape flag, not stored as linked copies

Status: accepted

## Context

Hand-tracing has live symmetry about a fixed vertical axis through the centre of the cleaned-up photo. A mirrored
shape's reflection could be kept as a second shape linked to the first, or produced from the drawn side whenever it's
needed. The stored record (ADR 0002) holds whichever is chosen, so the choice is hard to change once hand-traces
exist. Decided in Live symmetry (issue #12 in `Carigon/pumpkin-carving-template`); when a mirrored shape becomes
symmetric was amended in Placing and adjusting points on a phone (issue #14).

## Decision

- Each shape carries `mirror: "none" | "twin" | "symmetric"`, defaulting to `"none"`, so earlier records stay valid.
  Only the points the carver placed are stored; the reflection is generated on the way to path data, so the
  `Design`, the SVG download and the screen all get it by the one route ADR 0003's path model already has.
- A **twin** is reflected as a separate closed shape. A **symmetric shape** is its half joined to its reversed
  reflection at both ends: a join has no length when the end lies on the axis, and is a straight edge across the axis
  when it doesn't, so the result is always one valid closed shape.
- An open mirrored shape is stored as `"twin"`. It closes as `"symmetric"` when its closed outline runs along the axis
  (two points in a row on it, the closing edge included), wherever it was started; its points are then stored starting
  just after that edge, so the half runs axis to axis and the edge drops out. Starting on the axis and landing on it
  again is the same rule, closed automatically. Requiring the first point on the axis was dropped: carvers starting a
  mouth at its corner forgot it and had to redraw.
- The Symmetry setting is a drawing setting stored with the hand-trace. It stamps the flag on shapes as they're
  started and never changes shapes already drawn.

## Considered options

- **Linked copies** (two real shapes joined by their ids, every edit applied to both): would let the two sides
  diverge after a "detach". But they can drift out of sync, every edit rule (insert, delete, the small-shape rule)
  needs a mirrored twin, and undo must group two changes. Detaching can still be added on top of a flag by writing
  the reflection out as a real shape.
- **One switch over the whole hand-trace**: turning symmetry off would make every reflection vanish, and an
  asymmetric extra (a wink, a scar) on a symmetric face would be impossible.

## Consequences

- Editing either side moves the stored points by the reflection; every change, both sides together, is one undo step.
- Mirrored shapes' points are clamped to their own side of the axis, so a twin's points never cross it. Handles
  (Curves in v1, issue #19) are reflected with their points and clamped only to the photo or page, not to a side, so
  a curve can bulge across the axis and overlap its reflection; the overlap shows uncarved.
- A symmetric shape's point on the axis has one handle in the half; the reflection supplies the other. A smooth axis
  point keeps its handle at right angles to the axis, so the joined outline crosses smoothly; a corner axis point's
  handle is free, and the join is a cusp.
- When a hand-trace has any mirrored shape, its `Design` is centred on the symmetry axis rather than on its bounding
  box (the box is widened evenly about the axis before `placeDesign`), so the axis lands on the pumpkin's front
  centre even with unmirrored extras. A fully symmetric design places as before.
