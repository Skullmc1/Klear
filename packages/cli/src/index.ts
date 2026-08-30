#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty */
 /**
 * Klear CLI entry point.
 *
 * Batch: klear [options] <file|dir ...>
 * TUI  : klear tui [dir]  | klear --watch [dir] | klear (no args)
 */
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { exec } from 'node:child_process';
import blessed from 'blessed';
import chokidar from 'chokidar';
import { listMethods } from '@klear/core';
import {
  findImageFiles,
  isImageFile,
  outputPath,
  parseArgs,
  printUsage,
  runBatch,
  vectorizeFile,
  type CliOptions,
} from './lib.js';

type Focus = 'files' | 'method' | 'optimize';

let screen: ReturnType<typeof blessed.screen>;
let fileList: ReturnType<typeof blessed.list>;
let methodList: ReturnType<typeof blessed.list>;
let optBox: ReturnType<typeof blessed.checkbox>;
let logBox: ReturnType<typeof blessed.log>;
let statusBar: ReturnType<typeof blessed.box>;
let headerBar: ReturnType<typeof blessed.box>;
let outputBar: ReturnType<typeof blessed.box>;
let inputBar: ReturnType<typeof blessed.box>;
let methodDescBox: ReturnType<typeof blessed.box>;
let helpBox: ReturnType<typeof blessed.box> | null = null;
let promptWidget: ReturnType<typeof blessed.prompt> | null = null;

let baseOpts: CliOptions;
let watchDir = process.cwd();
let files: string[] = [];
let selected = new Set<number>();
const customOutputs = new Map<string, string>(); // input abs path -> output abs path
let vectorizing = false;
let focus: Focus = 'files';
let methodSelected = 0;
let watcher: ReturnType<typeof chokidar.watch> | null = null;

function whichDir(candidate: string | undefined): string {
  if (!candidate) return process.cwd();
  try {
    if (statSync(candidate).isDirectory()) return candidate;
    return dirname(candidate);
  } catch {
    return dirname(candidate);
  }
}

function currentMethod(): CliOptions['method'] {
  return (listMethods()[methodSelected]?.id ?? baseOpts.method) as CliOptions['method'];
}

function fullOptions(): CliOptions {
  return {
    ...baseOpts,
    method: currentMethod(),
    optimize: optBox.checked ?? true,
  };
}

function getOutputForFile(file: string): string {
  const custom = customOutputs.get(file);
  if (custom) return custom;
  return outputPath(file, baseOpts.outDir);
}

function log(line: string): void {
  logBox.add(line);
  screen.render();
}

function openInDefaultApp(filePath: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') cmd = `start "" "${filePath}"`;
  else if (platform === 'darwin') cmd = `open "${filePath}"`;
  else cmd = `xdg-open "${filePath}"`;
  exec(cmd, (err) => {
    if (err) log(`{red-fg}open failed: ${err.message}{/red-fg}`);
    else log(`{cyan-fg}opened{/cyan-fg} ${basename(filePath)} in default app`);
  });
}

function renderFileItems(): string[] {
  if (files.length === 0) return ['{gray-fg}(no images - press i to choose input, n to add){/gray-fg}'];
  return files.map((f, idx) => {
    const rel = relative(watchDir, f) || basename(f);
    const mark = selected.has(idx) ? '{green-fg}[x]{/green-fg}' : '[ ]';
    const out = getOutputForFile(f);
    const outRel = relative(process.cwd(), out);
    const isCustom = customOutputs.has(f);
    const outHint = isCustom ? ` → {yellow-fg}${outRel}{/yellow-fg}` : ` → {gray-fg}${outRel}{/gray-fg}`;
    const focusMark = fileList && (fileList as any).selected === idx ? '› ' : '  ';
    return `${mark} ${focusMark}${rel}${outHint}`;
  });
}

