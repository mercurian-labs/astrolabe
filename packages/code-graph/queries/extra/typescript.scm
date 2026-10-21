; What the grammar's tags.scm (typescript + javascript) leaves out, written for
; @mercurian/code-graph. Same capture vocabulary: @name plus one role capture.

; Type aliases and enums.
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

(enum_declaration
  name: (identifier) @name) @definition.enum

; Constants at module scope, exported or not. A declarator whose value is a
; function is also tagged a function; the extractor keeps the function.
(program
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator
        name: (identifier) @name) @definition.constant)))

; Heritage: `class A extends B implements C`, `interface I extends J`.
(extends_clause
  value: [
    (identifier) @name
    (member_expression
      property: (property_identifier) @name)
  ]) @reference.extends

(implements_clause
  [
    (type_identifier) @name
    (generic_type
      name: [
        (type_identifier) @name
        (nested_type_identifier
          name: (type_identifier) @name)
      ])
    (nested_type_identifier
      name: (type_identifier) @name)
  ]) @reference.implementation

(extends_type_clause
  type: [
    (type_identifier) @name
    (generic_type
      name: [
        (type_identifier) @name
        (nested_type_identifier
          name: (type_identifier) @name)
      ])
    (nested_type_identifier
      name: (type_identifier) @name)
  ]) @reference.extends

; Type references inside generics, which `type_annotation` alone misses.
(generic_type
  name: (type_identifier) @name) @reference.type

; A function or class passed as a value, not called: `items.map(render)`,
; `{ onFrame }`, `{ key: handler }`. Resolution keeps only callables and classes.
(arguments
  (identifier) @name) @reference.value

(object
  (shorthand_property_identifier) @name) @reference.value

(pair
  value: (identifier) @name) @reference.value
