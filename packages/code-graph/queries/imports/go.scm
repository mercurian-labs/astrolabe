; Import bindings for Go, written for @mercurian/code-graph. Captures as in
; typescript.scm. An unnamed import binds the path's last segment, which the
; extractor derives; dot and blank imports bind nothing.

(import_spec
  name: (package_identifier) @local
  path: (interpreted_string_literal) @source) @import.namespace

(import_spec
  !name
  path: (interpreted_string_literal) @source) @import.namespace

(import_spec
  name: [
    (dot)
    (blank_identifier)
  ]
  path: (interpreted_string_literal) @source) @import.module
