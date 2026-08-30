import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseArgs,
  outputPath,
  isImageFile,
  findImageFiles,
  vectorizeFile,
  runBatch,
  printUsage,
} from '../src/lib.js';

// 2x2 solid red PNG
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4o6FxR0ODAUIBACOuBLGwh8F2AAAAAElFTkSuQmCC',
  'base64',
);

let dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'klear-cli-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function scribble(dir: string): string {
  const img = join(dir, 'photo.png');
  writeFileSync(img, RED_PNG);
  writeFileSync(join(dir, 'notes.txt'), 'nope');
  const sub = join(dir, 'nested');
  mkdirSync(sub);
  writeFileSync(join(sub, 'pic.JPG'), RED_PNG);
  return img;
}

describe('parseArgs', () => {
  it('parses a plain path list', () => {
    const o = parseArgs(['a.png', 'b.jpg']);
    expect(o.inputs).toEqual(['a.png', 'b.jpg']);
    expect(o.method).toBe('potrace');
    expect(o.optimize).toBe(true);
    expect(o.watch).toBe(false);
  });

  it('parses flag values and booleans', () => {
    const o = parseArgs([
      '--method',
      'edge',
      '--out',
      'svgs',
      '--colors',
      '8',
      '--tolerance',
      '0.5',
      '--no-optimize',
      'img.png',
    ]);
    expect(o.method).toBe('edge');
    expect(o.outDir).toBe('svgs');
    expect(o.maxColors).toBe(8);
    expect(o.edgeTolerance).toBe(0.5);
    expect(o.optimize).toBe(false);
  });

  it('rejects unknown flags and stale values', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--method'])).toThrow(/Missing value/);
    expect(() => parseArgs(['--method', 'nope'])).toThrow(/Unknown method/);
  });

  it('prints usage without error', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printUsage();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('helpers', () => {
  it('recognizes image extensions case-insensitively', () => {
    expect(isImageFile('x.png')).toBe(true);
    expect(isImageFile('x.JPG')).toBe(true);
    expect(isImageFile('x.jpeg')).toBe(true);
    expect(isImageFile('x.gif')).toBe(false);
    expect(isImageFile('x.svg')).toBe(false);
  });

  it('computes output paths beside the source or in an output dir', () => {
    expect(outputPath('/a/b/c.png')).toBe('/a/b/c.svg');
    expect(outputPath('/a/b/c.jpg', '/out')).toBe(resolve('/out', 'c.svg'));
  });

  it('finds images recursively and skips junk', async () => {
    const root = tempDir();
    scribble(root);
    const found = await findImageFiles(root);
    expect(found).toHaveLength(2);
    expect(found.some((f) => f.endsWith('photo.png'))).toBe(true);
    expect(found.some((f) => f.endsWith('pic.JPG'))).toBe(true);
    // also accepts a bare file
    expect(await findImageFiles(found[0]!)).toEqual([found[0]]);
    // missing paths yield nothing
    expect(await findImageFiles(join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('vectorizeFile / runBatch', () => {
  it('writes an SVG next to the source by default', async () => {
    const root = tempDir();
    const img = scribble(root);
    const { output } = await vectorizeFile(img, {
      method: 'edge',
      optimize: true,
      watch: false,
      inputs: [],
    });
    expect(output).toBe(img.replace(/\.png$/i, '.svg'));
    expect(existsSync(output)).toBe(true);
    const svg = readFileSync(output, 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('undefined');
  });

  it('writes into an outDir when configured', async () => {
    const root = tempDir();
    const outDir = join(root, 'out');
    const img = scribble(root);
    const { output } = await vectorizeFile(img, {
      method: 'edge',
      optimize: true,
      watch: false,
      inputs: [],
      outDir,
    });
    expect(output).toBe(resolve(outDir, 'photo.svg'));
    expect(existsSync(output)).toBe(true);
  });

  it('reports per-file results through runBatch', async () => {
    const root = tempDir();
    scribble(root);
    const files = await findImageFiles(root);
    const events: string[] = [];
    const ok = await runBatch(
      files,
      { method: 'edge', optimize: false, watch: false, inputs: [] },
      (e) => events.push(`${e.status}:${e.file.split(/[\\/]/).pop()}`),
    );
    expect(ok).toBe(2);
    expect(events).toHaveLength(2);
    expect(events).toContain('ok:photo.png');
    expect(events).toContain('ok:pic.JPG');
  });
});
