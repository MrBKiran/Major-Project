/**
 * On Windows, points the Android build at CMake 3.31 or newer.
 *
 * Reanimated's object paths pass 260 characters, and the ninja bundled with the
 * default CMake 3.22 fails on them even with Windows long paths enabled; the
 * ninja in 3.31 (1.12) does not. Gradle reads the CMake to use from
 * android/local.properties, which prebuild generates — so it is written here
 * rather than by hand. Elsewhere this does nothing.
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const { mergeProperties, pickCmake } = require('./windows-cmake');

function sdkRoot() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
  return null;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withWindowsCmake = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      if (process.platform !== 'win32') return cfg;
      const sdk = sdkRoot();
      const cmakeRoot = sdk && path.join(sdk, 'cmake');
      const versions = cmakeRoot && fs.existsSync(cmakeRoot) ? fs.readdirSync(cmakeRoot) : [];
      const cmake = pickCmake(versions);
      if (!sdk || !cmake) {
        console.warn(
          '[with-windows-cmake] No CMake 3.31+ in the Android SDK. Reanimated\'s object paths pass 260 ' +
          'characters and the ninja in CMake 3.22 fails on them; install CMake 3.31+ with the SDK manager.');
        return cfg;
      }
      const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      fs.writeFileSync(file, mergeProperties(before, {
        'sdk.dir': sdk,
        'cmake.dir': path.join(cmakeRoot, cmake),
      }));
      return cfg;
    },
  ]);

module.exports = withWindowsCmake;
