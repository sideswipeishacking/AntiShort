import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewOpenWindowEvent,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { BLOCKER_SCRIPT } from './blocker/blockerScript.generated';
import { FirstRunNotice } from './components/FirstRunNotice';
import { ErrorPanel, HttpErrorBanner, type LoadFailure } from './components/StatusViews';
import { Toolbar } from './components/Toolbar';
import { hasSeenNotice, markNoticeSeen } from './firstRun';
import {
  type BlockReason,
  HOME_URL,
  buildNavigationScript,
  decideNavigation,
  isYouTubeUrl,
  normalizeUserUrl,
} from './navigationPolicy';
import { colors } from './theme';

/**
 * react-native-webview passes any URL that does not match `originWhitelist` straight to
 * Linking.openURL, i.e. it would open Safari or other apps on its own. Matching everything routes
 * every URL to onShouldStartLoadWithRequest instead, where navigationPolicy decides.
 */
const ROUTE_ALL_URLS_THROUGH_POLICY = ['*'];

type Session = { uri: string; key: number };
type HttpFailure = { status: number; url: string };

const renderNothing = () => <View />;

export function BrowserScreen() {
  const webViewRef = useRef<WebView<object>>(null);
  /** Last URL the main frame finished loading (including in-page navigations). */
  const committedUrlRef = useRef<string | null>(null);
  /** URL of the main-frame load in progress, for error messages and retry. */
  const pendingUrlRef = useRef<string | null>(null);
  const alertOpenRef = useRef(false);

  const [session, setSession] = useState<Session>({ uri: HOME_URL, key: 0 });
  const [history, setHistory] = useState({ canGoBack: false, canGoForward: false });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [httpFailure, setHttpFailure] = useState<HttpFailure | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);

  useEffect(() => {
    let active = true;
    hasSeenNotice().then((seen) => {
      if (active && !seen) setNoticeVisible(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const closeNotice = useCallback(() => {
    setNoticeVisible(false);
    void markNoticeSeen();
  }, []);

  const showBlockedLink = useCallback((url: string, reason: BlockReason, host: string | null) => {
    if (alertOpenRef.current) return; // one prompt at a time
    alertOpenRef.current = true;
    const done = () => {
      alertOpenRef.current = false;
    };
    if (reason === 'external-site' && host) {
      Alert.alert(
        'Link to another website',
        `This app only shows YouTube, so it did not open:\n\n${host}\n\nYou can open it in Safari instead. Shorts are not filtered there.`,
        [
          { text: 'Stay here', style: 'cancel', onPress: done },
          {
            text: 'Open in Safari',
            onPress: () => {
              done();
              Linking.openURL(url).catch(() => undefined);
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'Link not opened',
        'This link would leave the app (for example to open another app, where Shorts are not filtered), so it was not opened.',
        [{ text: 'OK', onPress: done }],
      );
    }
  }, []);

  /** Loads a URL in the WebView, applying the same policy as in-page navigation. */
  const navigateTo = useCallback(
    (url: string) => {
      const decision = decideNavigation(url, true);
      if (decision.action === 'block') {
        if (decision.notify) showBlockedLink(decision.url, decision.reason, decision.host);
        return;
      }
      const target = decision.action === 'redirect' ? decision.target : url;
      setFailure(null);
      setHttpFailure(null);
      if (isYouTubeUrl(committedUrlRef.current) && webViewRef.current) {
        // Navigate from inside the current YouTube page so back/forward history is kept.
        webViewRef.current.injectJavaScript(buildNavigationScript(target));
      } else {
        // No YouTube page to navigate from (first load failed, or on Google sign-in): load it directly.
        committedUrlRef.current = null;
        setSession((prev) => ({ uri: target, key: prev.uri === target ? prev.key + 1 : prev.key }));
      }
    },
    [showBlockedLink],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      const decision = decideNavigation(request.url, request.isTopFrame);
      if (decision.action === 'allow') return true;
      if (decision.action === 'redirect') {
        // e.g. /shorts/<id> -> /watch?v=<id>. Cancel this load and start the replacement.
        setTimeout(() => navigateTo(decision.target), 0);
        return false;
      }
      if (decision.notify) {
        setTimeout(() => showBlockedLink(decision.url, decision.reason, decision.host), 0);
      }
      return false;
    },
    [navigateTo, showBlockedLink],
  );

  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => navigateTo(event.nativeEvent.targetUrl),
    [navigateTo],
  );

  const onLoadStart = useCallback((event: WebViewNavigationEvent) => {
    pendingUrlRef.current = event.nativeEvent.url;
    setLoading(true);
    setProgress(0);
    setFailure(null);
    setHttpFailure(null);
  }, []);

  const onLoadProgress = useCallback((event: WebViewProgressEvent) => {
    const value = event.nativeEvent.progress;
    setProgress(value);
    if (value >= 1) setLoading(false);
  }, []);

  const onLoad = useCallback((event: WebViewNavigationEvent) => {
    committedUrlRef.current = event.nativeEvent.url;
    setFailure(null);
  }, []);

  const onLoadEnd = useCallback(() => setLoading(false), []);

  const onError = useCallback((event: WebViewErrorEvent) => {
    event.preventDefault(); // render our own error panel instead of the library's default
    const { description, domain, code } = event.nativeEvent;
    setLoading(false);
    setFailure({
      kind: 'load',
      title: "This page couldn't be loaded",
      detail: `${description || 'Unknown error'} (${domain ?? 'error'} ${code})`,
      url: pendingUrlRef.current,
    });
  }, []);

  const onHttpError = useCallback((event: WebViewHttpErrorEvent) => {
    setHttpFailure({ status: event.nativeEvent.statusCode, url: event.nativeEvent.url });
  }, []);

  const onContentProcessDidTerminate = useCallback(() => {
    setLoading(false);
    setFailure({
      kind: 'terminated',
      title: 'The page stopped unexpectedly',
      detail: 'iOS ended the web page process (usually to free memory). Try again to reload it.',
      url: committedUrlRef.current,
    });
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setHistory((prev) =>
      prev.canGoBack === nav.canGoBack && prev.canGoForward === nav.canGoForward
        ? prev
        : { canGoBack: nav.canGoBack, canGoForward: nav.canGoForward },
    );
  }, []);

  const retry = useCallback(() => {
    if (!failure) return;
    if (failure.kind === 'terminated') {
      setFailure(null);
      webViewRef.current?.reload();
    } else {
      navigateTo(failure.url ?? HOME_URL);
    }
  }, [failure, navigateTo]);

  const reload = useCallback(() => {
    if (failure) {
      retry();
      return;
    }
    setHttpFailure(null);
    webViewRef.current?.reload();
  }, [failure, retry]);

  const goHome = useCallback(() => navigateTo(HOME_URL), [navigateTo]);
  const goBack = useCallback(() => webViewRef.current?.goBack(), []);
  const goForward = useCallback(() => webViewRef.current?.goForward(), []);
  /** "Open YouTube link…": paste a link (e.g. a Shorts link someone sent you); same policy as taps. */
  const promptForLink = useCallback(() => {
    Alert.prompt(
      'Open a YouTube link',
      'Paste a YouTube link. Shorts links open in the regular video player.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open',
          onPress: (value?: string) => {
            const url = normalizeUserUrl(value ?? '');
            if (url) navigateTo(url);
          },
        },
      ],
      'plain-text',
      '',
      'url',
    );
  }, [navigateTo]);

  const showMoreMenu = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Open YouTube link…', 'About Shorts filtering', 'Cancel'], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) promptForLink();
        else if (index === 1) setNoticeVisible(true);
      },
    );
  }, [promptForLink]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.top}>
        <View style={styles.progressTrack} accessibilityElementsHidden importantForAccessibility="no">
          {loading ? <View style={[styles.progressFill, { width: `${Math.max(progress, 0.08) * 100}%` }]} /> : null}
        </View>
      </SafeAreaView>

      <View style={styles.content}>
        {/* react-native-webview declares `WebView<P = undefined>` with props `WebViewProps & P`, which
            TypeScript 6 reduces to `never`; an explicit `object` keeps the real prop types. */}
        <WebView<object>
          key={session.key}
          ref={webViewRef}
          source={{ uri: session.uri }}
          style={styles.webView}
          originWhitelist={ROUTE_ALL_URLS_THROUGH_POLICY}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={onOpenWindow}
          // Shorts blocker: a WKUserScript at document start, main frame only. Its first statement
          // returns unless the page is youtube.com / www.youtube.com / m.youtube.com.
          injectedJavaScriptBeforeContentLoaded={BLOCKER_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          // YouTube does not work without JavaScript.
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures
          // Link previews would load pages outside the navigation policy.
          allowsLinkPreview={false}
          // No camera or microphone for web pages; the app declares no device permissions.
          mediaCapturePermissionGrantType="deny"
          fraudulentWebsiteWarningEnabled
          webviewDebuggingEnabled={__DEV__}
          renderLoading={renderNothing}
          onLoadStart={onLoadStart}
          onLoadProgress={onLoadProgress}
          onLoad={onLoad}
          onLoadEnd={onLoadEnd}
          onError={onError}
          onHttpError={onHttpError}
          onContentProcessDidTerminate={onContentProcessDidTerminate}
          onNavigationStateChange={onNavigationStateChange}
        />
        {httpFailure && !failure ? (
          <HttpErrorBanner status={httpFailure.status} onReload={reload} onDismiss={() => setHttpFailure(null)} />
        ) : null}
        {failure ? <ErrorPanel failure={failure} onRetry={retry} onHome={goHome} /> : null}
      </View>

      <Toolbar
        canGoBack={history.canGoBack}
        canGoForward={history.canGoForward}
        loading={loading}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onHome={goHome}
        onMore={showMoreMenu}
      />

      <FirstRunNotice visible={noticeVisible} onClose={closeNotice} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.chrome,
  },
  top: {
    backgroundColor: colors.chrome,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.chrome,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.accent,
  },
  content: {
    flex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.chrome,
  },
});
