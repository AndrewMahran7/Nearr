import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingColors, OnboardingRadius } from '../theme';
import { OnboardingPrimaryButton } from '../OnboardingPrimaryButton';
import { NearrAppIcon } from './NearrAppIcon';

type Props = {
  visible: boolean;
  onClose: () => void;
  onStepViewed: (step: number) => void;
};

const STEPS = [
  {
    title: 'Tap More',
    body: 'Open the full list of apps in the Share Sheet.',
  },
  {
    title: 'Add Nearr',
    body: 'Find Nearr under Suggestions and tap the green +.',
  },
  {
    title: 'Nearr is now easier to find',
    body: 'Tap Done. Nearr will appear in your Favorites next time.',
  },
] as const;

export function NearrFavoritesHelp({ visible, onClose, onStepViewed }: Props) {
  const [step, setStep] = useState(0);
  const viewedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!visible) {
      setStep(0);
      viewedRef.current.clear();
      return;
    }
    if (viewedRef.current.has(step)) return;
    viewedRef.current.add(step);
    onStepViewed(step);
  }, [onStepViewed, step, visible]);

  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            onPress={step > 0 ? () => setStep((current) => current - 1) : onClose}
            style={styles.headerButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={step > 0 ? 'Previous help step' : 'Close Nearr help'}
          >
            <Feather name={step > 0 ? 'chevron-left' : 'x'} size={24} color={OnboardingColors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>iPhone Share Sheet help</Text>
          <Pressable
            onPress={onClose}
            style={styles.headerButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close Nearr help"
          >
            <Feather name="x" size={22} color={OnboardingColors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.progress} accessibilityLabel={`Help step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <View
              key={item.title}
              style={[styles.progressSegment, index <= step && styles.progressSegmentActive]}
            />
          ))}
        </View>

        <View style={styles.content}>
          <Text style={styles.eyebrow}>Step {step + 1}</Text>
          <Text style={styles.title}>{STEPS[step].title}</Text>
          <Text style={styles.body}>{STEPS[step].body}</Text>

          <View style={styles.mockCard} accessibilityLabel="Illustrated iPhone Share Sheet instructions">
            {step === 0 ? <MoreStep /> : step === 1 ? <SuggestionsStep /> : <FavoritesStep />}
          </View>
        </View>

        <View style={styles.footer}>
          <OnboardingPrimaryButton
            title={isLast ? 'Back to Share Sheet' : 'Next'}
            onPress={isLast ? onClose : () => setStep((current) => current + 1)}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function MoreStep() {
  return (
    <View>
      <View style={styles.sheetGrabber} />
      <Text style={styles.mockHeading}>Share with an app</Text>
      <View style={styles.appRow}>
        <AppTile icon="radio" label="AirDrop" color="#1E8FFF" />
        <AppTile icon="message-circle" label="Messages" color="#31D158" />
        <AppTile icon="mail" label="Mail" color="#1FA9F6" />
        <View style={styles.appTile}>
          <View style={[styles.appIcon, styles.moreIcon, styles.highlightRing]}>
            <Feather name="more-horizontal" size={23} color="#3C3C43" />
          </View>
          <Text style={styles.appLabel}>More</Text>
        </View>
      </View>
      <View style={styles.instructionPill}>
        <Feather name="arrow-up" size={15} color={OnboardingColors.onOrange} />
        <Text style={styles.instructionPillText}>Tap More</Text>
      </View>
    </View>
  );
}

function SuggestionsStep() {
  return (
    <View>
      <AppsEditorHeader />
      <Text style={styles.sectionLabel}>Favorites</Text>
      <EditorRow label="Messages" icon="message-circle" favorite />
      <Text style={styles.sectionLabel}>Suggestions</Text>
      <EditorRow label="Nearr" nearr highlighted />
      <EditorRow label="Notes" icon="file-text" />
    </View>
  );
}

function FavoritesStep() {
  return (
    <View>
      <AppsEditorHeader doneHighlighted />
      <Text style={styles.sectionLabel}>Favorites</Text>
      <EditorRow label="Messages" icon="message-circle" favorite />
      <EditorRow label="Mail" icon="mail" favorite />
      <EditorRow label="Nearr" nearr favorite />
      <View style={styles.successNote}>
        <Feather name="check-circle" size={18} color={OnboardingColors.orange} />
        <Text style={styles.successText}>Nearr will be visible in the app row.</Text>
      </View>
    </View>
  );
}

function AppsEditorHeader({ doneHighlighted = false }: { doneHighlighted?: boolean }) {
  return (
    <View style={styles.editorHeader}>
      <View style={styles.headerSpacer} />
      <Text style={styles.editorTitle}>Apps</Text>
      <View style={[styles.doneButton, doneHighlighted && styles.doneButtonHighlighted]}>
        <Feather name="check" size={19} color="#FFFFFF" />
      </View>
    </View>
  );
}

function EditorRow({
  label,
  icon,
  nearr = false,
  favorite = false,
  highlighted = false,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  nearr?: boolean;
  favorite?: boolean;
  highlighted?: boolean;
}) {
  return (
    <View style={[styles.editorRow, highlighted && styles.editorRowHighlighted]}>
      <View style={[styles.addButton, favorite && styles.removeButton]}>
        <Feather name={favorite ? 'minus' : 'plus'} size={18} color="#FFFFFF" />
      </View>
      <View style={styles.editorAppIcon}>
        {nearr ? (
          <NearrAppIcon size={36} />
        ) : (
          <Feather name={icon ?? 'square'} size={20} color="#FFFFFF" />
        )}
      </View>
      <Text style={styles.editorLabel}>{label}</Text>
      {favorite ? <Feather name="menu" size={20} color="#8E8E93" /> : null}
    </View>
  );
}

function AppTile({
  icon,
  label,
  color,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.appTile}>
      <View style={[styles.appIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={22} color="#FFFFFF" />
      </View>
      <Text style={styles.appLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: OnboardingColors.background,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: OnboardingColors.text,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  progress: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 24,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: OnboardingColors.progressInactive,
  },
  progressSegmentActive: {
    backgroundColor: OnboardingColors.orange,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  eyebrow: {
    color: OnboardingColors.orange,
    fontSize: 13,
    fontWeight: '800',
  },
  title: {
    color: OnboardingColors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginTop: 6,
  },
  body: {
    color: OnboardingColors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
  },
  mockCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: OnboardingRadius.card,
    backgroundColor: '#F2F2F4',
    minHeight: 300,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#C7C7CC',
    marginBottom: 18,
  },
  mockHeading: {
    color: '#1C1C1E',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 22,
  },
  appRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  appTile: {
    width: 60,
    alignItems: 'center',
  },
  appIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreIcon: {
    backgroundColor: '#E1E1E6',
  },
  highlightRing: {
    borderWidth: 3,
    borderColor: OnboardingColors.orange,
  },
  appLabel: {
    color: '#3C3C43',
    fontSize: 11,
    marginTop: 7,
  },
  instructionPill: {
    alignSelf: 'flex-end',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 32,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: OnboardingColors.orange,
  },
  instructionPillText: {
    color: OnboardingColors.onOrange,
    fontWeight: '800',
  },
  editorHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerSpacer: {
    width: 42,
  },
  editorTitle: {
    flex: 1,
    color: '#1C1C1E',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  doneButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A84FF',
  },
  doneButtonHighlighted: {
    borderWidth: 3,
    borderColor: OnboardingColors.orange,
  },
  sectionLabel: {
    color: '#6C6C70',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 5,
  },
  editorRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D9D9DE',
  },
  editorRowHighlighted: {
    borderWidth: 2,
    borderColor: OnboardingColors.orange,
    backgroundColor: '#FFF7F0',
  },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#30D158',
  },
  removeButton: {
    backgroundColor: '#FF453A',
  },
  editorAppIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2688D8',
    overflow: 'hidden',
  },
  editorLabel: {
    flex: 1,
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '600',
  },
  successNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFF1E6',
  },
  successText: {
    flex: 1,
    color: '#3C3C43',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
});