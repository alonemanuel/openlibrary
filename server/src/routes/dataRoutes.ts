import { Router } from 'express';
import { buildExport } from '../export/exporter.js';
import { importFile } from '../export/importer.js';
import {
  createSnapshot,
  listSnapshots,
  readSnapshot,
  restoreSnapshot,
} from '../domain/snapshots.js';
import { MEDIA_TYPES, SYNC_KINDS, VISIBILITIES } from '../domain/types.js';
import type { MediaType } from '../domain/types.js';
import {
  createSyncTarget,
  deleteSyncTarget,
  getSyncTarget,
  listRuns,
  listSyncTargets,
  updateSyncTarget,
} from '../domain/syncTargets.js';
import { getAdapter, runSync } from '../sync/engine.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asObject, optionalEnum, optionalString, requireEnum, requireString } from '../lib/validate.js';
import { handler, requireAuth, type AppContext } from '../http/context.js';

function secretsFrom(body: Record<string, unknown>): Record<string, string> {
  const raw = body.secrets;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

function configFrom(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body.config;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function dataRoutes(ctx: AppContext): Router {
  const router = Router();

  // -- Export ---------------------------------------------------------------

  router.get(
    '/export',
    handler((req, res) => {
      const user = requireAuth(req);
      const bundle = buildExport(ctx.db, user.id);
      res.json({
        generatedAt: bundle.generatedAt,
        itemCount: bundle.itemCount,
        files: bundle.files.map((file) => ({
          name: file.name,
          bytes: Buffer.byteLength(file.content, 'utf8'),
          contentType: file.contentType,
        })),
      });
    }),
  );

  router.get(
    '/export/:filename',
    handler((req, res) => {
      const user = requireAuth(req);
      const typeParam = req.query.type as MediaType | undefined;
      const bundle = buildExport(ctx.db, user.id, {
        includeDeleted: req.query.includeDeleted !== '0',
        ...(typeParam && MEDIA_TYPES.includes(typeParam) ? { mediaTypes: [typeParam] } : {}),
      });
      const file = bundle.files.find((candidate) => candidate.name === String(req.params.filename));
      if (!file) throw notFound('No such export file');
      res.setHeader('Content-Type', `${file.contentType}; charset=utf-8`);
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.send(file.content);
    }),
  );

  // -- Import ---------------------------------------------------------------

  router.post(
    '/import',
    handler((req, res) => {
      const user = requireAuth(req);
      const isText = typeof req.body === 'string';
      const body = isText ? {} : asObject(req.body);
      const content = isText ? (req.body as string) : requireString(body, 'content', 40_000_000);
      const filename = isText
        ? String(req.query.filename ?? 'import.csv')
        : (optionalString(body, 'filename', 200) ?? 'import.csv');

      const mediaType = isText
        ? (req.query.mediaType as MediaType | undefined)
        : optionalEnum(body, 'mediaType', MEDIA_TYPES);

      const result = importFile(ctx.db, user.id, filename, content, {
        ...(mediaType && MEDIA_TYPES.includes(mediaType) ? { mediaType } : {}),
        updateExisting: isText ? req.query.update === '1' : body.updateExisting === true,
        defaultVisibility: optionalEnum(body, 'visibility', VISIBILITIES) ?? 'friends',
      });
      res.json({ result });
    }),
  );

  // -- Snapshots (our own backup copy) --------------------------------------

  router.get(
    '/snapshots',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({ snapshots: listSnapshots(ctx.db, user.id) });
    }),
  );

  router.post(
    '/snapshots',
    handler((req, res) => {
      const user = requireAuth(req);
      const result = createSnapshot(ctx.db, ctx.config.snapshotDir, user.id, 'manual');
      res.status(result.unchanged ? 200 : 201).json(result);
    }),
  );

  router.get(
    '/snapshots/:id/download',
    handler((req, res) => {
      const user = requireAuth(req);
      const content = readSnapshot(ctx.db, ctx.config.snapshotDir, user.id, String(req.params.id));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.json"`);
      res.send(content);
    }),
  );

  router.post(
    '/snapshots/:id/restore',
    handler((req, res) => {
      const user = requireAuth(req);
      res.json({
        result: restoreSnapshot(ctx.db, ctx.config.snapshotDir, user.id, String(req.params.id)),
      });
    }),
  );

  // -- Sync targets ---------------------------------------------------------

  router.get(
    '/sync/targets',
    handler((req, res) => {
      const user = requireAuth(req);
      const targets = listSyncTargets(ctx.db, user.id).map((target) => ({
        ...target,
        description: getAdapter(target.kind).describe(target.config),
      }));
      res.json({ targets, kinds: SYNC_KINDS });
    }),
  );

  router.post(
    '/sync/targets',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const kind = requireEnum(body, 'kind', SYNC_KINDS);
      const adapter = getAdapter(kind);
      const config = adapter.normalizeConfig(configFrom(body));
      const secrets = secretsFrom(body);

      const missing = adapter.requiredSecrets.filter((key) => !secrets[key]);
      if (missing.length > 0) throw badRequest(`Missing credentials: ${missing.join(', ')}`);

      const target = createSyncTarget(
        ctx.db,
        user.id,
        { kind, name: requireString(body, 'name', 80), config, secrets },
        ctx.config.secretKey,
      );
      res.status(201).json({ target: { ...target, description: adapter.describe(target.config) } });
    }),
  );

  router.patch(
    '/sync/targets/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      const body = asObject(req.body);
      const existing = getSyncTarget(ctx.db, user.id, String(req.params.id));
      const adapter = getAdapter(existing.kind);
      const secrets = secretsFrom(body);

      const target = updateSyncTarget(
        ctx.db,
        user.id,
        existing.id,
        {
          ...(body.name !== undefined ? { name: requireString(body, 'name', 80) } : {}),
          ...(body.config !== undefined
            ? { config: adapter.normalizeConfig(configFrom(body)) }
            : {}),
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
          ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        },
        ctx.config.secretKey,
      );
      res.json({ target: { ...target, description: adapter.describe(target.config) } });
    }),
  );

  router.delete(
    '/sync/targets/:id',
    handler((req, res) => {
      const user = requireAuth(req);
      deleteSyncTarget(ctx.db, user.id, String(req.params.id));
      res.json({ ok: true });
    }),
  );

  router.post(
    '/sync/targets/:id/run',
    handler(async (req, res) => {
      const user = requireAuth(req);
      const target = getSyncTarget(ctx.db, user.id, String(req.params.id));
      const result = await runSync(ctx.db, ctx.config, target, ctx.fetchImpl);
      res.status(result.status === 'ok' ? 200 : 502).json({ result });
    }),
  );

  router.get(
    '/sync/runs',
    handler((req, res) => {
      const user = requireAuth(req);
      const targetId = req.query.target ? String(req.query.target) : undefined;
      res.json({ runs: listRuns(ctx.db, user.id, targetId) });
    }),
  );

  return router;
}
