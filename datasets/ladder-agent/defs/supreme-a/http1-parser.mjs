export default {
  slug: 'http1-parser',
  tier: {
    level: 5,
    human_minutes: 240,
    basis: 'Reference is about 280 lines in 3 modules (request line and target, field lines and section checks, the byte-wise state machine); an experienced engineer needs about 4 h to turn the rules into a parser whose result does not depend on how the bytes are cut, with exact limit order and error codes, and to test the corner cases.',
  },
  tags: ['build', 'spec'],
  task: 'Build the streaming HTTP/1.1 request parser that SPEC.md describes. RequestParser.push(bytes) takes the bytes in pieces of any size, down to one byte, and returns the completed messages, the first error and the number of ignored bytes; the result must not depend on how the input was cut. The stubs in src/target.mjs, src/headers.mjs and src/parser.mjs throw "not implemented"; src/errors.mjs, src/limits.mjs, src/chars.mjs and src/index.mjs are finished. The error codes are bad-newline, bad-request-line, bad-version, bad-target, uri-too-long, bad-header, headers-too-large, bad-host, bad-length, unsupported-te, body-too-large, bad-chunk, bad-trailer and incomplete. SPEC.md states every rule the hidden check tests: the request line and target forms, the field and chunk syntax (including the field names content-length, transfer-encoding and host that a trailer may not use), the order in which limits and checks fire, trailers, Connection and the ignored bytes, and the sticky error. Work must stay linear in the input size. The files in test/ must pass and must not be edited.',
};
