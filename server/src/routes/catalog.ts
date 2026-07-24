import { Router } from 'express';
import { searchBooks, searchItunes, searchMusicBrainz, type CatalogResult } from '../catalog/index.js';
import { MEDIA_TYPES } from '../domain/types.js';
import type { MediaType } from '../domain/types.js';
import { badRequest } from '../lib/errors.js';
import { handler, requireAuth, type AppContext } from '../http/context.js';

/**
 * Which providers answer for which media type. Several may run for one query;
 * whatever comes back is merged, so a provider going down degrades the result
 * list instead of breaking search.
 */
function providersFor(
  mediaType: MediaType,
  query: string,
  fetchImpl: typeof fetch,
): { name: string; run: () => Promise<CatalogResult[]> }[] {
  const options = { fetchImpl, limit: 12 };
  switch (mediaType) {
    case 'book':
      return [{ name: 'openlibrary', run: () => searchBooks(query, options) }];
    case 'music':
      return [
        { name: 'musicbrainz', run: () => searchMusicBrainz(query, options) },
        { name: 'itunes', run: () => searchItunes('music', query, options) },
      ];
    case 'movie':
    case 'tv':
    case 'podcast':
      return [{ name: 'itunes', run: () => searchItunes(mediaType, query, options) }];
    default:
      return [];
  }
}

function dedupe(results: CatalogResult[]): CatalogResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.mediaType}|${result.title.toLowerCase()}|${result.creators.toLowerCase()}|${result.year ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function catalogRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/catalog/search',
    handler(async (req, res) => {
      requireAuth(req);
      const query = String(req.query.q ?? '').trim();
      const mediaType = String(req.query.type ?? 'book') as MediaType;
      if (!MEDIA_TYPES.includes(mediaType)) throw badRequest('Unknown media type');
      if (query.length < 2) {
        res.json({ results: [], warnings: [] });
        return;
      }
      if (ctx.config.offline) {
        res.json({
          results: [],
          warnings: ['Catalog lookup is disabled (offline mode) — add items manually.'],
        });
        return;
      }

      const providers = providersFor(mediaType, query, ctx.fetchImpl);
      const settled = await Promise.allSettled(providers.map((provider) => provider.run()));

      const results: CatalogResult[] = [];
      const warnings: string[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') results.push(...outcome.value);
        else {
          warnings.push(
            `${providers[index]!.name} is unavailable right now (${(outcome.reason as Error).message})`,
          );
        }
      });

      res.json({ results: dedupe(results), warnings });
    }),
  );

  return router;
}
