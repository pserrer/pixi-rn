// ── Texture loading for the Pixi renderer ────────────────────────────────────
// Pixi's own Assets loader needs DOM image decoding (HTMLImageElement /
// createImageBitmap), which React Native doesn't have. Instead each sheet is
// an expo-asset resolved to a local file and uploaded through expo-gl's
// texImage2D extension, which accepts an Expo Asset directly (the same
// mechanism expo-three uses). ExpoAssetSource wraps that as a Pixi texture
// source, so context loss and re-upload on a new GL context work as normal.
//
// Frames within a sheet are `Texture` sub-rects on the shared TextureSource —
// one GL upload + one bind per sheet, batched by pixi's sprite batcher into
// one draw per layer, mirroring what Skia's <Atlas> did.

import './adapter';
import {
  BufferImageSource,
  Rectangle,
  Texture,
  TextureSource,
  extensions,
  type GlTexture,
  type GlRenderingContext,
} from 'pixi.js';
import { Asset } from 'expo-asset';
import { pixiRnFail, pixiRnTrace } from './log';

// Uploads a bundled image via expo-gl's texImage2D(…, asset) overload. The
// pixel data never round-trips through JS.
export class ExpoAssetSource extends TextureSource<Asset> {
  uploadMethodId = 'expo-asset';

  constructor(asset: Asset) {
    super({
      resource: asset,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha',
    });
  }
}

type ExpoAssetTextureUploader = {
  extension: { type: 'texture-uploader-webgl'; name: 'expo-asset' };
  id: 'expo-asset';
  upload: (
    source: ExpoAssetSource,
    glTexture: GlTexture,
    gl: GlRenderingContext,
    version: number,
    targetOverride?: number,
  ) => void;
};

const expoAssetUploader: ExpoAssetTextureUploader = {
  extension: { type: 'texture-uploader-webgl', name: 'expo-asset' },
  id: 'expo-asset',
  upload(
    source: ExpoAssetSource,
    glTexture: GlTexture,
    gl: GlRenderingContext,
    _version: number,
    targetOverride?: number,
  ) {
    const target = targetOverride ?? glTexture.target;
    gl.texImage2D(
      glTexture.target,
      0,
      glTexture.internalFormat,
      glTexture.format,
      glTexture.type,
      source.resource as unknown as TexImageSource,
    );
    glTexture.width = source.pixelWidth;
    glTexture.height = source.pixelHeight;
  },
};

extensions.add(expoAssetUploader);

// NB: expo-gl's native loadImage SILENTLY returns a null image unless
// asset.localUri is a file:// path (EXGLImageUtils.cpp) — a 0×0 upload =
// incomplete texture = samples opaque black. Verified good on-device for
// bundled + OTA assets (PR #132's asset diagnostics).
//
// `label` is deliberately a human-readable asset name rather than relying on
// Metro's opaque numeric module ID. A native asset-loader crash cannot be
// caught by JS, so the last persisted `load-sheet:start` is the only useful
// clue after the app restarts.
export async function loadSheet(label: string, mod: number): Promise<Texture> {
  pixiRnTrace('load-sheet:start', { label, mod });
  try {
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    const texture = new Texture({ source: new ExpoAssetSource(asset) });
    pixiRnTrace('load-sheet:ok', { label, mod, width: asset.width, height: asset.height });
    return texture;
  } catch (error) {
    pixiRnFail(`load-sheet:${label}`, error);
    throw error;
  }
}

// 1×1 white texture for solid tinted rects (dims, sky fills, hole shadow).
// NOT Texture.WHITE: that lazily rasterizes a 2D canvas, which doesn't exist
// here (see adapter.ts).
export function makeWhiteTexture(): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([255, 255, 255, 255]),
      width: 1,
      height: 1,
      scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha',
    }),
  });
}

/** Sub-rect of a sheet, cached by rect OBJECT IDENTITY — pass shared instances,
 *  never fresh literals, or every call leaks a Texture. */
export function makeSlicer(): (base: Texture, src: { x: number; y: number; w: number; h: number }) => Texture {
  const cache = new Map<Texture, Map<object, Texture>>();
  return (base, src) => {
    let inner = cache.get(base);
    if (!inner) {
      inner = new Map();
      cache.set(base, inner);
    }
    let tex = inner.get(src);
    if (!tex) {
      tex = new Texture({ source: base.source, frame: new Rectangle(src.x, src.y, src.w, src.h) });
      inner.set(src, tex);
    }
    return tex;
  };
}
