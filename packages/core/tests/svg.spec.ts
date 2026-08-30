import { describe, it, expect } from 'vitest';
import { normalizeSvg, optimizeSvg, escapeAttr } from '../src/utils/svg.js';

describe('normalizeSvg', () => {
  it('rewrites the root <svg> tag with explicit dimensions + viewBox', () => {
    const input = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0"/></svg>`;
    const out = normalizeSvg(input, {
      width: 100,
      height: 200,
      viewBoxWidth: 20,
      viewBoxHeight: 40,
    });
    expect(out).toContain(`width="100"`);
    expect(out).toContain(`height="200"`);
    expect(out).toContain(`viewBox="0 0 20 40"`);
    expect(out).toContain(`preserveAspectRatio="xMidYMid meet"`);
    expect(out).toContain(`<path d="M0 0"/>`);
  });

  it('throws for non-positive viewBox dimensions', () => {
    expect(() =>
      normalizeSvg('<svg></svg>', {
        width: 1,
        height: 1,
        viewBoxWidth: 0,
        viewBoxHeight: 10,
      }),
    ).toThrow();
  });
});

describe('optimizeSvg', () => {
  it('compacts markup but keeps the viewBox', () => {
    const input =
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">` +
      `<!-- keep? no --><path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" fill="rgb(255,0,0)"/></svg>`;
    const out = optimizeSvg(input);
    expect(out).not.toContain('<!--');
    expect(out).toMatch(/viewBox="0\s+0\s+10\s+10"/);
    expect(out).not.toContain('undefined');
  });

  it('throws a KlearError for invalid markup', () => {
    expect(() => optimizeSvg('not svg at all')).toThrow();
  });
});

describe('escapeAttr', () => {
  it('escapes XML-special characters', () => {
    expect(escapeAttr(`"<a&b>"`)).toBe(`&quot;&lt;a&amp;b&gt;&quot;`);
  });
});
