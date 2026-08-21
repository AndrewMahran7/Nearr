# Onboarding V2 journey contract

## Product phases

### Learn

1. Welcome to Nearr.
2. Choose Instagram, TikTok, YouTube, or Facebook.
3. Choose Food, Hiking & Outdoors, Travel, Beaches, or Anything Cool.
4. Resolve a configuration-driven tutorial from both choices.
5. Complete the in-app sequence: Share → More / Other → Nearr → add Nearr to Favorites.
6. Watch Nearr process the simulated share in-app.
7. Review the real place result and explicitly tap **Save to my map**.

Learn never calls `Linking.openURL` and never depends on the Share Extension. The final action calls
`saveSavedPlace`, waits for an authoritative `saved_places.id`, and only then records the tutorial save.

### Practice

1. Create or link the anonymous account without losing the tutorial save.
2. Open the saved tutorial place and walk through its real place card.
3. Return to the map with progress at 1/3.
4. Preview a starter place inside Nearr before opening its real source video.
5. Complete two real external shares. The first advances progress to 2/3; the second graduates the user.
6. Returning without sharing presents a **Need more help?** recovery surface. The help-video slot is wired,
   while the temporary fallback shows the same three real-share steps in text.

### Graduate

After the tutorial save plus two independent real saves, the map shows **Your map is ready**, a completed
three-place progress treatment, an optional weekend challenge, and the handoff into the normal map.

## Tutorial content configuration

`constants/onboardingStarterContent.ts` owns the mapping and place payloads. Platform controls the simulated
source shell; category chooses a repository-backed source fixture and verified Google Place identity. The
current visual media is a native placeholder frame so the interaction works offline and does not hotlink or
misrepresent third-party media.

Launch-quality content still needed from Andrew:

- Licensed, locally bundled tutorial clips or poster frames for 20 platform/category combinations:
  Instagram, TikTok, YouTube, and Facebook × Food, Hiking & Outdoors, Travel, Beaches, and Anything Cool.
- A real TikTok source URL for each category.
- A real YouTube source URL for each category.
- A real Facebook source URL for each category.
- Final creator attribution and usage approval for every tutorial asset.
- One short help/demo video for the Practice recovery surface.

Until those arrive, all choices remain functional with a platform-styled native shell and a durable real-place
save sourced from Nearr's existing regression corpus.

## Progress invariant

`totalSaved = tutorialSave ? 1 : 0 + independentSaves.length`

The tutorial save can only be committed from `tutorial_result_seen`. Independent progress still requires the
exact source identity received from a real Share Extension handoff. Duplicate rows and duplicate callbacks do
not increment progress.

## Back behavior

Welcome has no back action. Platform, category, tutorial preview, and each simulated share step move backward
one meaningful step. Going back preserves platform/category choices. Returning to the tutorial post clears only
the in-flight simulated attempt; it does not reset the onboarding session.
