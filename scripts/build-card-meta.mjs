import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'Data', 'cards.json');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'card_meta.js');
const PLAYABLE_KINDS = new Set(['怪獣', '交戦', '戦略']);

function rangeIds(prefix, from, to) {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${prefix}-${String(from + index).padStart(3, '0')}`,
  );
}

// Keep the historical catalog order stable so existing v2 deck codes continue
// to decode to the same cards after the Data-backed catalog grows.
const LEGACY_BASE_IDS = [
  ...rangeIds('SD01', 1, 15),
  ...rangeIds('SD02', 1, 15),
  ...rangeIds('BP01', 1, 80),
  ...rangeIds('BP02', 1, 80),
  ...rangeIds('BP03', 1, 80),
  ...rangeIds('FC01', 1, 6),
  ...rangeIds('PR', 1, 14),
  ...rangeIds('BP04', 1, 89),
  ...rangeIds('SC01', 1, 6),
];
const LEGACY_ORDER = new Map(LEGACY_BASE_IDS.map((id, index) => [id, index]));

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input') options.input = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--help') {
      console.log('Usage: node scripts/build-card-meta.mjs [--input Data/cards.json] [--output card_meta.js]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return options;
}

function catalogIdForBase(baseId) {
  if (/^(?:SD01|SD02|BP01)-\d{3}$/i.test(baseId)) return `${baseId}ol`;
  return baseId;
}

function resolvedKind(card) {
  return String(card.search_card_kind || card.card_kind || '').trim();
}

function canonicalRank(card) {
  const baseId = String(card.base_card_number || card.card_number || '').trim();
  const baseExpansion = baseId.split('-')[0].toUpperCase();
  const recordExpansion = String(card.expansion || '').trim().toUpperCase();
  return [
    card.is_parallel ? 1 : 0,
    recordExpansion === baseExpansion ? 0 : 1,
    String(card.card_number || '') === baseId ? 0 : 1,
    card.detail_effect_text || card.effect_text ? 0 : 1,
    Number(card.id) || Number.MAX_SAFE_INTEGER,
  ];
}

function compareRank(left, right) {
  const a = canonicalRank(left);
  const b = canonicalRank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function integerOr(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : fallback;
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function variantLabel(card, canonical) {
  if (card === canonical) return '通常';
  if (card.is_parallel) {
    const suffix = String(card.parallel_suffix || '').trim();
    return suffix ? `パラレル ${suffix}` : 'パラレル';
  }
  return '別イラスト';
}

function buildCatalog(payload) {
  if (!payload || !Array.isArray(payload.cards)) {
    throw new Error('Data/cards.json must contain a cards array');
  }

  const playable = payload.cards.filter((card) => PLAYABLE_KINDS.has(resolvedKind(card)));
  const grouped = new Map();
  for (const card of playable) {
    const baseId = String(card.base_card_number || card.card_number || '').trim();
    if (!baseId) throw new Error(`Card ${card.id ?? '?'} has no base card number`);
    if (!grouped.has(baseId)) grouped.set(baseId, []);
    grouped.get(baseId).push(card);
  }

  const bases = [...grouped.keys()].sort((left, right) => {
    const leftOrder = LEGACY_ORDER.get(left);
    const rightOrder = LEGACY_ORDER.get(right);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right, 'ja');
  });

  const entries = [];
  const usedIds = new Set();
  for (const baseId of bases) {
    const records = grouped.get(baseId).slice().sort(compareRank);
    const canonical = records[0];
    for (const card of records) {
      let catalogId = card === canonical
        ? catalogIdForBase(baseId)
        : `${baseId}~${String(card.id)}`;
      let collision = 2;
      while (usedIds.has(catalogId)) catalogId = `${baseId}~${String(card.id)}-${collision++}`;
      usedIds.add(catalogId);

      const kind = resolvedKind(card);
      const traits = Array.isArray(card.traits) ? card.traits.map(String) : [];
      const isToken = traits.includes('トークン') || String(card.rarity_key || card.rarity || '') === 'T';
      const officialImage = String(card.official_image_url || '').trim();
      if (!officialImage) throw new Error(`Card ${card.id ?? '?'} has no official image URL`);
      const text = String(
        card.detail_effect_text_plain
          || card.effect_text_plain
          || card.detail_effect_text
          || card.effect_text
          || 'なし',
      );

      entries.push([
        catalogId,
        {
          id: catalogId,
          base_id: baseId,
          card_number: String(card.card_number || baseId),
          source_id: String(card.source_id || `godzilla-cardgame:${card.id}`),
          variant_id: String(card.source_id || `godzilla-cardgame:${card.id}`),
          source_record_id: Number(card.id) || null,
          name: String(card.search_card_name || card.card_name || ''),
          color: String(card.color || (Array.isArray(card.colors) ? card.colors.join('・') : '') || ''),
          colors: Array.isArray(card.colors) ? card.colors.map(String) : [],
          type: kind,
          grade: integerOr(card.grade_number),
          grade_display: String(card.grade || card.grade_number || ''),
          advance: integerOr(card.step_icon),
          power: numberOrNull(card.stat_value, card.power_value),
          power_display: String(card.stat_raw || card.power_raw || ''),
          power_label: String(card.power_label || ''),
          power_suffix: String(card.stat_suffix || card.power_suffix || ''),
          features_raw: traits.join(', '),
          features: traits,
          text,
          rarity: String(card.rarity_display || card.rarity || ''),
          rarity_key: String(card.rarity_key || card.rarity || ''),
          set: String(card.expansion || baseId.split('-')[0] || 'OTHER'),
          expansion_name: String(card.expansion_name || ''),
          release_date: String(card.release_date || ''),
          picture: String(card.picture || ''),
          image_url: officialImage,
          fallback_image_url: '',
          is_parallel: Boolean(card.is_parallel),
          parallel_level: integerOr(card.parallel_level),
          parallel_suffix: String(card.parallel_suffix || ''),
          variant_label: variantLabel(card, canonical),
          is_canonical: card === canonical,
          deck_eligible: !isToken,
        },
      ]);
    }
  }

  return { entries, playable, grouped };
}

function renderJavaScript(payload, catalog) {
  const info = {
    schema_version: 2,
    source_schema_version: payload.metadata?.schema_version ?? null,
    source_completed_at: payload.metadata?.completed_at ?? null,
    source_cardlist_url: payload.metadata?.source_cardlist_url ?? null,
    source_record_count: payload.cards.length,
    playable_record_count: catalog.playable.length,
    playable_base_count: catalog.grouped.size,
    catalog_record_count: catalog.entries.length,
    deck_eligible_count: catalog.entries.filter(([, card]) => card.deck_eligible).length,
    parallel_count: catalog.entries.filter(([, card]) => card.is_parallel).length,
  };
  const lines = [
    '// Auto-generated from Data/cards.json by scripts/build-card-meta.mjs.',
    '// Replace Data/cards.json and rerun the generator; do not hand-edit this file.',
    `window.GCARD_DATA_INFO = ${JSON.stringify(info, null, 2)};`,
    'window.CARD_META = {',
  ];
  for (const [id, card] of catalog.entries) {
    lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(card)},`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

const options = parseArgs(process.argv.slice(2));
const payload = JSON.parse(readFileSync(options.input, 'utf8'));
const catalog = buildCatalog(payload);
writeFileSync(options.output, renderJavaScript(payload, catalog), 'utf8');
console.log(JSON.stringify({
  input: options.input,
  output: options.output,
  source_records: payload.cards.length,
  catalog_records: catalog.entries.length,
  playable_bases: catalog.grouped.size,
  parallel_records: catalog.entries.filter(([, card]) => card.is_parallel).length,
}, null, 2));
