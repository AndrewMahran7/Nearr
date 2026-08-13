export type NoteEditorState = {
  open: boolean;
  savedNote: string | null;
  draft: string;
  seededFromAi: boolean;
};

export const NOTE_EDITOR_BEHAVIOR = {
  surface: 'full_screen_modal',
  autoFocus: true,
  multiline: true,
  returnKeyCreatesNewline: true,
  inputScrollsLongText: true,
  headerActionsStayReachable: true,
  keyboardDismissMode: 'interactive',
} as const;

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

export function openNoteEditor(
  savedNote: string | null | undefined,
  aiNote: string | null | undefined = null,
  useAiSuggestion = false,
): NoteEditorState {
  const current = normalized(savedNote);
  const suggestion = normalized(aiNote);
  return {
    open: true,
    savedNote: current,
    draft: current ?? (useAiSuggestion ? suggestion ?? '' : ''),
    seededFromAi: !current && useAiSuggestion && !!suggestion,
  };
}

export function editNoteDraft(state: NoteEditorState, draft: string): NoteEditorState {
  return { ...state, draft };
}

export function cancelNoteEditor(state: NoteEditorState): NoteEditorState {
  return { ...state, open: false, draft: state.savedNote ?? '', seededFromAi: false };
}

export function commitNoteEditor(state: NoteEditorState): {
  state: NoteEditorState;
  notes: string | null;
} {
  const notes = normalized(state.draft);
  return {
    notes,
    state: { open: false, savedNote: notes, draft: notes ?? '', seededFromAi: false },
  };
}

/** Applying a user edit deliberately touches only `notes`. */
export function userNotePatch(draft: string): { notes: string | null } {
  return { notes: normalized(draft) };
}
