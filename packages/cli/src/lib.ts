/**
 * Klear CLI — shared, testable logic for the TUI and the batch command.
 */
import { promises as fsp } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  vectorize,
  listMethods,
  type MethodOptions,
  type VectorizeMethod,
  type VectorizeResult,
} from '@klear/core';

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

export interface CliOptions {
  method: VectorizeMethod;
  outDir?: string;
  optimize: boolean;
  resizeMax?: number;
  maxColors?: number;
  edgeTolerance?: number;
  watch: boolean;
  inputs: string[];
}

export interface BatchEvent {
  file: string;
  status: 'ok' | 'error';
  output?: string;
  note?: string;
  error?: string;
  ms: number;
}

const METHODS: VectorizeMethod[] = listMethods().map((m) => m.id);

/** Minimal flag parser: supports `--key value`, `--flag` and file/dir paths. */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    method: 'potrace',
    optimize: true,
    watch: false,
    inputs: [],
  };

  const takeValue = (flag: string, i: number): [string, number] => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return [v, i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--method': {
        const [v, next] = takeValue('--method', i);
        i = next;
        if (!METHODS.includes(v as VectorizeMethod)) {
          throw new Error(
            `Unknown method '${v}'. Available: ${METHODS.join(', ')}`,
          );
        }
        opts.method = v as VectorizeMethod;
        break;
      }
      case '--out': {
        const [v, next] = takeValue('--out', i);
        i = next;
        opts.outDir = v;
        break;
      }
      case '--colors': {
        const [v, next] = takeValue('--colors', i);
        i = next;
        opts.maxColors = parseInt(v, 10);
        break;
      }
      case '--resize-max': {
        const [v, next] = takeValue('--resize-max', i);
        i = next;
        opts.resizeMax = parseInt(v, 10);
        break;
      }
      case '--tolerance': {
        const [v, next] = takeValue('--tolerance', i);
        i = next;
        opts.edgeTolerance = parseFloat(v);
        break;
      }
      case '--optimize':
        opts.optimize = true;
        break;
      case '--no-optimize':
        opts.optimize = false;
        break;
      case '--watch':
        opts.watch = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option '${arg}'`);
        }
        opts.inputs.push(arg);
    }
  }
  return opts;
}

export function printUsage(): void {
  console.log(`Klear — raster-to-SVG vectorizer

Usage:
  klear [options] <file|dir ...>     Batch convert (straightforward)
  klear tui [dir] [options]          Open interactive TUI (Dashboard 2.0)
  klear --watch [dir] [options]      Alias for tui

  Run with no file arguments to open the interactive TUI.

TUI guidance:
  1. Inputs  [i] change source dir  [n] add file/folder
  2. Method  [Tab] focus, arrows pick
  3. Outputs [o] out dir  [r] rename selected output  [Space] multi-select
  4. Convert [Enter] selected / [a] all  [v] open SVG in default app  [?] help

Options:
  --method <m>        Trace method: ${METHODS.join(', ')} (default: potrace)
  --out <dir>         Write SVGs into <dir> (default: next to each source)
  --colors <n>        Max palette colors for imagetracer/edge (default: 16)
  --resize-max <n>    Downscale long side to <n> px before tracing edge
  --tolerance <n>     RDP simplification tolerance in px (edge, default: 1)
  --optimize          Optimize output with SVGO (default)
  --no-optimize       Skip SVGO optimization
  --watch             Open the TUI watching the target directory
  -h, --help          Show this help`);
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTS.has(extname(path).toLowerCase());
}

/** Recursively collect image files under `path` (file or directory). */
export async function findImageFiles(path: string): Promise<string[]> {
  const out: string[] = [];
  await walk(path, out);
  return out.sort();
}

async function walk(path: string, out: string[]): Promise<void> {
  let stat;
  try {
    stat = await fsp.stat(path);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (isImageFile(path)) out.push(resolve(path));
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = await fsp.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git'
      )
        continue;
      await walk(join(path, entry.name), out);
    } else if (entry.isFile() && isImageFile(entry.name)) {
      out.push(resolve(path, entry.name));
    }
  }
}

/** Where the SVG for `input` should be written. */
export function outputPath(input: string, outDir?: string): string {
  const base = basename(input).replace(/\.(png|jpe?g)$/i, '');
  if (outDir) return resolve(outDir, `${base}.svg`);
  return input.replace(/\.(png|jpe?g)$/i, '') + '.svg';
}

function methodOptions(opts: CliOptions): MethodOptions {
  const o: MethodOptions = {};
  if (opts.resizeMax !== undefined) o.resizeMax = opts.resizeMax;
  if (opts.maxColors !== undefined) o.maxColors = opts.maxColors;
  if (opts.edgeTolerance !== undefined) o.edgeTolerance = opts.edgeTolerance;
  return o;
}

export interface FileResult {
  result: VectorizeResult;
  output: string;
}

/** Vectorize a single image file and write the SVG to disk. */
export async function vectorizeFile(
  file: string,
  opts: CliOptions,
  outDir?: string,
): Promise<FileResult> {
  const buf = await fsp.readFile(file);
  const result = await vectorize(buf, {
    method: opts.method,
    optimize: opts.optimize,
    options: methodOptions(opts),
  });
  const output = outputPath(file, outDir ?? opts.outDir);
  await fsp.mkdir(dirname(output), { recursive: true });
  await fsp.writeFile(output, result.svg);
  return { result, output };
}

/** Vectorize a list of files sequentially, reporting progress via `onEvent`. */
export async function runBatch(
  files: string[],
  opts: CliOptions,
  onEvent: (event: BatchEvent) => void,
): Promise<number> {
  let ok = 0;
  for (const file of files) {
    const t0 = Date.now();
    try {
      const { result, output } = await vectorizeFile(file, opts);
      ok += 1;
      onEvent({
        file,
        status: 'ok',
        output,
        note: result.note,
        ms: Date.now() - t0,
      });
    } catch (cause) {
      onEvent({
        file,
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
        ms: Date.now() - t0,
      });
    }
  }
  return ok;
}
