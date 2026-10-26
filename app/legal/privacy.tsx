import { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { consentRpc } from '@/lib/aiSharingConsent';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Screen } from '@/components';
import { Spacing } from '@/constants';
import { openPrivacyPolicyWebsite, privacyPolicy } from '@/lib/privacyPolicy';
import { useTheme, type ThemeColors } from '@/lib/theme';
import { GlobalLegalDraft } from '@/components/GlobalLegalDraft';

export default function PrivacyScreen() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [opening, setOpening] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const openingRef = useRef(false);
  const { snapshot, canonicalUrl } = privacyPolicy;
  useEffect(() => {
    // Only an actually rendered, approved version can produce a presentation
    // receipt. A website link, absent snapshot or development draft cannot.
    if (!snapshot || snapshot.version !== 'nearr-global-privacy-v1') return;
    let visible = true;
    void (async () => {
      const { supabase } = require('../../lib/supabase') as typeof import('../../lib/supabase');
      const first = (await supabase.auth.getSession()).data.session;
      if (!first?.access_token) return;
      const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
      const transport = { supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '').replace(/\/$/, ''), publicKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '', accessToken: first.access_token };
      const access = await consentRpc(transport, 'get_my_global_access') as Record<string, unknown>;
      const current = (await supabase.auth.getSession()).data.session;
      if (!visible || current?.user.id !== first.user.id || access.legalApproved !== true || access.privacyVersion !== snapshot.version) return;
      await consentRpc({ ...transport, accessToken: current.access_token }, 'record_global_privacy_notice', { p_notice_version: snapshot.version });
    })().catch(() => {});
    return () => { visible = false; };
  }, [snapshot]);

  async function openWebsite() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setLinkFailed(false);
    const opened = await openPrivacyPolicyWebsite((url) => Linking.openURL(url));
    setLinkFailed(!opened);
    setOpening(false);
    openingRef.current = false;
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text accessibilityRole="header" style={typography.heading}>Privacy Policy</Text>
        <Button
          title="Open privacy policy website"
          accessibilityLabel="Open privacy policy website in your browser"
          variant="secondary"
          loading={opening}
          onPress={openWebsite}
        />
        <Text selectable style={[typography.caption, styles.meta]}>{canonicalUrl}</Text>
        {linkFailed ? (
          <Text accessibilityRole="alert" style={[typography.body, styles.paragraph]}>
            {snapshot
              ? 'The website could not be opened. You can read the saved policy below or try again.'
              : 'The website could not be opened. Check your connection and try again.'}
          </Text>
        ) : null}
        {snapshot ? (
          <>
            <Text style={[typography.caption, styles.meta]}>
              Effective date: {snapshot.effectiveDate}
            </Text>
            <Text style={[typography.caption, styles.meta]}>
              Saved copy · {snapshot.version} · Available offline
            </Text>

            {snapshot.sections.map((section, sectionIndex) => (
              <Card key={`${sectionIndex}:${section.heading}`} style={styles.card}>
                <Text accessibilityRole="header" style={typography.bodyStrong}>{section.heading}</Text>
                <View style={styles.paragraphs}>
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <Text key={paragraphIndex} selectable style={[typography.body, styles.paragraph]}>
                      {paragraph}
                    </Text>
                  ))}
                </View>
              </Card>
            ))}

            <Text selectable style={[typography.caption, styles.footer]}>
              {snapshot.operator}{'\n'}Contact: {snapshot.contactEmail}
            </Text>
          </>
        ) : (
          <Card style={styles.card}>
            <Text style={[typography.body, styles.paragraph]}>
              A saved privacy policy is not available in this build. You can open the policy website above.
            </Text>
          </Card>
        )}

        <GlobalLegalDraft kind="privacy" />
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
      gap: Spacing.md,
    },
    meta: {
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    card: {
      marginTop: Spacing.md,
    },
    paragraphs: {
      marginTop: Spacing.sm,
      gap: Spacing.sm,
    },
    paragraph: {
      color: colors.textSecondary,
      lineHeight: 22,
    },
    footer: {
      color: colors.textSecondary,
      marginTop: Spacing.lg,
    },
  });
}
