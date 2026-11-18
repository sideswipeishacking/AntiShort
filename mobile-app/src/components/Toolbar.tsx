import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

type ToolbarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onMore: () => void;
};

type ButtonProps = {
  glyph: string;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
};

function ToolbarButton({ glyph, label, accessibilityLabel, onPress, disabled = false, busy = false }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [styles.button, pressed && !disabled ? styles.pressed : null]}
    >
      <View style={styles.glyphBox}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Text style={[styles.glyph, disabled ? styles.disabled : null]}>{glyph}</Text>
        )}
      </View>
      <Text style={[styles.label, disabled ? styles.disabled : null]}>{label}</Text>
    </Pressable>
  );
}

/** Native bottom toolbar: Back, Forward, Reload (spinner while loading), Home, More. */
export function Toolbar(props: ToolbarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <ToolbarButton glyph="‹" label="Back" accessibilityLabel="Go back" onPress={props.onBack} disabled={!props.canGoBack} />
      <ToolbarButton
        glyph="›"
        label="Forward"
        accessibilityLabel="Go forward"
        onPress={props.onForward}
        disabled={!props.canGoForward}
      />
      <ToolbarButton
        glyph="↻"
        label={props.loading ? 'Loading' : 'Reload'}
        accessibilityLabel="Reload page"
        onPress={props.onReload}
        busy={props.loading}
      />
      <ToolbarButton glyph="⌂" label="Home" accessibilityLabel="Go to YouTube home" onPress={props.onHome} />
      <ToolbarButton glyph="⋯" label="More" accessibilityLabel="More: open a link, about" onPress={props.onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.chromeBorder,
    paddingTop: 6,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 10,
  },
  pressed: {
    backgroundColor: colors.card,
  },
  glyphBox: {
    height: 28,
    justifyContent: 'center',
  },
  glyph: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 28,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  disabled: {
    color: colors.disabled,
  },
});
