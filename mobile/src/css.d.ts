// Expo generates expo-env.d.ts (which declares CSS imports) only when the dev
// server runs, so declare it here for a clean `tsc` on a fresh checkout and in CI.
declare module '*.css';
