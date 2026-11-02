# Sync

What you see in Mercurian comes from two sources, and sync is how the app shows them as one. **Your machines:** each machine you connect to runs a T3 Code server, which holds that machine's checkouts, your private threads, and their turns. **The Mercurian cloud:** the control plane ([[Strategy]]) holds [[Organizations|organizations]] and their [[Teams|teams]], their members and repository sets, and the threads people have published there ([[Collaborative DAG]]). The [[Left Sidebar]] is where the two meet most visibly: one list whose rows come from both. _(Written 2026-09-24.)_

Sync here means showing each device what the sources already hold. It never moves private work into a team. Only [[Publishing]] does that, as a deliberate act.

## What a person can count on

- **The app opens on what it last showed.** Each device keeps a local copy of what it last received from both sources, so the sidebar and recent threads appear at once, before any connection finishes, and are brought up to date as connections return.
- **One copy per device.** The local copy is kept once and read by every surface on that device. There is no second cache that could disagree with the first.
- **Each source keeps its own truth.** A machine's T3 Code server stays the source of truth for its threads, and the cloud for organizations, teams and published work. The local copy only reflects them.
- **An action shows at once and is then confirmed.** Pinning, settling, or renaming a thread changes its row immediately, and the change stands once its source confirms it. If the source refuses, the row returns to how it was and says why.
- **Work sent to an agent is never queued offline.** Sending a message, approving a request, or starting a turn needs a connection to the machine that runs the thread. Without one, the action says so and does nothing. A turn that started hours later, after you had moved on, would surprise you. Edits to a team, such as renaming it or changing its repositories, may wait for the connection and apply when it returns.
- **An unreachable machine is named, not hidden.** When a machine that holds your threads is off or out of reach, its threads stay in the list from the local copy, marked as unreachable, and you can read what was last received. Nothing can be sent to them until the machine returns.

## How the client holds it

The client keeps one local store on each device, and the sidebar and other surfaces read it through live queries that join the two sources: your threads from each connected machine, and your teams' repository sets and published threads. The store is TanStack DB with its SQLite persistence, as the research note on the architecture chooses. Team data arrives as it changes in the control plane. Each machine's thread summaries arrive as T3 Code already sends them, as an ordered stream the client resumes from where it left off. The full history of an open thread stays with T3 Code's own client handling, because that stream is the heaviest one the app reads and the one most sensitive to speed.

**Amended (2026-10-09, Venkat): one saved copy per source, not one store for both.** T3 Code's client already saves each machine's thread summaries on the device, so copying them into a second saved store would make exactly the second cache this note forbids. Instead each source keeps one saved copy: T3 Code saves your machines' threads as it always has, and TanStack DB saves only team data. Your machines' thread summaries enter TanStack DB as a collection held in memory and fed from T3 Code's own state, so live queries can still join both sources without anything being saved twice. Team data arrives as Electric shapes the control plane scopes to you, and each change you make shows at once and stands when its transaction comes back through them ([[Strategy]]). Actions, permissions and the app's other state stay with T3 Code's own state model; TanStack DB holds team data only. Given up: one store that holds everything, in favour of one saved copy of everything.

## Open Decisions

### When your own published thread arrives from both sources, which one shows?

_(Raised 2026-09-24.)_ A thread you published exists on your machine and in its team. **The local copy, when reachable:** it is the more current one, and you can act on it. When the machine is out of reach, the published copy shows instead, marked as such. **Always the published copy:** one reading for everyone, at the cost of hiding work you have done since publishing. **Recommendation:** the local copy when reachable, the published copy otherwise. Given up: a row that reads the same on every device at every moment.

### Does the full history of a thread move into the shared store?

_(Raised 2026-09-24.)_ Thread summaries go into the local store so they can be joined with team data. A thread's full history could follow, so a query could reach across many threads' contents. **Recommendation:** not until a feature needs to ask questions across thread contents. Until then the history stays where T3 Code already handles it well. Given up: questions across threads' contents answered on the device.
