// One path segment, percent-decoded. A plus sign is a plus sign in a path.
// Throws URIError on a broken escape.
export function decodeSegment(segment) {
  return decodeURIComponent(segment);
}
