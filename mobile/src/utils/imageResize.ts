import ImageResizer from '@bam.tech/react-native-image-resizer';

/**
 * Resize an image URI to at most 1200px on the long edge, JPEG quality 80.
 * Falls back to the original URI if resizing fails for any reason (e.g. an
 * already-small image, or an unsupported format) so uploads never hard-fail
 * just because the resize step had trouble.
 */
export async function resizeImage(uri: string): Promise<string> {
  try {
    const result = await ImageResizer.createResizedImage(uri, 1200, 1200, 'JPEG', 80);
    return result.uri;
  } catch (err) {
    console.warn('Image resize failed, uploading original:', err);
    return uri;
  }
}
