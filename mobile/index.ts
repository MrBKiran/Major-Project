/**
 * The app's entry file (package.json "main"). The car's screen starts first, because Android Auto can
 * start this JavaScript with no screen on the phone at all (src/car/entry.ts); then the router, which
 * is what the default entry did on its own.
 */
import './src/car/entry';
import 'expo-router/entry';
