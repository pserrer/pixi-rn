package net.pixirn.mediavibration

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Vibration on the MEDIA usage channel — the companion native half of
 * `pixi-rn/haptics`.
 *
 * Every JS-reachable way to vibrate an Android phone is silenced by the
 * system's *haptic feedback* level, which is a setting about UI touches:
 *
 *  - `expo-haptics`' cross-platform cues call `Vibrator.vibrate(effect)` with no
 *    attributes.
 *  - React Native's `Vibration.vibrate` does the same, with DEFAULT_AMPLITUDE.
 *    Without attributes the platform treats the effect as USAGE_UNKNOWN and
 *    scales it by the touch-feedback intensity — at 0, to nothing.
 *  - `expo-haptics`' `performAndroidHapticsAsync` routes through
 *    `View.performHapticFeedback`, which is gated on the same setting and
 *    reports its refusal through a return value expo-haptics discards.
 *
 * Verified on a device with that level at 0: all three are inaudible and none
 * reports anything wrong.
 *
 * A game's collision feedback is not UI touch feedback, and Android agrees —
 * its settings screen carries an independent media-vibration level. Attaching
 * USAGE_MEDIA puts the effect on that channel instead.
 *
 * ⚠️ Installing this package lets an app vibrate while the user has touch
 * feedback switched off. That is the point of it, and it is only legitimate if
 * the app gives the player their own vibration toggle and honours it on every
 * call — which `pixi-rn/haptics` enforces by taking that flag as the first
 * argument of every function. Do not install this otherwise.
 *
 * `AudioAttributes` rather than `VibrationAttributes`: the latter arrived in API
 * 30 and its MEDIA usage later still, while the `vibrate(effect, attributes)`
 * overload taking AudioAttributes works from API 21 and is the long-standing
 * way games ask for a non-touch vibration.
 */
class PixiRnMediaVibrationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val vibrator: Vibrator
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  // USAGE_MEDIA + CONTENT_TYPE_SONIFICATION: "a sound accompanying an action",
  // which is exactly what a collision buzz is.
  private val mediaAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
    .build()

  override fun definition() = ModuleDefinition {
    Name("PixiRnMediaVibration")

    /** True when this device actually has a vibrator to drive. */
    Function("isAvailable") {
      vibrator.hasVibrator()
    }

    /** One pulse of `durationMs` at `amplitude` (1..255, full by default). */
    Function("vibrate") { durationMs: Int, amplitude: Int ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val amp = amplitude.coerceIn(1, 255)
        @Suppress("DEPRECATION")
        vibrator.vibrate(VibrationEffect.createOneShot(durationMs.toLong(), amp), mediaAttributes)
      } else {
        // VibrationEffect is API 26, and minSdk here is 24. The legacy
        // overload takes the same AudioAttributes from API 21, so the media
        // channel — the whole point of this module — still applies; only
        // amplitude control is unavailable, and the motor runs at full.
        @Suppress("DEPRECATION")
        vibrator.vibrate(durationMs.toLong(), mediaAttributes)
      }
    }

    /** A [wait, buzz, wait, buzz, …] waveform, in ms, at full amplitude. */
    Function("vibratePattern") { pattern: List<Int> ->
      val timings = pattern.map { it.toLong() }.toLongArray()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        // Alternating off/on, starting with off — the same convention as
        // Vibrator's own legacy pattern API.
        val amplitudes = IntArray(timings.size) { if (it % 2 == 0) 0 else 255 }
        @Suppress("DEPRECATION")
        vibrator.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1), mediaAttributes)
      } else {
        // Same off/on convention, which is where that convention came from.
        @Suppress("DEPRECATION")
        vibrator.vibrate(timings, -1, mediaAttributes)
      }
    }

    Function("cancel") {
      vibrator.cancel()
    }
  }
}
