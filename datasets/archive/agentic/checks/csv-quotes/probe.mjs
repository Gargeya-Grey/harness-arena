// Hidden probes for agentic-csv-quotes; expected.json holds the answers.
const parse = async (load, text) => (await load('src/csv.mjs')).parseCsv(text);

export const probes = [
  { name: 'plain rows', run: ({ load }) => parse(load, 'a,b\n1,2') },
  { name: 'quoted comma', run: ({ load }) => parse(load, '"x,y",z') },
  { name: 'doubled quote', run: ({ load }) => parse(load, '"he said ""hi""",1') },
  { name: 'CRLF and a final newline', run: ({ load }) => parse(load, 'a,b\r\n1,2\r\n') },
  { name: 'empty fields', run: ({ load }) => parse(load, 'a,,b') },
  { name: 'newline inside quotes', run: ({ load }) => parse(load, '"line1\nline2",x') },
];
