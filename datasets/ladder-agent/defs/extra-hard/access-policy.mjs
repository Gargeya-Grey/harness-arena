export default {
  slug: 'access-policy',
  tier: {
    level: 4,
    human_minutes: 55,
    basis: 'Estimate from the size of the work, not a timed solve: about 15 separate faults in 9 of 13 files, roughly 25 minutes to find them by reading and probing the evaluator and 30 to fix and check them.',
  },
  tags: ['bugfix', 'security'],
  task: `Our access-policy evaluator lets people do things they should not, and refuses other things.
- A user who holds a role with an allow statement and a role with a deny statement for the same request is allowed when the allow statement was added first. explain() names only one statement, and a statement for two roles is named twice.
- A role cycle that runs through other roles (a, then b, then c, then a again) is accepted.
- After a role gets other parents, or a group gets other roles, users keep their old permissions until their own record is set again.
- A user who has direct roles loses the roles of their groups.
- A statement for /projects/4 also covers /projects/42, and /a/**/z does not cover /a/z.
- With a statement for /homes/\${user.id}, a user whose id is * can read every home folder, and an id with a slash in it reaches folders it should not.
- A statement with notActions acts as if the actions were a plain list.
- A deny statement with a condition on an attribute that the user does not have has no effect. A between condition still holds at its end time.
- Adding a statement with an id that exists silently adds a second one, and a removed statement keeps applying.
- A request for a user that does not exist crashes with a TypeError.

The rules we agreed on:
- Nothing is allowed unless a statement allows it. Any applying deny statement beats every applying allow statement. explain() gives { allowed, decision, by }: decision is 'deny', 'allow' or 'default', and by holds the ids of every applying statement of the winning effect, once each, sorted by id (empty for 'default').
- A role inherits the statements of its parents and of their parents, and so on, deny statements included. A role cannot inherit from itself, directly or through other roles: defineRole() throws CycleError and the roles stay as they were. A user's roles are their own roles together with the roles of their groups, with everything those inherit. Every change to roles, groups, users and statements counts from the next request.
- A statement for the role '*' applies to every known user. A user that is not known is denied with decision 'default'; it is not an error. An action that is not 'namespace:name', or a resource that is not an absolute path, is a PolicyError even then.
- A resource path is cut into segments; empty segments are dropped, so '/a//b/' is '/a/b'. A '.' or '..' segment is a PolicyError, in a request and in a pattern. A pattern covers the resource it names and everything below it, compared segment by segment ('/projects/4' does not cover '/projects/42'), unless the statement has exact: true. In a pattern, '*' is exactly one segment and '**' is zero or more segments. The segment \${user.id}, as a whole segment, means exactly the id of the user who asks, as one literal segment, whatever characters that id holds (an id with a slash matches no segment). \${ inside a longer segment is a PolicyError.
- Actions: '*' matches every action, 'namespace:*' matches every action of that namespace, anything else matches only itself. A statement with notActions applies to every action except those listed.
- Conditions of a statement must all hold. owner: true holds when context.owner is the id of the user. mfa: true holds when context.mfa is true. attrs holds when each listed attribute of the user is strictly equal to the given value. between: [from, to] holds from 'from' up to, but not including, 'to' of the policy clock. If an attribute that a condition needs is missing (no context.owner, no context.mfa, no such user attribute), the condition cannot be told: in a deny statement it counts as holding, in an allow statement as not holding. A condition that fails for sure settles the statement, whatever else is missing.
- A statement id must be unique (PolicyError); removeStatement(id) removes the statement at once and answers true, or false when there is none, and the id is free again.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
