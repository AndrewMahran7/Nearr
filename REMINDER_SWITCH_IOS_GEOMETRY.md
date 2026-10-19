# Reminder switch iOS geometry

## Cause and repair

The earlier 54-point slot left only 3 points beyond the nominal 51×31-point iOS switch. The repaired slot is 67×48 points: 51 points for the control plus 8 points of horizontal clearance on each side. It cannot shrink. Copy uses `flexGrow: 1`, `flexShrink: 1`, and `minWidth: 0`, so long text wraps before it displaces the control. The slot and ancestors used here do not clip it, and the slot explicitly permits visible overflow.

The off state now uses `colors.textMuted` for both the false track and `ios_backgroundColor`, improving contrast while leaving reminder persistence unchanged.

## Geometry evidence

The source-level reference rectangle is:

- Slot: `(0,0,67,48)`
- Expected nominal iOS control: `(8,8.5,51,31)`
- Expected trailing clearance: `8`
- Containment with an 8-point inset: pass
- Wrapping-copy remainder with 16 points of row allowance: 197 points at a 280-point card, 237 at 320, and 307 at 390

Development builds log `[fieldnotes-layout] reminder-switch` with the native control rectangle, slot rectangle, trailing clearance, and containment result from `onLayout`.

## Verification status

Pure containment, narrow-width, long-label, large-text source wiring, on/off styling, and parent-overflow checks pass. No iOS renderer was available. The native UISwitch's drawn edge, thumb, transformed accessibility geometry, and scroll behavior must be confirmed on the founder's iPhone in Light and Dark modes.
