import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Input } from '@/components';
import { Radius, Spacing } from '@/constants';
import { NOTE_EDITOR_BEHAVIOR, userNotePatch } from '@/lib/noteEditor';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  initialValue: string;
  aiNote?: string | null;
  onClose: () => void;
  onSave: (notes: string | null) => Promise<void>;
};

export function NoteEditorModal({ visible, initialValue, aiNote, onClose, onSave }: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [initialValue, visible]);

  function cancel() {
    if (saving) return;
    Keyboard.dismiss();
    onClose();
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(userNotePatch(draft).notes);
      Keyboard.dismiss();
      onClose();
    } catch (error) {
      Alert.alert('Could not save note', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={cancel}
      statusBarTranslucent={false}
    >
      <View style={styles.safe}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel note editing"
            disabled={saving}
            onPress={cancel}
            style={({ pressed }) => [styles.headerActionButton, styles.headerActionStart, pressed && styles.pressed]}
          >
            <Text style={[typography.bodyStrong, styles.headerAction]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={[typography.heading, styles.headerTitle]}>Your note</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save note"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.headerActionButton, styles.headerActionEnd, pressed && styles.pressed]}
          >
            <Text style={[typography.bodyStrong, styles.headerAction]}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.keyboardSurface}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
            keyboardDismissMode={NOTE_EDITOR_BEHAVIOR.keyboardDismissMode}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[typography.bodyStrong, styles.prompt]}>Why did you save this one?</Text>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder="What do you want to remember?"
              accessibilityLabel="Your note"
              autoFocus={NOTE_EDITOR_BEHAVIOR.autoFocus}
              multiline={NOTE_EDITOR_BEHAVIOR.multiline}
              blurOnSubmit={false}
              scrollEnabled={NOTE_EDITOR_BEHAVIOR.inputScrollsLongText}
              textAlignVertical="top"
              style={[styles.editor, { minHeight: Math.max(210, Math.min(300, height * 0.34)) }]}
            />

            {aiNote?.trim() ? (
              <View style={styles.suggestion}>
                <View style={styles.suggestionHeading}>
                  <Feather name="play" size={14} color={colors.accent} />
                  <Text style={[typography.bodyStrong, styles.suggestionLabel]}>From the post</Text>
                </View>
                <Text style={[typography.body, styles.suggestionText]}>{aiNote.trim()}</Text>
                <Pressable
                  onPress={() => setDraft(aiNote.trim())}
                  accessibilityRole="button"
                  accessibilityLabel="Use the post suggestion as your note"
                  style={({ pressed }) => [styles.useSuggestion, pressed && styles.pressed]}
                >
                  <Text style={styles.useSuggestionText}>Use this</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      minHeight: 56,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bg,
    },
    headerActionButton: { flex: 1, minHeight: 44, justifyContent: 'center' },
    headerActionStart: { alignItems: 'flex-start' },
    headerActionEnd: { alignItems: 'flex-end' },
    headerAction: { color: colors.accent },
    headerTitle: { flex: 1, minWidth: 0, textAlign: 'center' },
    pressed: { opacity: 0.65 },
    keyboardSurface: { flex: 1 },
    scroll: { flex: 1 },
    content: { flexGrow: 1, padding: Spacing.lg },
    prompt: { color: colors.text, marginBottom: Spacing.sm },
    editor: {
      width: '100%',
      maxHeight: 360,
      borderRadius: Radius.lg,
      paddingTop: Spacing.lg,
      lineHeight: 23,
    },
    suggestion: {
      marginTop: Spacing.lg,
      padding: Spacing.lg,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      gap: Spacing.sm,
    },
    suggestionHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    suggestionLabel: { color: colors.text },
    suggestionText: { color: colors.textSecondary, lineHeight: 22 },
    useSuggestion: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    useSuggestionText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  });
}
