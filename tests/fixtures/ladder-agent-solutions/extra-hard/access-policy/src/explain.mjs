const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// `matched` lists { id, effect } of the statements that apply, in the order they were added.
// Any deny wins. The answer names every statement of the winning effect, sorted by id.
export function decide(matched) {
  const ids = (effect) => matched.filter((item) => item.effect === effect).map((item) => item.id).sort(byText);
  const denies = ids('deny');
  if (denies.length) return { allowed: false, decision: 'deny', by: denies };
  const allows = ids('allow');
  if (allows.length) return { allowed: true, decision: 'allow', by: allows };
  return { allowed: false, decision: 'default', by: [] };
}
