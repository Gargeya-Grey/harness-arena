// Hidden probes for ladder-agent-slugify-bug; expected.json holds the answers.
const slug = async (load, text) => (await load('src/slugify.mjs')).slugify(text);

export const probes = [
  { name: 'two words', run: ({ load }) => slug(load, 'Hello World') },
  { name: 'punctuation and spaces', run: ({ load }) => slug(load, '  Hello,   World!  ') },
  { name: 'digits', run: ({ load }) => slug(load, 'Top 10 Tips') },
  { name: 'runs of dashes collapse', run: ({ load }) => slug(load, 'a -- b') },
  { name: 'only separators gives empty', run: ({ load }) => slug(load, '--- !!!') },
  { name: 'underscores and dots separate', run: ({ load }) => slug(load, 'file_name.v2') },
];
