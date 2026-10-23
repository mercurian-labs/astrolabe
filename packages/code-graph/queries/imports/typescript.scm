; Import bindings for TypeScript and TSX, written for @mercurian/code-graph.
; @source is the module specifier, @name the imported name, @local the name it
; binds in the file when it differs. The role capture says what is bound:
;   @import.named     a name from the module
;   @import.default   the module's default export, under @local
;   @import.namespace the module itself, under @local
;   @import.module    nothing, only the dependency (side-effect imports, re-exports)
; @export.default names what this file exports as default, @export.named a name
; an export clause exports. `export` on a declaration is read from the syntax tree.

; A default import binds @local to whatever the module exports as default.
(import_statement
  (import_clause
    (identifier) @local)
  source: (string
    (string_fragment) @source)) @import.default

(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @name
        !alias)))
  source: (string
    (string_fragment) @source)) @import.named

(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @name
        alias: (identifier) @local)))
  source: (string
    (string_fragment) @source)) @import.named

(import_statement
  (import_clause
    (namespace_import
      (identifier) @local))
  source: (string
    (string_fragment) @source)) @import.namespace

; Every import is a dependency, side-effect imports included.
(import_statement
  source: (string
    (string_fragment) @source)) @import.module

(export_statement
  source: (string
    (string_fragment) @source)) @import.module

; `export default function actual`, `export default class Widget`, `export default name`.
(export_statement
  "default"
  declaration: [
    (function_declaration
      name: (identifier) @name)
    (generator_function_declaration
      name: (identifier) @name)
    (class_declaration
      name: (type_identifier) @name)
    (abstract_class_declaration
      name: (type_identifier) @name)
  ]) @export.default

(export_statement
  "default"
  value: (identifier) @name) @export.default

; `export { a, b as c }` of the file's own names (a clause with a source re-exports).
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @name))
  !source) @export.named
