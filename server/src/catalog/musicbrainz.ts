import { fetchJson, type CatalogResult, type CatalogSearchOptions } from './index.js';

interface MbRecording {
  id?: string;
  title?: string;
  'first-release-date'?: string;
  'artist-credit'?: { name?: string }[];
  releases?: { id?: string; title?: string }[];
  isrcs?: string[];
}

/**
 * MusicBrainz is the open music encyclopedia: keyless, community-owned, and
 * its MBIDs are stable identifiers that outlive any given streaming service —
 * exactly the kind of id worth writing into an export.
 */
export async function searchMusicBrainz(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<CatalogResult[]> {
  const url = new URL('https://musicbrainz.org/ws/2/recording');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(options.limit ?? 12));
  url.searchParams.set('fmt', 'json');

  const body = await fetchJson<{ recordings?: MbRecording[] }>(url.toString(), options);
  return (body.recordings ?? [])
    .filter((recording) => recording.title)
    .map((recording) => {
      const identifiers: Record<string, string> = {};
      if (recording.id) identifiers.musicbrainz = recording.id;
      if (recording.isrcs?.[0]) identifiers.isrc = recording.isrcs[0];
      const release = recording.releases?.[0];
      const year = recording['first-release-date']?.slice(0, 4);

      return {
        mediaType: 'music' as const,
        title: recording.title!,
        creators: (recording['artist-credit'] ?? [])
          .map((credit) => credit.name ?? '')
          .filter(Boolean)
          .join(', '),
        year: year ? Number(year) : null,
        // MusicBrainz has no artwork of its own; the Cover Art Archive serves
        // it by release id when one exists.
        coverUrl: release?.id
          ? `https://coverartarchive.org/release/${release.id}/front-250`
          : null,
        identifiers,
        provider: 'musicbrainz',
        ...(release?.title ? { detail: release.title } : {}),
      };
    });
}
