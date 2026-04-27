/**
 * Share entry screen.
 *
 * Flow:
 *   1. User pastes (or arrives via deep link with ?url=...) a TikTok /
 *      Instagram / generic URL.
 *   2. We call `parseShare(url)` to detect the platform and pull public
 *      OpenGraph metadata (title, description) — no scraping, no auth.
 *   3. If we got something useful we show a preview card with the platform,
 *      title, and description, plus a "Find this place" button that hands
 *      off to the existing /add-place screen with `q`, `source_url`, and
 *      `source_type` so the user can pick the correct candidate and save.
 *   4. If metadata extraction failed, we fall back to a manual search:
 *      same /add-place screen, but with no `q` prefilled — the user types
 *      the venue name themselves. `source_url` and `source_type` are still
 *      attached so the saved row is correctly attributed.
 *
 * Notes:
 *   - We never POST credentials, never use private APIs, and tolerate any
 *     HTTP / parse failure by routing the user to manual search.
 *   - The actual candidate list + confirmation UI lives in /add-place to
 *     avoid duplicating the Google Places search/list/save UI.
 */

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Input, Screen } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';
import { isLikelyUrl, parseShare, type ParsedShare, type ShareSource } from '@/lib/shareParser';

type Phase = 'paste' | 'parsing' | 'preview' | 'failed';

const PLATFORM_LABELS: Record<ShareSource, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  link: 'Link',
};

export default function ShareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string }>();

  const [url, setUrl] = useState(params.url ?? '');
  const [phase, setPhase] = useState<Phase>('paste');
  const [parsed, setParsed] = useState<ParsedShare | null>(null);

  // Auto-parse if we arrived with a URL (e.g. from a share intent / deep link).
  useEffect(() => {
    if (params.url && isLikelyUrl(params.url)) {
      void runParse(params.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runParse(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!isLikelyUrl(trimmed)) {
      Alert.alert('Paste a valid link', 'The link should start with http:// or https://');
      return;
    }
    setPhase('parsing');
    try {
      const result = await parseShare(trimmed);
      setParsed(result);
      setUrl(result.url);
      setPhase(result.metadataFailed && !result.suggestedQuery ? 'failed' : 'preview');
    } catch (err) {
      console.warn('[share] parseShare threw', (err as Error)?.message);
      setParsed({
        url: trimmed,
        source: 'link',
        title: null,
        description: null,
        suggestedQuery: null,
        metadataFailed: true,
      });
      setPhase('failed');
    }
  }

  function continueToCandidates() {
    if (!parsed) return;
    router.replace({
      pathname: '/add-place',
      params: {
        q: parsed.suggestedQuery ?? '',
        source_url: parsed.url,
        source_type: parsed.source,
      },
    });
  }

  function manualSearch() {
    // Fallback: open /add-place with no q so the user can type the venue
    // themselves. Source attribution is preserved if we have a URL.
    router.replace({
      pathname: '/add-place',
      params: parsed
        ? { source_url: parsed.url, source_type: parsed.source }
        : url
        ? { source_url: url.trim(), source_type: 'link' }
        : {},
    });
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    <Screen>
      <Text style={[Typography.title, styles.headerTitle]}>Save from a link</Text>
      <Text style={[Typography.body, styles.muted, styles.headerBody]}>
        Paste a TikTok, Instagram, or any URL that mentions a place. We&apos;ll read the
        public preview and try to identify it via Google Places.
      </Text>

      <View style={styles.inputRow}>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="https://..."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={phase !== 'parsing'}
          style={{ flex: 1 }}
          onSubmitEditing={() => runParse(url)}
        />
        <View style={{ width: Spacing.sm }} />
        <Button
          title="Read"
          onPress={() => runParse(url)}
          loading={phase === 'parsing'}
          disabled={phase === 'parsing' || !url.trim()}
        />
      </View>

      {phase === 'paste' ? (
        <View style={styles.hintBox}>
          <Text style={[Typography.caption, styles.muted, { textAlign: 'center' }]}>
            We only read the public link preview (the same thing your browser sees).
            We never sign in or scrape private content.
          </Text>
        </View>
      ) : null}

      {phase === 'preview' && parsed ? (
        <PreviewCard parsed={parsed} />
      ) : null}

      {phase === 'failed' && parsed ? (
        <Card style={styles.failCard}>
          <Text style={Typography.heading}>Couldn&apos;t read this link</Text>
          <Text style={[Typography.body, styles.muted, { marginTop: Spacing.xs }]}>
            We couldn&apos;t pull a preview from {PLATFORM_LABELS[parsed.source]}. You can still
            search for the place by name and we&apos;ll attach the link to whatever you save.
          </Text>
        </Card>
      ) : null}

      {phase === 'preview' || phase === 'failed' ? (
        <View style={styles.actions}>
          {phase === 'preview' ? (
            <Button title="Find this place" onPress={continueToCandidates} style={{ flex: 1 }} />
          ) : null}
          {phase === 'preview' ? <View style={{ height: Spacing.sm }} /> : null}
          <Pressable onPress={manualSearch} style={styles.manualBtn}>
            <Text style={[Typography.label, { color: Colors.primary }]}>
              {phase === 'preview' ? 'Search manually instead' : 'Search manually'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Preview card
// ---------------------------------------------------------------------------

function PreviewCard({ parsed }: { parsed: ParsedShare }) {
  return (
    <Card style={styles.previewCard}>
      <Text style={[Typography.label, styles.muted]}>{PLATFORM_LABELS[parsed.source]}</Text>
      {parsed.title ? (
        <Text style={[Typography.heading, { marginTop: Spacing.xs }]}>{parsed.title}</Text>
      ) : (
        <Text style={[Typography.body, styles.muted, { marginTop: Spacing.xs }]}>
          No title found.
        </Text>
      )}
      {parsed.description ? (
        <Text style={[Typography.body, styles.muted, { marginTop: Spacing.sm }]}>
          {parsed.description}
        </Text>
      ) : null}
      {parsed.suggestedQuery ? (
        <View style={styles.queryBox}>
          <Text style={[Typography.caption, styles.muted]}>We&apos;ll search for</Text>
          <Text style={[Typography.bodyStrong, { marginTop: 2 }]}>{parsed.suggestedQuery}</Text>
        </View>
      ) : (
        <Text style={[Typography.caption, styles.muted, { marginTop: Spacing.sm }]}>
          We couldn&apos;t guess a search term — you can edit it on the next screen.
        </Text>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  headerTitle: { marginBottom: Spacing.xs },
  headerBody: { marginBottom: Spacing.lg },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  hintBox: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  previewCard: { marginTop: Spacing.md },
  failCard: { marginTop: Spacing.md },
  queryBox: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actions: { marginTop: Spacing.lg },
  manualBtn: { alignItems: 'center', paddingVertical: Spacing.md },
  muted: { color: Colors.textMuted },
});
