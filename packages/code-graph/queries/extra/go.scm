; What the grammar's tags.scm leaves out, written for @mercurian/code-graph.
; The grammar's own struct and interface patterns carry no @definition capture;
; the extractor reads a type_spec's `type` field to call it a class or an interface.

; A function passed as a value, not called: `http.HandleFunc("/", serve)`.
(argument_list
  (identifier) @name) @reference.value

; Package-level constants.
(source_file
  (const_declaration
    (const_spec
      name: (identifier) @name) @definition.constant))

; Interface methods.
(method_elem
  name: (field_identifier) @name) @definition.method
