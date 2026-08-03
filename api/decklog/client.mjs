const DECKLOG_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
const DECKLOG_VIEW_API = 'https://decklog.bushiroad.com/system/app/api/view/';

export class DecklogError extends Error {
  constructor(code, status, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = 'DecklogError';
    this.code = code;
    this.status = status;
  }
}

export function extractDecklogCode(input) {
  const value = Array.isArray(input) ? input[0] : input;
  const code = String(value || '').trim().toUpperCase();
  return DECKLOG_CODE_PATTERN.test(code) ? code : '';
}

function projectCard(row) {
  const cardNumber = String(row?.card_number || '').trim();
  const count = Number(row?.num);
  if (!cardNumber || !Number.isInteger(count) || count <= 0 || count > 100) {
    throw new DecklogError('upstream_payload_invalid', 502);
  }
  return {
    cardNumber,
    count,
    image: String(row?.img || ''),
    name: String(row?.name || ''),
  };
}

export async function fetchDecklogDeck(code, options = {}) {
  const normalizedCode = extractDecklogCode(code);
  if (!normalizedCode) throw new DecklogError('invalid_code', 400);

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs) || 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${DECKLOG_VIEW_API}${encodeURIComponent(normalizedCode)}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: 'https://decklog.bushiroad.com',
          Referer: 'https://decklog.bushiroad.com/',
          'User-Agent': 'G-CARD Director Deck Log importer',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new DecklogError('upstream_unavailable', 502);

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new DecklogError('upstream_payload_invalid', 502, error);
    }

    // Deck Log returns HTTP 200 with [] when the code is missing or unavailable.
    if (Array.isArray(payload) && payload.length === 0) {
      throw new DecklogError('deck_not_found', 404);
    }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new DecklogError('upstream_payload_invalid', 502);
    }
    const payloadDeckId = String(payload.deck_id || '').trim().toUpperCase();
    if (!payloadDeckId || payloadDeckId !== normalizedCode) {
      throw new DecklogError('upstream_payload_invalid', 502);
    }
    if (Number(payload.game_title_id) !== 13) {
      throw new DecklogError('wrong_game_title', 422);
    }
    if (!Array.isArray(payload.list) || !Array.isArray(payload.p_list)) {
      throw new DecklogError('upstream_payload_invalid', 502);
    }

    return {
      deckId: payloadDeckId,
      gameTitleId: 13,
      title: String(payload.title || ''),
      main: payload.list.map(projectCard),
      monster: payload.p_list.map(projectCard),
    };
  } catch (error) {
    if (error instanceof DecklogError) throw error;
    if (error?.name === 'AbortError') throw new DecklogError('upstream_timeout', 504, error);
    throw new DecklogError('upstream_unavailable', 502, error);
  } finally {
    clearTimeout(timeout);
  }
}
