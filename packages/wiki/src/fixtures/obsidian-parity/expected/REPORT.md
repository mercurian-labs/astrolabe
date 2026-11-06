# Obsidian Bases ground truth

## Environment and capture method

- About Obsidian reports **Obsidian Version 1.14.4 (Installer 1.8.10)**. Evidence: `/tmp/obsidian-parity-shots/Obsidian - About.png`.
- Native macOS desktop app; English UI, dark theme; host timezone America/New_York. Display and timestamp observations below belong to this environment.
- Opened only `/tmp/obsidian-parity-vault`, copied from the supplied fixture vault. The repository vault was never opened in Obsidian.
- All 25 CSVs were saved directly with the base toolbar's results menu → **Export CSV...**. No clipboard fallback, generated expectations, reformatting, or CSV rewriting was used. Files are UTF-8, LF-separated, with no BOM or trailing newline.
- PNG evidence is in `/tmp/obsidian-parity-shots/`. Matching `.ax.txt` files record native accessibility observations. Screenshots capture all rows and all columns across horizontal positions. Long values can remain clipped inside their original column widths; widths were not changed. A selected cell outline in some captures is navigation, not editing.
- An initial pass was discarded after detecting Obsidian's automatic YAML normalization of formula definitions. The vault was recopied and fixture files made read-only, preserving their contents. All delivered exports were captured after this restart. Final byte comparison of all 20 source fixture files against the active copy found **zero differences**. Obsidian's own `.obsidian` metadata exists only in the temporary vault.
- Protected base files occasionally caused save/navigation interruptions; reopening the vault and using separate tabs allowed capture to continue. These are capture-environment issues, not formula result errors. The exact observed toast was: `Failed to save file “Groups.base”. EACCES: permission denied, open '/private/tmp/obsidian-parity-vault/Groups.base'. Make a backup of the contents of this file now to avoid losing data.`
- The fixture vault was closed through File → Close Window after capture. Obsidian was left open on its pre-existing other vault.

## Complete export and screenshot inventory

Each screenshot stem below is the CSV filename without `.csv`. `main, 2` means `<stem>.png` and `<stem>-2.png`, etc. Counts are the actual toolbar result counts, independently checked against exported data-row counts.

| Base / view                          | CSV filename                               | Results | Screenshot suffixes |
| ------------------------------------ | ------------------------------------------ | ------: | ------------------- |
| Files / Every file                   | `Files - Every file.csv`                   |      20 | main                |
| Files / In projects                  | `Files - In projects.csv`                  |       2 | main                |
| Files / Not notes                    | `Files - Not notes.csv`                    |      11 | main                |
| Files / File fields                  | `Files - File fields.csv`                  |       9 | main                |
| Strings / Text                       | `Strings - Text.csv`                       |       5 | main, 2             |
| Strings / Tests                      | `Strings - Tests.csv`                      |       5 | main, 2             |
| Numbers / Numbers                    | `Numbers - Numbers.csv`                    |       5 | main, 2             |
| Lists / Lists                        | `Lists - Lists.csv`                        |       3 | main, 2, 3          |
| Dates / Dates                        | `Dates - Dates.csv`                        |       4 | main, 2, 3, 4       |
| Links / Links                        | `Links - Links.csv`                        |       9 | main, 2, 3, 4, 5    |
| Summaries / Number summaries         | `Summaries - Number summaries.csv`         |       5 | main                |
| Summaries / More number summaries    | `Summaries - More number summaries.csv`    |       5 | main                |
| Summaries / Min max range            | `Summaries - Min max range.csv`            |       5 | main                |
| Summaries / Date and check summaries | `Summaries - Date and check summaries.csv` |       5 | main                |
| Summaries / Other summaries          | `Summaries - Other summaries.csv`          |       5 | main                |
| Summaries / Grouped summaries        | `Summaries - Grouped summaries.csv`        |       5 | main                |
| Groups / By status                   | `Groups - By status.csv`                   |       9 | main                |
| Groups / Only open and closed        | `Groups - Only open and closed.csv`        |       4 | main                |
| Groups / With ungrouped              | `Groups - With ungrouped.csv`              |       7 | main                |
| Groups / By folder                   | `Groups - By folder.csv`                   |       4 | main                |
| Groups / As a list                   | `Groups - As a list.csv`                   |       5 | main                |
| Groups / As a board                  | `Groups - As a board.csv`                  |       5 | main                |
| Groups / As cards                    | `Groups - As cards.csv`                    |       5 | main                |
| Formulas / Weighted                  | `Formulas - Weighted.csv`                  |       3 | main                |
| Formulas / By bucket                 | `Formulas - By bucket.csv`                 |       3 | main                |

