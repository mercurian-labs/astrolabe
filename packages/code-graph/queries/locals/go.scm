; Names a Go file binds locally, written for @mercurian/code-graph:
; parameters, `var`, and `:=`.

(parameter_declaration
  name: (identifier) @local)

(var_spec
  name: (identifier) @local)

(short_var_declaration
  left: (expression_list
    (identifier) @local))
