import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadGlobals() {
  const context = vm.createContext({ window: {}, atob, btoa, escape, unescape });
  context.globalThis = context;
  vm.runInContext(await readFile(path.join(ROOT, 'card_meta.js'), 'utf8'), context);
  vm.runInContext(await readFile(path.join(ROOT, 'deck-import.js'), 'utf8'), context);
  return {
    api: context.GCardDeckImport,
    cardMeta: context.window.CARD_META,
  };
}

test('extracts Deck Log and Bushi Navi recipe codes without guessing prose', async () => {
  const { api } = await loadGlobals();

  assert.equal(api.extractDecklogCode('26yk7'), '26YK7');
  assert.equal(
    api.extractDecklogCode('https://decklog.bushiroad.com/view/26YK7'),
    '26YK7',
  );
  assert.equal(api.extractDecklogCode('ブシナビ デッキコード: 26YK7'), '26YK7');
  assert.equal(api.extractDecklogCode('v2:1.1|2.1'), '');
  assert.equal(api.extractDecklogCode('ordinary words in a sentence'), '');
  assert.equal(api.normalizeCustomDeckCode('G-cardコード:v2:1.1|2.1'), 'v2:1.1|2.1');
});

test('imports exact parallel art from Deck Log before base-card fallback', async () => {
  const { api, cardMeta } = await loadGlobals();
  const result = api.importDecklogPayload(
    {
      deckId: '26YK7',
      title: 'sample',
      main: [
        { cardNumber: 'BP02-049', count: 3, image: 'BP02/BP02-049.png' },
        { cardNumber: 'BP02-049+', count: 1, image: 'BP02/BP02-049_2.png' },
      ],
      monster: [
        { cardNumber: 'BP04-027', count: 1, image: 'BP04/BP04-027.png' },
      ],
    },
    cardMeta,
  );

  const mainIds = Object.keys(result.main);
  assert.equal(result.mainCount, 4);
  assert.equal(result.monsterCount, 1);
  assert.equal(mainIds.length, 2);
  assert.ok(mainIds.some((id) => cardMeta[id].is_parallel));
  assert.ok(mainIds.some((id) => !cardMeta[id].is_parallel));
});

test('rejects the whole import when any card is unknown', async () => {
  const { api, cardMeta } = await loadGlobals();

  assert.throws(
    () => api.importDecklogPayload(
      {
        main: [{ cardNumber: 'UNKNOWN-999', count: 1 }],
        monster: [{ cardNumber: 'BP04-027', count: 1 }],
      },
      cardMeta,
    ),
    (error) => error.message === 'decklog_card_unknown'
      && error.cards.includes('UNKNOWN-999'),
  );
});

test('rejects an upstream row whose image and card number disagree', async () => {
  const { api, cardMeta } = await loadGlobals();

  assert.throws(
    () => api.importDecklogPayload(
      {
        main: [{ cardNumber: 'BP02-049', count: 1, image: 'BP04/BP04-027.png' }],
        monster: [],
      },
      cardMeta,
    ),
    (error) => error.message === 'decklog_card_mismatch',
  );
  assert.throws(
    () => api.importDecklogPayload(
      {
        main: [{ cardNumber: 'SD01-001++', count: 1, image: 'SD01/SD01-001_2.png' }],
        monster: [],
      },
      cardMeta,
    ),
    (error) => error.message === 'decklog_card_mismatch',
  );
});

test('copy limits aggregate normal and parallel prints by base card', async () => {
  const { api, cardMeta } = await loadGlobals();
  const normal = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP02-049' && card.is_canonical,
  );
  const parallel = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP02-049' && card.is_parallel,
  );
  const status = api.getDeckCopyStatus(
    { [normal.id]: 3 },
    parallel.id,
    2,
    cardMeta,
    4,
  );
  assert.equal(status.current, 3);
  assert.equal(status.next, 5);
  assert.equal(status.allowed, false);

  const unlimited = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP01-046' && card.is_canonical,
  );
  const unlimitedStatus = api.getDeckCopyStatus(
    { [unlimited.id]: 20 },
    unlimited.id,
    1,
    cardMeta,
    4,
  );
  assert.equal(unlimitedStatus.unlimited, true);
  assert.equal(unlimitedStatus.allowed, true);

  const mixedValidation = api.validateDeckCopyLimits(
    { [normal.id]: 3, [parallel.id]: 2 },
    cardMeta,
    4,
  );
  assert.equal(mixedValidation.valid, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(mixedValidation.violations)),
    [{ baseId: 'BP02-049', total: 5, limit: 4, restriction: 'copy_limit' }],
  );
  assert.equal(
    api.validateDeckCopyLimits({ [unlimited.id]: 20 }, cardMeta, 4).valid,
    true,
  );
});