function refreshFiles(): void {
  const items = renderFileItems();
  // blessed list setItems will reset selection, preserve index
  const sel = (fileList as any)?.selected ?? 0;
  fileList.setItems(items as any);
  try { (fileList as any).select(Math.min(sel, Math.max(0, files.length - 1))); } catch {}
  // update labels/bars
  const selCount = selected.size;
  const selHint = selCount > 0 ? ` {green-fg}${selCount} selected{/green-fg}` : '';
  fileList.setLabel(` Inputs: ${watchDir} (${files.length} image(s))${selHint} `);
  inputBar.setContent(` In: {cyan-fg}${watchDir}{/cyan-fg}  | {gray-fg}i:change  n:add  Del:remove{/gray-fg}`);
  const outDirHint = baseOpts.outDir ? baseOpts.outDir : '(next to source)';
  const customCount = customOutputs.size;
  const customHint = customCount ? ` {yellow-fg}${customCount} renamed{/yellow-fg}` : '';
  outputBar.setContent(` Out: {cyan-fg}${outDirHint}{/cyan-fg}${customHint}  | {gray-fg}o:out dir  r:rename output  v:open SVG{/gray-fg}`);
  // details pane - context aware so it's never empty
  const m = listMethods()[methodSelected];
  if (focus === 'method' && m) {
    methodDescBox.setContent(`{white-fg}${m.name}{/white-fg} {gray-fg}(${m.id}){/gray-fg}\n{gray-fg}${m.description}{/gray-fg}\n{cyan-fg}↑/↓ pick • Enter confirm • Tab next{/cyan-fg}`);
    methodDescBox.setLabel(' Details — Method ');
  } else if (focus === 'optimize') {
    const on = optBox.checked;
    methodDescBox.setContent(
      on ? `{green-fg}SVGO ON{/green-fg} — removes junk, minifies SVG (smaller files)\n{gray-fg}Toggle: Space when focused • also affects batch{/gray-fg}` : `{yellow-fg}SVGO OFF{/yellow-fg} — keeps raw trace output (larger, more faithful)\n{gray-fg}Toggle: Space when focused{/gray-fg}`
    );
    methodDescBox.setLabel(' Details — Optimize ');
  } else {
    const f = files[(fileList as any)?.selected ?? 0];
    if (f) {
      const out = getOutputForFile(f);
      methodDescBox.setContent(`{white-fg}${basename(f)}{/white-fg}\n{gray-fg}in: {/gray-fg}${relative(watchDir, f) || f}\n{gray-fg}out:{/gray-fg} {cyan-fg}${relative(process.cwd(), out)}{/cyan-fg}`);
      methodDescBox.setLabel(' Details — Selected file ');
    } else {
      methodDescBox.setContent(`{gray-fg}No file selected{/gray-fg}\n{cyan-fg}i{/cyan-fg} change input  {cyan-fg}n{/cyan-fg} add file  {cyan-fg}o{/cyan-fg} out dir  {cyan-fg}r{/cyan-fg} rename`);
      methodDescBox.setLabel(' Details — Guide ');
    }
  }
  // keep checkbox label in sync so Tab target is obvious
  const on = optBox.checked ? 'ON' : 'OFF';
  const boxOn = optBox.checked ? '{green-fg}ON{/green-fg}' : '{yellow-fg}OFF{/yellow-fg}';
  try {
    (optBox as any).setLabel(` Optimize (SVGO) [${on}] — Space to toggle `);
    (optBox as any).content = ` [${optBox.checked ? 'x' : ' '}] Optimize (SVGO) [${on}] — Space`;
  } catch {}
  const focusedLabel = focus === 'files' ? '{cyan-fg}FILES{/cyan-fg}' : focus === 'method' ? '{magenta-fg}METHOD{/magenta-fg}' : `{green-fg}OPTIMIZE ${boxOn}{/green-fg}`;
  headerBar.setContent(
    ` {white-fg}Klear{/white-fg}  1.Inputs {gray-fg}[i/n]{/gray-fg} > 2.Method {gray-fg}[Tab]{/gray-fg} > 3.Outputs {gray-fg}[o/r]{/gray-fg} > 4.Convert {gray-fg}[Enter/a]{/gray-fg}  |  Focus:${focusedLabel}  |  {yellow-fg}?:help  q:quit{/yellow-fg} `,
  );
  statusBar.setContent(
    ` ${files.length} image(s)${selHint}  |  method: ${currentMethod()}  |  out: ${outDirHint}  |  SVGO: ${boxOn}  |  {gray-fg}Space:select  Enter:convert  a:all  v:open  ?:help{/gray-fg} `,
  );
  screen.render();
}

