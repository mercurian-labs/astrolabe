; What the grammar's tags.scm leaves out, written for @mercurian/code-graph.

; A function passed as a value, not called: `items.map(render)`.
(arguments
  (identifier) @name) @reference.value

; Constants and statics.
(const_item
  name: (identifier) @name) @definition.constant

(static_item
  name: (identifier) @name) @definition.constant

; Trait method declarations without a body.
(function_signature_item
  name: (identifier) @name) @definition.method

; Path calls: `Type::new()`, `module::f()`.
(call_expression
  function: (scoped_identifier
    name: (identifier) @name)) @reference.call

; Generic and path-qualified traits: `impl Into<T> for S`, `impl fmt::Display for S`.
(impl_item
  trait: [
    (generic_type
      type: [
        (type_identifier) @name
        (scoped_type_identifier
          name: (type_identifier) @name)
      ])
    (scoped_type_identifier
      name: (type_identifier) @name)
  ]) @reference.implementation

; Supertraits: `trait T: U + V::W`.
(trait_item
  bounds: (trait_bounds
    [
      (type_identifier) @name
      (scoped_type_identifier
        name: (type_identifier) @name)
      (generic_type
        type: (type_identifier) @name)
    ])) @reference.extends
