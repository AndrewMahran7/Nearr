// Entry point for the iOS Share Extension bundle.
//
// metro.config.js registers `share.js` as a recognized source extension,
// so this file is selected as the bundle entry when Metro builds the
// share-extension target. The first arg to registerComponent MUST be
// "shareExtension" (required by expo-share-extension).

import { AppRegistry } from 'react-native';

import ShareExtension from './ShareExtension';

AppRegistry.registerComponent('shareExtension', () => ShareExtension);
