/**
 * components/ErrorBoundary.tsx
 *
 * Reusable route-level error boundary. Catches render errors in a subtree,
 * logs a SANITIZED message + component stack (no tokens/URLs/PII), and shows a
 * friendly retry fallback instead of letting the whole app fall to the global
 * boundary. Used to wrap the share-jobs queue so a single bad job row can never
 * blank the app, and so the next physical-device crash is diagnosable.
 */
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing, Radius } from '@/constants';
import { sanitizeErrorText, sanitizeStack } from '@/lib/sanitizeError';
import { recordDiagnostic } from '@/lib/deviceDiagnostics';
import { useOptionalTheme } from '@/lib/theme';

type Props = {
  children: ReactNode;
  /** Short tag used in the log line, e.g. "share-jobs". */
  name: string;
  fallbackTitle?: string;
  fallbackBody?: string;
};

type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: sanitizeErrorText(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // Sanitized so device logs never contain tokens/credentials/PII.
    console.error(
      `[ROUTE_ERROR_BOUNDARY:${this.props.name}] ${sanitizeErrorText(error)}`,
    );
    console.error(
      `[ROUTE_ERROR_BOUNDARY:${this.props.name}] stack ${sanitizeStack(info?.componentStack)}`,
    );
    // Persist a sanitized diagnostic so the next TestFlight failure is reportable
    // without macOS Console (surfaced via a dev "Copy diagnostic" action).
    void recordDiagnostic({
      errorCode: `route_boundary:${this.props.name}`,
      route: this.props.name,
      error,
      componentStack: info?.componentStack ?? null,
    });
  }

  private reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback title={this.props.fallbackTitle} body={this.props.fallbackBody} message={this.state.message} onRetry={this.reset} />;
  }
}

function ErrorFallback({ title, body, message, onRetry }: { title?: string; body?: string; message: string; onRetry: () => void }) {
  const theme = useOptionalTheme();
  const styles = createStyles(theme?.colors ?? Colors);
  return (
      <View style={styles.container}>
        <Text style={styles.title}>{title ?? 'Something went wrong'}</Text>
        <Text style={styles.body}>
          {body ?? 'This screen hit an unexpected error. Try again.'}
        </Text>
        <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        {__DEV__ ? <Text style={styles.detail}>{message}</Text> : null}
      </View>
    );
}

function createStyles(Colors: typeof import('@/constants').Colors) { return StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    backgroundColor: Colors.bg,
  },
  title: { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm },
  body: { fontSize: 14, textAlign: 'center', color: Colors.textSecondary, marginBottom: Spacing.lg },
  button: {
    minHeight: 50,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  buttonText: { color: Colors.textInverse, fontWeight: '700' },
  detail: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
}); }
