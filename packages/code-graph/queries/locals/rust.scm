; Names a Rust file binds locally, written for @mercurian/code-graph:
; `let` bindings, parameters, and closure parameters.

(let_declaration
  pattern: (identifier) @local)

(parameter
  pattern: (identifier) @local)

(closure_parameters
  (identifier) @local)
