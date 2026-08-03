import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('GitHub Pages sends Deck Log imports to the stable Vercel API', async () => {
  const [html, app] = await Promise.all([
    readFile(path.join(ROOT, 'index.html'), 'utf8'),
    readFile(path.join(ROOT, 'app.js'), 'utf8'),
  ]);

  assert.match(
    html,
    /decklogApiBase:\s*'https:\/\/g-card-decklog-api-kochavrendy\.vercel\.app\/api\/decklog'/,
  );
  assert.match(app, /const DECKLOG_API_BASE\s*=/);
  assert.match(
    app,
    /fetch\(`\$\{DECKLOG_API_BASE\}\/\$\{encodeURIComponent\(decklogCode\)\}`/,
  );
  assert.doesNotMatch(app, /fetch\(`\/api\/decklog\/\$\{encodeURIComponent\(decklogCode\)\}`/);
});
