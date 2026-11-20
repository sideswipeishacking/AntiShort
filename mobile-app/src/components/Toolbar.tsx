import type React from 'react';
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
  /** Show the picture-in-picture button (false on Android devices without picture-in-picture). */
  showPictureInPicture: boolean;
  /** Picture-in-picture button enabled (Android: only while a video page is open). */
  canPictureInPicture: boolean;
  onPictureInPicture: () => void;
};

type ButtonProps = {
  glyph?: string;
  /** Drawn icon instead of a text glyph; receives the current color. */
  icon?: (color: string) => React.ReactNode;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
};

function ToolbarButton({ glyph, icon, label, accessibilityLabel, onPress, disabled = false, busy = false }: ButtonProps) {
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
        ) : icon ? (
          icon(disabled ? colors.disabled : colors.text)
        ) : (
          <Text style={[styles.glyph, disabled ? styles.disabled : null]}>{glyph}</Text>
        )}
      </View>
      <Text style={[styles.label, disabled ? styles.disabled : null]}>{label}</Text>
    </Pressable>
  );
}

/** Picture-in-picture icon: a screen with a small window in its corner (plain views, same on every platform). */
function PipIcon(color: string) {
  return (
    <View style={[styles.pipFrame, { borderColor: color }]}>
      <View style={[styles.pipWindow, { backgroundColor: color }]} />
    </View>
  );
}

/** Native bottom toolbar: Back, Forward, Reload (spinner while loading), Home, PiP, More. */
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
      {props.showPictureInPicture ? (
        <ToolbarButton
          icon={PipIcon}
          label="PiP"
          accessibilityLabel="Picture in picture: keep the video playing in a small window"
          onPress={props.onPictureInPicture}
          disabled={!props.canPictureInPicture}
        />
      ) : null}
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
  pipFrame: {
    width: 24,
    height: 18,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 2,
  },
  pipWindow: {
    width: 10,
    height: 7,
    borderRadius: 1.5,
  },
});
