/**
 * Resize an image to at most 1200px on the long edge, re-encode as JPEG at
 * quality 0.8, and return the compressed base64 — turning multi-MB camera
 * photos into ~150-400KB uploads.
 *
 * Uses expo-image-manipulator, which is a NATIVE module: it only actually
 * runs once the dev client is rebuilt to include it (same as when
 * react-native-svg was added). Until then — and on any manipulation failure
 * (unsupported format, etc.) — this falls back to the original picker base64,
 * so uploads never break; compression simply starts engaging after the
 * rebuild. The require() is lazy (inside the try) so a missing native module
 * can't crash the bundle at import time on the current build.
 */
export async function compressToBase64(uri: string, fallbackBase64: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: SaveFormat.JPEG, base64: true },
    );
    return result.base64 ?? fallbackBase64;
  } catch (err) {
    console.warn('Image compression unavailable, uploading original:', err);
    return fallbackBase64;
  }
}