test('official restricted and choice-restricted cards are rejected', async () => {
  const { api, cardMeta } = await loadGlobals();
  const restricted = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP01-077' && card.is_canonical,
  );
  const comboA = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP02-003' && card.is_canonical,
  );
  const comboB = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP03-035' && card.is_canonical,
  );
  assert.ok(restricted && comboA && comboB);

  const restrictedStatus = api.getDeckCopyStatus(
    { [restricted.id]: 1 },
    restricted.id,
    1,
    cardMeta,
    4,
  );
  assert.equal(restrictedStatus.allowed, false);
  assert.equal(restrictedStatus.reason, 'restricted');
  assert.equal(restrictedStatus.limit, 1);

  const restrictedValidation = api.validateDeckCopyLimits(
    { [restricted.id]: 2 },
    cardMeta,
    4,
  );
  assert.equal(restrictedValidation.valid, false);
  assert.equal(restrictedValidation.violations[0].restriction, 'restricted');

  const comboStatus = api.getDeckCopyStatus(
    { [comboA.id]: 1 },
    comboB.id,
    1,
    cardMeta,
    4,
  );
  assert.equal(comboStatus.allowed, false);
  assert.equal(comboStatus.reason, 'choice_restricted');
  assert.deepEqual(Array.from(comboStatus.conflictingBaseIds), ['BP02-003']);

  const comboValidation = api.validateDeckCopyLimits(
    { [comboA.id]: 1, [comboB.id]: 1 },
    cardMeta,
    4,
  );
  assert.equal(comboValidation.valid, false);
  assert.equal(comboValidation.violations[0].restriction, 'choice_restricted');
});

test('v3 codes preserve exact parallel IDs when the catalog grows', async () => {
  const { api } = await loadGlobals();
  const legacyIds = ['SD01-001ol', 'SD01-002ol'];
  const original = api.createDeckCodec({
    legacyIds,
    activeIds: [...legacyIds, 'BP02-049~839'],
  });
  const code = original.encode({
    main: { 'BP02-049~839': 2, 'SD01-001ol': 1 },
    monster: { 'SD01-002ol': 1 },
  });
  assert.match(code, /^v3:/);

  const expanded = api.createDeckCodec({
    legacyIds,
    activeIds: ['NEW-001', 'BP02-049~839', ...legacyIds],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(expanded.decode(code))),
    {
      main: { 'BP02-049~839': 2, 'SD01-001ol': 1 },
      monster: { 'SD01-002ol': 1 },
    },
  );
});

test('v2 decoding remains pinned to the frozen legacy order', async () => {
  const { api } = await loadGlobals();
  const codec = api.createDeckCodec({
    legacyIds: ['SD01-001ol', 'SD01-002ol'],
    activeIds: ['NEW-001', 'SD01-002ol', 'SD01-001ol'],
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(codec.decode('v2:0.2|1.1'))),
    {
      main: { 'SD01-001ol': 2 },
      monster: { 'SD01-002ol': 1 },
    },
  );
  assert.throws(
    () => codec.decode('v3:eyJ2ZXJzaW9uIjozLCJtYWluIjpbWyJVTktOT1dOIiwxXV0sIm1vbnN0ZXIiOltdfQ'),
    /card_unknown:UNKNOWN/,
  );
  for (const malformed of [
    'v2:0.1.extra|1.1',
    'v2:0!.1|1.1',
    'v2:0.1|1.1|0.1',
    'v2:0.1,0.2|',
  ]) {
    assert.throws(() => codec.decode(malformed));
  }
  assert.throws(() => codec.decode(`v1:${'A'.repeat(20_001)}`), /deck_code_too_large/);
});

test('v3 serializes canonical cards with a source-stable variant ID', async () => {
  const { api } = await loadGlobals();
  const original = api.createDeckCodec({
    activeIds: ['BP01-037ol'],
    serializeId: (id) => id === 'BP01-037ol' ? 'godzilla-cardgame:124' : id,
  });
  const code = original.encode({ main: { 'BP01-037ol': 1 }, monster: {} });

  const changedCatalog = api.createDeckCodec({
    activeIds: ['BP01-037~124'],
    resolveId: (id) => id === 'godzilla-cardgame:124' ? 'BP01-037~124' : '',
    serializeId: (id) => id === 'BP01-037~124' ? 'godzilla-cardgame:124' : id,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(changedCatalog.decode(code))),
    { main: { 'BP01-037~124': 1 }, monster: {} },
  );
});

test('generated catalog round-trips canonical and parallel variants through v3', async () => {
  const { api, cardMeta } = await loadGlobals();
  const activeIds = Object.values(cardMeta)
    .filter((card) => card.deck_eligible)
    .map((card) => card.id);
  const bySource = new Map(Object.values(cardMeta).map((card) => [card.source_id, card.id]));
  const codec = api.createDeckCodec({
    activeIds,
    resolveId: (id) => bySource.get(id) || '',
    serializeId: (id) => cardMeta[id] && cardMeta[id].source_id,
  });
  const canonical = cardMeta['BP01-037ol'];
  const parallel = Object.values(cardMeta).find(
    (card) => card.base_id === 'BP02-049' && card.is_parallel,
  );
  const input = { main: { [canonical.id]: 1, [parallel.id]: 2 }, monster: {} };
  const code = codec.encode(input);

  assert.match(code, /^v3:/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(codec.decode(code))),
    input,
  );
});
