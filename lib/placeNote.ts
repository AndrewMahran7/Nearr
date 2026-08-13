import type { SourceType } from '@/types';

type PlaceNoteInput = {
  sourceType: SourceType | null | undefined;
  category: string | null | undefined;
};

export function deriveSuggestedPlaceNote(_input: PlaceNoteInput): string | null {
  // Category/provider metadata cannot explain what was compelling in a post.
  // Source analysis writes a grounded suggestion to `ai_note` instead.
  return null;
}

export function initialSavedPlaceNote(input: PlaceNoteInput & { notes: string | null | undefined }): string {
  if (input.notes?.trim()) return input.notes;
  return deriveSuggestedPlaceNote(input) ?? '';
}
