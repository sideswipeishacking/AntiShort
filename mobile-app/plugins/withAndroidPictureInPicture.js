// Expo config plugin: lets the main activity enter Android picture-in-picture.
// - android:supportsPictureInPicture="true"
// - configChanges covering every size change, so entering or leaving picture-in-picture resizes the
//   activity instead of recreating it (a recreated activity would reload the WebView and stop the video).
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const REQUIRED_CONFIG_CHANGES = ['orientation', 'screenLayout', 'screenSize', 'smallestScreenSize'];

function setPictureInPicture(androidManifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  activity.$['android:supportsPictureInPicture'] = 'true';
  const changes = (activity.$['android:configChanges'] || '').split('|').filter(Boolean);
  for (const change of REQUIRED_CONFIG_CHANGES) {
    if (!changes.includes(change)) changes.push(change);
  }
  activity.$['android:configChanges'] = changes.join('|');
  return androidManifest;
}

function withAndroidPictureInPicture(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = setPictureInPicture(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidPictureInPicture;
module.exports.setPictureInPicture = setPictureInPicture;
