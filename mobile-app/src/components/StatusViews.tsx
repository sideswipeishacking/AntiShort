import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export type LoadFailure = {
  kind: 'load' | 'terminated';
  title: string;
  detail: string;
  url: string | null;
};

type ErrorPanelProps = {
  failure: LoadFailure;
  onRetry: () => void;
  onHome: () => void;
};

/** Covers the web content when the main page failed to load, so a stale page is never presented as loaded. */
export function ErrorPanel({ failure, onRetry, onHome }: ErrorPanelProps) {
  return (
    <View style={styles.panel} accessibilityRole="alert">
      <Text style={styles.title}>{failure.title}</Text>
      <Text style={styles.detail}>{failure.detail}</Text>
      {failure.url ? (
        <Text style={styles.url} numberOfLines={2}>
          {failure.url}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={onRetry} accessibilityRole="button" style={[styles.action, styles.primary]}>
          <Text style={styles.actionText}>Try again</Text>
        </Pressable>
        <Pressable onPress={onHome} accessibilityRole="button" style={styles.action}>
          <Text style={styles.actionText}>YouTube home</Text>
        </Pressable>
      </View>
    </View>
  );
}

type HttpBannerProps = {
  status: number;
  onReload: () => void;
  onDismiss: () => void;
};

/** Non-blocking notice when YouTube answered the page request with an HTTP error status. */
export function HttpErrorBanner({ status, onReload, onDismiss }: HttpBannerProps) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>YouTube answered with HTTP {status}. The page may be incomplete.</Text>
      <Pressable onPress={onReload} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.bannerAction}>Reload</Text>
      </Pressable>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}>
        <Text style={styles.bannerAction}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.chrome,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  detail: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  url: {
    color: colors.disabled,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  action: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  actionText: {
    color: colors.buttonText,
    fontSize: 15,
    fontWeight: '600',
  },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.chromeBorder,
  },
  bannerText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
  },
  bannerAction: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
