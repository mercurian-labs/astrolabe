; What the grammar's tags.scm leaves out, written for @mercurian/code-graph.

; A function or class passed as a value, not called: `sorted(items, key=rank)`.
(argument_list
  (identifier) @name) @reference.value

(keyword_argument
  value: (identifier) @name) @reference.value

; Base classes: `class A(B, m.C)`. Keyword arguments (metaclass=) are skipped.
(class_definition
  superclasses: (argument_list
    [
      (identifier) @name
      (attribute
        attribute: (identifier) @name)
    ])) @reference.extends
