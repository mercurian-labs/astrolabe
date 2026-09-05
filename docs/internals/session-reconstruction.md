# Session reconstruction

Mercurian records the input it supplies when starting a clean line session. A continued or resumed session inherits its known reconstruction reference; it is not rebuilt every turn. Native provider compaction is separate: these records describe the session's reconstructed start, not the provider's private working context at a later instant.

`MercurianTurnPreparation` walks the carrying path through the selected parent inclusively. The recent conversation travels verbatim, artifact revisions travel as markers with the current artifact contents, and older conversation that does not fit is summarized by a separate provider session. The current human message appears once. Histories with multiple-parent commits currently refuse reconstruction because there is no recorded merge rendition to reuse.

`PlanningPrompt.partitionReconstruction` budgets the provider's input character cap, including framing, current artifacts, the current message and room for a bounded summary. The shared model capability schema currently exposes options, not a numeric context window; this is a character-cap budget, not a promise about model token capacity. Mandatory input that cannot fit refuses rather than being truncated. The helper reduces large histories in bounded chronological chunks, rejects incomplete or oversized output, and is cancelled with preparation. Its temporary directory is separate from the project workspace.

`session_reconstructions` retains one immutable, versioned record per clean start. `reconstruction_attempts` binds a thread and human message to that record before send, then marks it submitted or failed. A reply settlement waits for a live submission acknowledgment and attaches only submitted provenance. Abandoned attempts after a restart remain unknown. References and summaries are never backfilled for older replies or legacy sessions with unknown provenance.

The records are in Mercurian's database and owned by the plan. Publication changes commit visibility in place, so it does not copy or rewrite the evidence. Plan deletion cascades to records and attempt mappings. There is no external history-copy/export protocol for these records; any future one must transfer referenced records with their replies.

The timeline carries only a reconstruction ID. `mercurian.getReconstruction` reads immutable detail scoped by plan under the ordinary orchestration-read authorization; the shared history popover fetches it on demand and folds the exact summary. The current native context meter and provider switching restrictions are unchanged.
