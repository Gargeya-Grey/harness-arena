// Delimiter runs of * and _ live in a doubly linked list headed by a sentinel node. Matching follows SPEC.md 5.3.
export function newStack() {
  return { head: true, prev: null, next: null };
}

export function pushDelimiter(tail, node) {
  node.prev = tail;
  node.next = null;
  tail.next = node;
  return node;
}

function unlink(node) {
  node.prev.next = node.next;
  if (node.next) node.next.prev = node.prev;
}

/** Matches every closer after `bottom`. Matched characters turn into tags on the two nodes. */
export function processEmphasis(bottom) {
  const lowest = new Map();
  let closer = bottom.next;
  while (closer) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const key = `${closer.ch}${closer.canOpen ? 'o' : 'c'}${closer.orig % 3}`;
    const floor = lowest.get(key) || bottom;
    let opener = closer.prev;
    let found = false;
    while (opener && opener !== bottom && opener !== floor) {
      const odd = false;
      if (opener.ch === closer.ch && opener.canOpen && !odd) {
        found = true;
        break;
      }
      opener = opener.prev;
    }
    if (found) {
      const use = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
      opener.count -= use;
      closer.count -= use;
      opener.open.unshift(use === 2 ? '<strong>' : '<em>');
      closer.close.push(use === 2 ? '</strong>' : '</em>');
      opener.next = closer;
      closer.prev = opener;
      if (opener.count === 0) unlink(opener);
      if (closer.count === 0) {
        const after = closer.next;
        unlink(closer);
        closer = after;
      }
    } else {
      lowest.set(key, closer.prev);
      const after = closer.next;
      if (!closer.canOpen) unlink(closer);
      closer = after;
    }
  }
}
