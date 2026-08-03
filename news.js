(() => {
  'use strict';

  // 古い順に並べ、更新のたびに配列の末尾へ追記する。
  // 起動画面では新しいお知らせから表示する。
  window.GCARD_NEWS = [
    {
      date: '2026-08-03',
      version: 'v2.4.0',
      title: '更新内容',
      items: [
        '公式Data正本化・パラレル対応',
        'ブシナビ/Deck Logコード読込（公式使用制限・怪獣デッキ種別も検証）',
        'QR機能削除',
      ],
    },
  ];

  function renderStartNews() {
    const list = document.getElementById('startNewsList');
    if (!list) return;

    list.replaceChildren();
    const entries = Array.isArray(window.GCARD_NEWS)
      ? window.GCARD_NEWS.slice().reverse()
      : [];

    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'startNewsEntry';

      const meta = document.createElement('div');
      meta.className = 'startNewsMeta';

      const date = document.createElement('time');
      date.className = 'startNewsDate';
      date.dateTime = String(entry.date || '');
      date.textContent = String(entry.date || '');

      const version = document.createElement('span');
      version.className = 'startNewsVersion';
      version.textContent = String(entry.version || '');

      meta.append(date, version);
      article.appendChild(meta);

      if (entry.title) {
        const title = document.createElement('h3');
        title.textContent = String(entry.title);
        article.appendChild(title);
      }

      if (Array.isArray(entry.items) && entry.items.length) {
        const items = document.createElement('ul');
        items.className = 'startNewsItems';
        for (const item of entry.items) {
          const row = document.createElement('li');
          row.textContent = String(item);
          items.appendChild(row);
        }
        article.appendChild(items);
      }

      list.appendChild(article);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderStartNews, { once: true });
  } else {
    renderStartNews();
  }
})();
