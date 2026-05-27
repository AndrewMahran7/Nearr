# Nearr — UI Theme Notes

> Last updated: 2026-05-26
> Owner: Stage 0 stabilization
> Scope: keep the current visual identity readable; defer full redesign.

## 1. Current design direction

Nearr's product identity is intentionally narrow:

- Dark mode only (for now)
- Near-black background, dark gray rounded cards
- Orange primary actions / accents
- Soft borders, generous spacing, rounded geometry
- No drop shadows, no gradients in chrome

Nothing here is a redesign — these are the rules already encoded in
[constants/colors.ts](../constants/colors.ts).

## 2. Color tokens

All color tokens live in [constants/colors.ts](../constants/colors.ts)
and are surfaced via [lib/theme.tsx](../lib/theme.tsx) → `useTheme()`.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0B0B0D` | App background, `Screen` |
| `surface` | `#151518` | Default card / sheet background |
| `surfaceElevated` | `#1C1C20` | Inputs, raised CTA cards |
| `border` | `#2A2A30` | Card borders, dividers, progress track |
| `text` | `#FFFFFF` | Primary text |
| `textSecondary` | `#A1A1AA` | Body copy, captions |
| `textMuted` | `#71717A` | Fineprint, helper text, placeholders |
| `textInverse` | `#FFFFFF` | Text on top of `primary` (white pill text) |
| `primary` / `accent` | `#FF6A1A` | Primary buttons, focus, bullets |
| `gradientStart` / `gradientEnd` | `#FF8A1C` / `#FF3D2E` | Reserved (not in chrome yet) |
| `danger` | `#EF4444` | Destructive actions, error titles |
| `success` | `#22C55E` | Completion / "done" affordances |
| `overlay` / `modalBackdrop` | `rgba(0,0,0,0.45)` | Modal backdrops |

The `LightColors` palette also exists in `lib/theme.tsx` but is not
currently selectable (see §4).

## 3. How to use the tokens

**Do:**

```tsx
const { colors, typography } = useTheme();
const styles = useMemo(() => createStyles(colors), [colors]);
// ...
<Text style={[typography.body, { color: colors.text }]}>Hello</Text>
```

**Do not:**

- Import `Colors` from `@/constants` directly inside new screens.
  - It is the *dark-only* palette and will break the day light mode
    returns.
  - Existing usages (`app/(auth)/sign-in.tsx`, `app/share.tsx`,
    `app/add-place.tsx`, `app/(tabs)/map.tsx`, `app/auth-callback.tsx`,
    the error boundary in `app/_layout.tsx`) are tolerated today because
    the resolved theme is locked to dark.
- Inline hex strings (`'#fff'`, `'#000'`, etc.) inside component styles.
- Use `Colors.text` on a `colors.surface` background or vice versa
  without checking contrast.

## 4. Why the theme is locked to dark (Stage 0)

`ThemeProvider` resolves to `'dark'` unconditionally. The original
conditional (system / light / dark) is preserved in code as
`_systemAwareTheme` for the future redesign.

Reason: six screens import the static `Colors` constant (dark palette)
directly. On a device set to light mode, themed components rendered a
cream background while hardcoded white text painted on top of it — the
"Save places once..." screen showed white-on-cream tagline and bullets.
Locking the resolved theme to dark was the smallest centralized fix
that eliminated every white-on-white / dark-on-dark artifact across the
app without screen-level rewrites.

The Settings → Appearance section keeps the three radio buttons (so
preference is still persisted), but a small note explains that light
mode is temporarily disabled.

To re-enable light mode later:

1. Audit every direct `from '@/constants'` import of `Colors` and
   migrate to `useTheme()`.
2. Replace the line `const resolvedTheme: ResolvedTheme = 'dark';` in
   `lib/theme.tsx` with `const resolvedTheme = _systemAwareTheme;`.
3. Remove the temporary note from `app/(tabs)/settings.tsx`.

## 5. Common contrast mistakes to avoid

