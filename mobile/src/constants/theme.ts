/**
 * App colors for light and dark mode. `accent` is the FireFirst engine red; the web app uses the same palette.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  // Modern firehouse: engine red and gold leaf on warm, paper-white surfaces (charcoal in dark mode).
  light: {
    text: '#1B1A19',
    background: '#FBF9F6',
    backgroundElement: '#F3EFE9',
    backgroundSelected: '#E7E1D7',
    textSecondary: '#645D54',
    border: '#D9D1C4',
    accent: '#B3161D',
    accentText: '#ffffff',
    success: '#2E7D32',
    warning: '#A86B00',
    danger: '#B3161D',
  },
  dark: {
    text: '#F3EFE8',
    background: '#121110',
    backgroundElement: '#22201D',
    backgroundSelected: '#2F2C28',
    textSecondary: '#B4AC9F',
    border: '#3D3933',
    accent: '#E0453B',
    accentText: '#ffffff',
    success: '#4CC38A',
    warning: '#F5A524',
    danger: '#FF6B6B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
