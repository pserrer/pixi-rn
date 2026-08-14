# Changelog

All notable changes to `@pixi-rn/haptics` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-08-14

### Added

- Initial release. An Android Expo module that vibrates with
  `AudioAttributes.USAGE_MEDIA`, so game feedback is not silenced by the
  system's haptic-feedback level — which gates every JS-reachable vibration API,
  silently. `pixi-rn/haptics` discovers it by native-module name at runtime, so
  installing the package is the entire integration.
