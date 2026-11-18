import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onOpen: (text: string) => void;
};

/**
 * "Open YouTube link…" dialog for Android. iOS uses the native Alert.prompt, which Android lacks.
 * The entered text goes through the same navigation policy as taps in the page.
 */
export function LinkPrompt({ visible, onCancel, onOpen }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const submit = () => onOpen(text);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="height" style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Open a YouTube link
          </Text>
          <Text style={styles.body}>Paste a YouTube link. Shorts links open in the regular video player.</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={submit}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            placeholder="https://youtube.com/…"
            placeholderTextColor={colors.disabled}
            selectionColor={colors.accent}
            style={styles.input}
            accessibilityLabel="YouTube link"
          />
          <View style={styles.buttons}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.secondary, pressed ? styles.pressed : null]}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.primary, pressed ? styles.pressed : null]}
            >
              <Text style={styles.primaryText}>Open</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    marginBottom: 10,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },
  input: {
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.chromeBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.chrome,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.chromeBorder,
  },
  pressed: {
    opacity: 0.8,
  },
  primaryText: {
    color: colors.buttonText,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
