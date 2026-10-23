; Names a Python file binds locally, written for @mercurian/code-graph:
; parameters, assignment targets, loop and `with` targets.

(parameters
  (identifier) @local)

(default_parameter
  name: (identifier) @local)

(typed_parameter
  (identifier) @local)

(typed_default_parameter
  name: (identifier) @local)

(lambda_parameters
  (identifier) @local)

(assignment
  left: (identifier) @local)

(pattern_list
  (identifier) @local)

(tuple_pattern
  (identifier) @local)

(for_statement
  left: (identifier) @local)

(as_pattern_target
  (identifier) @local)
