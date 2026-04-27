/**
 * ShareExtension — root component for the iOS Share Extension target.
 *
 * Behavior:
 *   - Receives `url` and/or `text` from iOS as initial props (see
 *     expo-share-extension README). For Safari URL shares it's `url`;
 *     for Instagram/TikTok it's usually `text` containing a caption +
 *     URL, so we extract the first https URL from it.
 *   - Immediately opens the host app at `nearr://share?url=<encoded>`
 *     (via `openHostApp("share?url=...")`) and dismisses the sheet.
 *   - The host app's existing app/share.tsx flow (added in V2 beta)
 *     auto-runs the save flow when it sees the `url` param.
 *
 * UX note: we render a tiny "Saving to Nearr…" placeholder so the user
 * sees something for the ~half second before iOS animates the sheet
 * away. We never ask the user to tap anything inside the extension.
 */

import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { close, openHostApp, type InitialProps } from 'expo-share-extension';

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCT = /[.,)\]!?;:]+$/;

/**
 * Pull the first http(s) URL out of a free-text caption. Captions from
 * Instagram/TikTok typically look like
 *   "check this out https://www.tiktok.com/@x/video/123 #foodie"
 * so we want the URL token, not the surrounding caption.
 */
function firstUrlIn(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(URL_REGEX);
  if (!m) return null;
  return m[0].replace(TRAILING_PUNCT, '');
}

function pickSharedUrl(props: InitialProps): string | null {
  // Direct URL share (Safari) takes priority.
  if (props.url && /^https?:\/\//i.test(props.url)) return props.url;
  // Otherwise scan any text payload for the first URL.
  return firstUrlIn(props.text);
}

export default function ShareExtension(props: InitialProps) {
  // Guard against React 18 strict-mode double-invocation: only fire the
  // host-app handoff once per extension instantiation.
  const handedOffRef = useRef(false);

  useEffect(() => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;

    const url = pickSharedUrl(props);
    if (!url) {
      // Nothing actionable shared. Close immediately rather than leave
      // the user staring at a spinner.
      console.log('[shareExtension] no url found in shared payload, closing');
      close();
      return;
    }

    const encoded = encodeURIComponent(url);
    const path = `share?url=${encoded}`;
    console.log('[shareExtension] opening host app at', path);
    try {
      openHostApp(path);
    } catch (err) {
      console.warn('[shareExtension] openHostApp failed', err);
    }
    // Give iOS a beat to perform the openURL handoff before we tear down.
    const t = setTimeout(() => {
      close();
    }, 250);
    return () => clearTimeout(t);
  }, [props]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.label}>Saving to Nearr…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    marginTop: 12,
    fontSize: 16,
    color: '#111',
  },
});
