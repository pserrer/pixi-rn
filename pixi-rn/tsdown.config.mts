import { defineConfig } from 'tsdown';

export default defineConfig({
  // One entry per NATIVE-CAPABILITY module, plus the main barrel. Anything that
  // touches a native capability lives behind its own subpath (`pixi-rn/audio`,
  // `pixi-rn/haptics`) so the dependency follows the feature: a bundler resolves
  // imports statically, so a root barrel reaching `expo-audio` would force every
  // consumer to install it merely to bundle anything at all. Keyed object (not
  // an array) — every entry file is named index.ts, so an array would collide on
  // the output name.
  entry: {
    index: 'src/index.ts',
    audio: 'src/audio/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  sourcemap: true,
});
