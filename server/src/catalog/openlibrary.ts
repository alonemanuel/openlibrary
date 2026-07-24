import { fetchJson, type CatalogResult, type CatalogSearchOptions } from './index.js';

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  publisher?: string[];
}

/**
 * openlibrary.org's search API — no key, no rate-limit signup, and the data is
 * itself openly licensed. Fitting, given the name.
 */
export async function searchBooks(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<CatalogResult[]> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(options.limit ?? 12));
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i,isbn,publisher');

  const body = await fetchJson<{ docs?: OpenLibraryDoc[] }>(url.toString(), options);
  return (body.docs ?? [])
    .filter((doc) => doc.title)
    .map((doc) => {
      const identifiers: Record<string, string> = {};
      if (doc.key) identifiers.openlibrary = doc.key.replace('/works/', '');
      const isbn = doc.isbn?.find((value) => value.length === 13) ?? doc.isbn?.[0];
      if (isbn) identifiers.isbn = isbn;

      return {
        mediaType: 'book' as const,
        title: doc.title!,
        creators: (doc.author_name ?? []).join(', '),
        year: doc.first_publish_year ?? null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        identifiers,
        provider: 'openlibrary',
        ...(doc.publisher?.[0] ? { detail: doc.publisher[0] } : {}),
      };
    });
}
