import { defineConfig } from 'tsdown';

export default defineConfig({
  // Two entry points, so `audio` is opt-in. The main barrel must NOT reach
  // `expo-audio`: a bundler resolves imports statically, so re-exporting audio
  // from it would force every consumer to install the native package merely to
  // bundle anything at all. Keyed object (not an array) — both files are named
  // index.ts, so an array would collide on the output name.
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
