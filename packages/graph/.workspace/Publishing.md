# Publishing

Publishing is the act that makes your work part of a thread's shared history. Work in progress is private: until you publish, your unpublished threads are visible only to you. Others see the published history (see [[DAG]]). You publish a thread into one of your [[Teams|teams]], and from then on it **stays published as it grows**: each message that settles follows it to the team without another act, until you take it private. _(2026-10-09, Venkat; see the resolution below.)_

## The design (canonical)

- **Publishing a checkpoint publishes its unpublished ancestors** — the earlier checkpoints of its thread and the ancestry it forked from ([[DAG]]). Nobody ever sees a checkpoint whose origin is invisible — the shared history is always complete from any published checkpoint back to the family's root.
- This matters most for [[Merges]]: you can take context from a published thread into a private one, and the transfer stays private until you publish — but publishing a checkpoint that took context from a private thread force-publishes that source up to the taken checkpoint, with a warning before you confirm.
- **Every thread starts fully private** (the lifecycle resolution on [[Threads]]). _(2026-09-16: the carve-out under which a thread born from a tracker issue started published retired with issue import.)_

## Taking a thread private

Taking a published thread private stops it from that moment: nothing new follows it to the team. What teammates already saw stays shared, marked as taken private, because it was already part of the team's history; this keeps the rule that a published thread is never deleted ([[Threads]]). Publishing it again resumes the same published thread.

## What exists today

_(2026-10-09.)_ Built on Astrolabe's `collaboration` branch, not yet merged: **Share with team…** in a thread's menu publishes it into a team or takes it private, and the app you publish from keeps it current, sending each settled message after its turn ends. Only the conversation travels: your messages and the agent's settled answers, with the ancestry it was forked from. Checkpoints, tool activity and code do not. _(The 2026-09-24 reset onto upstream T3 Code removed the earlier privacy build this section described.)_

## Open Decisions

### Is publishing still an act under local-first collaboration?

The design's temperament is that "a publish is an act, not a replication" ([[Environments]]) — one deliberate crossing into shared history. The local-first architecture direction proposes CRDTs for collaborative planning, and CRDTs converge continuously — the opposite temperament. The two are reconcilable if the act and the transport are separated: publishing flips a commit's visibility, and the CRDT layer replicates only what is flagged published — the act decides _what_ crosses, the CRDT decides _how_ it travels. **Recommendation:** keep publish as the act and let CRDTs be transport underneath it; settle this in the architecture ADRs before Publishing is built, since a CRDT layer that replicates drafts would quietly dissolve the private/published boundary the whole lifecycle design leans on.

**Resolved (2026-07): publish stays the act; CRDTs are transport underneath it.** As recommended: publishing flips a commit's visibility, and any replication layer carries only what is flagged published — the act decides _what_ crosses, the transport decides _how_ it travels. The architecture ADR records the consequence and pins what it requires of the commit model's published flag. Given up: continuous convergence for unpublished work — private drafts never travel on their own, which is the point.

_(2026-09-16: teams became the first audience ([[Mercurian]]). This decision and the local-first posture behind it are the standing context for the collaboration design that must now follow; nothing here is re-decided yet.)_

**Amended (2026-10-09, Venkat): the act is publishing the thread, not each checkpoint.** A thread published once stays published as it grows. Publishing checkpoint by checkpoint asked for a deliberate act every time a teammate should see progress, and for a team that friction leaves shared threads stale. The boundary the 2026-07 resolution protected still holds: nothing private crosses on its own, because publishing a thread is still the one deliberate crossing, taking it private stops it, and only what the thread has published travels. Given up: choosing, checkpoint by checkpoint, what a teammate sees of a published thread.
