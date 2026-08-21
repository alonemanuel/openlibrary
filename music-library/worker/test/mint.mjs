/** Mints a session cookie the same way the Worker does, so the signed-in
 *  path can be tested without going through Google. Dev secret only. */
const enc = new TextEncoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const [, , secret, email] = process.argv;
const body = b64(enc.encode(JSON.stringify({ email, exp: Date.now() + 864e5 })));
const key = await crypto.subtle.importKey(
  'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
process.stdout.write(`${body}.${b64(sig)}`);