No view was skipped. Every view exported successfully. Only Links / Links showed formula error cells. Other than the save toast described above and the orange numeric-list display described below, no additional error or warning text was observed.

## Summaries: exact displayed values

Column names below are the visible headers. Summary names are the full names exposed by the UI; some labels are shortened visually when the column is narrow (for example Average). Values are transcribed as displayed, including the humanized duration and ISO-style date summary values. No summaries appear in the exported CSVs.

| View                                | Column   | Summary name  | Displayed value       |
| ----------------------------------- | -------- | ------------- | --------------------- |
| Number summaries                    | priority | Sum           | `11`                  |
| Number summaries                    | score    | Average       | `2.25`                |
| Number summaries                    | double   | doubled_total | `44`                  |
| More number summaries               | priority | Median        | `2`                   |
| More number summaries               | score    | Stddev        | `4.36`                |
| Min max range                       | priority | Min           | `0`                   |
| Min max range                       | score    | Max           | `10`                  |
| Min max range                       | due      | Range         | `2 years`             |
| Date and check summaries            | due      | Earliest      | `2024-02-29T00:00:00` |
| Date and check summaries            | done     | Checked       | `2`                   |
| Date and check summaries            | status   | Unique        | `3`                   |
| Date and check summaries            | owner    | Filled        | `3`                   |
| Other summaries                     | due      | Latest        | `2025-12-31T14:30:00` |
| Other summaries                     | done     | Unchecked     | `3`                   |
| Other summaries                     | owner    | Empty         | `2`                   |
| Other summaries                     | status   | how_many      | `5`                   |
| Grouped summaries — status archived | priority | Sum           | `0`                   |
| Grouped summaries — status closed   | priority | Sum           | `1`                   |
| Grouped summaries — status open     | priority | Sum           | `10`                  |
| Grouped summaries — overall footer  | priority | Sum           | `11`                  |

The ordinary summary row is below the data rows and begins with `Summary`. In Grouped summaries, each group has a `Summary` row **above its member rows**, and an overall `Summary` row remains at the bottom. No summary is shown for the filename column. The configured display name “Priority level” is not used: the visible/exported header is `priority`.

The score average is `2.25` despite only four nonempty scores (2.5, -1.25, 0, 10); the five-row sum divided by five is consistent with this observation. This is an interpretation of the observed value, not an independently established general rule for missing values. The standard deviation is `4.36`. The custom doubled_total is `44`, while the displayed double cells are 6, 2, 10, 0, 4.

## Group headings, order, and membership

These are screen order, including order within each group. For table groups, the property label precedes the value in the heading (for example gray `status` then emphasized `open`), with an expand/collapse chevron. Table headings do not show group counts. All groups were expanded.

| Base / view                   | Exact heading, in screen order | Rows in screen order         |
| ----------------------------- | ------------------------------ | ---------------------------- |
| Groups / By status            | `status open`                  | Gamma, Alpha, Delta          |
| Groups / By status            | `status closed`                | Beta                         |
| Groups / By status            | `status archived`              | Epsilon                      |
| Groups / By status            | `status None`                  | Priya, README, Sam, Untitled |
| Groups / Only open and closed | `status closed`                | Beta                         |
| Groups / Only open and closed | `status open`                  | Alpha, Delta, Gamma          |
| Groups / With ungrouped       | `status open`                  | Alpha, Delta, Gamma          |
| Groups / With ungrouped       | `status None`                  | Priya, README, Sam, Untitled |
| Groups / By folder            | `folder /`                     | Alpha, Beta                  |
| Groups / By folder            | `folder projects`              | Delta                        |
| Groups / By folder            | `folder projects/archive`      | Epsilon                      |
| Summaries / Grouped summaries | `status archived`              | Epsilon                      |
| Summaries / Grouped summaries | `status closed`                | Beta                         |
| Summaries / Grouped summaries | `status open`                  | Alpha, Delta, Gamma          |
| Formulas / By bucket          | `bucket heavy`                 | Alpha, Delta                 |
| Formulas / By bucket          | `bucket light`                 | Gamma                        |

**Only open and closed** shows exactly closed and open; archived and None are absent. **With ungrouped** shows exactly open and None; closed and archived are absent. Missing status is labeled `None`, capital N, in its heading. Its table cells are blank rather than the literal word None. By folder contains only four results total, divided 2 / 1 / 1 across its three groups.

CSV exports have one header row and ordinary data rows: no group-heading rows, separators, per-group counts, or group summaries. Group filtering is respected, but the CSV is not necessarily in the group's visual order:

