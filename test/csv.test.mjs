/**
 * The CSV export lives inline in worker/public/index.html — the page is one
 * self-contained file by design, so the offline build can inject data into a
 * copy of it. That is no reason to leave the logic untested: this lifts the
 * marked block out of the page and runs it against a small fake library.
 *
 * If the markers move or vanish, these tests fail loudly rather than silently
 * testing nothing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = new URL('../worker/public/index.html', import.meta.url);
const OPEN = '/* --8<-- csv --8<-- */';
const CLOSE = '/* --8<-- end csv --8<-- */';

function extractCsvBlock() {
  const html = readFileSync(PAGE, 'utf8');
  const from = html.indexOf(OPEN);
  const to = html.indexOf(CLOSE);
  assert.ok(from !== -1 && to > from, 'CSV export markers missing from the page');
  return html.slice(from + OPEN.length, to);
}

/** Builds the export functions over a fake library, the way the page would. */
function load(library = {}) {
  const {
    SONGS = [], ARTISTS = [], ALBUMS = [],
    songIdx = SONGS.map((_, i) => i),
    albumIdx = ALBUMS.map((_, i) => i),
    artistIdx = ARTISTS.map((_, i) => i),
    albTracks = new Map(), artTracks = new Map(), artAlbums = new Map(),
  } = library;

  // The page's own duration formatter, and the release-type names it displays.
  const mmss = (s) => {
    if (!s) return '';
    const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
             : `${m}:${String(x).padStart(2, '0')}`;
  };
  const RELNAME = { 0: 'Album', 1: 'Single', 2: 'EP', 3: 'Compilation', 4: 'Release' };

  const make = new Function(
    'SONGS', 'ARTISTS', 'ALBUMS', 'songIdx', 'albumIdx', 'artistIdx',
    'albTracks', 'artTracks', 'mmss', 'RELNAME', 'window',
    extractCsvBlock() +
    '\nreturn { csvCell, toCsv, csvSongRows, csvAlbumRows, csvArtistRows, csvRows, csvName };',
  );
  return make(SONGS, ARTISTS, ALBUMS, songIdx, albumIdx, artistIdx,
              albTracks, artTracks, mmss, RELNAME, { __artAlbums: artAlbums });
}

/** Parses CSV back into rows, so assertions are about values not punctuation. */
function parse(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field); field = ''; rows.push(row); row = []; i++;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

describe('csvCell', () => {
  const { csvCell, toCsv } = load();

  test('leaves ordinary values alone', () => {
    assert.equal(csvCell('Black Sands'), 'Black Sands');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell(42), '42');
  });

  test('renders nothing for null and undefined', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell(''), '');
  });

  test('quotes commas, quotes and newlines', () => {
    assert.equal(csvCell('Hello, world'), '"Hello, world"');
    assert.equal(csvCell('She said "hi"'), '"She said ""hi"""');
    assert.equal(csvCell('two\nlines'), '"two\nlines"');
  });

  test('defuses anything a spreadsheet would run as a formula', () => {
    // A real song can be called "-1", and =cmd|... is the classic CSV injection.
    // Read the value back, since the guard goes inside any quoting.
    for (const danger of ['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|"/c calc"!A1']) {
      assert.equal(parse(toCsv([[danger]]))[0][0], "'" + danger, danger);
    }
  });

  test('keeps a formula guard and quoting together', () => {
    assert.equal(csvCell('=a,b'), `"'=a,b"`);
  });
});

describe('toCsv', () => {
  const { toCsv } = load();

  test('uses CRLF and ends with one', () => {
    assert.equal(toCsv([['a', 'b'], ['1', '2']]), 'a,b\r\n1,2\r\n');
  });

  test('round-trips through a parser', () => {
    const rows = [['title', 'notes'], ['Wait, What?', 'She said "hello"'], ['Multi\nline', 'x']];
    assert.deepEqual(parse(toCsv(rows)), rows);
  });
});

/* A small library: two artists, two albums, three songs. Bonobo's "Black
   Sands" has an official 3-track order of which 2 are liked; the single has
   no tracklist at all, which is the common case for a YouTube-only upload. */
