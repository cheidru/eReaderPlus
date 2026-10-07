import { Capacitor } from '@capacitor/core';
import { createCapacitorPlatform } from './capacitor';
import { createElectronPlatform } from './electron';
import type { Platform } from './platform';

export function detectPlatform(): Platform | null {
  if (window.ereaderNative) return createElectronPlatform(window.ereaderNative);
  if (Capacitor.getPlatform() === 'android') return createCapacitorPlatform();
  return null;
}

export * from './platform';
