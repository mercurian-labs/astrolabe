; JSX, which only the TSX grammar parses; written for @mercurian/code-graph.

; Rendering a component calls it: `<Graph />`, `<Panel.Body>`. Lowercase names
; are host elements (`div`), not code.
(jsx_opening_element
  name: [
    (identifier) @name
    (member_expression)  @name
  ]
  (#match? @name "^[A-Z]")) @reference.call

(jsx_self_closing_element
  name: [
    (identifier) @name
    (member_expression) @name
  ]
  (#match? @name "^[A-Z]")) @reference.call

; A function passed as a prop value: `onClick={handleClick}`.
(jsx_expression
  (identifier) @name) @reference.value
