# Klear — Raster to SVG

> Fast, local raster-to-vector for PNG/JPEG → SVG. Three engines, one CLI, an interactive TUI (Dashboard 2.0) and a REST API. Monorepo powered by Turborepo.

**Engines:** `potrace` (posterized, highest quality) · `imagetracer` (color quantization + path tracing) · `edge` (pure-JS fallback: median-cut + marching squares). Auto-fallback to `edge` if a native binding fails (`result.note`).

---

## Packages

| Package | Name | Purpose |
|---|---|---|
| `packages/core` | `@klear/core` | Vectorization engine (`sharp` → `potrace`/`imagetracerjs`/`edge` → `svgo`) |
| `packages/cli` | `@klear/cli` (`bin: klear`) | Batch CLI + interactive TUI |
| `packages/server` | `@klear/server` | Express REST API (`/api/vectorize`) |

```
Vectorize/
├── packages/core/      engine
├── packages/cli/       CLI + TUI (blessed + chokidar)
├── packages/server/    HTTP API (express + multer)
├── samples/            PNG sources (SVGs are generated, gitignored)
└── turbo.json          build pipeline
```

---

## Requirements

- **Node >= 20** (`package.json:27`)
- npm 12+

---

## Install

```bash
git clone <repo>
cd Vectorize
npm install
npm run build        # turbo run build → packages/*/dist
```

### Run without installing

```bash
npm run dev                          # TUI watching cwd
npx tsx packages/cli/src/index.ts --help
npx tsx packages/cli/src/index.ts ./samples/colonized.png --method edge
```

### Global `klear` command

> `@klear/cli` is not published to the public registry — install from the monorepo.

```bash
npm run build
npm install -g ./packages/cli   # provides `klear` (bin: dist/index.js, shebang #!/usr/bin/env node)
klear --help
# dev link (live):
# npm link --workspaces
```

On Windows `klear.cmd`/`klear.ps1` shims are generated from the shebang; if you see the `.js` opening in an editor, rebuild with `npx tsc -p packages/cli/tsconfig.json` and reinstall.

---

## Quick start

```bash
# 1. Interactive TUI (recommended for exploration)
klear                          # no args → TUI watching cwd
klear tui ./samples            # explicit
klear --watch ./samples --method potrace

# 2. Batch (scripting)
klear ./samples/colonized.png --method potrace --out ./out
klear ./samples --method imagetracer --colors 16 --out ./out --no-optimize
klear ./photo.jpg ./logo.png --method edge --tolerance 1.2 --resize-max 256

# 3. REST API
npm run dev:api                 # tsx packages/server/src/index.ts → http://0.0.0.0:8080
curl -F image=@samples/colonized.png "http://localhost:8080/api/vectorize?method=potrace" -o out.svg
```

---

## CLI

```
Usage:
  klear [options] <file|dir ...>     Batch convert (straightforward)
  klear tui [dir] [options]          Open interactive TUI (Dashboard 2.0)
  klear --watch [dir] [options]      Alias for tui

TUI guidance:
  1. Inputs  [i] change source dir  [n] add file/folder
  2. Method  [Tab] focus, arrows pick
  3. Outputs [o] out dir  [r] rename selected output  [Space] multi-select
  4. Convert [Enter] selected / [a] all  [v] open SVG in default app  [?] help

Options:
  --method <m>        potrace, imagetracer, edge (default: potrace)
  --out <dir>         Write SVGs into <dir> (default: next to each source)
  --colors <n>        Max palette colors for imagetracer/edge (default: 16)
  --resize-max <n>    Downscale long side to <n> px before tracing edge
  --tolerance <n>     RDP simplification tolerance in px (edge, default: 1)
  --optimize          Optimize with SVGO (default)
  --no-optimize       Skip SVGO
  --watch             Open TUI
  -h, --help
```

*Inputs* are resolved recursively (`findImageFiles` skips `node_modules/dist/.git` and dotfiles, sorts). `outputPath` is `input → .svg` beside source or `resolve(outDir, basename.svg)`. Intermediate dirs are created (`mkdir -p`).

### TUI Dashboard 2.0

No inline image preview — `v` opens the resulting SVG in your OS default app (`start`/`open`/`xdg-open`).

```
┌──────────────── Klear — raster to SVG ────────────────┐
│ 1.Inputs[i/n] > 2.Method[Tab] > 3.Outputs[o/r] > 4.Convert[Enter/a] | Focus:FILES | ?:help │
├ In: /path/to/watch  | i:change n:add Del:remove ├── Out: (next to source) | o:out dir r:rename v:open │
│ Inputs: /watch (12) [2 selected]      │ Method (2)          │
│ [x] › photo.png → out/photo.svg       │ potrace — Potrace   │
│ [ ]   icon.jpg → icon.svg             │ imagetracer — ...   │
│                                       │ edge — ...          │
│                                       ├ Details ────────────┤
│                                       │ Potrace — Highest   │
│                                       │ quality, posterized │
│                                       ├ Output (3) ─────────┤
│                                       │ in: photo.png       │
│                                       │ out: out/photo.svg  │
│                                       ├ Log ────────────────┤
│                                       │ ✓ photo.png → ...   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
  12 image(s) [2 selected] | method:potrace | out:./out | SVGO: ON | Space:select Enter:convert a:all v:open ?:help
```

