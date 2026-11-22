/**
 * Expo reads this on top of app.json.
 *
 * Google sign-in on iOS needs a URL scheme (the iOS OAuth client id, reversed:
 * com.googleusercontent.apps.<id>) for Google's sheet to return to the app, and its config plugin
 * refuses to run without one. There is no iOS client yet, so the plugin is added only when
 * GOOGLE_IOS_URL_SCHEME is set; without it iOS builds still work and the Google button simply
 * does not complete there. Android needs nothing from the plugin (see docs/authentication.md).
 */

module.exports = ({ config }) => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  if (!iosUrlScheme) return config;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['@react-native-google-signin/google-signin', { iosUrlScheme }]],
  };
};