- By status CSV: Epsilon, Beta, Gamma, Alpha, Delta, Priya, README, Sam, Untitled (global ascending priority), versus the grouped screen order above.
- Only open and closed CSV: Alpha, Beta, Delta, Gamma.
- With ungrouped CSV: Alpha, Delta, Gamma, Priya, README, Sam, Untitled.
- By folder CSV: Alpha, Beta, Delta, Epsilon. The grouping property is not included because the only displayed/exported column is file name.
- Grouped summaries CSV: Alpha, Beta, Delta, Epsilon, Gamma, with just file name and priority.
- By bucket CSV: Alpha, Delta, Gamma, with bucket as a normal column.
- As a board CSV: Alpha, Beta, Delta, Epsilon, Gamma; only file name and priority. It does not export the status column used for the board headings.

### List, board, and cards layouts

**As a list:** a compact vertical bullet list at the top left, with five items, in this exact order: `Alpha, open`; `Beta, closed`; `Delta, open`; `Epsilon, archived`; `Gamma, open`. Each filename is a purple underlined link followed by comma-space and the plain status text. No group headings, property labels, or per-item counts appear. The toolbar says `5 results`.

**As a board:** three tall bordered columns, left to right `archived 1`, `closed 1`, `open 3`. The value is bold and the count follows it. Archived contains Epsilon with priority 0; closed contains Beta with priority 1; open contains Alpha with priority 3, Delta with priority 5, then Gamma with priority 2, top to bottom. Each card has a bold filename, the muted label `priority`, and its value on the next line. The status is represented by the enclosing column, not repeated on the card. A `+ New` control sits at each column's bottom; the columns extend nearly to the window bottom. No None or empty column is visible. Toolbar: `5 results`.

**As cards:** five bordered cards in a single left-to-right row at the captured width: Alpha, Beta, Delta, Epsilon, Gamma. Each shows a bold filename, then muted label `status`, then open / closed / open / archived / open respectively. There are no group headings, counts per card, images, or priority fields. The remaining view is empty space; toolbar: `5 results`.

## Display semantics and additional observations

### Files

- Every file shows 20 entries: nine Markdown notes, nine bases, one canvas, and one PNG. `.obsidian` metadata is not included. Filename links omit `.md` for notes but retain `.base`, `.canvas`, and `.png`; file base name removes those extensions too.
- `file.name`, `file.basename`, `file.path`, `file.folder`, `file.ext`, and `file.size` are headed `file name`, `file base name`, `file path`, `folder`, `file extension`, and `file size`.
- Root folder displays `/`; nested folders are `projects`, `projects/archive`, and `attachments`, without leading/trailing slashes. Path sorting places attachments/diagram.png between Alpha.md and Beta.md, and projects/archive/Epsilon.md before projects/Delta.md.
- `file.size` displays plain, right-aligned byte counts, without units or thousands separators. Examples: diagram.png `70`, Strings.base `2316`, Untitled `0`. CSV has the same numeric text.
- In projects shows Epsilon followed by Delta. Not notes shows 11 non-Markdown files.
- Both Not notes and File fields request `file.properties`, but **no file.properties column appears**, either on screen or in CSV. There is no rendered object placeholder or visible error for that omitted column. Object operations do work in Lists formulas (keys, values length, isEmpty).
- File tags are purple rounded pills, without `#`. File links/backlinks/embeds are purple underlined links separated by spaces visually; CSV uses comma-space-separated wikilinks. Some long link lists clip at the cell edge. Alpha's embed displays `diagram.png`. Empty lists render blank cells.

### Strings and booleans

- Text rows: Alpha, Beta, Delta, Epsilon, Gamma. Only Beta has title_cased `Hello World`; other title_cased cells are blank. Formula-produced split lists show adjacent text items separated by spaces; CSV uses comma-space. Gamma's split_three is the single text `one two`, visually indistinguishable from the two-item split_regex list `one`, `two` without the CSV.
- `regex_first` on Gamma displays `G4mma`; `regex_all` displays `G4mm4`. `regex_groups` is the literal string `Smith, John`, including its comma. Replaced strings use digit zero (`0pen`, `cl0sed`).
- Tests and boolean formulas elsewhere render centered checkboxes: purple filled with a check for true, empty outlined square for false. Formula checkboxes are read-only/disabled in accessibility. CSV spells `true` / `false`.
- The done property in summary views also displays checkboxes. Missing done on Gamma is an unchecked box and exports false.
- False branches of if_no_else display blank, not false. Escaped HTML displays literal entity text such as `&lt;b&gt;Alpha&lt;/b&gt;`, whereas html_out in Links renders bold text.
- Missing/null text and numeric values generally show blank table cells, with no dash, null, undefined, or zero placeholder. Accessibility can label editable blanks `Empty`; that word is not visibly printed as cell content.