| Key | Action |
|---|---|
| `Tab` | Cycle focus `FILES → METHOD → OPTIMIZE` |
| `↑/↓`, mouse | Navigate |
| `Space` | Multi-select (toggle `[x]`) |
| `Enter` | Convert highlighted file |
| `a` | Convert selected (or all if none selected) |
| `i` | Change **input** directory (prompt, rescan, rewatch) |
| `n` | **Add** file/folder to list |
| `Del`/`Backspace` | Remove highlighted from list |
| `o` | Set global **output** directory (empty = next to source) |
| `r` | **Rename** output for highlighted file — accepts `name`, `name.svg`, `./out/name.svg`, `/abs/path.svg` (stored per-input in `customOutputs`) |
| `v` / `p` | **Open** SVG for highlighted file in default app |
| `?` / `h` / `F1` | Help overlay (workflow + keys + methods) |
| `q` / `Ctrl-C` | Quit (closes `chokidar` watcher) |

*Guidance* is always visible in the header; `Details` pane is context-aware (file `in`/`out` when Files focused, method description when Method focused, SVGO ON/OFF explanation when Optimize focused). `Optimize (SVGO) [ON/OFF] — Space to toggle` checkbox label stays in sync.

---

## Methods

| Id | Name | When to use | Options |
|---|---|---|---|
| `potrace` | Potrace | Line art, logos, highest quality posterized output (native) | `threshold`, `turdSize`, `alphaMax`, `optCurve`, `color`, `background` |
| `imagetracer` | ImageTracer | Photos/illustrations, fast | `colors`/`numberofcolors`, `ltres`, `qtres`, `pathomit` |
| `edge` | Edge | No native deps, tiny images, fallback | `maxColors`, `resizeMax` (default 256), `edgeTolerance` |

List via `klear --help` or `GET /api/methods`. Core exports `listMethods()` / `getDefaultMethod()` (`potrace`) `packages/core/src/index.ts:40`.

---

## REST API (`@klear/server`)

```bash
npm run dev:api   # PORT=8080 HOST=0.0.0.0
npm --prefix packages/server run build && npm --prefix packages/server start
```

| Endpoint | Description |
|---|---|
| `GET /healthz` | `{ status: "ok" }` |
| `GET /api/methods` | `{ methods: MethodMeta[] }` |
| `POST /api/vectorize` | `multipart/form-data` `image` (PNG/JPEG, ≤15 MiB) → SVG |

Query params (also work as multipart fields via `req.query` in `app.ts:53`):

`method`, `optimize` (`1/0 true/false`), `threshold`, `turdSize`, `alphaMax`, `optCurve`, `color`, `background`, `colors`, `maxColors`, `resizeMax`, `edgeTolerance`, `format=svg` (returns `image/svg+xml` instead of JSON).

**Examples:**

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/api/methods

# JSON response
curl -F image=@samples/colonized.png "http://localhost:8080/api/vectorize?method=potrace&optimize=1"

# Raw SVG
curl -F image=@samples/colonized.png "http://localhost:8080/api/vectorize?method=edge&colors=8&format=svg" -o out.svg
```

Errors are machine-readable: `E_NO_FILE`, `E_IMAGE_FORMAT`, `E_METHOD`, `E_TOO_LARGE`, `E_IMAGE_DIMENSIONS`, `E_INTERNAL` (`KlearError.code` `packages/core/src/types.ts:59`).

---

## Programmatic API (`@klear/core`)

```ts
import { vectorize, listMethods } from '@klear/core';

const { svg, width, height, method, note } = await vectorize('./samples/colonized.png', {
  method: 'potrace',
  optimize: true,
  options: { threshold: 128, turdSize: 2 },
});

// Buffer
const { svg } = await vectorize(buffer, { method: 'edge', options: { maxColors: 16, resizeMax: 256, edgeTolerance: 1 } });

listMethods(); // → [{ id, name, description }, ...]
```

`vectorize(input: string|Buffer, { method, optimize, options })` `packages/core/src/index.ts:61` validates via `sharp`, normalizes viewBox and optionally optimizes via `svgo` (`normalizeSvg`/`optimizeSvg` `packages/core/src/utils/svg.ts`).

---

## Development

```bash
npm install
npm run build          # turbo run build
npm run typecheck      # turbo run typecheck
npm run lint           # turbo run lint
npm run test           # turbo run test (vitest)
npm run format         # prettier
```

Per-package:

```bash
npm --prefix packages/core run dev
npm --prefix packages/cli run dev        # tsx --watch src/index.ts → TUI
npm --prefix packages/cli test           # vitest run (helpers, vectorizeFile, runBatch)
npm --prefix packages/server run dev     # tsx --watch src/index.ts
```

Turbo pipeline `turbo.json:3`: `build` depends on `^build` outputs `dist/**`, `test` depends on `build`.

`.gitignore` covers `node_modules/`, `dist/`, `.turbo/`, `*.tsbuildinfo`, `coverage/`, `*.log`, `.env`, `.DS_Store`, `_dbg*.ts`, `samples/*.svg` (generated), etc.

---

## Samples

` samples/` holds `colonized.png` plus generated `colonized.svg`/`edge.svg`/`imagetracer.svg`/`potrace.svg` etc. PNGs are sources, SVGs are gitignored outputs — regenerate with `klear ./samples --out ./samples`.

---

## Troubleshooting

* **`klear` opens `.js` in editor (Windows):** `dist/index.js` missing shebang. Rebuild `npx tsc -p packages/cli/tsconfig.json` (bypass turbo cache) and `npm install -g ./packages/cli --force`. Shims should call `node` not `WScript` (`C:\Users\…\npm\klear.cmd`).
* **`sharp` native error:** Reinstall `npm rebuild sharp` / `npm install` (requires Node 20+).
* **No images in TUI:** Press `i` to set a folder containing `.png/.jpg/.jpeg`, or `n` to add a file.

---

## License

MIT — see `packages/*/package.json:5`.
