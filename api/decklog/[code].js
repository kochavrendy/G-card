import { DecklogError, extractDecklogCode, fetchDecklogDeck } from './client.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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