function setFocus(next: Focus): void {
  focus = next;
  if (next === 'files') fileList.focus();
  else if (next === 'method') methodList.focus();
  else optBox.focus();
  refreshFiles();
}

function quit(): void {
  try { watcher?.close(); } catch {}
  screen.destroy();
  process.exit(0);
}

function isPromptOpen(): boolean {
  return !!promptWidget || !!helpBox;
}

function showPrompt(title: string, initial: string, cb: (val: string | null) => void): void {
  if (promptWidget) return;
  promptWidget = blessed.prompt({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: 7,
    border: { type: 'line' },
    label: ` ${title} `,
    tags: true,
    keys: true,
    vi: true,
    style: { border: { fg: 'cyan' } },
  }) as any;
  (promptWidget as any).input(title, initial, (err: any, value: string | undefined) => {
    const v = value;
    if (promptWidget) {
      screen.remove(promptWidget as any);
      promptWidget = null;
      screen.render();
    }
    // return focus
    setFocus(focus);
    if (err || v === undefined) cb(null);
    else cb(v);
  });
  screen.render();
}

function showHelp(): void {
  if (helpBox) return;
  const methods = listMethods().map(m => `  {cyan-fg}${m.id}{/cyan-fg} — ${m.name}: ${m.description}`).join('\n');
  helpBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '78%',
    height: '78%',
    border: { type: 'line' },
    label: ' Help — Dashboard 2.0 (press q/Esc/? to close) ',
    tags: true,
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    content:
      `{white-fg}Workflow (guided){/white-fg}\n` +
      `  1. {cyan-fg}Inputs{/cyan-fg}  — pick where images come from\n` +
      `     {gray-fg}i{/gray-fg} change source directory (rescan)   {gray-fg}n{/gray-fg} add file/folder to list   {gray-fg}Del{/gray-fg} remove selected\n` +
      `  2. {magenta-fg}Method{/magenta-fg} — how to vectorize\n` +
      `     {gray-fg}Tab{/gray-fg} focus Method, {gray-fg}↑/↓{/gray-fg} pick, description below list\n` +
      `     ${methods}\n` +
      `  3. {cyan-fg}Outputs{/cyan-fg} — where SVGs go + custom names\n` +
      `     {gray-fg}o{/gray-fg} set global out dir (empty = next to source)   {gray-fg}r{/gray-fg} rename output for highlighted file\n` +
      `     Use location + name: e.g. {gray-fg}./out/icon.svg{/gray-fg} or {gray-fg}C:\\exports\\logo.svg{/gray-fg}\n` +
      `     Renamed files show {yellow-fg}yellow{/yellow-fg} in list, stored per-input (survives rescan)\n` +
      `  4. {green-fg}Convert{/green-fg} & preview\n` +
      `     {gray-fg}Enter{/gray-fg} convert highlighted  {gray-fg}Space{/gray-fg} multi-select  {gray-fg}a{/gray-fg} convert selected (or all)  {gray-fg}v{/gray-fg} open SVG in default app\n` +
      `\n{white-fg}Inputs & Outputs detail{/white-fg}\n` +
      `  Inputs: any .png/.jpg/.jpeg file or folder (recursive, watches for add/remove)\n` +
      `  Outputs: global outDir + per-file override. Final path = override || outputPath(input, outDir)\n` +
      `  On conflict SVG is overwritten — {gray-fg}r{/gray-fg} lets you pick a new name/location first.\n` +
      `\n{white-fg}Keys{/white-fg}\n` +
      `  {gray-fg}Tab{/gray-fg} cycle focus  {gray-fg}q{/gray-fg} quit  {gray-fg}?/h/F1{/gray-fg} help  {gray-fg}Ctrl-C{/gray-fg} quit\n` +
      `  {gray-fg}Space{/gray-fg} toggle select  {gray-fg}Enter{/gray-fg} convert one  {gray-fg}a{/gray-fg} batch  {gray-fg}v{/gray-fg} open  {gray-fg}i/o/r/n/Del{/gray-fg} as above\n` +
      `\n{gray-fg}Tip: batch CLI still works: klear [options] <file|dir ...> — TUI is for exploration.{/gray-fg}`,
    style: { border: { fg: 'yellow' } },
  }) as any;
  helpBox!.focus();
  helpBox!.key(['q', 'escape', '?', 'h'], () => {
    if (helpBox) { screen.remove(helpBox as any); helpBox = null; screen.render(); setFocus(focus); }
  });
  screen.render();
}

