import { fetchJson, type CatalogResult, type CatalogSearchOptions } from './index.js';
import type { MediaType } from '../domain/types.js';

interface ItunesResult {
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  trackId?: number;
  collectionId?: number;
  primaryGenreName?: string;
  trackTimeMillis?: number;
}

const ENTITY: Record<string, { entity: string; media: string }> = {
  movie: { entity: 'movie', media: 'movie' },
  tv: { entity: 'tvSeason', media: 'tvShow' },
  music: { entity: 'song', media: 'music' },
  podcast: { entity: 'podcast', media: 'podcast' },
};

/**
 * The iTunes Search API is keyless and covers movies, TV, music and podcasts.
 * We only take metadata from it — nothing here depends on Apple continuing to
 * carry the title, which is rather the point.
 */
export async function searchItunes(
  mediaType: MediaType,
  query: string,
  options: CatalogSearchOptions = {},
): Promise<CatalogResult[]> {
  const mapping = ENTITY[mediaType];
  if (!mapping) return [];

  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('entity', mapping.entity);
  url.searchParams.set('media', mapping.media);
  url.searchParams.set('limit', String(options.limit ?? 12));

  const body = await fetchJson<{ results?: ItunesResult[] }>(url.toString(), options);
  return (body.results ?? [])
    .map((result) => {
      const title = result.trackName ?? result.collectionName;
      if (!title) return null;
      const identifiers: Record<string, string> = {};
      if (result.trackId) identifiers.itunes = String(result.trackId);
      else if (result.collectionId) identifiers.itunes_collection = String(result.collectionId);

      const year = result.releaseDate ? Number(result.releaseDate.slice(0, 4)) : null;
      const detail =
        mediaType === 'music' && result.collectionName
          ? result.collectionName
          : result.primaryGenreName;

      return {
        mediaType,
        title,
        creators: result.artistName ?? '',
        year: Number.isFinite(year) ? year : null,
        // artworkUrl100 is a thumbnail; ask for a usable size instead.
        coverUrl: result.artworkUrl100?.replace('100x100', '400x400') ?? null,
        identifiers,
        provider: 'itunes',
        ...(detail ? { detail } : {}),
      } satisfies CatalogResult;
    })
    .filter((result): result is CatalogResult => result !== null);
}
