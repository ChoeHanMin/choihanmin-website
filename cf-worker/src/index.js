/**
 * Cloudflare Worker: real server-side password gate for choihanmin.com's
 * protected files (certificate gallery images + the full portfolio PDF).
 *
 * The site itself stays a static GitHub Pages site. This worker is the only
 * thing that can read the R2 bucket where the actual files live, so a
 * correct password is enforced server-side instead of being a client-side
 * check that anyone can bypass by guessing the public file URL.
 *
 * Endpoints:
 *   POST /auth              { password } -> { token, exp }  (2h token)
 *   GET  /file/:name?token= -> streams the file from R2 if the token is valid
 */

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ALLOWED_ORIGIN = 'https://www.choihanmin.com';

const ALLOWED_FILES = new Set([
  'portfolio-locked.pdf',
  ...Array.from({ length: 45 }, (_, i) => `cert${String(i + 1).padStart(2, '0')}.jpg`),
]);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.TOKEN_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function issueToken(env) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(exp)));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token: `${exp}.${sigB64}`, exp };
}

async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const [expStr, sigB64] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const key = await hmacKey(env);
  const padded = sigB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(sigB64.length / 4) * 4, '=');
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(expStr));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/auth' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'bad request' }), {
          status: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
      if (typeof body.password !== 'string' || body.password !== env.SITE_PASSWORD) {
        return new Response(JSON.stringify({ error: 'invalid password' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
      const { token, exp } = await issueToken(env);
      return new Response(JSON.stringify({ token, exp }), {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.startsWith('/file/') && request.method === 'GET') {
      const name = decodeURIComponent(url.pathname.slice('/file/'.length));
      if (!ALLOWED_FILES.has(name)) {
        return new Response('Not found', { status: 404, headers: corsHeaders() });
      }
      const token = url.searchParams.get('token');
      const valid = await verifyToken(env, token);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'invalid or expired token' }), {
          status: 401,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        });
      }
      const obj = await env.PROTECTED_BUCKET.get(name);
      if (!obj) {
        return new Response('Not found', { status: 404, headers: corsHeaders() });
      }
      const headers = new Headers(corsHeaders());
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', 'private, no-store');
      if (name.endsWith('.pdf')) {
        headers.set('Content-Disposition', 'attachment; filename="Choi_Hanmin_Portfolio.pdf"');
      }
      return new Response(obj.body, { headers });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};
