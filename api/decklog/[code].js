import { DecklogError, extractDecklogCode, fetchDecklogDeck } from './_client.mjs';

export const PAGES_ORIGIN = 'https://kochavrendy.github.io';

function setCorsHeaders(req, res) {
  const origin = String(req.headers?.origin || '');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (origin === PAGES_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  setCorsHeaders(req, res);
  const origin = String(req.headers?.origin || '');
  if (origin && origin !== PAGES_ORIGIN) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const code = extractDecklogCode(req.query?.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_code' });
    return;
  }

  try {
    res.status(200).json(await fetchDecklogDeck(code));
  } catch (error) {
    if (error instanceof DecklogError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    res.status(502).json({ error: 'upstream_unavailable' });
  }
}
