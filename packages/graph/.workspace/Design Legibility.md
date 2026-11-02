# Design Legibility

The theory behind the [[Code Graph]]: how the design of a program an agent is making is communicated to the engineer who steers it. _(Written 2026-10-02 from Venkat's notes after a week of building the graph: the goal was never a graph, and every channel added before this note, shapes, edges, tags, toggles, was vocabulary built before the grammar. This note is the grammar; the features derive from it, not the reverse.)_

## The tool never grades

_(Venkat, 2026-10-02: deciding what separates a good design from a bad one is playing god.)_ The tool makes the design legible so that the engineer's judgement has something to act on, and it stays silent about what the judgement should be. It reports facts with their scope, in the engineer's own vocabulary where the engineer gave one, and never a verdict:

- A link that crosses layers the engineer declared reads "crosses model → render, not in your allowed list", never "violation". The engineer drew the line; the tool reports the crossing; whether it is a leak or a deliberate exception is theirs.
- A recogniser names a shape, "hub, 14 callers", "cycle of 3", "interface, 4 implementers", never a smell. Nothing is ever called tangled, bloated, or a god object.
- A failure mark states its scope: "throws; no catch found upstream in what is shown", never "unhandled".
- No scores, no health numbers, no complexity grades, no trend arrows. A number that ranks is the tool deciding.

## What program design consists of

Design is what survives a rewrite of the lines. For the purpose of reading an agent's work, it has these parts:

- **Boundaries and direction.** Where the modules are and which way dependencies cross between them.
- **Abstractions.** What the interfaces are, who implements them, and what each one promises beyond its signature.
- **Data.** The shapes of the values, who owns them, and who accepts and returns them.
- **Failure.** What can go wrong where, and where it is caught.
- **Sequence.** The order in which the design came to be, which is the only thing a diff cannot show.
- **Intent.** Why this boundary, why this abstraction, which tradeoff was taken and what it cost.
- **Algorithms and invariants.** What happens inside one node. These are read in the code, in the editor, and the graph points at them rather than drawing them.

## Three sources, and what each can carry

- **Derived, deterministically, from the code and its history:** boundaries as they stand, direction, interfaces and implementers, accepts and returns, throws and catches, and the sequence of every change. Tree-sitter and git give all of this without a model, at the tags tier with the honesty rules of the [[Code Graph]]. This is what the graph draws.
- **Declared by the engineer:** the intended layers and allowed directions, and any other line the engineer wants reported against. The tool reports crossings of declared lines; it never infers lines and reports against its own.
- **Authored:** the why. The agent's turn text already says what it set out to do, and the checkpoint records what it did; the graph has shown only the second half. The thread and the graph are one record: every structural move is attributed to the span of the conversation that caused it, so hovering a change shows the sentence that motivated it, and reading the thread shows the shapes it produced. Where the prose does not say, the agent may annotate a move through a tool or skill, and that annotation is authored intent too, marked as the agent's. An LLM may summarise, but a summary is authored content with an author named, never a derived fact.

The engineer's verdict is none of these. It is what the tool exists to support and must never pre-empt.

## Granularity

_(Venkat, 2026-10-02: too much is happening; drilling is the reader's prerogative.)_ Live, while the agent works, detail follows the agent, because the engineer is watching. In playback the default is tuned for the reader:

- **The default level is files**, as the memory of notes is read note by note. The tour tells files; a file's symbols are the reader's drill, chosen with a click and left with Escape. This is one notch coarser than the span rule of the [[Code Graph]] would choose on its own.
- **The play-by-play travels with the cursor.** The cursor's chip grows into a popover that holds the turn's moves with scrollback, because attention is already on the cursor; the column beside the graph is the index, not the story.
- **The shapes, gestures, and typed edges live below the default level.** They are what the reader sees on choosing to look closer, and they are not noise at the level where they are not shown.

## The product surface is not the instrument

The playground has four renderers and a dozen switches because the research needed them. The surface an engineer uses has one renderer, no modes, and a handful of controls: step, play, drill, and the declared lines. The toggles of the [[Code Graph]]'s design features exist to find out which facets earn a place; those that do become the surface, those that do not are cut.

## The record

A faithful record of how an engineer steers an agent, read over the structure it produced, shows how the best engineers use these tools. _(Venkat, 2026-10-02.)_ The same record is a record of the engineer. It is the engineer's private instrument first: it lives with them, it serves their own review, and an aggregate leaves their machine only when they choose and know what leaves. The value of the record depends on people working naturally in front of it, which they do only when they trust it.

## What exists today

The [[Code Graph]] derives the first source and reports it under the rules above as of 2026-10-02, with its five design facets behind toggles. Nothing authored is shown yet: the thread and the graph are still two records, and no move is attributed to the conversation that caused it. The default level is still the span's, not files. The product surface does not exist; the playground is the instrument.

## Open Decisions

### How is a move attributed to the conversation?

_(Opened 2026-10-02.)_ A turn's moves and its prose are produced by the same agent in sequence, so the simplest attribution is by time: a write that lands between two sentences belongs to the span around it. T3 Code's turn record carries tool calls in order with the text, which makes this derivable for threads it ran. For a git history with no thread, the commit message is the only prose, and the whole turn is attributed to it. Whether the agent should be asked to name the span explicitly, through a tool, or whether time is enough, is to be seen once the fused record exists.
