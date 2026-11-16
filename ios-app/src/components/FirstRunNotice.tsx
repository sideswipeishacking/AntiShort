import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/** Shown on first launch (and from the About button): what this app can and cannot filter. */
export function FirstRunNotice({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Shorts are filtered in this app only
          </Text>
          <Text style={styles.body}>
            AntiShort shows YouTube's mobile website and hides Shorts on it. Shorts links open in the regular video
            player instead.
          </Text>
          <Text style={styles.body}>
            It cannot change the official YouTube app, Safari, or YouTube links opened from other apps. Shorts still
            appear there.
          </Text>
          <Text style={styles.body}>
            Links to other websites are never opened automatically; you are asked first. YouTube may limit sign-in or
            playback in embedded browsers like this one.
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.buttonText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.chromeBorder,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 12,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 10,
  },
  button: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.buttonText,
    fontSize: 16,
    fontWeight: '600',
  },
});
