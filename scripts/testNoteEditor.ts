import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOTE_EDITOR_BEHAVIOR,
  cancelNoteEditor,
  commitNoteEditor,
  editNoteDraft,
  openNoteEditor,
  userNotePatch,
} from '../lib/noteEditor';

const empty = openNoteEditor(null, 'Saved for the matcha flight they showed.');
assert.equal(empty.open, true, 'Add note opens the editor');
assert.equal(empty.draft, '', 'Add note never silently impersonates the AI suggestion');

const existing = openNoteEditor('My original note', 'AI context');
assert.equal(existing.draft, 'My original note', 'Edit note opens with user-authored text');
const cancelled = cancelNoteEditor(editNoteDraft(existing, 'Unsaved replacement'));
assert.equal(cancelled.open, false);
assert.equal(cancelled.savedNote, 'My original note', 'Cancel preserves the saved note');
assert.equal(cancelled.draft, 'My original note', 'Cancel discards the unsaved draft');

const seeded = openNoteEditor(null, 'Try the matcha flight and strawberry cream latte.', true);
assert.equal(seeded.seededFromAi, true, 'Use as my note is an explicit action');
const committed = commitNoteEditor(editNoteDraft(seeded, `${seeded.draft}\nGo before noon.`));
assert.equal(committed.state.open, false, 'successful Save closes cleanly');
assert.equal(committed.notes, 'Try the matcha flight and strawberry cream latte.\nGo before noon.');
assert.deepEqual(userNotePatch('New user note'), { notes: 'New user note' }, 'save patch cannot overwrite ai_note');

const longNote = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n');
assert.equal(commitNoteEditor(editNoteDraft(empty, longNote)).notes, longNote, 'long multiline text remains intact');
assert.deepEqual(NOTE_EDITOR_BEHAVIOR, {
  surface: 'full_screen_modal',
  autoFocus: true,
  multiline: true,
  returnKeyCreatesNewline: true,
  inputScrollsLongText: true,
  headerActionsStayReachable: true,
  keyboardDismissMode: 'interactive',
});

const component = readFileSync(join(process.cwd(), 'components/map/NoteEditorModal.tsx'), 'utf8');
const details = readFileSync(join(process.cwd(), 'components/map/SelectedPlaceDetails.tsx'), 'utf8');
assert.match(component, /presentationStyle="fullScreen"/);
assert.match(component, /useSafeAreaInsets/);
assert.match(component, /paddingTop: insets\.top/);
assert.match(component, /KeyboardAvoidingView/);
assert.match(component, /blurOnSubmit=\{false\}/, 'return inserts a newline');
assert.match(component, /scrollEnabled=\{NOTE_EDITOR_BEHAVIOR\.inputScrollsLongText\}/);
assert.match(component, /Keyboard\.dismiss\(\)/, 'Save and Cancel dismiss the keyboard');
assert.match(component, /styles\.header[\s\S]*Cancel[\s\S]*Save/, 'header actions remain outside keyboard content');
assert.match(component, /headerActionButton: \{ flex: 1, minHeight: 44/, 'Cancel and Save have 44pt targets');
assert.match(component, /keyboardDismissMode=\{NOTE_EDITOR_BEHAVIOR\.keyboardDismissMode\}/);
assert.match(component, /onPress=\{\(\) => setDraft\(aiNote\.trim\(\)\)\}/, 'Use this explicitly copies the post note');
assert.match(component, />Use this</);
assert.match(details, /setNotes\(nextNotes \?\? ''\)/, 'details refresh immediately');
assert.match(details, /updateSavedPlacesCache/, 'the shared saved-place cache refreshes immediately');
// Place Detail V2 deliberately presents ONE "Why you saved it" surface, so the
// separation is no longer VISUAL — it is a data guarantee. What must never
// change: an edit writes `notes` and leaves `ai_note` provenance untouched, and
// the editor is seeded from the cue only while the user has no note of their
// own. (The display rule itself is unit-tested in scripts/testPlaceDetailV2.ts.)
assert.match(details, /styles\.sourceNoteLabel/, 'the single surface has its own labeled section');
assert.match(details, /whySaved\.seedFromSourceNote/, 'the editor seeds from the cue, once');
assert.match(
  details,
  /updateSavedPlace\(saved\.id, \{ notes: nextNotes \}\)/,
  'an edit persists into the user note field only',
);
{
  const start = details.indexOf('async function saveNote(');
  const body = details.slice(start, details.indexOf('\n  }', start));
  assert.ok(!body.includes('ai_note'), 'ai_note provenance is never written or cleared by an edit');
}

console.log('PASS dedicated note editor state, persistence, cancellation, long-text, and keyboard contracts');
