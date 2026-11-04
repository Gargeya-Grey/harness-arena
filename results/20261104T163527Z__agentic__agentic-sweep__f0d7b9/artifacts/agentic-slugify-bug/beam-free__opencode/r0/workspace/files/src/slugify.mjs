// Turns a title into a URL slug.
export function slugify(text) {
  return text.toLowerCase().replace(/ /g, '-');
}
