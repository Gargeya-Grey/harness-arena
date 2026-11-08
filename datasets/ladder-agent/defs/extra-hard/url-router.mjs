export default {
  slug: 'url-router',
  tier: {
    level: 4,
    human_minutes: 60,
    basis: 'Estimate from the size of the work, not a timed solve: about 18 separate faults in 10 of 12 files, roughly 30 minutes to find them by reading and probing the router and 30 to fix and check them.',
  },
  tags: ['bugfix'],
  task: `Our URL router answers wrong in many small ways.
- GET /users/me goes to the /users/:id route although a /users/me route exists. In general the less specific route wins when two routes fit. A typed parameter such as :id<int> loses against a plain :id registered before it, and :id<int> accepts -5 and +5.
- /files/** matches /files with an empty rest.
- /tag/a%2Fb is a 404: the encoded slash splits the segment. %2541 comes out as A, and a + in the path comes out as a space.
- /x/./y and /x/z/../y are not the same as /x/y.
- A path with a broken escape such as /tag/%zz crashes with a URIError.
- In the query string only the last value of a repeated key is kept, a + stays a plus, c=1=2 is cut after the first equal sign, a key like __proto__ is lost, and a broken escape in the query crashes the request.
- With the redirect policy, every path with a trailing slash is redirected, also unknown ones, and the query string is lost.
- HEAD on a GET route is a 405. The allowed methods in a 405 come in registration order and miss HEAD and OPTIONS. GET /users/me is a 405 when only POST /users/me is registered and GET /users/:id covers it.
- A route added with a lowercase method such as 'get' is never found.
- Two routes that differ only in the name of a parameter are both accepted, a name can be used twice in one pattern, and an optional parameter can sit in the middle.
- Mounting a router that has a '/' route under a prefix fails.
- With caseSensitive: false the parameters come out in lower case.

The rules we agreed on:
- Among the routes that fit a path and a method, the most specific wins. Positions are compared from the left. At one position a static segment beats a typed parameter (int before slug), that beats a plain parameter, that beats '*', and '**' is last. If the best branch has no route for the method or does not fit further on, the next one is tried. A route for the method wins over a more specific route that lacks it.
- int is digits only. slug is lower-case letters and digits in groups joined by single dashes. A typed parameter is checked against the decoded value.
- '**' needs one or more segments. params['**'] holds them decoded and joined with '/'.
- The path is cut into segments first. A segment is then percent-decoded once; a plus sign is not a space; an encoded slash stays inside its segment and never splits it. Empty segments are dropped, '.' is dropped, '..' removes the segment before it and cannot climb above the root. A broken escape in the path gives { status: 400 }, also when no route would fit. The query string is not part of the path; the fragment is ignored.
- The query string gives an object without a prototype. A repeated key gives an array of its values in order. A plus is a space. Only the first equal sign splits a pair. A key without an equal sign has the value ''. Empty pairs are skipped. A broken escape in the query leaves that text as it is, and never fails the request.
- trailingSlash 'strict': a path with a trailing slash matches nothing (404), the root excepted. 'redirect': a trailing slash gives { status: 308, location } only when the same path without the slash would give status 200; location is the cleaned path with its segments still encoded, followed by ? and the original query string when there is one. In any other case the answer is the one for the path without the slash. 'ignore' (the default) does not care about the slash.
- Methods are not case-sensitive in add() and in match(); routes() lists them in upper case. HEAD uses a HEAD route when a route that fits has one, otherwise the GET route. A method with no route on a path that fits gives { status: 405, allow }, and OPTIONS gives { status: 204, allow } unless a route handles OPTIONS itself. allow holds every method of every route that fits the path, plus HEAD when GET is there and always OPTIONS, in alphabetical order.
- Two routes with the same method are the same route when their shapes are equal: the same static texts, parameters with the same type (names do not matter), and the same '*' and '**'. ':x?' counts as both the shorter and the longer pattern. add() throws a PatternError for such a duplicate. A parameter name may be used once in a pattern, and an optional parameter must be the last segment. A parameter that is not given leaves its name out of params.
- mount(prefix, router) adds every route of the other router under the prefix; the prefix may hold parameters and end in a slash, and '/' of the mounted router becomes the prefix itself. A route that is taken is refused as in add().
- With caseSensitive: false the static segments are compared without regard to case and the parameters keep their case.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
