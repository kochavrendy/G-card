import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadGeneratedCatalog() {
  const source = await readFile(path.join(ROOT, 'card_meta.js'), 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { filename: 'card_meta.js' });
  return context.window;
}

test('Data snapshot is complete and has collision-safe source keys', async () => {
  const payload = JSON.parse(await readFile(path.join(ROOT, 'Data', 'cards.json'), 'utf8'));
  const cards = payload.cards;

  assert.equal(payload.metadata.partial_run, false);
  assert.equal(payload.metadata.detail_failed, 0);
  assert.equal(payload.metadata.detail_successful, 973);
  assert.equal(cards.length, 973);
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.source_id)).size, cards.length);
  assert.equal(new Set(cards.map((card) => card.picture)).size, cards.length);
});

test('generated catalog is backed by the complete Data snapshot', async () => {
  const { CARD_META, GCARD_DATA_INFO } = await loadGeneratedCatalog();
  const cards = Object.values(CARD_META);

  assert.equal(GCARD_DATA_INFO.source_record_count, 973);
  assert.equal(cards.length, 839);
  assert.equal(new Set(cards.map((card) => card.base_id)).size, 393);
  assert.equal(cards.filter((card) => card.is_parallel).length, 442);
  assert.equal(cards.filter((card) => card.deck_eligible).length, 826);
  assert.equal(new Set(cards.filter((card) => card.deck_eligible).map((card) => card.base_id)).size, 388);
  assert.equal(cards.filter((card) => card.features.includes('トークン')).length, 13);
  assert.equal(new Set(cards.filter((card) => card.features.includes('トークン')).map((card) => card.base_id)).size, 5);
});

test('every generated variant keeps the exact source metadata', async () => {
  const payload = JSON.parse(await readFile(path.join(ROOT, 'Data', 'cards.json'), 'utf8'));
  const sourceById = new Map(payload.cards.map((card) => [Number(card.id), card]));
  const { CARD_META } = await loadGeneratedCatalog();

  for (const generated of Object.values(CARD_META)) {
    const source = sourceById.get(generated.source_record_id);
    assert.ok(source, `missing source ${generated.source_record_id}`);
    const expectedText = String(
      source.detail_effect_text_plain
        || source.effect_text_plain
        || source.detail_effect_text
        || source.effect_text
        || 'なし',
    );
    assert.equal(generated.base_id, source.base_card_number);
    assert.equal(generated.card_number, source.card_number);
    assert.equal(generated.variant_id, source.source_id);
    assert.equal(generated.name, source.search_card_name || source.card_name || '');
    assert.equal(generated.type, source.search_card_kind || source.card_kind || '');
    assert.deepEqual(Array.from(generated.colors), source.colors || []);
    assert.equal(generated.grade, Number.parseInt(source.grade_number || 0, 10));
    assert.equal(generated.grade_display, String(source.grade || source.grade_number || ''));
    assert.equal(generated.power, source.stat_value ?? source.power_value ?? null);
    assert.equal(generated.power_display, String(source.stat_raw || source.power_raw || ''));
    assert.deepEqual(Array.from(generated.features), source.traits || []);
    assert.equal(generated.text, expectedText);
    assert.equal(generated.picture, source.picture);
    assert.equal(generated.image_url, source.official_image_url);
    assert.equal(generated.fallback_image_url, '');
    assert.equal(generated.is_parallel, Boolean(source.is_parallel));
  }
});

test('parallel prints keep a distinct catalog id and shared rules id', async () => {
  const { CARD_META } = await loadGeneratedCatalog();
  const prints = Object.values(CARD_META).filter(
    (card) => card.base_id === 'BP02-049',
  );

  assert.ok(prints.some((card) => card.is_canonical && !card.is_parallel));
  assert.ok(prints.some((card) => card.is_parallel));
  assert.equal(new Set(prints.map((card) => card.id)).size, prints.length);
  assert.deepEqual(new Set(prints.map((card) => card.base_id)), new Set(['BP02-049']));
});

test('Data corrections and uncommon display values survive generation', async () => {
  const { CARD_META } = await loadGeneratedCatalog();
  const cards = Object.values(CARD_META);
  const byBase = (baseId) => cards.filter((card) => card.base_id === baseId);

  assert.equal(byBase('PR-005')[0].name, '噛みつき');
  assert.equal(byBase('PR-005')[0].type, '戦略');
  assert.equal(byBase('PR-011').length, 0);
  assert.equal(byBase('PR-012').length, 0);
  assert.equal(byBase('PR-013').length, 0);
  assert.equal(byBase('PR-015').length, 1);
  assert.equal(byBase('PR-016').length, 1);
  assert.equal(new Set(cards.filter((card) => /^SC01-/.test(card.base_id)).map((card) => card.base_id)).size, 6);

  const suffixlessParallel = byBase('BP01-078').find(
    (card) => card.source_record_id === 1139,
  );
  assert.equal(suffixlessParallel.card_number, 'BP01-078');
  assert.equal(suffixlessParallel.is_parallel, true);
  assert.equal(byBase('PR-004').length, 7);
  assert.equal(CARD_META['BP01-037ol'].source_record_id, 124);
  assert.deepEqual(
    Array.from(byBase('BP03-006')[0].colors),
    ['赤', '青'],
  );

  const unusual = byBase('BP02-068')[0];
  assert.equal(unusual.grade, 23);
  assert.equal(unusual.grade_display, '㉓');
  assert.equal(unusual.power, 7000);
  assert.equal(unusual.power_display, '7000+');
});
