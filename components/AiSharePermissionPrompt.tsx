import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/** Shown before a selected share can create a job or start extraction. */
export const AI_SHARE_PERMISSION_NOTICE =
  "To find places and later generate an AI note about a saved video place, Nearr may send the post link, captions, creator/location details, and selected video frames to Google Gemini. Some searches also send selected text and video frames to OpenAI. If needed, OpenAI may receive post audio for transcription.";

type Props = {
  onAllow: () => void;
  onCancel: () => void;
  compact?: boolean;
};

export function AiSharePermissionPrompt({ onAllow, onCancel, compact = false }: Props) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, compact && styles.compactContent]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, compact && styles.compactTitle]}>Analyze this post?</Text>
        <Text style={styles.body}>{AI_SHARE_PERMISSION_NOTICE}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Allow third-party AI analysis of this post"
          onPress={onAllow}
          style={styles.allowButton}
        >
          <Text style={styles.allowText}>Allow AI analysis</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel share without analyzing this post"
          onPress={onCancel}
          style={styles.cancelButton}
        >
          <Text style={styles.cancelText}>Cancel share</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0D' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  compactContent: { paddingHorizontal: 20, paddingVertical: 16, gap: 10 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '800' },
  compactTitle: { fontSize: 21 },
  body: { color: '#E4E4E7', fontSize: 14, lineHeight: 20 },
  allowButton: {
    minHeight: 48, borderRadius: 14, backgroundColor: '#FF6A1A',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 4,
  },
  allowText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
