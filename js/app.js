(function () {
  'use strict';

  const CASES = (window.CASES || []).slice().sort((a, b) => a.id - b.id);
  const app = document.getElementById('app');
  const STORE_KEY = 'multicase-trainer-v1';
  const SECTION_NAMES = { survey: 'План обследования', diagnosis: 'Диагноз', therapy: 'Лечение', var: 'Вариатив' };

  // ---------- сохранение прогресса ----------
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  const store = Object.assign({ best: {}, q: {}, shuffle: false }, loadStore());
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* хранилище недоступно — работаем без него */ }
  }

  // ---------- индекс вопросов ----------
  const QUESTIONS = [];
  for (const c of CASES) {
    for (const item of c.items) {
      if (!item.q) continue;
      QUESTIONS.push({
        id: c.id + '-' + item.q,
        c, q: item,
        normText: norm(plain(item.text)),
        normOpts: norm(item.a.map(a => plain(a.t)).join(' '))
      });
    }
  }

  // ---------- текст ----------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }
  // Разметка сайта (AsciiDoc) -> обычный текст.
  function plain(s) {
    return String(s || '')
      .replace(/\+(_+)\+/g, '$1')
      .replace(/\{asterisk\}/g, '*').replace(/\{nbsp\}/g, ' ')
      .replace(/\^([^^\s]{1,6})\^/g, '$1');
  }
  function norm(s) {
    return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  }
  function inline(s) {
    return esc(String(s || '').replace(/\{asterisk\}/g, '*').replace(/\{nbsp\}/g, ' '))
      .replace(/\+(_+)\+/g, '<span class="blank"></span>')
      .replace(/_{3,}/g, '<span class="blank"></span>')
      .replace(/\^([^^\s]{1,6})\^/g, '<sup>$1</sup>');
  }
  function tableRows(lines) {
    const rows = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^[\^<>]?a\|/.test(line)) {
        rows.push(line.split(/(?:^|\s+)[\^<>]?a\|\s*/).slice(1));
      } else if (/^(\.?\d+\+)?[\^<>]?[a-z]?\|/.test(line)) {
        const cleaned = line.replace(/(^|\s)(\.?\d+\+)[\^<>]?[a-z]?\|/g, '$1|');
        rows.push(cleaned.split('|').slice(1).map(x => x.trim()));
      } else if (rows.length) {
        const last = rows[rows.length - 1];
        last[last.length - 1] += ' ' + line;
      }
    }
    return rows;
  }
  function renderTable(lines) {
    const rows = tableRows(lines);
    if (!rows.length) return '';
    const width = Math.max.apply(null, rows.map(r => r.length));
    let html = '<div class="tbl-wrap"><table class="tbl">';
    rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      html += '<tr>' + r.map((cell, j) => {
        const span = j === r.length - 1 && r.length < width ? ' colspan="' + (width - r.length + 1) + '"' : '';
        return '<' + tag + span + '>' + inline(cell) + '</' + tag + '>';
      }).join('') + '</tr>';
    });
    return html + '</table></div>';
  }
  // Блочный текст: абзацы, списки и таблицы.
  function rich(text) {
    const lines = String(text || '').split('\n');
    let html = '';
    let list = [];
    const flush = () => {
      if (list.length) { html += '<ul>' + list.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'; list = []; }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^\[.*\]$/.test(line) && /^\|={3,}/.test((lines[i + 1] || '').trim())) continue;
      if (/^\|={3,}/.test(line)) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !/^\|={3,}/.test(lines[i].trim())) body.push(lines[i++]);
        html += renderTable(body);
        continue;
      }
      const m = line.match(/^(\*|-|•|\d+\.)\s+(.*)$/);
      if (m) { list.push(m[2]); continue; }
      flush();
      html += '<p>' + inline(line) + '</p>';
    }
    flush();
    return html;
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function plural(n, one, few, many) {
    const d = n % 10, h = n % 100;
    if (d === 1 && h !== 11) return n + ' ' + one;
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return n + ' ' + few;
    return n + ' ' + many;
  }
  function sources(c, a) {
    const list = (a.s || []).map(i => c.src[i]).filter(Boolean);
    return list.length ? '<div class="src">Источник: ' + list.map(esc).join(' · ') + '</div>' : '';
  }
  function caseLabel(c) { return 'Кейс ' + c.id + '. ' + c.title; }

  // ---------- поиск ----------
  function searchQuestions(query, withOptions) {
    const terms = norm(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const item of QUESTIONS) {
      let score = 0;
      let all = true;
      for (const t of terms) {
        if (item.normText.includes(t)) score += 2;
        else if (withOptions && item.normOpts.includes(t)) score += 1;
        else { all = false; break; }
      }
      if (all) out.push({ item, score });
    }
    out.sort((a, b) => b.score - a.score || a.item.c.id - b.item.c.id || a.item.q.q - b.item.q.q);
    return out.map(x => x.item);
  }
  function highlight(text, query) {
    const terms = norm(query).split(' ').filter(Boolean).sort((a, b) => b.length - a.length);
    const safe = inline(text);
    if (!terms.length) return safe;
    const pattern = terms.map(t => t.replace(/е/g, '[её]')).join('|');
    // Подсвечиваем только текст между тегами, не трогая разметку.
    return safe.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, txt) =>
      tag ? tag : txt.replace(new RegExp('(' + pattern + ')', 'gi'), '<mark>$1</mark>'));
  }
  function resultCard(item, query) {
    const q = item.q;
    const correct = q.a.filter(a => a.ok);
    const card = el(
      '<article class="card result">' +
        '<div class="result__q">' + highlight(q.text, query) + '</div>' +
        '<div class="result__a">' + correct.map(a => '<div class="answer answer--ok">' + highlight(a.t, query) + '</div>').join('') + '</div>' +
        '<details class="more"><summary>Все варианты и обоснование</summary>' +
          '<ul class="opts-plain">' + q.a.map(a => '<li class="' + (a.ok ? 'is-ok' : '') + '">' + inline(a.t) + '</li>').join('') + '</ul>' +
          correct.map(a => (a.j ? '<div class="just">' + rich(a.j) + '</div>' : '') + sources(item.c, a)).join('') +
        '</details>' +
        '<div class="meta"><a href="#review/' + item.c.id + '">' + esc(caseLabel(item.c)) + '</a> · вопрос ' + q.q + ' · ' + esc(SECTION_NAMES[q.sec] || q.sec) + '</div>' +
      '</article>');
    return card;
  }
  function viewSearch() {
    app.innerHTML = '';
    const box = el(
      '<section class="search">' +
        '<h1>Поиск верного ответа</h1>' +
        '<input class="search__input" type="search" placeholder="Начните вводить текст вопроса…" autocomplete="off" spellcheck="false">' +
        '<label class="check"><input type="checkbox" class="search__opts" checked> искать и в вариантах ответа</label>' +
        '<div class="search__info"></div>' +
        '<div class="search__list"></div>' +
      '</section>');
    app.appendChild(box);
    const input = box.querySelector('.search__input');
    const opts = box.querySelector('.search__opts');
    const info = box.querySelector('.search__info');
    const list = box.querySelector('.search__list');
    const LIMIT = 40;
    function run() {
      const query = input.value;
      list.innerHTML = '';
      if (!norm(query)) {
        info.textContent = 'В базе ' + plural(QUESTIONS.length, 'вопрос', 'вопроса', 'вопросов') + ' из ' +
          plural(CASES.length, 'кейса', 'кейсов', 'кейсов') + '. Достаточно нескольких слов или их начала, порядок не важен.';
        return;
      }
      const found = searchQuestions(query, opts.checked);
      info.textContent = found.length
        ? 'Найдено: ' + found.length + (found.length > LIMIT ? ' (показаны первые ' + LIMIT + ')' : '')
        : 'Ничего не найдено. Попробуйте меньше слов или другое слово из вопроса.';
      found.slice(0, LIMIT).forEach(item => list.appendChild(resultCard(item, query)));
    }
    input.addEventListener('input', run);
    opts.addEventListener('change', run);
    run();
    input.focus();
  }

  // ---------- вопрос (общий блок для кейса и тренировки) ----------
  function recordAnswer(id, ok) {
    const r = store.q[id] || { ok: 0, bad: 0 };
    if (ok) r.ok++; else r.bad++;
    store.q[id] = r;
    saveStore();
  }
  // done(isCorrect) вызывается один раз, сразу после ответа.
  function questionBlock(c, q, done) {
    const need = q.a.filter(a => a.ok).length;
    const multi = need > 1;
    const order = store.shuffle ? shuffled(q.a) : q.a;
    const box = el(
      '<div class="q">' +
        '<div class="q__sec">' + esc(SECTION_NAMES[q.sec] || '') + '</div>' +
        '<div class="q__text">' + inline(q.text) + '</div>' +
        (multi ? '<div class="q__hint">Выберите вариантов: ' + need + '</div>' : '') +
        '<div class="q__opts"></div>' +
        '<div class="q__actions"><button class="btn btn--primary q__check" disabled>Ответить</button></div>' +
        '<div class="q__after"></div>' +
      '</div>');
    const optsBox = box.querySelector('.q__opts');
    const checkBtn = box.querySelector('.q__check');
    const chosen = new Set();
    let answered = false;
    order.forEach(a => {
      const b = el('<button type="button" class="opt"><span class="opt__mark"></span><span class="opt__text">' + inline(a.t) + '</span></button>');
      b.addEventListener('click', () => {
        if (answered) return;
        if (multi) {
          if (chosen.has(a)) chosen.delete(a); else chosen.add(a);
        } else {
          chosen.clear(); chosen.add(a);
        }
        [...optsBox.children].forEach((node, i) => node.classList.toggle('is-chosen', chosen.has(order[i])));
        checkBtn.disabled = chosen.size !== need;
      });
      optsBox.appendChild(b);
    });
    checkBtn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const ok = order.every(a => !!a.ok === chosen.has(a));
      [...optsBox.children].forEach((node, i) => {
        const a = order[i];
        node.disabled = true;
        if (a.ok) node.classList.add('is-ok');
        else if (chosen.has(a)) node.classList.add('is-bad');
      });
      checkBtn.remove();
      const after = box.querySelector('.q__after');
      after.innerHTML = '<div class="verdict ' + (ok ? 'verdict--ok' : 'verdict--bad') + '">' + (ok ? 'Верно' : 'Неверно') + '</div>' +
        q.a.filter(a => a.ok).map(a => (a.j ? '<div class="just">' + rich(a.j) + '</div>' : '') + sources(c, a)).join('');
      recordAnswer(c.id + '-' + q.q, ok);
      done(ok);
    });
    return box;
  }
  function conditionBlock(c, uptoIndex) {
    let html = '';
    c.items.forEach((item, i) => {
      if (!item.c || i >= uptoIndex) return;
      const level = item.c.split('.').filter(Boolean).length;
      if (level === 1) html += '<h2 class="cond__h">' + esc(item.name) + '</h2>';
      else html += '<h3 class="cond__sub">' + esc(item.name) + '</h3>';
      if (item.text) html += '<div class="cond__text">' + rich(item.text) + '</div>';
    });
    return html;
  }

  // ---------- кейсы ----------
  function viewCases() {
    app.innerHTML = '';
    const head = el(
      '<section><h1>Кейсы</h1>' +
      '<input class="search__input" id="case-filter" type="search" placeholder="Поиск по названию или ситуации…" autocomplete="off" spellcheck="false">' +
      '<div class="search__info" id="case-info"></div>' +
      '<label class="check"><input type="checkbox" id="shuffle"' + (store.shuffle ? ' checked' : '') + '> перемешивать варианты ответа</label>' +
      '<div class="grid"></div></section>');
    head.querySelector('#shuffle').addEventListener('change', e => { store.shuffle = e.target.checked; saveStore(); });
    const grid = head.querySelector('.grid');
    if (!CASES.length) grid.innerHTML = '<p>Кейсов пока нет. Добавьте файлы в data/cases и выполните node tools/build.js.</p>';
    const cards = [];
    for (const c of CASES) {
      const total = c.items.filter(i => i.q).length;
      const best = store.best[c.id];
      const sit = plain((c.items.find(i => i.c && /^ситуация$/i.test((i.name || '').trim())) || {}).text || '');
      const card = el(
        '<article class="card case">' +
          '<div class="case__num">Кейс ' + c.id + '</div>' +
          '<div class="case__title">' + esc(c.title) + '</div>' +
          (sit ? '<div class="case__sit">' + esc(sit) + '</div>' : '') +
          '<div class="case__sec">' + c.sections.map(s => esc(s[1]) + ' — ' + s[2]).join(' · ') + '</div>' +
          '<div class="case__best">' + (best ? 'Лучший результат: ' + best.score + ' из ' + best.total : 'Ещё не решали') + '</div>' +
          '<div class="case__actions">' +
            '<a class="btn btn--primary" href="#case/' + c.id + '">Решать</a>' +
            '<a class="btn" href="#review/' + c.id + '">Ответы</a>' +
          '</div>' +
          '<div class="case__total">' + plural(total, 'вопрос', 'вопроса', 'вопросов') + '</div>' +
        '</article>');
      cards.push({ card, key: norm('кейс ' + c.id + ' ' + c.title + ' ' + sit) });
      grid.appendChild(card);
    }
    const filter = head.querySelector('#case-filter');
    const info = head.querySelector('#case-info');
    function applyFilter() {
      const terms = norm(filter.value).split(' ').filter(Boolean);
      let shown = 0;
      for (const x of cards) {
        const ok = terms.every(t => x.key.includes(t));
        x.card.hidden = !ok;
        if (ok) shown++;
      }
      info.textContent = !terms.length ? 'Всего: ' + plural(cards.length, 'кейс', 'кейса', 'кейсов')
        : shown ? 'Найдено: ' + shown + ' из ' + cards.length
        : 'Кейсов с таким названием или ситуацией нет. Попробуйте другое слово или его начало.';
    }
    filter.addEventListener('input', applyFilter);
    applyFilter();
    app.appendChild(head);
  }
  function viewCase(id) {
    const c = CASES.find(x => x.id === id);
    if (!c) return viewCases();
    const qItems = c.items.map((item, i) => ({ item, i })).filter(x => x.item.q);
    const results = [];
    let pos = 0;
    app.innerHTML = '';
    const wrap = el(
      '<section class="run">' +
        '<div class="run__head"><a class="back" href="#cases">← К списку кейсов</a><h1>' + esc(caseLabel(c)) + '</h1></div>' +
        '<div class="cond card"></div>' +
        '<div class="pills"></div>' +
        '<div class="run__q card"></div>' +
      '</section>');
    app.appendChild(wrap);
    const cond = wrap.querySelector('.cond');
    const pills = wrap.querySelector('.pills');
    const qBox = wrap.querySelector('.run__q');
    function drawPills() {
      pills.innerHTML = qItems.map((x, n) => {
        const cls = results[n] === undefined ? (n === pos ? 'is-current' : '') : (results[n] ? 'is-ok' : 'is-bad');
        return '<span class="pill ' + cls + '">' + (n + 1) + '</span>';
      }).join('');
    }
    function show() {
      // До ответа на вопрос видно только то, что сайт уже открыл к этому моменту (диагноз и анализы появляются позже).
      cond.innerHTML = conditionBlock(c, qItems[pos].i);
      drawPills();
      qBox.innerHTML = '';
      const block = questionBlock(c, qItems[pos].item, ok => {
        results[pos] = ok;
        drawPills();
        const last = pos === qItems.length - 1;
        const next = el('<button class="btn btn--primary">' + (last ? 'Завершить кейс' : 'Далее') + '</button>');
        next.addEventListener('click', () => { if (last) finish(); else { pos++; show(); window.scrollTo(0, pills.offsetTop - 70); } });
        block.querySelector('.q__actions').appendChild(next);
        next.focus();
      });
      qBox.appendChild(el('<div class="q__num">Вопрос ' + (pos + 1) + ' из ' + qItems.length + '</div>'));
      qBox.appendChild(block);
    }
    function finish() {
      const score = results.filter(Boolean).length;
      const prev = store.best[c.id];
      if (!prev || score > prev.score) { store.best[c.id] = { score, total: qItems.length, date: new Date().toISOString().slice(0, 10) }; saveStore(); }
      cond.innerHTML = conditionBlock(c, c.items.length);
      qBox.innerHTML =
        '<div class="final">' +
          '<div class="final__score">' + score + ' из ' + qItems.length + '</div>' +
          '<div class="final__text">' + (score === qItems.length ? 'Все ответы верные.' : 'Ошибки: вопросы ' + results.map((r, n) => (r ? null : n + 1)).filter(Boolean).join(', ') + '.') + '</div>' +
          '<div class="final__actions">' +
            '<a class="btn" href="#review/' + c.id + '">Разбор с ответами</a>' +
            '<button class="btn" id="again">Решить ещё раз</button>' +
            '<a class="btn btn--primary" href="#cases">К списку кейсов</a>' +
          '</div>' +
        '</div>';
      qBox.querySelector('#again').addEventListener('click', () => viewCase(id));
    }
    show();
  }
  function viewReview(id) {
    const c = CASES.find(x => x.id === id);
    if (!c) return viewCases();
    app.innerHTML = '';
    let html = '<section class="run"><div class="run__head"><a class="back" href="#cases">← К списку кейсов</a><h1>' + esc(caseLabel(c)) + '</h1>' +
      '<a class="btn btn--primary" href="#case/' + c.id + '">Решать этот кейс</a></div>';
    let condOpen = false;
    c.items.forEach((item, i) => {
      if (item.c) {
        if (!condOpen) { html += '<div class="cond card">'; condOpen = true; }
        html += conditionBlock({ items: [item] }, 1);
        return;
      }
      if (condOpen) { html += '</div>'; condOpen = false; }
      html += '<article class="card result"><div class="q__num">Вопрос ' + item.q + ' · ' + esc(SECTION_NAMES[item.sec] || '') + '</div>' +
        '<div class="result__q">' + inline(item.text) + '</div>' +
        '<ul class="opts-plain">' + item.a.map(a => '<li class="' + (a.ok ? 'is-ok' : '') + '">' + inline(a.t) + '</li>').join('') + '</ul>' +
        item.a.filter(a => a.ok).map(a => (a.j ? '<div class="just">' + rich(a.j) + '</div>' : '') + sources(c, a)).join('') +
        '</article>';
    });
    if (condOpen) html += '</div>';
    app.innerHTML = html + '</section>';
  }

  // ---------- вопросы подряд ----------
  function viewDrill() {
    app.innerHTML = '';
    const weak = QUESTIONS.filter(x => (store.q[x.id] || {}).bad > 0);
    const wrap = el(
      '<section class="run">' +
        '<h1>Вопросы подряд</h1>' +
        '<div class="drill__modes">' +
          '<button class="btn btn--primary" data-mode="all">Все вопросы вперемешку (' + QUESTIONS.length + ')</button>' +
          '<button class="btn" data-mode="weak"' + (weak.length ? '' : ' disabled') + '>Только с ошибками (' + weak.length + ')</button>' +
        '</div>' +
        '<div class="drill__body"></div>' +
      '</section>');
    app.appendChild(wrap);
    const body = wrap.querySelector('.drill__body');
    function start(pool) {
      const queue = shuffled(pool);
      let pos = 0, right = 0;
      function show() {
        if (pos >= queue.length) {
          body.innerHTML = '<div class="card final"><div class="final__score">' + right + ' из ' + queue.length + '</div>' +
            '<div class="final__text">Подход закончен.</div></div>';
          return;
        }
        const x = queue[pos];
        const qIndex = x.c.items.indexOf(x.q);
        body.innerHTML = '';
        const card = el(
          '<div class="card">' +
            '<div class="q__num">' + (pos + 1) + ' из ' + queue.length + ' · верно ' + right + ' · <a href="#review/' + x.c.id + '">' + esc(caseLabel(x.c)) + '</a></div>' +
            '<details class="more"><summary>Условие задачи</summary><div class="cond">' + conditionBlock(x.c, qIndex) + '</div></details>' +
          '</div>');
        const block = questionBlock(x.c, x.q, ok => {
          if (ok) right++;
          const next = el('<button class="btn btn--primary">' + (pos === queue.length - 1 ? 'Итог' : 'Следующий вопрос') + '</button>');
          next.addEventListener('click', () => { pos++; show(); });
          block.querySelector('.q__actions').appendChild(next);
          next.focus();
        });
        card.appendChild(block);
        body.appendChild(card);
      }
      show();
    }
    wrap.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => start(b.dataset.mode === 'weak' ? weak : QUESTIONS)));
  }

  // ---------- статистика ----------
  function viewStats() {
    const seen = QUESTIONS.filter(x => store.q[x.id]);
    const right = seen.reduce((n, x) => n + store.q[x.id].ok, 0);
    const wrong = seen.reduce((n, x) => n + store.q[x.id].bad, 0);
    const worst = seen.filter(x => store.q[x.id].bad > 0)
      .sort((a, b) => store.q[b.id].bad - store.q[a.id].bad).slice(0, 15);
    app.innerHTML =
      '<section><h1>Статистика</h1>' +
      '<div class="tiles">' +
        '<div class="tile"><div class="tile__n">' + CASES.length + '</div><div class="tile__l">кейсов в базе</div></div>' +
        '<div class="tile"><div class="tile__n">' + QUESTIONS.length + '</div><div class="tile__l">вопросов в базе</div></div>' +
        '<div class="tile"><div class="tile__n">' + seen.length + '</div><div class="tile__l">вопросов уже встречалось</div></div>' +
        '<div class="tile"><div class="tile__n">' + (right + wrong ? Math.round(100 * right / (right + wrong)) + '%' : '—') + '</div><div class="tile__l">верных ответов</div></div>' +
      '</div>' +
      '<h2>Результаты по кейсам</h2>' +
      '<table class="tbl"><tr><th>Кейс</th><th>Лучший результат</th><th>Дата</th></tr>' +
      CASES.map(c => {
        const b = store.best[c.id];
        return '<tr><td><a href="#review/' + c.id + '">' + esc(caseLabel(c)) + '</a></td><td>' + (b ? b.score + ' из ' + b.total : '—') + '</td><td>' + (b ? esc(b.date) : '') + '</td></tr>';
      }).join('') + '</table>' +
      '<h2>Вопросы с ошибками</h2>' +
      (worst.length
        ? '<table class="tbl"><tr><th>Вопрос</th><th>Ошибок</th><th>Верно</th></tr>' +
          worst.map(x => '<tr><td>' + inline(x.q.text) + '<div class="meta">' + esc(caseLabel(x.c)) + '</div></td><td>' + store.q[x.id].bad + '</td><td>' + store.q[x.id].ok + '</td></tr>').join('') + '</table>'
        : '<p>Ошибок пока нет.</p>') +
      '<p><button class="btn" id="reset">Сбросить статистику</button></p></section>';
    document.getElementById('reset').addEventListener('click', () => {
      if (!confirm('Удалить результаты и статистику ответов?')) return;
      store.best = {}; store.q = {}; saveStore(); viewStats();
    });
  }

  // ---------- навигация ----------
  function route() {
    const hash = location.hash.replace(/^#/, '') || 'search';
    const [view, arg] = hash.split('/');
    document.querySelectorAll('#tabs .tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.view === (view === 'case' || view === 'review' ? 'cases' : view)));
    window.scrollTo(0, 0);
    if (view === 'cases') viewCases();
    else if (view === 'case') viewCase(Number(arg));
    else if (view === 'review') viewReview(Number(arg));
    else if (view === 'drill') viewDrill();
    else if (view === 'stats') viewStats();
    else viewSearch();
  }
  document.getElementById('tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (location.hash === '#' + t.dataset.view) route(); else location.hash = t.dataset.view;
  });
  window.addEventListener('hashchange', route);
  document.getElementById('foot').textContent = 'Кейсов: ' + CASES.length + ' · вопросов: ' + QUESTIONS.length + ' · прогресс хранится только в этом браузере';
  route();
})();
