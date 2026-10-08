# Flow test paints

2048×2048 test paints for the Hyundai Veloster N TCR. This branch only holds
these files. It is not part of the app.

## Test 2: `flow-test-paint-2.png` (use this one)

One stripe pattern, a level magenta band and an upright blue band were laid over
an arrangement of the pieces, then each piece's share was put back where that
piece really sits on the sheet. `how-the-pieces-were-arranged-2.png` shows the
arrangement:

- driver's side (Piece 2), roof (Piece 4) above it, passenger side (Piece 1)
  above the roof as the driver's side's mirror image;
- rear bumper (Piece 5) on the back of the driver's side, bonnet piece
  (Piece 3) and wings on the front.

Along every linked edge the pattern is stitched: each point on one piece's edge
takes exactly what its matching point on the other piece has, and the nudge
fades out further into the piece.

Edges left open in this arrangement: passenger side to rear bumper (the bumper
sits with the driver's side), and the short front edge of the left wing.

## Test 1: `flow-test-paint.png`

Pieces placed by a script that followed the links, with no stitching. The
passenger side ended up hanging off the rear bumper. Kept for comparison.
