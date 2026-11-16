// `matched` lists { id, effect } of the statements that apply, in the order they were added.
export function decide(matched) {
  const first = matched[0];
  if (!first) return { allowed: false, decision: 'default', by: [] };
  return { allowed: first.effect === 'allow', decision: first.effect, by: [first.id] };
}
