import express from 'express';
import type { ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db/index.js';
import { loadConfig, type Config } from './config.js';
import { HttpError } from './lib/errors.js';
import { withUser, type AppContext } from './http/context.js';
import { authRoutes } from './routes/auth.js';
import { itemRoutes } from './routes/items.js';
import { friendRoutes } from './routes/friends.js';
import { catalogRoutes } from './routes/catalog.js';
import { dataRoutes } from './routes/dataRoutes.js';

export interface CreateAppOptions {
  config?: Partial<Config>;
  fetchImpl?: typeof fetch;
}

export function createApp(options: CreateAppOptions = {}): { app: express.Express; ctx: AppContext } {
  const config = loadConfig(options.config ?? {});
  const db = openDb(config.dbPath);
  const ctx: AppContext = { db, config, fetchImpl: options.fetchImpl ?? fetch };

  const app = express();
  app.disable('x-powered-by');
  // Imports can be large; everything else is small JSON.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.text({ limit: '25mb', type: ['text/csv', 'text/plain'] }));
  app.use(withUser(ctx));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: 1 });
  });

  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', itemRoutes(ctx));
  app.use('/api', friendRoutes(ctx));
  app.use('/api', catalogRoutes(ctx));
  app.use('/api', dataRoutes(ctx));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  // Serve the built SPA when it exists, falling back to index.html so client
  // routes deep-link correctly.
  if (config.webDist) {
    const dist = config.webDist;
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('Open Library API is running. Build the web client with `npm run build`.');
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
      return;
    }
    console.error('[openlibrary] unhandled error:', err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side' } });
  };
  app.use(errorHandler);

  return { app, ctx };
}

/** Convenience for tests: an app backed by a throwaway data directory. */
export function createTestApp(dataDir: string, fetchImpl?: typeof fetch) {
  fs.mkdirSync(dataDir, { recursive: true });
  return createApp({
    config: { dataDir, dbPath: path.join(dataDir, 'test.db'), webDist: null, offline: true },
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
