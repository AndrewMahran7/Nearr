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
import { SafeAreaView } from 'react-native-safe-area-context';

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
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel note editing"
            disabled={saving}
            hitSlop={12}
            onPress={cancel}
          >
            <Text style={[typography.bodyStrong, styles.headerAction]}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={typography.heading}>Edit note</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save note"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            hitSlop={12}
            onPress={() => void save()}
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
            contentContainerStyle={styles.content}
            keyboardDismissMode={NOTE_EDITOR_BEHAVIOR.keyboardDismissMode}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[typography.caption, styles.label]}>Your note</Text>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder="What should you remember about this place?"
              accessibilityLabel="Your note"
              autoFocus={NOTE_EDITOR_BEHAVIOR.autoFocus}
              multiline={NOTE_EDITOR_BEHAVIOR.multiline}
              blurOnSubmit={false}
              scrollEnabled={NOTE_EDITOR_BEHAVIOR.inputScrollsLongText}
              textAlignVertical="top"
              style={[styles.editor, { minHeight: Math.max(220, Math.min(360, height * 0.42)) }]}
            />

            {aiNote?.trim() ? (
              <View style={styles.suggestion}>
                <Text style={[typography.caption, styles.suggestionLabel]}>Suggested from the post</Text>
                <Text style={[typography.body, styles.suggestionText]}>{aiNote.trim()}</Text>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
    headerAction: { color: colors.accent, minWidth: 58 },
    keyboardSurface: { flex: 1 },
    scroll: { flex: 1 },
    content: { flexGrow: 1, padding: Spacing.lg, paddingBottom: Spacing.xxl },
    label: { color: colors.textSecondary, marginBottom: Spacing.sm },
    editor: {
      width: '100%',
      maxHeight: 420,
      borderRadius: Radius.lg,
      paddingTop: Spacing.lg,
      lineHeight: 23,
    },
    suggestion: {
      marginTop: Spacing.lg,
      padding: Spacing.lg,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    suggestionLabel: { color: colors.textMuted, marginBottom: Spacing.xs },
    suggestionText: { color: colors.textSecondary, lineHeight: 22 },
  });
}
