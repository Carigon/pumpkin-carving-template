# Pumpkin Carving Template Generator

Turning a flat carving design and a pumpkin's tape-measure measurements into a printable template that, taped on, looks like the design from the front.

## Measuring the pumpkin

**Display units**:
Inches or centimetres: the carver's choice for every length they read or type. Switching never changes a measurement.
_Avoid_: Measurement units

**Height**:
The straight vertical distance from the table to the underside of a book laid flat on the pumpkin's shoulders; the stem is left out.

**Ring**:
A level tape measurement around the pumpkin: a circumference taken at a height above the table, kept as a fraction of the height.
_Avoid_: Slice, section, band

**Widest circumference**:
The ring with the largest circumference; the pumpkin bulges past it nowhere.

**Gap**:
The stretch of height between two neighbouring rings, or between a ring and the table or the top; a new ring goes in the middle of the gap the carver picks.
_Avoid_: Slot, band

**Profile**:
The pumpkin's side edge from stem to base, fitted smoothly through every ring; the pumpkin's shape is this edge spun around its vertical axis.
_Avoid_: Outline, silhouette, contour

**Shape ratio**:
The height over the widest diameter. Edits keep it between 0.2 and 5, so the pumpkin is never more than 5 times as tall as it is wide, or as wide as it is tall; the test-grid ball is left out.
_Avoid_: Aspect ratio, proportions

**Ring edited last**:
The ring most recently dragged, nudged, typed in or added. When no smooth profile passes through the rings, the failure is blamed on it; after a page load there is none, and nothing is blamed.
_Avoid_: Active ring, current ring, last ring (the ring that can't be deleted)

## Design

**Auto-trace**:
Turning a photo or scanned stencil into a design automatically, by finding its dark areas.
_Avoid_: Trace (on its own), vectorize

**Hand-trace**:
Building a design by placing points around each carve area over a photo, starting from nothing.
_Avoid_: Manual trace, drawing, outlining

**Carve area**:
A region of the design that gets cut out of the pumpkin. One carve area can come from several shapes: an eye shape with a pupil shape inside it is one ring-shaped carve area.
_Avoid_: Hole, cut-out

**Shape**:
One run of points the carver draws in a hand-trace, open while it's being drawn and closed once finished. A shape drawn inside another keeps that part uncarved.
_Avoid_: Path, outline, contour

**Point**:
One place a shape's edge passes through, placed by the carver.
_Avoid_: Anchor, node, vertex

**Corner point**:
A point where the edge may change direction sharply. For now every point is a corner point and every edge between points is straight.

**Smooth point**:
A point the edge passes through without a kink, its two handles on one line. Not yet available.

**Handle**:
A control pulled out of a point that sets which way, and how far, the edge curves as it leaves the point. Not yet available.

**Open shape**:
A shape that isn't closed. It's kept, but it isn't carved until the carver closes it.
_Avoid_: Unfinished shape, path

**Shape being drawn**:
The one shape new points are added to in draw mode, from its first point until the carver closes it or ends it open. At most one at a time.
_Avoid_: Current shape, active shape

**Draw mode**:
The hand-trace mode for placing points: each tap adds a point to the shape being drawn, or starts a new one. Other shapes can't be selected or changed.
_Avoid_: Pen mode, pen tool

**Edit mode**:
The hand-trace mode for changing what's already drawn: selecting, moving, inserting and deleting points and shapes. No new points are placed by tapping.
_Avoid_: Select mode, node tool

**Insert marker**:
The small target in the middle of each edge of the selected shape that adds a point there when tapped or dragged.
_Avoid_: Midpoint handle (a handle shapes a curve)

**Tracing method**:
Auto-trace or hand-trace: how the loaded photo becomes the design, chosen per photo. The design is the chosen method's result; the other method's work is kept, not used.
_Avoid_: Trace mode, trace type

## Viewport

**View**:
One of the ways the viewport shows the work: 3D, Photo, Blueprint or Paper.

**Photo view**:
The view showing the loaded photo with the chosen tracing method's work on it: the crop and result for auto-trace, the points being placed for hand-trace.
_Avoid_: Trace view

**Blueprint view**:
The view for editing the pumpkin's shape directly: the profile drawn flat on both sides against a ruler, with each ring as a line you can drag.
_Avoid_: Shape view, profile view, ortho view

**Height line**:
The line across the top of the Blueprint view at the pumpkin's height, with a handle that drags the height. It can be selected like a ring; focusing the Height field selects it.
_Avoid_: Top line, height ring

**Ghost ring**:
The dashed ring the Blueprint view draws in the middle of a hovered gap: where a click would add a ring, with the circumference the profile has there.
_Avoid_: Ghost line, preview ring, phantom ring

**Projection**:
Which flat, straight-on direction the Blueprint view looks from. Front is the first; side and top may follow.
_Avoid_: Camera, angle