function fixture() {
  return {
    ARTISTS: [
      // [name, pic, picSm, nTracks, nAlbums, latinName, slug]
      ['Bonobo', '', '', 0, 0, '', 'bonobo'],
      ['הדג נחש', '', '', 0, 0, 'Hadag Nahash', 'hadag-nahash'],
    ],
    ALBUMS: [
      // [name, artistIdx, cover, coverSm, nTracks, releaseType, tracklist, slug]
      ['Black Sands', 0, '', '', 0, 0,
       [['Prelude', 70, -1], ['Kiara', 240, 0], ['Kong', 300, 1]], 'black-sands'],
      ['שירת הסטיקר', 1, '', '', 0, 1, null, 'shirat-hastiker'],
    ],
    SONGS: [
      // [title, leadArtistIdx, albumIdx, seconds, videoId, allArtistIdxs]
      ['Kiara', 0, 0, 240, 'vid1', [0]],
      ['Kong', 0, 0, 300, 'vid2', [0]],
      ['שירת הסטיקר', 1, 1, 0, '', [1, 0]],
    ],
    albTracks: new Map([[0, 2], [1, 1]]),
    artTracks: new Map([[0, 3], [1, 1]]),
    artAlbums: new Map([[0, new Set([0])], [1, new Set([1])]]),
  };
}

describe('song rows', () => {
  const api = load(fixture());
  const rows = parse(api.toCsv(api.csvSongRows()));

  test('carries the documented columns', () => {
    assert.deepEqual(rows[0], ['title', 'artists', 'album', 'album_artist',
                               'duration', 'seconds', 'youtube_video_id']);
    assert.equal(rows.length, 4);
  });

  test('writes a song with its album and formatted length', () => {
    assert.deepEqual(rows[1], ['Kiara', 'Bonobo', 'Black Sands', 'Bonobo', '4:00', '240', 'vid1']);
  });

  test('joins every credited act, not just the lead', () => {
    assert.equal(rows[3][1], 'הדג נחש; Bonobo');
  });

  test('leaves an unknown length blank but keeps the seconds column', () => {
    assert.equal(rows[3][4], '');
    assert.equal(rows[3][5], '0');
  });
});

describe('album rows', () => {
  const api = load(fixture());
  const rows = parse(api.toCsv(api.csvAlbumRows()));

  test('counts liked tracks against the official total', () => {
    assert.deepEqual(rows[0], ['album', 'artist', 'liked_tracks', 'total_tracks', 'release_type']);
    assert.deepEqual(rows[1], ['Black Sands', 'Bonobo', '2', '3', 'Album']);
  });

  test('leaves the total blank when the release was never identified', () => {
    assert.deepEqual(rows[2], ['שירת הסטיקר', 'הדג נחש', '1', '', 'Single']);
  });
});

describe('artist rows', () => {
  const api = load(fixture());
  const rows = parse(api.toCsv(api.csvArtistRows()));

  test('reports liked tracks and album counts', () => {
    assert.deepEqual(rows[0], ['artist', 'latin_name', 'liked_tracks', 'albums']);
    assert.deepEqual(rows[1], ['Bonobo', '', '3', '1']);
  });

  test('keeps the romanised name beside a native-script one', () => {
    assert.deepEqual(rows[2], ['הדג נחש', 'Hadag Nahash', '1', '1']);
  });
});

describe('exporting only what the view shows', () => {
  test('follows the filtered index, in its order', () => {
    const lib = fixture();
    lib.songIdx = [2, 0];                      // searched, and sorted differently
    const api = load(lib);
    const rows = parse(api.toCsv(api.csvSongRows()));
    assert.deepEqual(rows.map((r) => r[0]), ['title', 'שירת הסטיקר', 'Kiara']);
  });

  test('an empty view produces a header and nothing else', () => {
    const lib = fixture();
    lib.songIdx = [];
    const api = load(lib);
    assert.equal(api.csvSongRows().length, 1);
  });

  test('csvRows picks the builder for the tab', () => {
    const api = load(fixture());
    assert.equal(api.csvRows('songs')[0][0], 'title');
    assert.equal(api.csvRows('albums')[0][0], 'album');
    assert.equal(api.csvRows('artists')[0][0], 'artist');
  });
});

describe('csvName', () => {
  const { csvName } = load();

  test('names the file after the tab', () => {
    assert.equal(csvName('songs', ''), 'songs.csv');
    assert.equal(csvName('artists', '   '), 'artists.csv');
  });

  test('folds a search into the name', () => {
    assert.equal(csvName('albums', 'Bonobo'), 'albums-bonobo.csv');
    assert.equal(csvName('songs', 'Black  Sands!'), 'songs-black-sands.csv');
  });

  test('drops a search it cannot slug rather than emitting hyphens', () => {
    assert.equal(csvName('songs', 'הדג נחש'), 'songs.csv');
  });

  test('keeps the name to a sane length', () => {
    const name = csvName('songs', 'a'.repeat(200));
    assert.ok(name.length <= 'songs-.csv'.length + 40, name);
  });
});