| Wrong | Right |
|---|---|
| `color: '#fff'` on `colors.surface` in a future light theme | `color: colors.text` |
| `color: colors.textMuted` on `colors.bg` (dark/dark) for body copy | use `colors.textSecondary` |
| Orange text on orange button | `color: colors.textInverse` on primary |
| Disabled button rendered with `colors.textMuted` text on `colors.surface` (invisible) | use `colors.textSecondary` + 0.6 opacity, or rely on the `Button` component's built-in disabled state |
| Hardcoded `borderColor: '#222'` | `borderColor: colors.border` |
| Placeholders left at default (`#C7C7CD` on iOS) | always pass `placeholderTextColor={colors.textMuted}` — the shared `Input` component already does this |

## 6. Fixed white-on-white issue

- **Screen**: `/(auth)/sign-in` (the "Save places once. Nearr reminds
  you when you're nearby." tagline + bullets)
- **Symptom**: on a device set to light mode, the `Screen` background
  was cream while the tagline (`Colors.text = '#FFFFFF'`) and bullet
  text (`Colors.textMuted = '#71717A'`) rendered white/very-faint on
  cream — effectively unreadable.
- **Cause**: `lib/theme.tsx` resolved to `'light'`, but the sign-in
  screen used the static dark palette `Colors` directly.
- **Fix**: `ThemeProvider` now resolves `'dark'` unconditionally
  (Stage 0). See §4 above.

## 7. Manual screen QA checklist

Run on a real device or simulator with the system color scheme toggled
to **Light** at least once — Nearr should still render as dark mode
because the resolved theme is locked.

- [ ] Sign-in: brand wordmark, tagline, bullet text, "Send magic link"
      button label all clearly readable on dark background
- [ ] Sign-in: input placeholder ("you@example.com") visible
- [ ] Auth-callback screen: status text readable
- [ ] Home: greeting, sub copy, "Build your first map" / "Save a place"
      card body all readable; orange CTA contrast OK
- [ ] Home empty state: title + body readable, both CTAs visible
- [ ] Activation progress bar: track + fill distinguishable
- [ ] Places tab: search input + placeholder visible; filter chips have
      clear active/inactive states; empty states readable
- [ ] Saved place cards: title, address, meta line, action buttons
      readable
- [ ] Map screen: selected place bottom card text readable; "open in
      maps" button readable; map fallback list readable
- [ ] Place detail screen: title, address, notes, radius slider labels
      readable
- [ ] Add Place / Share modal: header, body, search input, candidate
      list rows readable
- [ ] Settings: section labels, helper captions, theme option buttons
      (active orange + inactive border), "How Nearr works" row,
      Setup checklist items all readable
- [ ] HowNearrWorksModal: step numbers, titles, body, Share Favorites
      steps readable
- [ ] SetupReminderModal: title, body, row labels, all three buttons
      readable
- [ ] LegalAgreementModal: heading, body, Agree button readable
      (currently gated by `LEGAL_ACCEPTANCE_REQUIRED=false`)
- [ ] Error states (Home + Places when offline): error title in
      `colors.danger`, body in `colors.textMuted`, Try Again button
      visible
- [ ] Loading states: `ActivityIndicator` visible on dark background
- [ ] Disabled buttons: still visible but clearly distinct from active

## 8. Remaining UI work (deferred — full redesign)

These were spotted during the audit but intentionally left for the
redesign pass. Do not address piecemeal.

- Six screens still import the static `Colors` constant; should be
  migrated to `useTheme()` before re-enabling light mode.
- `app/_layout.tsx`'s `AppErrorBoundary` uses static `Colors` — that's
  appropriate (theme provider may itself have crashed) but is worth
  re-evaluating during the redesign.
- The map's selected-place bottom sheet uses local hex colors in a few
  spots; harmless today, fragile later.
- The progress track on Home (`colors.border`) is barely distinguishable
  from the card background — works but should get its own token (e.g.
  `progressTrack`) in the redesign.
- The `LightColors` palette has cream + soft-orange theme that probably
  doesn't match the brand any more; revisit the actual light palette
  before re-enabling.
- The Settings Appearance section keeps a three-button row that doesn't
  do anything visible today. Acceptable Stage 0 trade-off; remove or
  collapse during the redesign.
