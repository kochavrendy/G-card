import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DecklogError,
  extractDecklogCode,
  fetchDecklogDeck,
} from '../api/decklog/_client.mjs';
import handler, { PAGES_ORIGIN } from '../api/decklog/[code].js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockResponse() {
  const headers = new Map();
  return {
    body: undefined,
    ended: false,
    headers,
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test('accepts four-to-sixteen character Deck Log codes', () => {
  assert.equal(extractDecklogCode('vd26'), 'VD26');
  assert.equal(extractDecklogCode('26YK7'), '26YK7');
  assert.equal(extractDecklogCode('7td5d'), '7TD5D');
  assert.equal(extractDecklogCode('abc'), '');
  assert.equal(extractDecklogCode('../26YK7'), '');
});

test('allows GitHub Pages preflight requests', async () => {
  const response = mockResponse();
  await handler({
    method: 'OPTIONS',
    headers: { origin: PAGES_ORIGIN },
    query: { code: '7TD5D' },
  }, response);

  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.equal(response.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Accept');
  assert.equal(response.headers.get('access-control-max-age'), '86400');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('allow'), 'GET, OPTIONS');
});

test('rejects other origins before contacting Deck Log', async () => {
  const response = mockResponse();
  await handler({
    method: 'GET',
    headers: { origin: 'https://kochavrendy.github.io.evil.invalid' },
    query: { code: '7TD5D' },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'origin_not_allowed' });
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('reports supported methods to the allowed origin', async () => {
  const response = mockResponse();
  await handler({
    method: 'POST',
    headers: { origin: PAGES_ORIGIN },
    query: { code: '7TD5D' },
  }, response);

  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: 'method_not_allowed' });
  assert.equal(response.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
  assert.equal(response.headers.get('allow'), 'GET, OPTIONS');
});

test('returns success and validation errors with GitHub Pages CORS headers', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return jsonResponse({
      deck_id: '7TD5D',
      game_title_id: 13,
      title: 'sample',
      list: [{ card_number: 'BP01-001', num: 50, img: '', name: 'main' }],
      p_list: [{ card_number: 'BP01-002', num: 4, img: '', name: 'monster' }],
    });
  };
  try {
    const success = mockResponse();
    await handler({
      method: 'GET',
      headers: { origin: PAGES_ORIGIN },
      query: { code: '7TD5D' },
    }, success);

    assert.equal(success.statusCode, 200);
    assert.equal(success.body.deckId, '7TD5D');
    assert.equal(success.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
    assert.equal(upstreamCalls, 1);

    const invalid = mockResponse();
    await handler({
      method: 'GET',
      headers: { origin: PAGES_ORIGIN },
      query: { code: '../7TD5D' },
    }, invalid);

    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.body, { error: 'invalid_code' });
    assert.equal(invalid.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps originless server requests compatible without granting CORS', async () => {
  const response = mockResponse();
  await handler({ method: 'GET', headers: {}, query: { code: '' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('calls the official POST endpoint and projects only required fields', async () => {
  let request;
  const deck = await fetchDecklogDeck('26yk7', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        deck_id: '26YK7',
        game_title_id: 13,
        title: 'Official deck',
        list: [{ card_number: 'BP02-049+', num: 1, img: 'BP02/BP02-049_2.png', name: 'x' }],
        p_list: [{ card_number: 'BP04-027', num: 1, img: 'BP04/BP04-027.png', name: 'y' }],
        memo: 'must not leak',
      });
    },
  });

  assert.equal(request.options.method, 'POST');
  assert.match(request.url, /\/system\/app\/api\/view\/26YK7$/);
  assert.equal(request.options.headers.Origin, 'https://decklog.bushiroad.com');
  assert.equal(deck.deckId, '26YK7');
  assert.equal(deck.main[0].cardNumber, 'BP02-049+');
  assert.equal('memo' in deck, false);
});

test('maps empty and other-game responses to safe errors', async () => {
  await assert.rejects(
    fetchDecklogDeck('26YK7', { fetchImpl: async () => jsonResponse([]) }),
    (error) => error instanceof DecklogError
      && error.code === 'deck_not_found'
      && error.status === 404,
  );

  await assert.rejects(
    fetchDecklogDeck('3UFAC', {
      fetchImpl: async () => jsonResponse({ deck_id: '3UFAC', game_title_id: 9, list: [], p_list: [] }),
    }),
    (error) => error instanceof DecklogError
      && error.code === 'wrong_game_title'
      && error.status === 422,
  );
});

test('rejects a mismatched deck id and times out while reading the body', async () => {
  await assert.rejects(
    fetchDecklogDeck('26YK7', {
      fetchImpl: async () => jsonResponse({
        deck_id: 'OTHER',
        game_title_id: 13,
        list: [],
        p_list: [],
      }),
    }),
    (error) => error instanceof DecklogError
      && error.code === 'upstream_payload_invalid'
      && error.status === 502,
  );

  await assert.rejects(
    fetchDecklogDeck('26YK7', {
      timeoutMs: 5,
      fetchImpl: async (_url, options) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        }),
      }),
    }),
    (error) => error instanceof DecklogError
      && error.code === 'upstream_timeout'
      && error.status === 504,
  );
});
