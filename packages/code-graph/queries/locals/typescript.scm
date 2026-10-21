; Names a TypeScript file binds locally, written for @mercurian/code-graph:
; variables, destructured names, and parameters. A call to one is a call to
; something the code wrote, so it is never a frontier.

(variable_declarator
  name: (identifier) @local)

(array_pattern
  (identifier) @local)

(object_pattern
  (shorthand_property_identifier_pattern) @local)

(pair_pattern
  value: (identifier) @local)

(assignment_pattern
  left: [
    (identifier)
    (shorthand_property_identifier_pattern)
  ] @local)

(object_assignment_pattern
  left: (shorthand_property_identifier_pattern) @local)

(rest_pattern
  (identifier) @local)

(required_parameter
  pattern: (identifier) @local)

(optional_parameter
  pattern: (identifier) @local)

(arrow_function
  parameter: (identifier) @local)

(catch_clause
  parameter: (identifier) @local)

(for_in_statement
  left: (identifier) @local)