async function rescanInputs(newDir?: string): Promise<void> {
  if (newDir) {
    const resolved = resolve(newDir);
    try {
      const st = statSync(resolved);
      if (st.isDirectory()) {
        // change watched dir
        try { await watcher?.close(); } catch {}
        watchDir = resolved;
        // clean custom outputs that no longer exist? keep them
      } else if (st.isFile()) {
        // if single file passed as input dir replacement, add it
        if (isImageFile(resolved) && !files.includes(resolved)) {
          files.push(resolved);
          files.sort();
          selected.clear();
          refreshFiles();
          log(`{cyan-fg}+ added{/cyan-fg} ${relative(process.cwd(), resolved)}`);
          return;
        }
        watchDir = dirname(resolved);
      }
    } catch {
      watchDir = resolve(whichDir(newDir));
    }
    setupWatcher();
  }
  const found = await findImageFiles(watchDir);
  // preserve customOutputs for files that still exist + add new files
  // keep manually added files that are outside watchDir?
  const outside = files.filter(f => !f.startsWith(watchDir) && !found.includes(f));
  files = [...found, ...outside].sort();
  selected.clear();
  refreshFiles();
  log(`{cyan-fg}✓{/cyan-fg} inputs: ${watchDir} (${found.length} found${outside.length ? ` + ${outside.length} outside` : ''})`);
}

function setupWatcher(): void {
  try { watcher?.close(); } catch {}
  watcher = chokidar.watch(watchDir, { ignoreInitial: true, depth: 4 });
  watcher.on('add', (f) => {
    if (!isImageFile(f)) return;
    if (!files.includes(f)) {
      files.push(f);
      files.sort();
      refreshFiles();
      log(`{gray-fg}+ watch add{/gray-fg} ${relative(watchDir, f) || basename(f)}`);
    }
  });
  watcher.on('unlink', (f) => {
    const i = files.indexOf(f);
    if (i >= 0) {
      files.splice(i, 1);
      selected.delete(i);
      // reindex selected
      const newSel = new Set<number>();
      for (const idx of selected) {
        if (idx < i) newSel.add(idx);
        else if (idx > i) newSel.add(idx - 1);
      }
      selected = newSel;
      refreshFiles();
      log(`{gray-fg}- watch remove{/gray-fg} ${relative(watchDir, f) || basename(f)}`);
    }
  });
  watcher.on('error', (err: Error) => log(`{red-fg}watch error: ${err.message}{/red-fg}`));
}

