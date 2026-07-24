import { useState } from 'react';
import { api } from '../api';
import { ItemEditor } from '../components/ItemEditor';
import { Empty, useToast } from '../components/ui';
import {
  MEDIA_ICONS,
  MEDIA_LABELS,
  type CatalogResult,
  type Item,
  type MediaType,
} from '../types';

const SEARCHABLE: MediaType[] = ['book', 'movie', 'tv', 'music', 'podcast'];

export function Discover() {
  const [type, setType] = useState<MediaType>('book');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<Partial<Item> | null>(null);
  const [toast, showToast] = useToast();

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      const response = await api.searchCatalog(type, query.trim());
      setResults(response.results);
      setWarnings(response.warnings);
      setSearched(true);
    } catch (error) {
      showToast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function quickAdd(result: CatalogResult) {
    try {
      const response = await api.createItem({
        mediaType: result.mediaType,
        title: result.title,
        creators: result.creators,
        year: result.year,
        coverUrl: result.coverUrl,
        identifiers: result.identifiers,
        source: result.provider,
      } as Partial<Item>);
      showToast(response.duplicate ? 'Already in your library' : `Added “${result.title}”`);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Find something</h1>
          <p>
            Search open catalogues — Open Library for books, MusicBrainz and iTunes for music, iTunes
            for film and TV. Only the metadata is copied into your library, so what you keep does not
            depend on any of them sticking around.
          </p>
        </div>
      </div>

      <form className="toolbar" onSubmit={search}>
        <select value={type} onChange={(event) => setType(event.target.value as MediaType)}>
          {SEARCHABLE.map((option) => (
            <option key={option} value={option}>
              {MEDIA_LABELS[option]}
            </option>
          ))}
        </select>
        <input
          className="search"
          type="search"
          placeholder={`Search ${MEDIA_LABELS[type].toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : null} Search
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setAdding({ mediaType: type, title: query })}
        >
          Add by hand
        </button>
      </form>

      {warnings.map((warning) => (
        <div className="alert warn" key={warning}>
          {warning}
        </div>
      ))}

      {!searched ? (
        <Empty
          icon="🔎"
          title="Search a catalogue"
          hint="Or add anything manually — nothing here requires a match in someone else's database."
        />
      ) : results.length === 0 ? (
        <Empty
          icon="🤷"
          title="No matches"
          hint="Add it by hand instead — your library is not limited to what these catalogues know about."
        />
      ) : (
        <div className="list">
          {results.map((result, index) => (
            <div className="row" key={`${result.provider}-${index}`}>
              <div
                className="cover"
                style={{ width: 42, height: 56, borderRadius: 6, aspectRatio: 'auto', flex: 'none' }}
              >
                {result.coverUrl ? (
                  <img src={result.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span style={{ fontSize: '1.1rem' }}>{MEDIA_ICONS[result.mediaType]}</span>
                )}
              </div>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{result.title}</div>
                <div className="muted">
                  {[result.creators, result.year, result.detail].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="badge">{result.provider}</span>
              <button
                className="btn small"
                onClick={() =>
                  setAdding({
                    mediaType: result.mediaType,
                    title: result.title,
                    creators: result.creators,
                    year: result.year,
                    coverUrl: result.coverUrl,
                    identifiers: result.identifiers,
                  })
                }
              >
                Details
              </button>
              <button className="btn primary small" onClick={() => quickAdd(result)}>
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <ItemEditor
          initial={adding}
          onClose={() => setAdding(null)}
          onSaved={() => undefined}
          onMessage={showToast}
        />
      ) : null}
      {toast}
    </>
  );
}
