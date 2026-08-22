/**
 * Music library Worker: Google sign-in, then one library per signed-in user.
 *
 * Nothing about a library is reachable without a verified Google identity —
 * /api/library is the only source of data and it answers 401 until a session
 * cookie proves who you are. The HTML shell ships no data of its own.
 *
 * Sessions are our own HMAC-signed cookie rather than Google's ID token,
 * which expires hourly; the Google token is verified once at sign-in.
 */

const SESSION_COOKIE = 'ml_session';
const SESSION_DAYS = 30;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = ['https://accounts.google.com', 'accounts.google.com'];

const enc = new TextEncoder();
const b64urlDecode = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
const b64urlEncode = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'cache-control': 'no-store', ...headers },
  });

/* ---------- Google ID token ---------- */

let certsCache = { at: 0, keys: null };

async function googleKeys() {
  if (certsCache.keys && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const jwks = await (await fetch(GOOGLE_CERTS)).json();
  certsCache = { at: Date.now(), keys: jwks.keys };
  return jwks.keys;
}

/** Verifies signature, issuer, audience and expiry. Returns the claims. */
async function verifyGoogleToken(idToken, clientId) {
  const [h, p, s] = (idToken || '').split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));

  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
    b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');

  if (!GOOGLE_ISS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('bad audience');
  if (claims.exp * 1000 < Date.now()) throw new Error('expired');
  if (!claims.email || claims.email_verified === false) throw new Error('unverified email');
  return claims;
}

