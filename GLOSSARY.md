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
Building a design by placing and adjusting points around each carve area: from nothing over a photo or a blank page, or starting from a loaded design's shapes.
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
A point where the edge may change direction sharply. It may have a handle on either side, each set on its own, like the tips of a crescent-moon eye; a side with no handle leaves the point in a straight edge. Placing a point makes a corner point.

**Smooth point**:
A point the edge passes through without a kink, its two handles on one line. Its handles follow its neighbours, rounding the edge out, until the carver drags one.

**Handle**:
A control pulled out of a point that sets which way, and how far, the edge curves as it leaves the point. Dragged back onto its point, it's gone and that side is straight.

**Open shape**:
A shape that isn't closed. It's kept, but it isn't carved until the carver closes it.
_Avoid_: Unfinished shape, path

**Shape being drawn**:
The one shape a tap on empty space adds points to, from its first point until the carver closes it or ends it open. At most one at a time.
_Avoid_: Current shape, active shape, draw mode (hand-tracing has no modes)

**Insert marker**:
The small target in the middle of each edge of the selected shape that adds a point there when tapped or dragged.
_Avoid_: Midpoint handle (a handle shapes a curve)

**Loupe**:
The magnified circle shown beside a finger that holds or drags, centred on where the point under the finger will land.
_Avoid_: Magnifier, offset cursor (the point lands under the finger, not beside it)

**Cleanup**:
Straightening, cropping and toning the loaded photo before it's traced. Its straightening and cropping are shared by both tracing methods; its toning only changes what a hand-trace is placed over.
_Avoid_: Preprocessing, photo editing

**Frame**:
The four-sided outline the carver drags onto the photo during cleanup; what's inside it, squared up, becomes the cleaned-up photo. Its handles are the frame corners.
_Avoid_: Quad, crop box, corners (a corner point belongs to a shape)

**Blank page**:
The square, faintly gridded page a hand-trace is placed on when there's no photo. It has no cleanup, and no auto-trace, since there's nothing to find dark areas in. A photo can't be added to it later.
_Avoid_: Canvas, artboard, empty photo

**Symmetry axis**:
The fixed vertical line through the centre of the cleaned-up photo, or of the blank page, that mirrored shapes are reflected about.
_Avoid_: Mirror line, centre line

**Symmetry**:
The hand-trace setting that makes each shape started while it's on a mirrored shape. Turning it on or off never changes shapes already drawn.
_Avoid_: Mirror mode

**Mirrored shape**:
A shape whose reflection about the symmetry axis is part of the design. Either side can be edited, and the other follows.

**Reflection**:
The side of a mirrored shape the carver didn't place: always the exact mirror image of the side they did.
_Avoid_: Mirror copy, ghost

**Twin**:
A mirrored shape drawn wholly on one side of the symmetry axis, so its reflection is a separate shape on the other side, like a pair of eyes.
_Avoid_: Mirrored pair, copy

**Symmetric shape**:
A mirrored shape that spans the symmetry axis: the carver draws one half, meeting the axis along an edge or at both ends, and its reflection completes it into a single shape, like a mouth or a nose.
_Avoid_: Fused shape, half shape

**Hand-trace file**:
An SVG download of a hand-trace that reopens as one, its photo (if it has one) and work included. Changed in another program, it opens as a plain SVG design instead.
_Avoid_: Export, backup, project file

**Tracing method**:
Auto-trace or hand-trace: how the loaded photo becomes the design, chosen per photo. The design is the chosen method's result; the other method's work is kept, not used.
_Avoid_: Trace mode, trace type

## Viewport

**View**:
One of the ways the viewport shows the work: 3D, Photo or Page, Blueprint or Paper.

**Photo view**:
The view showing the loaded photo: its cleanup, then the chosen tracing method's work on the cleaned-up photo (the result for auto-trace, the points being placed for hand-trace).
_Avoid_: Trace view

**Page view**:
The view showing a hand-trace on a blank page: the points being placed, with no cleanup before them. It takes the Photo view's place when there's no photo; the two never show at once.
_Avoid_: Photo view (there's no photo), blank view

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
