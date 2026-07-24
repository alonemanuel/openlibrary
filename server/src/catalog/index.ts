import type { MediaType } from '../domain/types.js';
import type { NewItemInput } from '../domain/items.js';

export interface CatalogResult {
  mediaType: MediaType;
  title: string;
  creators: string;
  year: number | null;
  coverUrl: string | null;
  identifiers: Record<string, string>;
  provider: string;
  /** Free-text extra shown under the result (publisher, album, runtime...). */
  detail?: string;
}

export interface CatalogSearchOptions {
  fetchImpl?: typeof fetch;
  limit?: number;
  timeoutMs?: number;
}

export function resultToItemInput(result: CatalogResult): NewItemInput {
  return {
    mediaType: result.mediaType,
    title: result.title,
    creators: result.creators,
    year: result.year,
    coverUrl: result.coverUrl,
    identifiers: result.identifiers,
    source: result.provider,
  };
}

export async function fetchJson<T>(
  url: string,
  options: CatalogSearchOptions,
): Promise<T> {
  const impl = options.fetchImpl ?? fetch;
  const response = await impl(url, {
    headers: {
      // MusicBrainz (and good manners generally) require identifying ourselves.
      'user-agent': 'OpenLibrary/0.1 (self-hosted media library)',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
  return (await response.json()) as T;
}

export { searchBooks } from './openlibrary.js';
export { searchItunes } from './itunes.js';
export { searchMusicBrainz } from './musicbrainz.js';
