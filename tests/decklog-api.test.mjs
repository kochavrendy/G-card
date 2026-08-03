import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DecklogError,
  extractDecklogCode,
  fetchDecklogDeck,
} from '../api/decklog/client.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('accepts four-to-sixteen character Deck Log codes', () => {
  assert.equal(extractDecklogCode('vd26'), 'VD26');
  assert.equal(extractDecklogCode('26YK7'), '26YK7');
  assert.equal(extractDecklogCode('abc'), '');
  assert.equal(extractDecklogCode('../26YK7'), '');
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