/* ---------- our session cookie ---------- */

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlEncode(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

async function makeSession(secret, email) {
  const body = b64urlEncode(enc.encode(JSON.stringify({
    email, exp: Date.now() + SESSION_DAYS * 864e5,
  })));
  return `${body}.${await hmac(secret, body)}`;
}

async function readSession(secret, cookieHeader) {
  const raw = (cookieHeader || '').split(/;\s*/)
    .find((c) => c.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  // Constant-time-ish: compare the recomputed signature, never the payload.
  if (await hmac(secret, body) !== sig) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

/* ---------- library ---------- */

/** Rebuilds exactly the DATA shape the page already understands, scoped to
 *  one user. Index-based rather than keyed so the client stays unchanged:
 *  the arrays are large and the page indexes into them constantly. */
async function libraryFor(db, email) {
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) return null;
  const uid = user.id;

  const [assetsQ, tracksQ, itemsQ, iaQ, aaQ] = await Promise.all([
    db.prepare(`SELECT music_key, kind, display_name, slug, source_url, image_sm_url,
                       latin_name, release_type, n_tracks FROM media_assets`).all(),
    db.prepare(`SELECT music_key, title, seconds FROM release_tracks
                ORDER BY music_key, position`).all(),
    db.prepare(`SELECT id, title, identifiers, music_key, track_pos FROM items
                WHERE user_id = ? AND deleted_at IS NULL ORDER BY rowid`).bind(uid).all(),
    db.prepare(`SELECT ia.item_id, ia.music_key, ia.position FROM item_artists ia
                JOIN items i ON i.id = ia.item_id WHERE i.user_id = ?
                ORDER BY ia.item_id, ia.position`).bind(uid).all(),
    db.prepare(`SELECT album_key, artist_key, position FROM album_artists
                ORDER BY album_key, position`).all(),
  ]);

  // Only the artists and albums this user actually touches are worth shipping.
  const usedArtist = new Set(iaQ.results.map((r) => r.music_key));
  const usedAlbum = new Set(itemsQ.results.map((r) => r.music_key).filter(Boolean));

  const artistIx = new Map(), albumIx = new Map();
  const artists = [], albums = [];
  const assetByKey = new Map();
  for (const a of assetsQ.results) assetByKey.set(a.music_key, a);

  for (const a of assetsQ.results) {
    if (a.kind !== 'artist' || !usedArtist.has(a.music_key)) continue;
    artistIx.set(a.music_key, artists.length);
    artists.push([a.display_name, a.source_url || '', a.image_sm_url || a.source_url || '',
                  0, 0, a.latin_name || '', a.slug]);
  }
  const RT = { album: 0, single: 1, ep: 2, compilation: 3 };
  for (const a of assetsQ.results) {
    if (a.kind !== 'album' || !usedAlbum.has(a.music_key)) continue;
    albumIx.set(a.music_key, albums.length);
    const lead = aaQ.results.find((x) => x.album_key === a.music_key);
    albums.push([a.display_name, lead ? (artistIx.get(lead.artist_key) ?? -1) : -1,
                 a.source_url || '', a.image_sm_url || a.source_url || '',
                 0, RT[a.release_type] ?? 4, null, a.slug]);
  }

  // Official running order, so unliked tracks can render greyed.
  const byAlbum = new Map();
  for (const t of tracksQ.results) {
    if (!albumIx.has(t.music_key)) continue;
    (byAlbum.get(t.music_key) || byAlbum.set(t.music_key, []).get(t.music_key))
      .push([t.title, t.seconds || 0, -1]);
  }

  const artistsOf = new Map();
  for (const r of iaQ.results) {
    const ix = artistIx.get(r.music_key);
    if (ix === undefined) continue;
    (artistsOf.get(r.item_id) || artistsOf.set(r.item_id, []).get(r.item_id)).push(ix);
  }

  const songs = itemsQ.results.map((r) => {
    const id = JSON.parse(r.identifiers || '{}');
    const ais = artistsOf.get(r.id) || [];
    const ali = r.music_key != null ? (albumIx.get(r.music_key) ?? -1) : -1;
    return [r.title, ais.length ? ais[0] : -1, ali, id.seconds || 0,
            id.videoId || '', ais];
  });

  // Counts and tracklists, matching what the build used to precompute.
  songs.forEach((s, n) => {
    for (const a of s[5]) artists[a][3]++;
    if (s[2] >= 0) albums[s[2]][4]++;
  });
  const artAlbums = new Map();
  songs.forEach((s) => {
    if (s[2] < 0) return;
    for (const a of s[5]) {
      (artAlbums.get(a) || artAlbums.set(a, new Set()).get(a)).add(s[2]);
    }
  });
  for (const [a, set] of artAlbums) artists[a][4] = set.size;

  for (const [key, rows] of byAlbum) {
    const ai = albumIx.get(key);
    if (ai === undefined) continue;
    albums[ai][6] = rows;
  }
  // Positions were resolved at import time by the tiered matcher; a naive
  // equality check here would drop every 'Eyesdown feat. …' style pairing.
  itemsQ.results.forEach((r, n) => {
    if (!r.track_pos) return;
    const s = songs[n];
    const tl = s[2] >= 0 ? albums[s[2]][6] : null;
    if (tl && tl[r.track_pos - 1]) tl[r.track_pos - 1][2] = n;
  });

  return { songs, artists, albums, kinds: ['cover', 'artist'], email };
}

/* ---------- routes ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.SESSION_SECRET;
    const clientId = env.GOOGLE_CLIENT_ID;

    if (url.pathname === '/api/config') {
      return json({ clientId: clientId || null });
    }

    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (!clientId || !secret) return json({ error: 'auth not configured' }, 503);
      let claims;
      try {
        const { credential } = await request.json();
        claims = await verifyGoogleToken(credential, clientId);
      } catch (e) {
        return json({ error: 'sign-in failed: ' + e.message }, 401);
      }
      const known = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(claims.email).first();
      if (!known) {
        // Signed in with Google, but no library here. Say so plainly rather
        // than creating an empty account for anyone who finds the URL.
        return json({ error: 'no library for ' + claims.email }, 403);
      }
      const cookie = `${SESSION_COOKIE}=${await makeSession(secret, claims.email)}; ` +
        `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
      return json({ email: claims.email, name: claims.name || null }, 200,
                  { 'set-cookie': cookie });
    }

    if (url.pathname === '/api/logout') {
      return json({ ok: true }, 200, {
        'set-cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      });
    }

    if (url.pathname === '/api/library') {
      const sess = secret ? await readSession(secret, request.headers.get('cookie')) : null;
      if (!sess) return json({ error: 'not signed in' }, 401);
      const lib = await libraryFor(env.DB, sess.email);
      if (!lib) return json({ error: 'no library' }, 403);
      return json(lib);
    }

    if (url.pathname === '/api/me') {
      const sess = secret ? await readSession(secret, request.headers.get('cookie')) : null;
      return sess ? json({ email: sess.email }) : json({ error: 'not signed in' }, 401);
    }

    // Everything else is the app itself. No session, no app — a logged-out
    // visitor gets the sign-in page and nothing else, not even the shell.
    const sess = secret ? await readSession(secret, request.headers.get('cookie')) : null;
    if (!sess) {
      const login = await env.ASSETS.fetch(new URL('/login.html', url).toString());
      return new Response(login.body, {
        status: 401,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get('content-type') || '';

    // The shell ships with an empty data slot; fill it with this user's
    // library so the page runs unchanged, and never cache the result.
    if (type.includes('text/html')) {
      const lib = await libraryFor(env.DB, sess.email);
      if (!lib) return json({ error: 'no library for ' + sess.email }, 403);
      const html = (await res.text()).replace(
        '/*__DATA__*/null',
        JSON.stringify(lib).replace(/</g, '\\u003c'));
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8',
                   'cache-control': 'private, no-store' },
      });
    }

    const headers = new Headers(res.headers);
    headers.set('cache-control', 'private, no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};
