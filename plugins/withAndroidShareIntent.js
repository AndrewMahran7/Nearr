/**
 * withAndroidShareIntent — Expo config plugin.
 *
 * Why this exists:
 *   On Android, Instagram / TikTok / Safari deliver a "Share to Nearr"
 *   payload as ACTION_SEND with EXTRA_TEXT. Expo's deep-link plumbing
 *   (expo-linking + expo-router) only handles ACTION_VIEW with a URI.
 *   So we patch MainActivity.kt to convert ACTION_SEND text/plain into
 *   our existing nearr://share?url=<encoded> deep link, which Expo Router
 *   already routes to app/share.tsx.
 *
 *   The intent-filter itself (action="SEND", mimeType="text/plain") is
 *   already declared in app.json under android.intentFilters, so this
 *   plugin only owns the Kotlin glue.
 *
 * Why patch MainActivity instead of adding a native module:
 *   - Zero new RN/native bridges to maintain.
 *   - Single source of truth in JS (app/share.tsx handles everything else).
 *   - Cold-start and warm-start behave identically because the intent is
 *     rewritten in both onCreate and onNewIntent.
 *
 * Idempotency:
 *   The mod is gated on the marker `// nearr:share-intent-rewrite` so
 *   running `expo prebuild` repeatedly will not double-inject.
 *
 * If you edit the Kotlin snippet here, also update the live source at
 *   android/app/src/main/java/com/nearr/app/MainActivity.kt
 * so manual `expo run:android` builds (which don't always re-prebuild)
 * stay in sync.
 */

const { withMainActivity } = require('@expo/config-plugins');

const MARKER = '// nearr:share-intent-rewrite';

const IMPORTS = `import android.content.Intent
import android.net.Uri
import android.util.Log`;

const HELPER_METHODS = `
  // ${MARKER}
  // Convert ACTION_SEND with EXTRA_TEXT into nearr://share?url=<encoded>
  // so expo-router routes it to app/share.tsx like any deep link.
  private fun rewriteShareIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != Intent.ACTION_SEND) return
    val mime = intent.type ?: ""
    if (!mime.startsWith("text/")) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    if (text.isNullOrBlank()) return
    val firstUrl = extractFirstUrlForShare(text) ?: run {
      Log.w("NearrMainActivity", "ACTION_SEND received but no URL found in EXTRA_TEXT")
      return
    }
    val encoded = Uri.encode(firstUrl)
    val deepLink = Uri.parse("nearr://share?url=$encoded")
    Log.i("NearrMainActivity", "rewriting ACTION_SEND -> $deepLink")
    intent.action = Intent.ACTION_VIEW
    intent.data = deepLink
    intent.removeExtra(Intent.EXTRA_TEXT)
  }

  private fun extractFirstUrlForShare(text: String): String? {
    val regex = Regex("https?://[^\\\\s<>\\"']+", RegexOption.IGNORE_CASE)
    val raw = regex.find(text)?.value ?: return null
    return raw.trimEnd('.', ',', ')', ']', '!', '?', ';', ':')
  }

  override fun onNewIntent(intent: Intent) {
    rewriteShareIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;

/** @type {import('@expo/config-plugins').ConfigPlugin} */
function withAndroidShareIntent(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      console.warn(
        '[withAndroidShareIntent] MainActivity is not Kotlin; skipping. ' +
          'V2 share-intent forwarding requires the Kotlin template.',
      );
      return cfg;
    }

    let src = cfg.modResults.contents;

    if (src.includes(MARKER)) {
      // Already patched — keep idempotent.
      return cfg;
    }

    // 1. Add imports (only the ones missing).
    for (const line of IMPORTS.split('\n')) {
      if (!src.includes(line)) {
        src = src.replace(
          /import android\.os\.Bundle/,
          `${line}\nimport android.os.Bundle`,
        );
      }
    }

    // 2. Inject a call to rewriteShareIntent at the top of onCreate, before
    //    super.onCreate(...). Match the Expo template's onCreate signature.
    const onCreateRe = /(super\.onCreate\(null\))/;
    if (onCreateRe.test(src)) {
      src = src.replace(
        onCreateRe,
        `rewriteShareIntent(intent)\n    $1`,
      );
    } else {
      console.warn(
        '[withAndroidShareIntent] could not find super.onCreate(null) to inject ' +
          'rewriteShareIntent call. Template may have changed.',
      );
    }

    // 3. Insert the helper methods + onNewIntent override before the closing
    //    brace of the MainActivity class. We anchor on the last `}` in the
    //    file, which is the class brace in the Expo template.
    const lastBrace = src.lastIndexOf('}');
    if (lastBrace > 0) {
      src = src.slice(0, lastBrace) + HELPER_METHODS + '\n' + src.slice(lastBrace);
    } else {
      console.warn(
        '[withAndroidShareIntent] could not find class closing brace; helper ' +
          'methods not injected.',
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = withAndroidShareIntent;
