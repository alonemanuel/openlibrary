import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords, toCsv } from '../src/export/csv.js';
import { detectFormat } from '../src/export/importer.js';
import { addItem, registerUser, startTestServer, type TestServer } from './helpers.js';

describe('CSV reader/writer', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [
      ['title', 'notes'],
      ['Wait, What?', 'She said "hello"'],
      ['Multi\nline', 'trailing space '],
    ];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });

  it('accepts CRLF, LF and a BOM', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.deepEqual(parseCsv('a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.deepEqual(parseCsv('﻿a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('neutralises spreadsheet formulas', () => {
    const csv = toCsv([['title'], ['=1+1']]);
    assert.match(csv, /'=1\+1/);
  });

  it('reads records keyed by header', () => {
    const records = parseCsvRecords('Title,Author\nDune,Herbert\n');
    assert.deepEqual(records, [{ Title: 'Dune', Author: 'Herbert' }]);
  });

  it('recognises the formats we import', () => {
    assert.equal(detectFormat(['id', 'media_type', 'title', 'created_at']), 'openlibrary');
    assert.equal(detectFormat(['Book Id', 'Title', 'Author', 'Exclusive Shelf']), 'goodreads');
    assert.equal(detectFormat(['Date', 'Name', 'Year', 'Letterboxd URI']), 'letterboxd');
    assert.equal(detectFormat(['track name', 'artist']), 'generic');
  });
});

describe('export and import', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it('exports a bundle of CSV plus JSON plus a manifest', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Dune', creators: 'Frank Herbert', year: 1965 });
    await addItem(client, { mediaType: 'movie', title: 'Arrival', year: 2016 });

    const listing = await client.get('/api/export');
    const names = listing.body.files.map((file: any) => file.name);
    assert.ok(names.includes('library.csv'));
    assert.ok(names.includes('books.csv'));
    assert.ok(names.includes('movies.csv'));
    assert.ok(names.includes('library.json'));
    assert.ok(names.includes('MANIFEST.json'));
    assert.ok(names.includes('README.md'));

    const csv = await client.get('/api/export/library.csv');
    assert.equal(csv.status, 200);
    const rows = parseCsv(csv.body as string);
    assert.equal(rows[0]?.[0], 'id');
    assert.equal(rows.length, 3);
  });

  it('round-trips a library through CSV into a different account', async () => {
    const source = await registerUser(server);
    await addItem(source.client, {
      title: 'The Left Hand of Darkness',
      creators: 'Ursula K. Le Guin',
      year: 1969,
      rating: 10,
      tags: ['sci-fi', 're-read'],
      notes: 'Winter, and the long walk across it.',
      identifiers: { isbn: '9780441478125' },
    });
    await addItem(source.client, { mediaType: 'music', title: 'Blue', creators: 'Joni Mitchell' });

    const csv = (await source.client.get('/api/export/library.csv')).body as string;

    const destination = await registerUser(server);
    const imported = await destination.client.postText('/api/import?filename=library.csv', csv);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.result.format, 'openlibrary');
    assert.equal(imported.body.result.created, 2);

    const items = (await destination.client.get('/api/items')).body.items;
    assert.equal(items.length, 2);
    const book = items.find((item: any) => item.mediaType === 'book');
    assert.equal(book.title, 'The Left Hand of Darkness');
    assert.equal(book.rating, 10);
    assert.deepEqual(book.tags.sort(), ['re-read', 'sci-fi']);
    assert.equal(book.identifiers.isbn, '9780441478125');
    assert.equal(book.notes, 'Winter, and the long walk across it.');
  });

  it('round-trips through JSON too', async () => {
    const source = await registerUser(server);
    await addItem(source.client, { title: 'Ancillary Justice', year: 2013 });
    // The download is served as application/json, so the test client parses it.
    const json = JSON.stringify((await source.client.get('/api/export/library.json')).body);

    const destination = await registerUser(server);
    const imported = await destination.client.post('/api/import', {
      filename: 'library.json',
      content: json,
    });
    assert.equal(imported.body.result.created, 1);
    assert.equal((await destination.client.get('/api/items')).body.items[0].title, 'Ancillary Justice');
  });

  it('re-importing the same file does not duplicate anything', async () => {
    const { client } = await registerUser(server);
    await addItem(client, { title: 'Roadside Picnic', year: 1972 });
    const csv = (await client.get('/api/export/library.csv')).body as string;

    const again = await client.postText('/api/import?filename=library.csv', csv);
    assert.equal(again.body.result.created, 0);
    assert.equal(again.body.result.skipped, 1);
    assert.equal((await client.get('/api/items')).body.items.length, 1);
  });

  it('imports a Goodreads export', async () => {
    const { client } = await registerUser(server);
    const goodreads = [
      'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review',
      '12345,Dune,Frank Herbert,"Herbert, Frank",,="0441013597",="9780441013593",5,4.25,Ace,Paperback,604,2005,1965,2020/01/02,2019/12/01,"sci-fi, favourites",read,"A desert planet, and a boy."',
      '67890,Neuromancer,William Gibson,"Gibson, William",,="0441569595",="9780441569595",0,3.89,Ace,Paperback,271,1984,1984,,2021/03/03,cyberpunk,to-read,',
    ].join('\n');

    const result = await client.postText('/api/import?filename=goodreads_library_export.csv', goodreads);
    assert.equal(result.body.result.format, 'goodreads');
    assert.equal(result.body.result.created, 2);

    const items = (await client.get('/api/items?sort=title')).body.items;
    const dune = items.find((item: any) => item.title === 'Dune');
    assert.equal(dune.mediaType, 'book');
    assert.equal(dune.creators, 'Herbert, Frank');
    assert.equal(dune.year, 1965);
    assert.equal(dune.status, 'done');
    // Goodreads' 5-star scale is stored on our 10-point scale.
    assert.equal(dune.rating, 10);
    assert.equal(dune.identifiers.isbn13, '9780441013593');
    assert.deepEqual(dune.tags.sort(), ['favourites', 'sci-fi']);

    const neuromancer = items.find((item: any) => item.title === 'Neuromancer');
    assert.equal(neuromancer.status, 'want');
    assert.equal(neuromancer.rating, null);
  });

  it('imports a Letterboxd export', async () => {
    const { client } = await registerUser(server);
    const letterboxd = [
      'Date,Name,Year,Letterboxd URI,Rating,Review',
      '2021-05-04,Stalker,1979,https://boxd.it/abc,4.5,"Slow, and worth it."',
    ].join('\n');

    const result = await client.postText('/api/import?filename=reviews.csv', letterboxd);
    assert.equal(result.body.result.format, 'letterboxd');
    const item = (await client.get('/api/items')).body.items[0];
    assert.equal(item.mediaType, 'movie');
    assert.equal(item.title, 'Stalker');
    assert.equal(item.year, 1979);
    assert.equal(item.rating, 9);
  });

  it('imports an arbitrary music CSV', async () => {
    const { client } = await registerUser(server);
    const spotifyish = [
      'Track Name,Artist Name(s),Album,Release Date,ISRC',
      'Hejira,Joni Mitchell,Hejira,1976-11-22,USEE10001234',
    ].join('\n');

    const result = await client.postText('/api/import?filename=liked_songs.csv&mediaType=music', spotifyish);
    assert.equal(result.body.result.created, 1);
    const item = (await client.get('/api/items')).body.items[0];
    assert.equal(item.mediaType, 'music');
    assert.equal(item.title, 'Hejira');
    assert.equal(item.creators, 'Joni Mitchell');
    assert.equal(item.identifiers.isrc, 'USEE10001234');
  });

  it('keeps deleted items in the export, flagged rather than dropped', async () => {
    const { client } = await registerUser(server);
    const item = await addItem(client, { title: 'Forgotten Book' });
    await client.del(`/api/items/${item.id}`);

    const csv = (await client.get('/api/export/library.csv')).body as string;
    const records = parseCsvRecords(csv);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.title, 'Forgotten Book');
    assert.notEqual(records[0]!.deleted_at, '');
  });
});