### Numbers and lists

- Numbers row order is Delta, Alpha, Gamma, Beta, Epsilon. Numeric values are right-aligned and use short decimal forms (`2.5`, `-1.25`, `0`, `10`); no forced decimal places or grouping separators. The fixed formula produces left-aligned strings (`0.00`, `2.50`, `10.00`, `-1.25`). Epsilon's missing score and score-derived values such as fixed are blank.
- Numeric-list property nums displays orange compact bracketed text: Alpha `[4,1,3]`, Beta `[2,2,5]`, Epsilon `[3,1,2,2]`; its header has a question-mark property icon. No accompanying textual warning was observed. CSV instead exports `4, 1, 3`, etc., without brackets.
- Formula lists have no brackets or visible commas: sorted Alpha `1 3 4`, mapped Alpha `40 10 30`, indexed Alpha `0 1 2`; CSV uses comma-space-separated values. Empty lists are blank.
- unique displays sorted distinct values (`1 3 4`, `2 5`, `1 2 3`) even though the original arrays have different order. Other formulas still show original order where applicable: Alpha listed `4 1 3`, joined `4-1-3`, first `4`.
- keys displays space-separated property names in source order, with long cells clipped. property_values is `9`, `11`, `5` for Alpha, Beta, Epsilon. empty_object is false for all three; empty_list is true for all three. These are checkboxes on screen.

### Dates and durations

- Dates row order: Epsilon, Beta, Alpha, Delta. Due displays calendar icons and `02/29/2024`, `01/05/2025`, `03/10/2025` for the first three. Delta displays the literal `2025-12-31T14:30:00`, without the calendar icon seen on date-only values. CSV retains ISO input text for due.
- Formatted date formulas are plain text. Examples include `Thursday, February 29th 2024`, `29/02/24`, and `2024-02-29`. Clock/time_part show `00:00:00` for date-only inputs and `14:30:00` for Delta. date_part shows a date followed by `00:00:00`.
- The leap-date year_later result is `2025-03-01`, and month_later is `2024-03-29`. Delta hours_later is `2026-01-02 02:30`.
- gap displays and exports the humanized string `2 months` for all four rows. The summary Range displays `2 years`; it is not exported at all.
- Date summary values are ISO-style timestamps, not the localized due-cell controls. as_number exports/displays epoch milliseconds, e.g. Epsilon `1709182800000`, Alpha `1741579200000`; Numbers from_date is `1735707600000` in every row. These are environment-sensitive observations.

### Links, rich cells, and exact errors

- Links has nine rows: Alpha, Beta, Delta, Epsilon, Gamma, Priya, README, Sam, Untitled. Owner links show `Priya`, `Sam`, `Priya` for the first three, then blank. Beta's people cell shows purple links `Priya` and `Sam` with small removal x controls. CSV retains wikilink syntax and comma-space between list members.
- owner_name and file_of_owner show plain names. people_names shows `Priya Sam` on Beta, versus `Priya, Sam` in CSV.
- as_link shows full vault-relative path including `.md` (`Alpha.md`, `projects/Delta.md`, `projects/archive/Epsilon.md`). as_link_named shows `Open Alpha`, etc. link_plain shows `Alpha`; link_display shows `the alpha note`. CSV retains the corresponding target and alias syntax.
- link_url shows purple underlined `https://obsidian.md` with an external-link icon; CSV contains the URL only.
- html_out renders the filename in bold, without tags. CSV contains `<b>Alpha</b>`, etc. icon_out renders a right-arrow glyph; CSV contains `arrow-right`. image_out displays the fixture's tiny image as a barely visible colored speck; CSV contains `![[attachments/diagram.png]]`. No image error is shown.
- **owner_links_alpha has three red warning/error cells**, on Alpha, Beta, and Delta. Exact UI/tooltip text: `Type error in "linksTo", parameter "file". Expected File, given Link.` The red cell text is truncated to fit; screenshot `Links - Links-4.png` includes the complete tooltip. CSV prepends `Error: ` to the same message. The other six rows are blank in that column, not false.

### Formula views

- Weighted shows Delta `11`, `Delta (11)`, `heavy`; Alpha `7`, `Alpha (7)`, `heavy`; Gamma `5`, `Gamma (5)`, `light`, in that order. Weight is numeric/right-aligned; label and bucket are plain text. There are no errors or summary footers.
- By bucket contains the same three notes, grouped as documented above, with only file name and bucket columns. Its CSV contains no extra grouping metadata.
