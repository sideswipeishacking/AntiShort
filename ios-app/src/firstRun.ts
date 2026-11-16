import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTICE_KEY = 'antishort.firstRunNotice.v1';

/** Whether the "filtering only works in this app" notice was already acknowledged. */
export async function hasSeenNotice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NOTICE_KEY)) === 'seen';
  } catch {
    // If storage is unavailable, show the notice again rather than never.
    return false;
  }
}

export async function markNoticeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTICE_KEY, 'seen');
  } catch {
    // Not fatal: the notice shows again on the next launch.
  }
}
