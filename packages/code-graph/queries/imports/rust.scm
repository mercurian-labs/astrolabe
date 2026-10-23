; Import bindings for Rust `use`, written for @mercurian/code-graph. Captures as
; in typescript.scm; @source is the path before the imported name. One level of
; braces is read; nested groups and `self` in a group bind nothing.

(use_declaration
  argument: (scoped_identifier
    path: (_) @source
    name: (identifier) @name)) @import.named

(use_declaration
  argument: (use_as_clause
    path: (scoped_identifier
      path: (_) @source
      name: (identifier) @name)
    alias: (identifier) @local)) @import.named

(use_declaration
  argument: (scoped_use_list
    path: (_) @source
    list: (use_list
      (identifier) @name))) @import.named

(use_declaration
  argument: (scoped_use_list
    path: (_) @source
    list: (use_list
      (use_as_clause
        path: (identifier) @name
        alias: (identifier) @local)))) @import.named

(use_declaration
  argument: (use_wildcard
    (scoped_identifier) @source)) @import.module
