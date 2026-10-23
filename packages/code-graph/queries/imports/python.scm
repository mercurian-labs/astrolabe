; Import bindings for Python, written for @mercurian/code-graph. Captures as in
; typescript.scm. `import a.b` binds the dotted name itself (and, in the
; extractor, its first segment); relative module names keep their dots.

(import_statement
  name: (dotted_name) @source) @import.namespace

(import_statement
  name: (aliased_import
    name: (dotted_name) @source
    alias: (identifier) @local)) @import.namespace

(import_from_statement
  module_name: (_) @source
  name: (dotted_name) @name) @import.named

(import_from_statement
  module_name: (_) @source
  name: (aliased_import
    name: (dotted_name) @name
    alias: (identifier) @local)) @import.named

(import_from_statement
  module_name: (_) @source
  (wildcard_import)) @import.module

; `__all__ = ["a", "b"]` (or a tuple) names what the module exports.
(module
  (expression_statement
    (assignment
      left: (identifier) @all
      right: [
        (list
          (string
            (string_content) @name))
        (tuple
          (string
            (string_content) @name))
      ]))
  (#eq? @all "__all__")) @export.named
