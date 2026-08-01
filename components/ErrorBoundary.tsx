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
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{this.props.fallbackTitle ?? 'Something went wrong'}</Text>
        <Text style={styles.body}>
          {this.props.fallbackBody ?? 'This screen hit an unexpected error. Try again.'}
        </Text>
        <Pressable style={styles.button} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        {__DEV__ ? <Text style={styles.detail}>{this.state.message}</Text> : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
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
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  buttonText: { color: Colors.textInverse, fontWeight: '700' },
  detail: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
});
