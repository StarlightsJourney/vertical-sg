// Wikimedia Commons "original file" URLs (upload.wikimedia.org/wikipedia/commons/X/XX/Name.jpg)
// can be several MB — some of the ones used in this app are 8-14MB, which is
// almost certainly why club-logo/cover images were failing to render on a
// phone (silently, since <Image> has no built-in timeout indicator): too
// slow/large to actually finish loading. This rewrites such a URL to
// Commons' own thumbnail-resizing endpoint, which is the standard way to
// embed a Commons image at a sane size. Non-Commons URLs pass through
// unchanged.
// Wikimedia's thumbnail endpoint only serves a fixed whitelist of widths
// (anything else 400s) — snap the requested width up to the nearest one.
const VALID_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
function snapWidth(width: number): number {
  return VALID_WIDTHS.find((w) => w >= width) ?? VALID_WIDTHS[VALID_WIDTHS.length - 1];
}

export function wikimediaThumb(url: string, width = 500): string {
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/i);
  if (!m) return url;
  const [, base, d1, d2, filename] = m;
  return `${base}/thumb/${d1}/${d2}/${filename}/${snapWidth(width)}px-${filename}`;
}