async function vectorizeOne(file: string): Promise<void> {
  if (vectorizing) return;
  vectorizing = true;
  const out = getOutputForFile(file);
  statusBar.setContent(` Vectorizing ${basename(file)} → ${relative(process.cwd(), out)} … `);
  screen.render();
  try {
    // vectorizeFile respects outDir, but we have per-file override -> pass custom dir/base via outDir override trick
    // we handle custom by writing to our resolved path manually if needed
    const custom = customOutputs.get(file);
    let result: any;
    let output: string;
    if (custom) {
      // use baseOpts but override outDir to dirname(custom) and handle basename via temp output then rename?
      // simpler: vectorize to buffer then write to custom path ourselves
      const buf = await (await import('node:fs/promises')).readFile(file);
      const { vectorize } = await import('@klear/core');
      const { outputPath: _op } = await import('./lib.js');
      // We still need method options handling - reuse vectorizeFile logic via fullOptions but write manually
      const opts = fullOptions();
      const { vectorize: doVec } = await import('@klear/core');
      // call vectorizeFile with custom outDir then move? easier: call vectorize directly
      const { promises: fsp } = await import('node:fs');
      const { dirname: d } = await import('node:path');
      const vec = await doVec(buf, { method: opts.method, optimize: opts.optimize, options: { ...(opts.resizeMax!==undefined?{resizeMax:opts.resizeMax}:{}), ...(opts.maxColors!==undefined?{maxColors:opts.maxColors}:{}), ...(opts.edgeTolerance!==undefined?{edgeTolerance:opts.edgeTolerance}:{}) }});
      await fsp.mkdir(dirname(custom), { recursive: true });
      await fsp.writeFile(custom, vec.svg);
      result = vec;
      output = custom;
    } else {
      const r = await vectorizeFile(file, fullOptions());
      result = r.result;
      output = r.output;
    }
    log(
      `{green-fg}✓{/green-fg} ${basename(file)} → ${relative(process.cwd(), output)}` +
        ` (${result.svg.length} bytes${result.note ? `, ${result.note}` : ''}) {gray-fg}v:open{/gray-fg}`,
    );
  } catch (cause) {
    log(`{red-fg}✗{/red-fg} ${basename(file)}: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    vectorizing = false;
    refreshFiles();
  }
}

async function vectorizeSelected(): Promise<void> {
  const targets = selected.size > 0 ? [...selected].sort((a,b)=>a-b).map(i=>files[i]!).filter(Boolean) : files;
  if (targets.length === 0) {
    log('{yellow-fg}no images — press i to choose input, n to add{/yellow-fg}');
    return;
  }
  log(`{blue-fg}→ converting ${targets.length} image(s) [out: ${baseOpts.outDir || 'next to source'}]…{/blue-fg}`);
  let ok = 0;
  for (const file of targets) {
    const out = getOutputForFile(file);
    try {
      const custom = customOutputs.get(file);
      if (custom) {
        const { promises: fsp } = await import('node:fs');
        const buf = await fsp.readFile(file);
        const { vectorize } = await import('@klear/core');
        const opts = fullOptions();
        const vec = await vectorize(buf, { method: opts.method, optimize: opts.optimize, options: { ...(opts.resizeMax!==undefined?{resizeMax:opts.resizeMax}:{}), ...(opts.maxColors!==undefined?{maxColors:opts.maxColors}:{}), ...(opts.edgeTolerance!==undefined?{edgeTolerance:opts.edgeTolerance}:{}) }});
        await fsp.mkdir(dirname(custom), { recursive: true });
        await fsp.writeFile(custom, vec.svg);
        ok++;
        log(`{green-fg}✓{/green-fg} ${basename(file)} → ${relative(process.cwd(), custom)}`);
      } else {
        const { result, output } = await vectorizeFile(file, fullOptions());
        ok++;
        log(`{green-fg}✓{/green-fg} ${basename(file)} → ${relative(process.cwd(), output)} (${result.svg.length} bytes)`);
      }
    } catch (cause) {
      log(`{red-fg}✗{/red-fg} ${basename(file)}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  log(`{cyan-fg}done{/cyan-fg} ${ok}/${targets.length} ok — press v to open SVGs`);
  refreshFiles();
}

function currentFocusedFile(): string | undefined {
  const idx = (fileList as any)?.selected ?? 0;
  return files[idx];
}

export function runTui(start: string, opts: CliOptions): void {
  baseOpts = opts;
  watchDir = resolve(whichDir(start));
  const startIndex = listMethods().findIndex((m) => m.id === opts.method);
  methodSelected = startIndex >= 0 ? startIndex : 0;

  screen = blessed.screen({ smartCSR: true, title: 'Klear TUI — Dashboard 2.0' });

  headerBar = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { fg: 'white', bg: 'blue' },
    content: '',
  });

  inputBar = blessed.box({
    top: 1,
    left: 0,
    width: '55%',
    height: 1,
    tags: true,
    style: { fg: 'white', bg: 'black' },
    content: '',
  });

  outputBar = blessed.box({
    top: 1,
    left: '55%',
    width: '45%',
    height: 1,
    tags: true,
    style: { fg: 'white', bg: 'black' },
    content: '',
  });

  fileList = blessed.list({
    label: ' Inputs ',
    top: 2,
    left: 0,
    width: '55%',
    height: '100%-4',
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    border: { type: 'line' },
    scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    style: {
      selected: { bg: 'cyan', fg: 'black', bold: true },
      focus: { border: { fg: 'cyan' } },
      border: { fg: 'gray' },
      item: { fg: 'white' },
    },
  });

  methodList = blessed.list({
    label: ' Method (2) ',
    top: 2,
    left: '55%',
    width: '45%',
    height: 5,
    items: listMethods().map((m) => `${m.id} — ${m.name}`),
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    border: { type: 'line' },
    style: {
      selected: { bg: 'magenta', fg: 'white', bold: true },
      focus: { border: { fg: 'magenta' } },
      border: { fg: 'gray' },
    },
  });
  methodList.select(methodSelected);

  methodDescBox = blessed.box({
    top: 7,
    left: '55%',
    width: '45%',
    height: 4,
    tags: true,
    border: { type: 'line' },
    label: ' Details ',
    style: { border: { fg: 'gray' }, fg: 'white' },
    content: '',
  });

  optBox = blessed.checkbox({
    parent: screen,
    label: ' Optimize (SVGO) [ON] — Space to toggle ',
    top: 11,
    left: '55%',
    width: '45%',
    height: 1,
    content: ' [x] Optimize (SVGO) — Space to toggle',
    checked: opts.optimize,
    keys: true,
    mouse: true,
    style: { fg: 'white', bg: 'black', focus: { fg: 'black', bg: 'green' } },
  } as any);

  // Output hint box (shows selected file's output)
  const outHintBox = blessed.box({
    top: 12,
    left: '55%',
    width: '45%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    label: ' Output (3) ',
    style: { border: { fg: 'gray' } },
    content: '',
  });

  logBox = blessed.log({
    label: ' Log ',
    top: 15,
    left: '55%',
    width: '45%',
    height: '100%-16',
    tags: true,
    scrollback: 800,
    mouse: true,
    keys: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' } },
  });

  statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { fg: 'black', bg: 'white' },
    content: '',
  });

  screen.append(headerBar);
  screen.append(inputBar);
  screen.append(outputBar);
  screen.append(fileList);
  screen.append(methodList);
  screen.append(methodDescBox);
  // optBox already parented
  screen.append(outHintBox);
  screen.append(logBox);
  screen.append(statusBar);

  function refreshOutHint(): void {
    const f = currentFocusedFile();
    if (!f) { outHintBox.setContent('{gray-fg}no file selected{/gray-fg}'); return; }
    const out = getOutputForFile(f);
    const relOut = relative(process.cwd(), out);
    outHintBox.setContent(` {gray-fg}in:{/gray-fg} {white-fg}${basename(f)}{/white-fg}\n {gray-fg}out:{/gray-fg} {cyan-fg}${relOut}{/cyan-fg}\n {gray-fg}o:out dir  r:rename  v:open{/gray-fg}`);
  }

  fileList.on('select', (_item: any, index: number) => {
    // Enter converts the highlighted file; if multi-selected, convert that one only (explicit)
    const file = files[index];
    if (file) void vectorizeOne(file);
  });

  methodList.on('select', (_item: any, index: number) => {
    methodSelected = index;
    refreshFiles();
  });
  // also update details while navigating without Enter (blessed fires 'move' via keypress)
  methodList.on('keypress', () => setTimeout(() => {
    const idx = (methodList as any).selected ?? methodSelected;
    if (idx !== methodSelected) {
      methodSelected = idx;
      refreshFiles();
    } else if (focus === 'method') refreshFiles();
  }, 0));
  (optBox as any).on('check', () => refreshFiles());
  (optBox as any).on('uncheck', () => refreshFiles());

  // navigation: fileList select change updates out hint
  fileList.on('keypress', () => setTimeout(() => { refreshOutHint(); screen.render(); }, 0));
  fileList.key(['space'], () => {
    const idx = (fileList as any).selected ?? 0;
    if (files[idx]) {
      if (selected.has(idx)) selected.delete(idx);
      else selected.add(idx);
      refreshFiles();
      refreshOutHint();
    }
  });
  fileList.key(['delete', 'backspace'], () => {
    const idx = (fileList as any).selected ?? 0;
    const f = files[idx];
    if (!f) return;
    files.splice(idx, 1);
    customOutputs.delete(f);
    const newSel = new Set<number>();
    for (const s of selected) {
      if (s < idx) newSel.add(s);
      else if (s > idx) newSel.add(s - 1);
    }
    selected = newSel;
    refreshFiles();
    refreshOutHint();
    log(`{yellow-fg}removed{/yellow-fg} ${basename(f)} from list`);
  });

  // global keys
  screen.key(['q', 'C-c'], () => { if (!isPromptOpen()) quit(); });

  screen.key(['a'], () => { if (!isPromptOpen()) void vectorizeSelected(); });
  screen.key(['tab'], () => {
    if (isPromptOpen()) return;
    const order: Focus[] = ['files', 'method', 'optimize'];
    const idx = order.indexOf(focus);
    setFocus(order[(idx + 1) % order.length]!);
  });
  screen.key(['?', 'h', 'f1'], () => { if (!isPromptOpen()) showHelp(); });

  screen.key(['i'], () => {
    if (isPromptOpen()) return;
    showPrompt('Input source (file or folder)', watchDir, (val) => {
      if (val === null) return;
      const v = val.trim();
      if (!v) return;
      void rescanInputs(v);
    });
  });

  screen.key(['n'], () => {
    if (isPromptOpen()) return;
    showPrompt('Add file or folder to inputs', '', (val) => {
      if (val === null) return;
      const v = val.trim();
      if (!v) return;
      const p = isAbsolute(v) ? resolve(v) : resolve(process.cwd(), v);
      void (async () => {
        const found = await findImageFiles(p);
        if (found.length === 0) {
          log(`{yellow-fg}no images found at{/yellow-fg} ${v}`);
          return;
        }
        let added = 0;
        for (const f of found) if (!files.includes(f)) { files.push(f); added++; }
        files.sort();
        refreshFiles();
        refreshOutHint();
        log(`{cyan-fg}+ added{/cyan-fg} ${added} image(s) from ${v}`);
      })();
    });
  });

  screen.key(['o'], () => {
    if (isPromptOpen()) return;
    showPrompt('Output directory (empty = next to source)', baseOpts.outDir ?? '', (val) => {
      if (val === null) return;
      const v = val.trim();
      baseOpts.outDir = v || undefined;
      refreshFiles();
      refreshOutHint();
      log(`{cyan-fg}out dir{/cyan-fg} → ${baseOpts.outDir || '(next to source)'}`);
    });
  });

  screen.key(['r'], () => {
    if (isPromptOpen()) return;
    const f = currentFocusedFile();
    if (!f) { log('{yellow-fg}no file selected to rename{/yellow-fg}'); return; }
    const currentOut = getOutputForFile(f);
    showPrompt(`New name/location for ${basename(f)} (e.g. ./out/custom.svg)`, currentOut, (val) => {
      if (val === null) return;
      const v = val.trim();
      if (!v) { customOutputs.delete(f); refreshFiles(); refreshOutHint(); log(`{yellow-fg}reset{/yellow-fg} ${basename(f)} → default`); return; }
      let resolved: string;
      // allow bare name like "my-icon" or "my-icon.svg" or path
      const hasSep = v.includes('/') || v.includes('\\');
      const hasExt = extname(v).toLowerCase() === '.svg';
      if (!hasSep && !hasExt) resolved = resolve(baseOpts.outDir ?? dirname(f), `${v}.svg`);
      else if (!hasSep && hasExt) resolved = resolve(baseOpts.outDir ?? dirname(f), v);
      else if (hasSep) {
        const maybe = isAbsolute(v) ? v : resolve(process.cwd(), v);
        resolved = extname(maybe) ? maybe : `${maybe}.svg`;
      } else resolved = resolve(v);
      customOutputs.set(f, resolved);
      refreshFiles();
      refreshOutHint();
      log(`{cyan-fg}rename{/cyan-fg} ${basename(f)} → ${relative(process.cwd(), resolved)}`);
    });
  });

  screen.key(['v', 'p'], () => {
    if (isPromptOpen()) return;
    const f = currentFocusedFile();
    if (!f) return;
    const out = getOutputForFile(f);
    // check exists
    import('node:fs').then(({ existsSync }) => {
      if (!existsSync(out)) {
        log(`{yellow-fg}no SVG yet for{/yellow-fg} ${basename(f)} — press Enter to convert first`);
        // try default location if custom doesn't exist but default does?
        const def = outputPath(f, baseOpts.outDir);
        if (def !== out && existsSync(def)) {
          log(`{gray-fg}found at default:{/gray-fg} ${relative(process.cwd(), def)} — opening`);
          openInDefaultApp(def);
        }
        return;
      }
      openInDefaultApp(out);
    });
  });

  // keep out hint synced
  const origRefresh = refreshFiles;
  // monkey patch to also refresh hint (wrap)
  const wrappedRefresh = () => { origRefresh(); refreshOutHint(); };
  // replace reference used elsewhere - easiest: assign after definition
  // We'll just call refreshOutHint in refreshFiles tail already via inputBar etc, but also need on focus change
  // So override refreshFiles variable (not const) - we defined as function, so reassign via global
  (global as any).__refreshOutHint = refreshOutHint;

  refreshFiles();
  refreshOutHint();
  rescanInputs();
  setupWatcher();
  setFocus('files');
  log(`{gray-fg}Dashboard 2.0{/gray-fg} — {cyan-fg}1.Inputs[i/n]{/cyan-fg} → {magenta-fg}2.Method[Tab]{/magenta-fg} → {cyan-fg}3.Outputs[o/r]{/cyan-fg} → {green-fg}4.Convert[Enter/a]{/green-fg}  | {yellow-fg}?{/yellow-fg} help`);
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  // explicit tui subcommand: `klear tui [dir] [options]`
  let argv = raw;
  let forceTui = false;
  if (raw[0] === 'tui') {
    forceTui = true;
    argv = raw.slice(1);
  }
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (cause) {
    console.error(`klear: ${cause instanceof Error ? cause.message : String(cause)}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (forceTui) opts.watch = true;

  if (opts.watch) {
    runTui(opts.inputs[0] ?? process.cwd(), opts);
    return;
  }

  const collected = new Set<string>();
  for (const input of opts.inputs) {
    const path = isAbsolute(input) ? resolve(input) : resolve(process.cwd(), input);
    try {
      for (const f of await findImageFiles(path)) collected.add(f);
    } catch (cause) {
      console.error(`klear: cannot read '${input}': ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    }
  }
  const batchFiles = [...collected].sort();
  if (batchFiles.length === 0) {
    if (opts.inputs.length > 0) {
      console.error('klear: no supported images found in the given paths');
      process.exitCode = 1;
    } else {
      runTui(process.cwd(), opts);
    }
    return;
  }

  const t0 = Date.now();
  console.log(`klear: vectorizing ${batchFiles.length} file(s) with "${opts.method}"…`);
  const ok = await runBatch(batchFiles, opts, (e) => {
    if (e.status === 'ok') {
      console.log(`  ok    ${e.file} -> ${e.output} (${e.ms}ms)${e.note ? ` [${e.note}]` : ''}`);
    } else {
      console.error(`  fail  ${e.file}: ${e.error}`);
    }
  });
  console.log(`klear: done in ${Date.now() - t0}ms (${ok}/${batchFiles.length} ok)`);
  if (ok < batchFiles.length) process.exitCode = 1;
}

main().catch((cause) => {
  console.error(`klear: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
