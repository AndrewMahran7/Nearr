import type { SourceType } from '@/types';

type PlaceNoteInput = {
  sourceType: SourceType | null | undefined;
  category: string | null | undefined;
};

const CATEGORY_NOTES: Array<[RegExp, string]> = [
  [/cafe|coffee/, 'Try the coffee featured in this post'],
  [/bakery|dessert/, 'Try the treat featured in this post'],
  [/bar|brewery|winery/, 'Try the drink featured in this post'],
  [/restaurant|food|meal/, 'Try the dish featured in this post'],
  [/museum|gallery|art/, 'See what caught your eye here'],
  [/park|trail|outdoor/, 'Explore the spot featured in this post'],
  [/shop|store|retail/, 'Browse what caught your eye here'],
];

export function deriveSuggestedPlaceNote(input: PlaceNoteInput): string | null {
  if (!input.sourceType || input.sourceType === 'manual') return null;
  const category = (input.category ?? '').toLowerCase();
  return CATEGORY_NOTES.find(([pattern]) => pattern.test(category))?.[1]
    ?? 'Try what caught your eye in this post';
}

export function initialSavedPlaceNote(input: PlaceNoteInput & { notes: string | null | undefined }): string {
  if (input.notes?.trim()) return input.notes;
  return deriveSuggestedPlaceNote(input) ?? '';
}