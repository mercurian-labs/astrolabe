# Atlas

Atlas is the research surface: where a person and an agent think together over a project's [[Memory|memory]] — atomic, linked notes in git, one concept per note, arranged and taught by [[Skill Maps|skill maps]] — while the agent works. It is what the 2026-09-16 ruling on [[Mercurian]] left open, "what research looks like as a surface beyond the conversation and its checkpoints," now designed. Atlas is Memory's surface, not a second memory: the notes, the maps, the amendment, the branch, and the merge home are all Memory's, unchanged. What Atlas adds is a way of seeing them while a turn runs, and a desk to edit them at, the [[Atlas Editor]]. _(Written up 2026-09-24 from the research note of the same name; the naming question is recorded below.)_

An Atlas is project-specific and version-controlled in git, and the product is a lens over it, never a silo ([[Memory]]). Humans collaborate with humans through git — branches that merge home as reviewed promotions ([[Collaborative DAG]], [[Publishing]]). A human collaborates with an agent inside one thread, on one working state, through the two-peer document the editor carries ([[Threads]], [[Atlas Editor]]).

## What it is for

The workflow it exists to make natural is the one a relentless design interview produces — a design tree worked frontier by frontier, each question carrying a recommended answer, facts fetched by the agent and decisions left to the person, with a glossary and decision records written as they crystallise. The memory already holds every piece of that discipline in a more durable form: the glossary is the notes, and a name is a concept's identity; a decision record is an Open Decision with its resolution, reasoning, and tradeoff kept under the question; the design tree is the **frontier** — red links the substrate can compute, and open decisions the decisions map teaches the [[Assistant|assistant]] to offer; and "check the claim against the code" is the base teaching, notes for intent and code for what happens ([[Skills]]). What the memory adds over an interview in one chat: the frontier lives in the notes, so it persists across threads and people; trying two answers is a fork in the [[DAG]], not a hypothetical; and every resolution lands as a reviewed amendment on a branch, never a write into shared truth.

The division of labour Atlas is built for: the person works at the level of decisions and structure, the agent at the level of prose and facts, and the map is the shared picture that keeps them honest with each other.

## The surface

Atlas is ambient in a thread's space, not a place you go. Four pieces, all reading from what the record already keeps:

- **The map pane, lit by the turn.** Beside the thread, a [[Panes|pane]] shows the [[Atlas Graph]]'s thread's reading: every note the thread's turns reach rises into view with its local graph, and the links the turn adds or removes draw as they land. When a turn works a skill map's territory, invoking it from the [[Composer]] or grounding in its notes, that map turns on as a lens: its notes and edges tinted, edges named in the map's own vocabulary ([[Skill Maps]]). Notes the turn has read glow; notes it amended are marked; red links it is reaching toward show as frontier. All of it derives from the record every turn keeps ([[Assistant]]), so the pane never says more than the record does. You watch where the agent is in the structure instead of reading its stream. Clicking a node opens the note in the editor. _(2026-09-26: the pane first drew the map's own subgraph in the shape the map declares; it is now the Atlas Graph with the map as a lens, as resolved there.)_
- **The frontier, as a standing list.** Beside the map: the red links reachable from the map's territory, computed by the index, and the open decisions the assistant is offering for this territory, each with its recommended answer folded. Answering one is sending it — the resolution lands as an amendment under its question. Wanting both answers is a fork ([[DAG]]). Two sources, deliberately kept apart by the litmus on [[Memory]]: red links are structure the substrate knows, and open decisions are genre, which only teaching may read — so they arrive through the assistant's structured-question channel and its suggested next messages ([[Composer]]), never from the product parsing a heading. The list renders both together; it computes only one.
- **The editor as the shared desk.** The note the agent is amending is open in the [[Atlas Editor]] with the agent's cursor visible, and your edit steers the running turn ([[Threads]]). The map shows which note you are both in.
- **Review on the map.** An amendment's review shows which edges it changed and which red links it filled, not only its text diff — structure is what a person checks quickly, prose is what the agent is good at. The memory tab's review and the merge home's walk gain this reading; they lose nothing ([[Memory]]).

## Merge checks

Before a branch merges home, the walk asks what the substrate can ask without reading meaning: are the skill maps still whole — every edge's prose link present, no standing warning unresolved ([[Skill Maps]]); and are there links the branch could have made and did not — notes it touched that name a concept without linking it, offered as potential links for a person to accept, never added on their own. _(From the research note's list; "are the maps up to date" is the read-time validation and the landing-time stamp Memory already designs, asked once more at the door.)_

## Example workflow

You make several changes to notes in a thread by hand, then ask the agent to improve them. The agent reads the thread's snapshot chain for what you changed, and where the changed passages are separate enough it works them as separate turns, one amendment each — so each lands reviewable on its own, and a bad one reverts alone ([[Memory]], one amendment per commit). _(Kept from the research note.)_

# AI Integration

[[Atlas Chat]]

## Open Decisions

### Is Atlas a rename of Memory?

The research note read "Atlas is Memory, but reworked; considering naming it Almagest instead." As written above, Atlas is Memory's surface and adds no second concept: the notes, maps, amendments, branches, and merge home are Memory's. Renaming Memory to Atlas (or Almagest) would be one rename utility run across every note and map — cheap mechanically, but a rename is a claim that the concept changed. **Recommendation:** keep both names with the split above — Memory is the knowledge and its rules, Atlas is the surface you research at — until use shows the split is false; then rename, once, by the utility. Given up for now: one word for the whole thing.

### Where does the map pane live?

_(2026-09-24: this question dissolved when the right sidebar retired. The map is a pane that stands beside the thread for as long as you keep it there, so it can be watched without being a fixed view or an overlay ([[Tabs]], [[Thread Tabs]]).)_ The right sidebar kept its standing views, with Checkpoints pinned first. As **a fourth standing view**, the map is always one click away and shares the panel's camera and persistence, at the cost of a wider strip. As **a mode of the memory overlay**, it stays transient, which is what the 2026-09-10 reconciliation on [[Memory]] settled for the in-thread reader, at the cost of never being ambient — and ambient is the point. **Recommendation:** a standing view, since a surface meant to be watched while a turn runs cannot be an overlay. Given up: the panel's three-view economy.

### What lights the map: the invocation, or the grounding record?

Highlighting from **the map invocation** is simple and immediate — invoke a map and it shows — but says nothing about what the turn actually did. Highlighting from **the grounding record** is exact — a note glows because the turn read it — but arrives as the turn proceeds, and a turn that invoked no map still needs a map to draw on. **Recommendation:** both, in order: the invoked map, or the map whose territory the turn's first grounding touches, chooses _which_ map; the grounding record lights it. Given up: nothing but the ambiguity when a turn's grounding spans two maps, which the pane resolves by showing the one invoked and naming the other.

_(2026-09-26: the pane is now the [[Atlas Graph]] with a skill map as a lens, so this question chooses which lens turns on by itself, not which subgraph is drawn. A turn whose grounding spans two maps can show both lenses, each in its own tint.)_

### Is the frontier list a pane, or the composer's offers?

The [[Composer]] already surfaces open decisions as suggested next messages. A standing frontier list duplicates that source in a second place, at the cost of two surfaces saying one thing; folding the frontier into the composer's offers keeps one place but loses the red links, which are not messages. **Recommendation:** one list beside the map, with the composer's offers as its decision half and the index's red links as its structure half — the composer keeps offering, and the list is where you see the whole frontier at once. Given up: the composer as the only place an offer appears.
