import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * Android picture-in-picture for the app's activity (android/src/main/java/.../PipState.kt). The
 * native side also makes the video player fill the small window (PipZoom.kt), because React Native
 * doesn't update the screen while the activity is paused in picture-in-picture.
 * Null on iOS, where the WebView's own video player provides picture-in-picture.
 */
declare class AntiShortPipModule extends NativeModule {
  /** Device supports picture-in-picture (Android 8+ with the system feature). */
  isSupported(): boolean;
  /** Enter picture-in-picture automatically on Home while the page's video plays. Set while a video page is open. */
  setAutoEnterEnabled(enabled: boolean): void;
  /** Enter picture-in-picture now. False if the device or the user's settings don't allow it. */
  enterAsync(): Promise<boolean>;
}

export const AntiShortPip = requireOptionalNativeModule<AntiShortPipModule>('AntiShortPip');
