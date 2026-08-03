(function attachDeckImport(root) {
  'use strict';

  // Official Japanese restriction list effective 2026-04-01.
  // Keep this small policy table in sync with https://godzilla-cardgame.com/rules/.
  const RESTRICTED_COPY_LIMITS = Object.freeze({
    'BP01-077': 1,
  });
  const CHOICE_RESTRICTED_GROUPS = Object.freeze([
    Object.freeze(['BP02-003', 'BP03-035']),
  ]);

  const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
  const MAX_CUSTOM_CODE_LENGTH = 20_000;

  function normalizeCatalogText(value) {
    return String(value || '').trim().toUpperCase();
  }

  function normalizePicture(value) {
    return String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .toLowerCase();
  }

  function baseCardNumber(value) {
    return normalizeCatalogText(value).replace(/OL$/i, '').replace(/\++$/, '');
  }

  function normalizeCustomDeckCode(value) {
    const text = String(value || '').trim();
    if (/^v[123]:/i.test(text)) return text;
    const match = text.match(/(v[123]:[^\s]+)/i);
    return match ? match[1] : text;
  }

  function extractDecklogCode(value) {
    const text = String(value || '').trim();
    if (!text || /^v[123]:/i.test(text)) return '';

    const direct = normalizeCatalogText(text);
    if (CODE_PATTERN.test(direct)) return direct;

    const urlMatch = text.match(
      /https?:\/\/(?:www\.)?decklog\.bushiroad\.com\/view\/([a-z0-9]{4,16})(?:\b|[/?#])/i,
    );
    if (urlMatch) return urlMatch[1].toUpperCase();

    const labeled = text.match(
      /(?:デッキ|deck\s*log|ブシナビ|bushi\s*navi)[^a-z0-9]{0,12}(?:コード|code)?[^a-z0-9]{0,6}([a-z0-9]{4,16})\b/i,
    );
    return labeled ? labeled[1].toUpperCase() : '';
  }

  function catalogEntries(cardMeta) {
    return Object.values(cardMeta || {}).filter(
      (card) => card && card.id && card.deck_eligible !== false,
    );
  }

  function preferredCard(cards) {
    return cards.slice().sort((left, right) => {
      const rank = (card) => [
        card.is_canonical ? 0 : 1,
        card.is_parallel ? 1 : 0,
        Number(card.source_record_id) || Number.MAX_SAFE_INTEGER,
      ];
      const a = rank(left);
      const b = rank(right);
      for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
      }
      return String(left.id).localeCompare(String(right.id));
    })[0] || null;
  }

  function createCatalogIndex(cardMeta) {
    const entries = catalogEntries(cardMeta);
    const byPicture = new Map();
    const byNumber = new Map();
    const byBase = new Map();

    for (const card of entries) {
      const picture = normalizePicture(card.picture);
      if (picture) byPicture.set(picture, card);

      const number = normalizeCatalogText(card.card_number || card.base_id || card.id);
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push(card);

      const base = baseCardNumber(card.base_id || number);
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(card);
    }

    return {
      resolve(row) {
        const picture = normalizePicture(row && (row.image || row.img || row.picture));
        const number = normalizeCatalogText(
          row && (row.cardNumber || row.card_number || row.number),
        );
        if (picture && byPicture.has(picture)) {
          const card = byPicture.get(picture);
          if (number && number !== normalizeCatalogText(card.card_number)) {
            const error = new Error('decklog_card_mismatch');
            error.cardNumber = number;
            throw error;
          }
          return card;
        }

        if (number && byNumber.has(number)) return preferredCard(byNumber.get(number));

        const base = baseCardNumber(number);
        return base && byBase.has(base) ? preferredCard(byBase.get(base)) : null;
      },
    };
  }

  function positiveCount(row) {
    const count = Number(row && (row.count ?? row.num ?? row._num));
    return Number.isInteger(count) && count > 0 && count <= 100 ? count : 0;
  }

  function rowsFromPayload(payload, normalizedKey, rawKey) {
    const value = payload && (payload[normalizedKey] ?? payload[rawKey]);
    return Array.isArray(value) ? value : null;
  }

  function importDecklogPayload(payload, cardMeta) {
    const source = payload && payload.data && !payload.main && !payload.list
      ? payload.data
      : payload;
    const mainRows = rowsFromPayload(source, 'main', 'list');
    const monsterRows = rowsFromPayload(source, 'monster', 'p_list');
    if (!mainRows || !monsterRows) throw new Error('decklog_response_invalid');

    const index = createCatalogIndex(cardMeta);
    const unknown = [];
    const invalid = [];
    const buildMap = (rows) => {
      const result = {};
      for (const row of rows) {
        const count = positiveCount(row);
        const number = String(row && (row.cardNumber || row.card_number || row.number) || '').trim();
        if (!count) {
          invalid.push(number || '番号なし');
          continue;
        }
        const card = index.resolve(row);
        if (!card) {
          unknown.push(number || '番号なし');
          continue;
        }
        result[card.id] = (result[card.id] || 0) + count;
      }
      return result;
    };

    const main = buildMap(mainRows);
    const monster = buildMap(monsterRows);
    if (invalid.length) {
      const error = new Error('decklog_count_invalid');
      error.cards = [...new Set(invalid)];
      throw error;
    }
    if (unknown.length) {
      const error = new Error('decklog_card_unknown');
      error.cards = [...new Set(unknown)];
      throw error;
    }
    const placement = validateDeckPlacements({ main, monster }, cardMeta);
    if (placement.invalidMonster.length) {
      const error = new Error('deck_monster_type_invalid');
      error.cards = placement.invalidMonster;
      throw error;
    }

    return {
      main,
      monster,
      mainCount: Object.values(main).reduce((sum, count) => sum + count, 0),
      monsterCount: Object.values(monster).reduce((sum, count) => sum + count, 0),
      title: String(source && (source.title || source.deckTitle || '') || ''),
      deckId: String(source && (source.deckId || source.deck_id || '') || ''),
    };
  }

  function getDeckCopyStatus(deck, cardId, increment, cardMeta, maxCopies = 4) {
    const meta = cardMeta && cardMeta[cardId];
    const baseId = baseCardNumber(meta && meta.base_id ? meta.base_id : cardId);
    const addition = Number(increment);
    const limit = Number(maxCopies);
    if (!baseId || !Number.isInteger(addition) || addition <= 0 || !Number.isInteger(limit) || limit <= 0) {
      throw new Error('deck_copy_check_invalid');
    }
    let current = 0;
    for (const [id, countValue] of Object.entries(deck || {})) {
      const itemMeta = cardMeta && cardMeta[id];
      const itemBase = baseCardNumber(itemMeta && itemMeta.base_id ? itemMeta.base_id : id);
      const count = Number(countValue);
      if (itemBase === baseId && Number.isFinite(count) && count > 0) current += count;
    }
    const unlimited = Boolean(meta && /好きな枚数入れてよい/.test(String(meta.text || '')));
    const restrictedLimit = RESTRICTED_COPY_LIMITS[baseId];
    const effectiveLimit = Number.isInteger(restrictedLimit) ? restrictedLimit : limit;
    const choiceGroup = CHOICE_RESTRICTED_GROUPS.find((group) => group.includes(baseId));
    const conflictingBaseIds = choiceGroup
      ? choiceGroup.filter((member) => member !== baseId && Number(totalsByBase(deck, cardMeta).get(member) || 0) > 0)
      : [];
    const reason = conflictingBaseIds.length
      ? 'choice_restricted'
      : (Number.isInteger(restrictedLimit) && current + addition > effectiveLimit
        ? 'restricted'
        : 'copy_limit');
    return {
      allowed: conflictingBaseIds.length === 0 && (unlimited || current + addition <= effectiveLimit),
      baseId,
      current,
      next: current + addition,
      limit: effectiveLimit,
      unlimited,
      reason,
      conflictingBaseIds,
    };
  }

  function totalsByBase(deck, cardMeta) {
    const totals = new Map();
    for (const [id, countValue] of Object.entries(deck || {})) {
      const meta = cardMeta && cardMeta[id];
      const count = Number(countValue);
      if (!meta || !Number.isFinite(count) || count <= 0) continue;
      const baseId = baseCardNumber(meta.base_id || id);
      totals.set(baseId, (totals.get(baseId) || 0) + count);
    }
    return totals;
  }

  function validateDeckCopyLimits(deck, cardMeta, maxCopies = 4) {
    const limit = Number(maxCopies);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('deck_copy_check_invalid');
    const totals = new Map();
    const unlimitedBases = new Set();
    const unknown = [];
    const invalid = [];

    for (const [id, countValue] of Object.entries(deck || {})) {
      const meta = cardMeta && cardMeta[id];
      const count = Number(countValue);
      if (!meta) {
        unknown.push(id);
        continue;
      }
      if (!Number.isInteger(count) || count <= 0 || count > 100) {
        invalid.push(id);
        continue;
      }
      const baseId = baseCardNumber(meta.base_id || id);
      totals.set(baseId, (totals.get(baseId) || 0) + count);
      if (/好きな枚数入れてよい/.test(String(meta.text || ''))) unlimitedBases.add(baseId);
    }

    const violations = [...totals.entries()]
      .filter(([baseId, total]) => {
        const effectiveLimit = RESTRICTED_COPY_LIMITS[baseId] || limit;
        return total > effectiveLimit && !unlimitedBases.has(baseId);
      })
      .map(([baseId, total]) => {
        const restrictedLimit = RESTRICTED_COPY_LIMITS[baseId];
        return {
          baseId,
          total,
          limit: restrictedLimit || limit,
          restriction: restrictedLimit ? 'restricted' : 'copy_limit',
        };
      });

    for (const group of CHOICE_RESTRICTED_GROUPS) {
      const present = group.filter((baseId) => Number(totals.get(baseId) || 0) > 0);
      if (present.length > 1) {
        violations.push({
          baseId: present.join(' + '),
          baseIds: present,
          total: present.length,
          limit: 1,
          restriction: 'choice_restricted',
        });
      }
    }
    return {
      valid: unknown.length === 0 && invalid.length === 0 && violations.length === 0,
      unknown,
      invalid,
      violations,
    };
  }

  function validateDeckPlacements(deck, cardMeta) {
    const invalidMonster = [];
    for (const id of Object.keys((deck && deck.monster) || {})) {
      const meta = cardMeta && cardMeta[id];
      if (!meta || String(meta.type || '').trim() === '怪獣') continue;
      invalidMonster.push(String(meta.card_number || meta.base_id || id));
    }
    return {
      valid: invalidMonster.length === 0,
      invalidMonster: [...new Set(invalidMonster)],
    };
  }

  function encodeBase64Url(value) {
    return root.btoa(root.unescape(encodeURIComponent(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function decodeBase64Url(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(root.escape(root.atob(padded)));
  }

  function createDeckCodec(options = {}) {
    const legacyIds = Array.isArray(options.legacyIds) ? options.legacyIds.slice() : [];
    const activeIds = new Set(
      (Array.isArray(options.activeIds) ? options.activeIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    const externalResolver = typeof options.resolveId === 'function'
      ? options.resolveId
      : null;
    const externalSerializer = typeof options.serializeId === 'function'
      ? options.serializeId
      : null;

    const resolveId = (value) => {
      const direct = String(value || '').trim();
      if (!direct) throw new Error('card_id_empty');
      if (activeIds.has(direct)) return direct;
      const resolved = externalResolver ? String(externalResolver(direct) || '').trim() : '';
      if (resolved && activeIds.has(resolved)) return resolved;
      throw new Error(`card_unknown:${direct}`);
    };

    const normalizeMap = (value) => {
      if (value == null) return {};
      if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') {
        throw new Error('deck_map_invalid');
      }
      const entries = Array.isArray(value) ? value : Object.entries(value);
      const result = {};
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2) throw new Error('deck_entry_invalid');
        const id = resolveId(entry[0]);
        const count = Number(entry[1]);
        if (!Number.isInteger(count) || count <= 0 || count > 100) {
          throw new Error('deck_count_invalid');
        }
        result[id] = (result[id] || 0) + count;
      }
      return result;
    };

    const encode = (deck) => {
      const encodeMap = (value) => {
        const normalized = normalizeMap(value);
        const serialized = [];
        const used = new Set();
        for (const [id, count] of Object.entries(normalized)) {
          const outputId = String(externalSerializer ? externalSerializer(id) : id).trim();
          if (!outputId || used.has(outputId)) throw new Error('deck_variant_id_invalid');
          used.add(outputId);
          serialized.push([outputId, count]);
        }
        serialized.sort((left, right) => left[0].localeCompare(right[0]));
        return serialized;
      };
      const payload = {
        version: 3,
        main: encodeMap(deck && deck.main),
        monster: encodeMap(deck && deck.monster),
      };
      return `v3:${encodeBase64Url(JSON.stringify(payload))}`;
    };

    const decode = (value) => {
      const code = String(value || '').trim();
      if (!code) throw new Error('empty');
      if (code.length > MAX_CUSTOM_CODE_LENGTH) throw new Error('deck_code_too_large');

      if (/^v3:/i.test(code)) {
        const payload = JSON.parse(decodeBase64Url(code.slice(3)));
        if (!payload || Number(payload.version) !== 3) throw new Error('v3_payload_invalid');
        return { main: normalizeMap(payload.main), monster: normalizeMap(payload.monster) };
      }

      if (/^v2:/i.test(code)) {
        const sections = code.slice(3).split('|');
        if (sections.length !== 2) throw new Error('v2_payload_invalid');
        const [mainText, monsterText] = sections;
        const decodeLegacyMap = (text) => {
          const result = {};
          if (!text) return result;
          for (const part of text.split(',')) {
            if (!part) throw new Error('v2_entry_invalid');
            if (!/^[0-9a-z]+\.[0-9a-z]+$/i.test(part)) throw new Error('v2_entry_invalid');
            const [indexText, countText] = part.split('.');
            const index = parseInt(indexText, 36);
            const count = parseInt(countText, 36);
            const id = legacyIds[index];
            if (!id || !Number.isInteger(count) || count <= 0 || count > 100) {
              throw new Error('v2_entry_invalid');
            }
            if (Object.prototype.hasOwnProperty.call(result, id)) {
              throw new Error('v2_entry_duplicate');
            }
            result[id] = count;
          }
          return normalizeMap(result);
        };
        return { main: decodeLegacyMap(mainText), monster: decodeLegacyMap(monsterText) };
      }

      if (/^v1:/i.test(code)) {
        const payload = JSON.parse(decodeURIComponent(root.escape(root.atob(code.slice(3)))));
        return {
          main: normalizeMap(payload && payload.main),
          monster: normalizeMap(payload && payload.monster),
        };
      }
      throw new Error('ver');
    };

    return Object.freeze({ decode, encode, normalizeMap });
  }

  root.GCardDeckImport = Object.freeze({
    baseCardNumber,
    createDeckCodec,
    createCatalogIndex,
    extractDecklogCode,
    getDeckCopyStatus,
    importDecklogPayload,
    normalizeCustomDeckCode,
    validateDeckCopyLimits,
    validateDeckPlacements,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
