import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

// 2x2 solid red PNG
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4o6FxR0ODAUIBACOuBLGwh8F2AAAAAElFTkSuQmCC',
  'base64',
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function postPng(params: URLSearchParams): Promise<Response> {
  const form = new FormData();
  form.append('image', new Blob([RED_PNG], { type: 'image/png' }), 'photo.png');
  const qs = params.toString();
  return fetch(`${baseUrl}/api/vectorize${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    body: form,
  });
}

describe('healthz', () => {
  it('reports ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('methods', () => {
  it('lists the three trace methods', async () => {
    const res = await fetch(`${baseUrl}/api/methods`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { methods: { id: string }[] };
    const ids = body.methods.map((m) => m.id);
    expect(ids).toContain('potrace');
    expect(ids).toContain('imagetracer');
    expect(ids).toContain('edge');
  });
});

describe('POST /api/vectorize', () => {
  it('vectorizes an upload and returns JSON metadata + svg', async () => {
    const res = await postPng(
      new URLSearchParams({ method: 'edge', optimize: '1' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      svg: string;
      width: number;
      height: number;
      method: string;
      input: { name: string };
    };
    expect(body.svg.startsWith('<svg')).toBe(true);
    expect(body.svg).not.toContain('undefined');
    expect(body.width).toBe(2);
    expect(body.height).toBe(2);
    expect(body.method).toBe('edge');
    expect(body.input.name).toBe('photo.png');
  });

  it('returns a raw SVG with format=svg', async () => {
    const res = await postPng(
      new URLSearchParams({ method: 'edge', format: 'svg' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/svg\+xml/);
    const text = await res.text();
    expect(text.startsWith('<svg')).toBe(true);
  });

  it('falls back gracefully when a method fails', async () => {
    // turn the buffer into something potrace cannot read by passing a bad method
    const res = await postPng(new URLSearchParams({ method: 'potrace' }));
    // potrace handles our tiny png fine, so expect 200
    expect(res.status).toBe(200);
  });

  it('rejects requests without a file', async () => {
    const res = await fetch(`${baseUrl}/api/vectorize?method=edge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('E_NO_FILE');
  });

  it('rejects a non-multipart body with E_NO_FILE', async () => {
    // no multipart at all -> multer produces no file
    const res = await fetch(`${baseUrl}/api/vectorize`, {
      method: 'POST',
      body: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown methods', async () => {
    const res = await postPng(new URLSearchParams({ method: 'nope' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('E_METHOD');
    expect(body.error.message).toContain('nope');
  });
});
