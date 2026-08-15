# Changelog

All notable changes to `@pixi-rn/sound` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-14

### Added

- Initial release. `@pixi/sound` on React Native, backed by
  `react-native-audio-api`: the Web Audio globals it expects, installed in the
  order it needs them, and the library re-exported unchanged.

- The import-order guarantee. `@pixi/sound` reads `document` at module scope, so
  importing it directly on Hermes throws `ReferenceError: document is not
defined` before any user code runs. Importing from this package installs the
  shim first.

- A unity-gain `GainNode` standing in for `createDynamicsCompressor()`, which
  `@pixi/sound`'s `WebAudioContext` constructor calls unconditionally and
  `react-native-audio-api` does not implement. Without it the context cannot be
  constructed at all. The cost is no master limiting — see the README.
