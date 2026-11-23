# Family tree visualizer

A static family tree editor with **Vue 3 + D3 7**, plain HTML/CSS/JavaScript, **no Vite, npm install, or build step**. Designed for GitHub Pages.

## Run locally

Because browser ES modules and `fetch()` require HTTP, serve the project folder:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ in your browser. Do not open `index.html` with `file://`.

Vue 3 and D3 load from jsDelivr CDN, so Internet access is needed. All application code is local and dependency-free.

## Publish on GitHub Pages

Commit the project files to a public or suitably configured repository. In repository **Settings → Pages**, use **Deploy from a branch**, select your branch and the root (`/`) folder. `index.html` is the entry point. All asset paths are relative, so project pages under `username.github.io/repository/` work.

## Data / editing

- Published initial data lives at `data/family.json` and follows `data/schema.json`.
- Changes are saved locally to **IndexedDB** in your browser. The status in the top bar indicates local saves.
- **Export JSON** downloads the complete current family. Replace `data/family.json` in your repository with the exported file and commit to publish the updates.
- **Import** validates and replaces the working family data; export beforehand if you need a backup.
- **Reset to published JSON** discards local changes and reloads the committed file.
- **Undo** and **Redo** retain the 20 most recent changes during the current tab session; history is not preserved across reloads.
- Photos can be committed to `images/people/` and referenced with relative URLs (e.g., `images/people/jane.jpg`). If hosted externally, HTTPS URLs can also be used.

## Graph

The app lays out everyone in the dataset, including disconnected family branches. Click a person or use search to select them; drag to pan, scroll to zoom, and use **Fit** to fit the graph. Ancestors, descendants, and the shortest relationship path can be highlighted. Step-parent links are dashed and not included in ancestry by default; adoptive parents are included.

The **Highlight** menu also shows gaps across the whole tree. **Missing Parents** marks people with fewer than two distinct recorded parents, excluding step-parent links. **Missing DOB/DOD** marks people with a blank birth or death date, including living people with a blank death date. A year or year and month counts as a recorded date.

Select a person, right-click another card, and choose **Explain Relationship** to see how the right-clicked person is related to the selected person. Where the records support several possible ancestry paths, the explanation shows a closest shared ancestor and the paths through that ancestor.

The layout puts each generation on its own row and reserves horizontal space for each descendant branch. Siblings appear in birth order within their branch and share a row when the ancestry permits it. When two branches join, the layout draws the household toward both sides of its ancestry. Each marriage or partnership with children has a marked junction and a shared horizontal connector for children in the same generation. Longer connectors use a nearby gap between cards when one is available. A person appears once, so shared ancestry or cross-generation partnerships can still produce crossing lines. Canvas viewport culling, semantic zoom, and **Fit** help navigate wide trees.

## Project structure

- `index.html` — Vue template and CDN script tags
- `style.css` — all styling
- `src/app/main.js` — Vue state, editors, undo/redo, import/export
- `src/app/graph.js` — graph layout and lineage/path traversal
- `src/app/family-layout.js` — generation ranking, marriage groups, and branch placement
- `src/app/family-routes.js` — marriage lines, sibling connectors, and row spacing
- `src/app/canvas.js` — D3 zoom + Canvas viewport renderer
- `src/app/persistence.js` — IndexedDB and JSON downloads
- `src/data/` — existing tested schema, indexes, validation and atomic `FamilyStore`
- `data/family.json` — published dataset (blank by default)
- `tests/` — focused data and layout tests

## Known limits

- Static GitHub Pages cannot write back to repository JSON automatically; publishing requires a manual commit.
- Only one browser's IndexedDB draft is active at a time. Changes on different devices are **not synchronized**.
- The current schema accepts partial ISO-formatted dates but not date ranges, circa indicators, or pre-AD dates.
- The editor supports adding and removing parent-child links and creating, editing, or removing partnerships. It does not currently edit existing parent-child link types in place; remove and re-add those links instead.
- Parent-child links can reference unions in imported data, but the editing UI currently manages parent-child links independently.

## Tests

```bash
node --test
```

Node 20+ recommended. The layout tests cover multiple marriages, step-parent links, cross-generation routes, and deep and wide trees.
