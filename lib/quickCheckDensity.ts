export const QUICK_CHECK_LAYOUT = {
  sheetHeightRatio: 0.92,
  dragIndicatorBlockHeight: 12,
  headerHeight: 56,
  scrollContentTop: 0,
  sourceLineHeight: 28,
  sourceLineBottomGap: 4,
  evidenceSectionTop: 4,
  evidenceTitleHeight: 20,
  evidenceSubtitleHeight: 17,
  evidenceSubtitleBottomGap: 4,
  evidenceFrameHeight: 96,
  evidenceDotsHeight: 14,
  evidenceSectionBottom: 4,
  candidateCardHeight: 148,
  candidateLongCardHeight: 167,
  candidateGap: 6,
  candidatePadding: 6,
  whyButtonHeight: 32,
  stickyTopPadding: 8,
  stickyButtonHeight: 56,
  scrollBottomPadding: 104,
} as const;

export function quickCheckCompactEvidenceFrameWidth(windowWidth: number): number {
  return Math.min(160, Math.max(124, (Math.floor(windowWidth) - 72) / 2));
}

export type QuickCheckLayoutAudit = {
  sheetHeight: number;
  headerBlock: number;
  stickyBlock: number;
  scrollViewport: number;
  evidenceBlock: number;
  preCandidateBlock: number;
  candidateStack: number;
  contentThroughCandidates: number;
  requiredScroll: number;
};

/** Deterministic point-budget model for the collapsed Quick Check picker. */
export function quickCheckLayoutAudit({
  deviceHeight,
  safeAreaBottom,
  candidateCount,
  longCandidate = false,
}: {
  deviceHeight: number;
  safeAreaBottom: number;
  candidateCount: number;
  longCandidate?: boolean;
}): QuickCheckLayoutAudit {
  const sheetHeight = deviceHeight * QUICK_CHECK_LAYOUT.sheetHeightRatio;
  const headerBlock = QUICK_CHECK_LAYOUT.dragIndicatorBlockHeight + QUICK_CHECK_LAYOUT.headerHeight;
  const stickyBlock = QUICK_CHECK_LAYOUT.stickyTopPadding
    + QUICK_CHECK_LAYOUT.stickyButtonHeight
    + Math.max(safeAreaBottom, QUICK_CHECK_LAYOUT.stickyTopPadding);
  const scrollViewport = sheetHeight - headerBlock - stickyBlock;
  const evidenceBlock = QUICK_CHECK_LAYOUT.evidenceSectionTop
    + QUICK_CHECK_LAYOUT.evidenceTitleHeight
    + QUICK_CHECK_LAYOUT.evidenceSubtitleHeight
    + QUICK_CHECK_LAYOUT.evidenceSubtitleBottomGap
    + QUICK_CHECK_LAYOUT.evidenceFrameHeight
    + QUICK_CHECK_LAYOUT.evidenceDotsHeight
    + QUICK_CHECK_LAYOUT.evidenceSectionBottom;
  const preCandidateBlock = QUICK_CHECK_LAYOUT.scrollContentTop
    + QUICK_CHECK_LAYOUT.sourceLineHeight
    + QUICK_CHECK_LAYOUT.sourceLineBottomGap
    + evidenceBlock;
  const rowHeight = longCandidate
    ? QUICK_CHECK_LAYOUT.candidateLongCardHeight
    : QUICK_CHECK_LAYOUT.candidateCardHeight;
  const candidateStack = candidateCount > 0
    ? candidateCount * rowHeight + (candidateCount - 1) * QUICK_CHECK_LAYOUT.candidateGap
    : 0;
  const contentThroughCandidates = preCandidateBlock + candidateStack;

  return {
    sheetHeight,
    headerBlock,
    stickyBlock,
    scrollViewport,
    evidenceBlock,
    preCandidateBlock,
    candidateStack,
    contentThroughCandidates,
    requiredScroll: Math.max(0, contentThroughCandidates - scrollViewport),
  };
}
