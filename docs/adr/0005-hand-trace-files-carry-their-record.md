# 5. Hand-trace files carry the hand-trace's record in SVG metadata

Status: accepted

## Context

Browser storage can be cleared (Safari after 7 days without a visit) or refuse the work outright, so ADR 0002 makes
the SVG download the carver's lasting copy of a hand-trace. A plain SVG of the design would keep the carve areas but
not the work: points, open shapes, mirroring, the photo they were placed over. Once files are out in the world their
format is hard to change. Decided in Downloading a hand-trace as SVG (issue #17 in `Carigon/pumpkin-carving-template`).

## Decision

- A **hand-trace file** is an ordinary SVG plus the hand-trace's record. The visible drawing is one compound `<path>`
  of every closed shape, reflections written out as real geometry (ADR 0004), `fill="black" fill-rule="evenodd"`,
  y flipped to SVG's y-down. Its `viewBox` is the design's bounding box, widened about the symmetry axis as the
  `Design` is; its `width`/`height` are in mm at the placed front-view Width. Open shapes aren't drawn.
- The record sits in a namespaced `<metadata>` element as versioned JSON: what storage holds (ADR 0002), with the
  photo, if there is one, as a JPEG copy shrunk to 2048 px on the long edge (or as chosen when already smaller). A
  hand-trace on a blank page carries the page's aspect instead and reopens on a blank page (Hand-tracing without a
  photo, issue #18).
  Never a visible `<image>`: the photo is uncropped and unwarped, so it wouldn't line up behind the shapes.
  Placement (Width, offset, rotation) isn't in it; loading a design never changes placement.
- The record holds a fingerprint of the geometry it drew. Loading reopens the file as a hand-trace only when the
  visible path still matches it within the loader's tolerance, compared as geometry, not as `d` text (editors
  rewrite path text without moving anything). Otherwise, or when the record is from an unknown version or fails
  validation, the file loads as an SVG design with a note saying why. Editing that SVG design as a hand-trace takes
  its shapes from the visible path but reuses the stale record's photo, cleanup and auto-trace side when the photo
  still validates; mirror flags and open shapes aren't taken from it (Editing a loaded SVG as a hand-trace,
  issue #20).
- A hand-trace started from an SVG design keeps the file's name in its record, for the download's name.
- When a file carries our record, even a stale one, the loader takes the design's box as the union of the `viewBox`
  and its paths' box, so a mirrored design with an unmirrored extra stays centred on the axis. Other SVGs are
  unchanged.

## Considered options

- **Plain shapes only**: simplest, but the lasting copy would be read-only, and an hour of tracing gone from storage
  couldn't be edited again.
- **The photo as chosen, embedded**: phone photos would make 5–16 MB files. ADR 0002's shrunk copy already lines up.
- **The photo by name only**: fails exactly when it's needed, when the photo is gone from the phone's recent picks.
- **A separate project file (JSON) beside the SVG**: two files to keep together, and the one other programs open
  wouldn't reopen.
- **Trusting the record over an edited drawing**: silently drops the carver's edits from another program.

## Consequences

- One record format serves storage and the download; a change to it is versioned in both places.
- A hand-trace file is about 0.3–1 MB with a photo, a few KB without.
- Inkscape keeps foreign metadata on a plain save; an SVG optimiser may strip it, and the file then loads as an SVG
  design, which is still carvable.
