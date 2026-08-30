/**
 * Klear REST API — Express application factory.
 *
 * Endpoints:
 *   GET  /healthz        liveness probe
 *   GET  /api/methods    list of supported trace methods
 *   POST /api/vectorize  multipart (`image` file + options) -> SVG
 */
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';
import {
  listMethods,
  vectorize,
  KlearError,
  type MethodOptions,
  type VectorizeMethod,
  type VectorizeOptions,
} from '@klear/core';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v !== 'string') return undefined;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

/** Collect per-method options from the request query (and multipart fields). */
function methodOptions(req: Request): MethodOptions {
  const o: MethodOptions = {};
  const v = req.query;
  // potrace
  const threshold = num(v.threshold);
  if (threshold !== undefined) o.threshold = threshold;
  const turdSize = num(v.turdSize);
  if (turdSize !== undefined) o.turdSize = turdSize;
  const alphaMax = num(v.alphaMax);
  if (alphaMax !== undefined) o.alphaMax = alphaMax;
  const optCurve = bool(v.optCurve);
  if (optCurve !== undefined) o.optCurve = optCurve;
  const color = str(v.color);
  if (color !== undefined) o.color = color;
  const background = str(v.background);
  if (background !== undefined) o.background = background;
  // imagetracer
  const colors = num(v.colors);
  if (colors !== undefined) o.colors = colors;
  // edge
  const maxColors = num(v.maxColors);
  if (maxColors !== undefined) o.maxColors = maxColors;
  const resizeMax = num(v.resizeMax);
  if (resizeMax !== undefined) o.resizeMax = resizeMax;
  const edgeTolerance = num(v.edgeTolerance);
  if (edgeTolerance !== undefined) o.edgeTolerance = edgeTolerance;
  return o;
}

function isVectorizeMethod(value: unknown): value is VectorizeMethod {
  return typeof value === 'string' && listMethods().some((m) => m.id === value);
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/methods', (_req, res) => {
    res.json({ methods: listMethods() });
  });

  app.post('/api/vectorize', upload.single('image'), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          error: {
            code: 'E_NO_FILE',
            message: "Missing 'image' multipart file.",
          },
        });
      }
      if (!SUPPORTED_IMAGE_TYPES.has(file.mimetype)) {
        return res.status(400).json({
          error: {
            code: 'E_IMAGE_FORMAT',
            message: `Unsupported file type '${file.mimetype}'. Send a PNG or JPEG.`,
          },
        });
      }

      const requested = str(req.query.method) ?? 'potrace';
      if (!isVectorizeMethod(requested)) {
        return res.status(400).json({
          error: {
            code: 'E_METHOD',
            message: `Unknown method '${requested}'. Available: ${listMethods()
              .map((m) => m.id)
              .join(', ')}`,
          },
        });
      }

      const optimize = bool(req.query.optimize) ?? true;
      const options: VectorizeOptions = {
        method: requested,
        optimize,
        options: methodOptions(req),
      };

      const result = await vectorize(file.buffer, options);

      if (req.query.format === 'svg') {
        res.type('image/svg+xml').send(result.svg);
        return;
      }
      res.json({
        svg: result.svg,
        width: result.width,
        height: result.height,
        method: result.method,
        ...(result.note ? { note: result.note } : {}),
        input: {
          name: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
        },
      });
    } catch (cause) {
      next(cause);
    }
  });

  // Multer errors (oversize, wrong field, etc.)
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 'E_TOO_LARGE' : 'E_UPLOAD';
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`
          : err.message;
      return void res.status(413).json({ error: { code, message } });
    }
    next(err);
  });

  // Klear errors carry machine-readable codes
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof KlearError) {
      return void res.status(422).json({
        error: { code: err.code, message: err.message },
      });
    }
    next(err);
  });

  // Anything else — do not leak internals
  app.use((err: unknown, _req: Request, res: Response) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[klear:server] unexpected error: ${message}`);
    res.status(500).json({
      error: { code: 'E_INTERNAL', message: 'Internal server error.' },
    });
  });

  return app;
}
