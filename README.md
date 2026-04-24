# FAIRWELL

Fairwell (Version: Adelie 1.0)

A lightweight, static front-end for documenting and navigating **First Article Inspection (FAI)** verification processes. FAIRWELL turns the web of governing documents, hierarchies, decision flows, and inspection forms into something you can click through instead of dig through PDFs for.

It's a single HTML page with no build step and no server — open it in a browser and it works, including from the local filesystem.

## Purpose

FAIs involve multiple overlapping documents (enterprise standards, supplements, operational procedures, AS9102 forms) that reference each other extensively. FAIRWELL lets a team capture that structure once and browse it interactively:

- See which documents govern which fields.
- Trace how high-level standards flow down to the forms people actually fill out.
- Walk a decision flow when reviewing a FAIR to figure out which doc answers a given question.
- Click any field on the FAI forms to see what to check and the related turnback codes.

All content is data-driven — the app ships with a vanilla/empty default so you can load your own organization's content from a JSON file.

## Getting Started

1. Clone or download the repo.
2. Open `index.html` in any modern browser. No install, no server.
3. (Optional) Click **Load Data** in the top-right to pick a JSON file with your seed content. If your browser supports the File System Access API (Chromium-based), future edits save back to that same file automatically.

That's it.

## The Four Sections

- **Document Map** — cards for each governing document, with cross-references and links. Add, edit, or remove documents from the UI.
- **Hierarchy** — visual tree showing how documents relate, from enterprise foundation down to the operational forms.
- **Decision Flow** — a step-by-step guide for deciding which document to consult given a specific question during a FAIR review.
- **Interactive Forms** — the three AS9102 form layouts. Click any field to see which documents govern it, what inspectors should verify, and the turnback codes tied to it.

## Top Toolbar

Three buttons in the top-right corner of the header, available on every tab:

- **Load Data** — import content from a JSON file. If your browser supports it, edits will save back to this file.
- **Export Data** — download the current state as JSON.
- **Reset to Defaults** — wipe to the empty/vanilla state.

Below the header is a strip of **special characters** (§, →, —, and any you add). Click one to copy it to the clipboard — useful when referencing document sections. Hover a character to remove it; click the `+` to add a new one.

## Editing

Every section has an **Add** button for new items and edit/delete controls on existing ones. All edits are stored in the browser's `localStorage` under the key `fairwell_data`. If you loaded a JSON file on a browser that supports writing to it, changes also mirror to that file.

## Exporting

Click **Export Data** to download a `fairwell-data.json` file containing everything. This is the same format accepted by **Load Data**, so you can share your configuration with collaborators or back it up to a repo.

## Theming

The moon/sun button in the navigation bar toggles between dark and light mode.

## License

[PolyForm Strict License 1.0.0](LICENSE). The license is narrow; it permits a small set of personal uses defined in the license text, and does **not** grant rights to use FAIRWELL commercially, to modify it, or to redistribute it. No warranty, no liability.

For commercial use, modification, redistribution, hosting, or any derivative work, a separate paid commercial license is required. See [COMMERCIAL.md](COMMERCIAL.md) for the inquiry funnel and contact details.

