import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ereaderplus.app',
  appName: 'eReaderPlus',
  webDir: 'dist/web',
  android: {
    // Book content is served by BookWebViewClient from https://<bookId>.ereaderplus.invalid
    allowMixedContent: false,
  },
};

export default config;
