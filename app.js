/* ============================================================================
   ДЖИВИО · ОБУЧЕНИЕ — приложение (роутинг + рендер + интерактив)
   Контент берётся из content.js (DATA). Этот файл менять не нужно.
   ============================================================================ */
(function () {
  'use strict';

  // ---------- Прогресс (сохраняется локально, если доступно) ----------
  var STORE_KEY = 'jvo-training-progress-v1';
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  var store = loadStore();
  function procKey(d, p) { return d + '::' + p; }
  function isDone(d, p) { return !!(store.done && store.done[procKey(d, p)]); }
  function setDone(d, p, v) {
    store.done = store.done || {};
    if (v) store.done[procKey(d, p)] = true; else delete store.done[procKey(d, p)];
    saveStore(store);
  }
  function getFeedback(d, p) { return (store.feedback && store.feedback[procKey(d, p)]) || null; }
  function setFeedback(d, p, obj) {
    store.feedback = store.feedback || {};
    if (obj) store.feedback[procKey(d, p)] = obj; else delete store.feedback[procKey(d, p)];
    saveStore(store);
  }
  function checkKey(d, p, i) { return procKey(d, p) + '#' + i; }
  function isChecked(d, p, i) { return !!(store.checks && store.checks[checkKey(d, p, i)]); }
  function setChecked(d, p, i, v) {
    store.checks = store.checks || {};
    if (v) store.checks[checkKey(d, p, i)] = true; else delete store.checks[checkKey(d, p, i)];
    saveStore(store);
  }

  // ---------- Утилиты ----------
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function findDir(id) { return DATA.directions.filter(function (d) { return d.id === id; })[0]; }
  function findProc(d, pid) { return (d.processes || []).filter(function (p) { return p.id === pid; })[0]; }
  function readyDirs() { return DATA.directions.filter(function (d) { return d.status === 'ready'; }); }
  // Внутри каждого модуля: стартовые уроки (идущие подряд без шильдика в начале)
  // остаются на месте, затем — процессы с шильдиком (по rank, затем по порядку),
  // затем остальные.
  // Шильдик урока: «Обязательный урок» — лаймовый со звёздочкой, остальные — фирменный с короной
  function badgeHtml(badge) {
    var must = /обязательн/i.test(badge);
    var ico = must
      ? '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 2l2.9 6.2 6.6.9-4.8 4.7 1.2 6.7L12 17.3 6.1 20.5l1.2-6.7L2.5 9.1l6.6-.9z"/></svg>'
      : ICONS.crown;
    return '<span class="leader-badge' + (must ? ' leader-badge--must' : '') + '">' + ico + esc(badge) + '</span>';
  }

  function reorderProcesses() {
    DATA.directions.forEach(function (d) {
      var ps = d.processes || [];
      if (ps.length < 3) return;
      var i = 0;
      while (i < ps.length && !ps[i].badge) i++;   // ведущая серия уроков без шильдика
      if (i === 0) i = 1;                           // хотя бы первый урок оставляем сверху
      var head = ps.slice(0, i);
      var rest = ps.slice(i);
      var badged = rest.filter(function (p) { return p.badge; })
        .sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
      var plain = rest.filter(function (p) { return !p.badge; });
      d.processes = head.concat(badged, plain);
    });
  }

  function byOrder(a, b) { return (a.order == null ? 99 : a.order) - (b.order == null ? 99 : b.order); }
  function featuredDirs() { return DATA.directions.filter(function (d) { return d.featured; }).slice().sort(byOrder); }
  function regularDirs() { return DATA.directions.filter(function (d) { return !d.featured; }).slice().sort(byOrder); }
  function allOrdered() { return DATA.directions.slice().sort(byOrder); }
  function totalSteps() { return regularDirs().length; }

  var ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    arrow: '&rarr;',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M9 21h6v-1H9v1zm3-19a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a4 4 0 004-4V9"/><path d="M6 16V9a4 4 0 014-4h5"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M2 8l4.5 3.5L12 4l5.5 7.5L22 8l-2 11H4L2 8z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2z"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M7 10v11H3V10h4zm4 11h7a2 2 0 002-1.6l1.3-6A2 2 0 0020.3 11H14l1-4a2 2 0 00-2-2.5L7 10v11z"/></svg>',
    dislike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M17 14V3h4v11h-4zm-4-11H6a2 2 0 00-2 1.6l-1.3 6A2 2 0 004.7 14H11l-1 4a2 2 0 002 2.5l6-6.5V3z"/></svg>',
  };

  // ---------- Прогресс направления ----------
  function dirProgress(d) {
    var total = (d.processes || []).length;
    if (!total) return { done: 0, total: 0, pct: 0 };
    var done = d.processes.filter(function (p) { return isDone(d.id, p.id); }).length;
    return { done: done, total: total, pct: Math.round(done / total * 100) };
  }

  // ============================================================
  // Сайдбар
  // ============================================================
  function renderSidebar(active) {
    var nav = document.getElementById('nav');
    nav.innerHTML = '';

    // Секция «С чего начать» (featured / онбординг)
    var feat = featuredDirs();
    if (feat.length) {
      var fsec = h('<div class="nav-section"><div class="nav-head">С чего начать</div></div>');
      feat.forEach(function (d) {
        var isAct = active && active.dir === d.id;
        var fp = dirProgress(d);
        var item = h(
          '<button class="nav-item nav-item--start' + (isAct ? ' is-active' : '') + '">' +
            '<span class="ni-zero">0</span>' +
            '<img class="ni-ico" src="' + esc(d.icon) + '" alt="">' +
            '<span>' + esc(d.title) + '</span>' +
            (fp.total ? '<span class="ni-dot">' + fp.done + '/' + fp.total + '</span>' : '') +
          '</button>'
        );
        item.addEventListener('click', function () { location.hash = '#/d/' + d.id; closeMenu(); });
        fsec.appendChild(item);
      });
      nav.appendChild(fsec);
    }

    var section = h('<div class="nav-section"><div class="nav-head">Модули</div></div>');
    regularDirs().forEach(function (d) {
      var soon = d.status !== 'ready';
      var isAct = active && active.dir === d.id;
      var prog = dirProgress(d);
      var right = soon ? ''
        : (prog.total ? '<span class="ni-dot">' + prog.done + '/' + prog.total + '</span>' : '');
      var item = h(
        '<button class="nav-item' + (isAct ? ' is-active' : '') + '">' +
          '<span class="ni-num">' + (d.order != null ? d.order : '') + '</span>' +
          '<img class="ni-ico" src="' + esc(d.icon) + '" alt="">' +
          '<span>' + esc(d.title) + '</span>' + right +
        '</button>'
      );
      item.addEventListener('click', function () {
        location.hash = '#/d/' + d.id; closeMenu();
      });
      section.appendChild(item);
    });
    nav.appendChild(section);
  }

  // ============================================================
  // Прогресс ученика и грейды
  // ============================================================
  var GRADES = [
    { min: 0,   name: 'Новичок',              sub: 'Первое знакомство с ИИ-агентами' },
    { min: 20,  name: 'Оператор ИИ',          sub: 'Запускаете агентов' },
    { min: 40,  name: 'Специалист по ИИ-автоматизации', sub: 'Автоматизируете процессы' },
    { min: 60,  name: 'Менеджер по внедрению ИИ', sub: 'Внедряете ИИ в бизнес' },
    { min: 80,  name: 'Архитектор ИИ-решений', sub: 'Проектируете систему агентов' },
    { min: 100, name: 'Директор по ИИ-трансформации', sub: 'Вершина: весь бизнес на ИИ' },
  ];
  // Плоский список уроков в порядке программы
  function flatLessons() {
    var list = [];
    allOrdered().forEach(function (d) { (d.processes || []).forEach(function (p) { list.push({ d: d, p: p }); }); });
    return list;
  }
  // Состояние кнопки «Начать / Продолжить обучение»
  function continueState() {
    var list = flatLessons();
    var lastDone = -1;
    for (var i = 0; i < list.length; i++) { if (isDone(list[i].d.id, list[i].p.id)) lastDone = i; }
    if (lastDone === -1) {
      var start = featuredDirs()[0] || readyDirs()[0] || regularDirs()[0];
      return { label: 'Начать обучение', hash: start ? ('#/d/' + start.id) : '#/' };
    }
    var nxt = list[lastDone + 1];
    return { label: 'Продолжить обучение', hash: nxt ? ('#/p/' + nxt.d.id + '/' + nxt.p.id) : '#/' };
  }

  function overallProgress() {
    var total = 0, done = 0;
    DATA.directions.forEach(function (d) {
      (d.processes || []).forEach(function (p) { total++; if (isDone(d.id, p.id)) done++; });
    });
    return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0 };
  }
  function gradeIndex(pct) { var idx = 0; for (var i = 0; i < GRADES.length; i++) { if (pct >= GRADES[i].min) idx = i; } return idx; }

  // Компактная сводка по грейду в верхней панели (на всех страницах)
  function updateGradeMini() {
    var box = document.getElementById('gradeMini');
    if (!box) return;
    var pr = overallProgress();
    var gi = gradeIndex(pr.pct);
    var g = GRADES[gi];
    var next = GRADES[gi + 1];
    var hint = next ? ('до следующего грейда — ' + (next.min - pr.pct) + '%') : 'вершина достигнута';
    box.innerHTML =
      '<span class="gm-ring" style="--p:' + pr.pct + '"><span>' + pr.pct + '%</span></span>' +
      '<span class="gm-text"><b>' + esc(g.name) + '</b><small>' + esc(hint) + '</small></span>';
    box.onclick = function () {
      function toProgress() { var p = document.querySelector('.progress'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (location.hash.replace(/^#\/?/, '') === '') { toProgress(); }
      else { location.hash = '#/'; setTimeout(toProgress, 80); }
    };
  }

  function renderProgress() {
    var pr = overallProgress();
    var gi = gradeIndex(pr.pct);
    var g = GRADES[gi];
    var next = GRADES[gi + 1];
    var isTop = gi === GRADES.length - 1;
    var el = h('<section class="progress reveal"></section>');

    el.appendChild(h(
      '<div class="progress__top">' +
        '<div class="progress__grade">' +
          '<span class="progress__medal' + (isTop ? ' is-top' : '') + '">' + (isTop ? ICONS.crown : ICONS.star) + '</span>' +
          '<div class="progress__gtext">' +
            '<span class="progress__eyebrow">Ваш грейд · ' + (gi + 1) + ' из ' + GRADES.length + '</span>' +
            '<h2>' + esc(g.name) + '</h2>' +
            '<p>' + esc(g.sub) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="progress__pct"><b>' + pr.pct + '%</b><span>' + pr.done + ' из ' + pr.total + ' уроков</span></div>' +
      '</div>'
    ));

    var bar = h('<div class="progress__bar"><div class="progress__fill"></div></div>');
    var fill = bar.querySelector('.progress__fill');
    GRADES.forEach(function (gr, i) {
      bar.appendChild(h('<span class="progress__tick' + (pr.pct >= gr.min ? ' reached' : '') + (i === gi ? ' current' : '') + '" style="left:' + gr.min + '%"></span>'));
    });
    el.appendChild(bar);

    var labels = h('<div class="progress__labels"></div>');
    GRADES.forEach(function (gr, i) {
      var pos = i === 0 ? '' : (i === GRADES.length - 1 ? ' pg--last' : ' pg--mid');
      labels.appendChild(h('<span class="pg' + (i < gi ? ' done' : '') + (i === gi ? ' current' : '') + pos + '" style="left:' + gr.min + '%">' + esc(gr.name) + '</span>'));
    });
    el.appendChild(labels);

    var hint = next
      ? 'До грейда «' + esc(next.name) + '» — ещё ' + (next.min - pr.pct) + '%'
      : 'Поздравляем! Вы достигли вершины — Директор по ИИ-трансформации.';
    el.appendChild(h('<p class="progress__next">' + (next ? ICONS.bolt : ICONS.crown) + '<span>' + hint + '</span></p>'));

    // Дорожная карта в той же карточке
    el.appendChild(h('<div class="journey-div"></div>'));
    el.appendChild(h(
      '<div class="roadmap__head">' +
        '<span class="roadmap__ico">' + ICONS.route + '</span>' +
        '<div><h2>Рекомендуемый порядок изучения</h2>' +
        '<p>Проходите модули по шагам — от настройки к экспертному уровню. Каждый следующий опирается на предыдущий. По прохождению обучения вы станете профессионалом управления бизнесом на маркетплейсах.</p></div>' +
      '</div>'
    ));
    var track = h('<ol class="roadmap__track"></ol>');
    allOrdered().forEach(function (d) {
      var soon = d.status !== 'ready';
      var n = (d.order != null ? d.order : '');
      var mp = dirProgress(d);
      var li = h(
        '<li class="rm-step' + (d.featured ? ' rm-step--start' : '') + (soon ? ' rm-step--soon' : '') + (mp.pct === 100 ? ' rm-step--done' : '') + '">' +
          '<button class="rm-btn">' +
            '<span class="rm-fill" style="width:' + mp.pct + '%"></span>' +
            '<span class="rm-num">' + n + '</span>' +
            '<span class="rm-title">' + esc(d.title) + '</span>' +
            (mp.total ? '<span class="rm-count">' + (mp.pct === 100 ? ICONS.check : (mp.done + '/' + mp.total)) + '</span>' : '') +
          '</button>' +
        '</li>'
      );
      li.querySelector('.rm-btn').addEventListener('click', function () { location.hash = '#/d/' + d.id; });
      track.appendChild(li);
    });
    el.appendChild(track);

    setTimeout(function () {
      fill.style.width = pr.pct + '%';
      Array.prototype.forEach.call(el.querySelectorAll('.rm-fill'), function (f) { f.style.transform = 'scaleX(1)'; });
    }, 80);
    return el;
  }

  // ============================================================
  // Экран: Главная
  // ============================================================
  function viewHome() {
    var el = h('<div></div>');
    var cont = continueState();
    el.appendChild(h(
      '<section class="hero reveal">' +
        '<img class="hero__mark" src="assets/sign/sign-pink.png" alt="">' +
        '<div class="eyebrow">Дживио · база знаний</div>' +
        '<h1>' + esc(DATA.brand.title) + '</h1>' +
        '<p>' + esc(DATA.brand.subtitle) + '</p>' +
        '<div class="hero__actions">' +
          '<a class="btn btn--pink" href="' + cont.hash + '">' + cont.label + ' ' + ICONS.arrow + '</a>' +
        '</div>' +
      '</section>'
    ));

    // Прогресс ученика, грейды и дорожная карта (в одной карточке)
    el.appendChild(renderProgress());

    // Выделенный модуль 0 (онбординг)
    featuredDirs().forEach(function (d) {
      var prog = dirProgress(d);
      var card = h(
        '<button class="onboard-card reveal">' +
          '<img class="onboard-card__mark" src="assets/sign/sign-pink.png" alt="">' +
          '<div class="onboard-card__body">' +
            '<span class="onboard-card__badge">' + esc(d.badge || 'Модуль 0') + '</span>' +
            '<h3>' + esc(d.title) + '</h3>' +
            '<p>' + esc(d.tagline || d.intro) + '</p>' +
          '</div>' +
          '<div class="onboard-card__side">' +
            '<span class="onboard-card__count">' + (prog.total ? (prog.done + ' / ' + prog.total + ' пройдено') : 'Готово') + '</span>' +
            '<span class="btn btn--pink">Настроить ' + ICONS.arrow + '</span>' +
          '</div>' +
        '</button>'
      );
      card.addEventListener('click', function () { location.hash = '#/d/' + d.id; });
      el.appendChild(card);
    });

    var regs = regularDirs();
    el.appendChild(h(
      '<div class="section-head reveal" id="directions">' +
        '<h2>Модули</h2>' +
        '<span class="sub">' + regs.filter(function (d) { return d.status === 'ready'; }).length + ' из ' + regs.length + ' открыто</span>' +
      '</div>'
    ));

    var grid = h('<div class="grid"></div>');
    regs.forEach(function (d) {
      var soon = d.status !== 'ready';
      var prog = dirProgress(d);
      var foot = soon
        ? '<span class="dir-card__count dir-card__count--muted">В разработке</span>' +
          '<span class="dir-card__arrow">' + ICONS.arrow + '</span>'
        : '<span class="dir-card__count">' + (prog.total ? (prog.done + ' / ' + prog.total + ' пройдено') : 'Готово') + '</span>' +
          '<span class="dir-card__arrow">' + ICONS.arrow + '</span>';
      var card = h(
        '<button class="dir-card reveal' + (soon ? ' is-soon' : '') + (d.theme === 'dark' ? ' dir-card--dark' : '') + '" ' +
          'style="--accent:' + esc(d.accent) + ';--tint:' + esc(d.tint) + '">' +
          '<span class="dir-card__step">Шаг ' + (d.order != null ? d.order : '') + '</span>' +
          '<img class="dir-card__icon" src="' + esc(d.icon) + '" alt="">' +
          (soon ? '' : '<span class="badge-ready" style="align-self:flex-start">Открыто</span>') +
          '<h3>' + esc(d.title) + '</h3>' +
          '<p>' + esc(d.tagline || d.intro) + '</p>' +
          '<div class="dir-card__foot">' + foot + '</div>' +
        '</button>'
      );
      card.addEventListener('click', function () {
        location.hash = '#/d/' + d.id;
      });
      grid.appendChild(card);
    });
    el.appendChild(grid);
    return el;
  }

  // ============================================================
  // Экран: Направление
  // ============================================================
  function viewDirection(d) {
    var el = h('<div></div>');
    el.appendChild(crumbs([['Главная', '#/'], [d.title, null]]));

    var prog = dirProgress(d);
    el.appendChild(h(
      '<section class="dir-hero reveal' + (d.theme === 'dark' ? ' dir-hero--dark' : '') + '" style="--tint:' + esc(d.tint) + '">' +
        '<img class="dir-hero__icon" src="' + esc(d.icon) + '" alt="">' +
        '<div>' +
          '<h1>' + esc(d.title) + '</h1>' +
          '<p>' + esc(d.intro) + '</p>' +
          '<div class="dir-hero__meta">' +
            (d.featured ? '<span class="chip chip--lime">Модуль 0 · с чего начать</span>'
                        : '<span class="chip chip--lime">Шаг ' + d.order + ' из ' + totalSteps() + '</span>') +
            '<span class="chip">' + prog.total + ' ' + plural(prog.total, 'процесс', 'процесса', 'процессов') + '</span>' +
            (prog.total ? '<span class="chip chip--lime">' + prog.done + ' пройдено · ' + prog.pct + '%</span>' : '') +
            '<span class="chip chip--soft">Для клиентов Дживио</span>' +
          '</div>' +
        '</div>' +
      '</section>'
    ));

    if (d.note) {
      el.appendChild(h('<div class="callout reveal"><span class="ico">' + ICONS.bulb + '</span><div>' + esc(d.note) + '</div></div>'));
    }

    var list = h('<div class="proc-list"></div>');
    (d.processes || []).forEach(function (p, i) {
      var done = isDone(d.id, p.id);
      var card = h(
        '<button class="proc-card reveal' + (done ? ' done' : '') + '">' +
          '<span class="proc-card__num">' + (done ? ICONS.check.replace('24 24', '24 24') : (i + 1)) + '</span>' +
          '<span class="proc-card__body">' +
            (p.badge ? badgeHtml(p.badge) : '') +
            '<h3>' + esc(p.title) + '</h3>' +
            '<p>' + esc(p.summary) + '</p>' +
          '</span>' +
          '<span class="proc-card__meta">' +
            (p.duration ? '<span class="chip chip--soft">' + esc(p.duration) + '</span>' : '') +
            '<span class="proc-card__arrow">' + ICONS.arrow + '</span>' +
          '</span>' +
        '</button>'
      );
      card.addEventListener('click', function () { location.hash = '#/p/' + d.id + '/' + p.id; });
      list.appendChild(card);
    });
    if (!(d.processes || []).length) {
      list.appendChild(h('<div class="callout reveal"><span class="ico">' + ICONS.bulb + '</span><div>Материалы этого модуля в разработке.</div></div>'));
    }
    el.appendChild(list);

    // Переход к следующему по порядку модулю
    var seq = allOrdered();
    var pos = seq.map(function (x) { return x.id; }).indexOf(d.id);
    var nextDir = seq[pos + 1];
    if (nextDir) {
      var lbl = nextDir.order != null ? ('Шаг ' + nextDir.order + ' · далее по программе') : 'Далее по программе';
      var nx = h(
        '<div class="next-dir reveal">' +
          '<div><span class="next-dir__lbl">' + lbl + '</span>' +
          '<span class="next-dir__t">' + esc(nextDir.title) + '</span></div>' +
          '<span class="btn btn--dark">Перейти ' + ICONS.arrow + '</span>' +
        '</div>'
      );
      nx.addEventListener('click', function () {
        location.hash = '#/d/' + nextDir.id;
      });
      el.appendChild(nx);
    }

    return el;
  }

  // ============================================================
  // Экран: Процесс (учебный блок)
  // ============================================================
  function viewProcess(d, p) {
    var el = h('<div></div>');
    el.appendChild(crumbs([['Главная', '#/'], [d.title, '#/d/' + d.id], [p.title, null]]));

    // Заголовок
    var metaTags = (p.tags || []).map(function (t) { return '<span class="chip chip--soft">' + esc(t) + '</span>'; }).join('');
    el.appendChild(h(
      '<header class="proc-header reveal">' +
        '<span class="proc-header__chips">' +
          '<span class="chip">' + esc(d.title) + '</span>' +
          (p.badge ? badgeHtml(p.badge) : '') +
        '</span>' +
        '<h1>' + esc(p.title) + '</h1>' +
        '<p class="lead">' + esc(p.summary) + '</p>' +
        '<div class="proc-header__meta">' +
          (p.duration ? '<span class="chip chip--lime">▶ ' + esc(p.duration) + '</span>' : '') +
          metaTags +
        '</div>' +
      '</header>'
    ));

    // Видео
    el.appendChild(videoBlock(p.video, p.title));

    // Готовый промпт — сразу после видео (если задан)
    if (p.teamBuilder) el.appendChild(teamBuilderBlock(p.teamBuilder));
    else if (p.promptBuilder) el.appendChild(promptBuilderBlock(p.promptBuilder));
    else if (p.prompts || p.prompt) el.appendChild(promptBlock(p.prompts || p.prompt));

    // Демо-визуализация под видео (если задана)
    if (p.demo === 'oos') el.appendChild(oosDemoBlock());
    else if (p.demo === 'destock') el.appendChild(destockDemoBlock());
    else if (p.demo === 'orders') el.appendChild(ordersDemoBlock());
    else if (p.demo && EXPERT_DEMOS[p.demo]) el.appendChild(expertDemoBlock(EXPERT_DEMOS[p.demo]));
    else if (p.demo && DEMOS[p.demo]) el.appendChild(buildDemo(DEMOS[p.demo]));

    // Было → Стало
    var ba = h('<div class="ba-grid"></div>');
    var cp = p.clientProcess || {};
    ba.appendChild(h(
      '<div class="panel panel--pain reveal">' +
        '<span class="panel__label">Какой сейчас процесс</span>' +
        '<h3>' + esc(cp.pain || 'Процесс вручную') + '</h3>' +
        '<ul class="step-list">' +
          (cp.steps || []).map(function (s, i) { return '<li><span class="mk">' + (i + 1) + '</span><span>' + esc(s) + '</span></li>'; }).join('') +
        '</ul>' +
      '</div>'
    ));
    var sol = p.djivioSolution || {};
    ba.appendChild(h(
      '<div class="panel panel--gain reveal">' +
        '<span class="panel__label">Как автоматизирует Дживио</span>' +
        '<h3>' + esc(sol.intro || 'Автоматизация Дживио') + '</h3>' +
        '<ul class="step-list">' +
          (sol.steps || []).map(function (s) {
            return '<li><span class="mk">' + ICONS.check + '</span><span><b>' + esc(s.title) + '.</b> ' + esc(s.desc) + '</span></li>';
          }).join('') +
        '</ul>' +
        (sol.result ? '<div class="result-tag"><span>' + ICONS.bolt + '</span><span><b>Результат:</b> ' + esc(sol.result) + '</span></div>' : '') +
      '</div>'
    ));
    el.appendChild(ba);

    // Пояснение к уроку (если задано)
    if (p.note) {
      el.appendChild(h('<div class="callout reveal"><span class="ico">' + ICONS.bulb + '</span><div>' + esc(p.note) + '</div></div>'));
    }

    // Обратная связь по уроку
    el.appendChild(feedbackBlock(d, p));

    // Навигация между уроками (переход спрашивает про отметку о прохождении)
    var procs = d.processes || [];
    var idx = procs.indexOf(p);
    var prev = procs[idx - 1], next = procs[idx + 1];

    if (isDone(d.id, p.id)) {
      el.appendChild(h('<div class="proc-done-chip reveal">' + ICONS.check + '<span>Урок пройден</span></div>'));
    }

    var nav = h('<nav class="proc-nav reveal"></nav>');
    function navLink(cls, hash, label, title) {
      var a = h('<a href="' + hash + '" class="' + cls + '"><span class="dir-lbl">' + label + '</span><span class="t">' + esc(title) + '</span></a>');
      a.addEventListener('click', function (e) { e.preventDefault(); askBeforeLeave(d, p, hash); });
      return a;
    }
    if (prev) nav.appendChild(navLink('prev', '#/p/' + d.id + '/' + prev.id, '← Предыдущий', prev.title));
    if (next) nav.appendChild(navLink('next', '#/p/' + d.id + '/' + next.id, 'Следующий →', next.title));
    else nav.appendChild(navLink('next', '#/d/' + d.id, 'Завершить →', 'Вернуться к направлению'));
    el.appendChild(nav);

    return el;
  }

  // ---------- Переход между уроками: спросить об отметке ----------
  function askBeforeLeave(d, p, targetHash) {
    if (isDone(d.id, p.id)) { location.hash = targetHash; return; }
    var reason = (p.djivioSolution && p.djivioSolution.result) ||
      'Вы закрепите процесс и сможете сразу применить его в работе.';
    var ov = h(
      '<div class="modal-ov">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<button class="modal__close" aria-label="Закрыть">&times;</button>' +
          '<div class="modal__ico">' + ICONS.bolt + '</div>' +
          '<h3>Отметить урок как пройденный?</h3>' +
          '<div class="modal__why">' +
            '<span class="modal__why-lbl">Зачем проходить</span>' +
            '<span class="modal__why-txt">' + esc(reason) + '</span>' +
          '</div>' +
          '<div class="modal__actions">' +
            '<button class="btn btn--pink modal__done">Отметить пройденным ' + ICONS.arrow + '</button>' +
            '<button class="btn btn--ghost modal__later">Пройду позже</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    function close() { ov.classList.remove('show'); document.removeEventListener('keydown', onKey); setTimeout(function () { if (ov.parentNode) ov.remove(); }, 200); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.querySelector('.modal__done').addEventListener('click', function () { setDone(d.id, p.id, true); close(); location.hash = targetHash; toast('Отлично! Урок отмечен пройденным'); });
    ov.querySelector('.modal__later').addEventListener('click', function () { close(); location.hash = targetHash; });
    ov.querySelector('.modal__close').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
  }

  function maybeAutoComplete(d, p, applyEl) {
    var total = (p.apply || []).length;
    var checked = p.apply.filter(function (_, i) { return isChecked(d.id, p.id, i); }).length;
    if (total && checked === total && !isDone(d.id, p.id)) {
      setDone(d.id, p.id, true);
      toast('Все шаги выполнены — процесс пройден!');
      renderSidebar(currentRoute());
    }
  }

  // ---------- Обратная связь по уроку ----------
  function feedbackBlock(d, p) {
    var wrap = h('<section class="feedback reveal"></section>');
    function step(html) { var s = h('<div class="fb-step">' + html + '</div>'); wrap.innerHTML = ''; wrap.appendChild(s); return s; }
    function paint() {
      var fb = getFeedback(d, p);

      if (!fb) {
        var s = step(
          '<p class="fb-q">Как вам урок?</p>' +
          '<div class="fb-reacts">' +
            '<button class="fb-react" data-v="like"><span class="fb-face">' + ICONS.like + '</span><span class="fb-lbl">Понравился</span></button>' +
            '<button class="fb-react fb-react--no" data-v="dislike"><span class="fb-face">' + ICONS.dislike + '</span><span class="fb-lbl">Не очень</span></button>' +
          '</div>'
        );
        s.querySelector('[data-v=like]').addEventListener('click', function () { setFeedback(d, p, { rating: 'like' }); paint(); });
        s.querySelector('[data-v=dislike]').addEventListener('click', function () { setFeedback(d, p, { rating: 'dislike' }); paint(); });

      } else if (fb.rating === 'like' && typeof fb.implemented === 'undefined') {
        var s2 = step(
          '<p class="fb-q">Класс! Будете внедрять процесс?</p>' +
          '<div class="fb-chips">' +
            '<button class="fb-chip fb-chip--yes" data-v="yes">Буду внедрять</button>' +
            '<button class="fb-chip" data-v="no">Не буду</button>' +
          '</div>'
        );
        s2.querySelector('[data-v=yes]').addEventListener('click', function () { fb.implemented = true; setFeedback(d, p, fb); paint(); });
        s2.querySelector('[data-v=no]').addEventListener('click', function () { fb.implemented = false; setFeedback(d, p, fb); paint(); });

      } else if (fb.rating === 'dislike' && typeof fb.text === 'undefined') {
        var s3 = step(
          '<p class="fb-q">Жаль. Что улучшить?</p>' +
          '<div class="fb-form">' +
            '<textarea class="fb-text" rows="2" placeholder="Пара слов…"></textarea>' +
            '<button class="fb-chip fb-chip--yes fb-send">Отправить</button>' +
          '</div>'
        );
        var ta = s3.querySelector('.fb-text');
        s3.querySelector('.fb-send').addEventListener('click', function () { fb.text = ta.value.trim(); setFeedback(d, p, fb); paint(); });
        ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { fb.text = ta.value.trim(); setFeedback(d, p, fb); paint(); } });
        setTimeout(function () { ta.focus(); }, 0);

      } else {
        var msg = fb.rating === 'like'
          ? (fb.implemented ? 'Огонь! Внедряйте — и почувствуете разницу.' : 'Спасибо! Вернётесь к внедрению, когда будете готовы.')
          : 'Спасибо за честность — станем лучше.';
        var s4 = step(
          '<span class="fb-badge">' + ICONS.check + '</span>' +
          '<p class="fb-thanks">' + esc(msg) + '</p>' +
          '<button class="fb-reset">Изменить ответ</button>'
        );
        s4.classList.add('fb-step--done');
        s4.querySelector('.fb-reset').addEventListener('click', function () { setFeedback(d, p, null); paint(); });
      }
    }
    paint();
    return wrap;
  }

  // ---------- Демо-визуализация «Контроль остатка» ----------
  function oosDemoBlock() {
    var root = h(
      '<div class="oos-demo reveal">' +
        '<div class="oosd__body">' +
          '<div class="oosd__chart">' +
            '<svg viewBox="0 0 620 240" preserveAspectRatio="none">' +
              '<line class="oosd__base" x1="40" y1="200" x2="600" y2="200"/>' +
              '<line class="oosd__supply" x1="460" y1="34" x2="460" y2="200"/>' +
              '<path class="oosd__area" d="M40 66 C150 120 220 158 300 168 C355 175 425 172 460 150 C495 130 550 122 600 108 L600 200 L40 200 Z"/>' +
              '<path class="oosd__red" pathLength="100" d="M40 66 C150 120 250 196 340 200"/>' +
              '<path class="oosd__lime" pathLength="100" d="M40 66 C150 120 220 158 300 168 C355 175 425 172 460 150 C495 130 550 122 600 108"/>' +
              '<g class="oosd__oos"><circle cx="340" cy="200" r="7"/><text x="340" y="224">OOS · 0</text></g>' +
              '<g class="oosd__ok"><circle cx="600" cy="108" r="7"/></g>' +
              '<text class="oosd__supplylbl" x="460" y="26">Поставка</text>' +
            '</svg>' +
            '<div class="oosd__legend"><span class="lg lg--red">без агента</span><span class="lg lg--lime">с Дживио</span></div>' +
          '</div>' +
          '<div class="oosd__side">' +
            '<div class="oosd__stock"><span class="oosd__k">Запаса на складе</span><b><span class="oosd__num">20</span> дн</b>' +
              '<div class="oosd__track"><span class="oosd__fill"></span></div></div>' +
            '<div class="oosd__row"><span class="oosd__k">Цена</span><span class="oosd__price">990 ₽</span></div>' +
            '<div class="oosd__row"><span class="oosd__k">Статус</span><span class="oosd__status">Запас в норме</span></div>' +
            '<div class="oosd__result">' + ICONS.check + '<span>Товар в наличии до поставки — позиции сохранены</span></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var elNum = root.querySelector('.oosd__num');
    var elFill = root.querySelector('.oosd__fill');
    var elPrice = root.querySelector('.oosd__price');
    var elStatus = root.querySelector('.oosd__status');
    var elResult = root.querySelector('.oosd__result');
    var elRed = root.querySelector('.oosd__red');
    var elLime = root.querySelector('.oosd__lime');
    var elArea = root.querySelector('.oosd__area');
    var elOos = root.querySelector('.oosd__oos');
    var elOk = root.querySelector('.oosd__ok');

    function pw(t, pts) {
      for (var i = 0; i < pts.length - 1; i++) {
        if (t >= pts[i][0] && t <= pts[i + 1][0]) {
          var k = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
          return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
        }
      }
      return pts[pts.length - 1][1];
    }
    var daysPts = [[0, 20], [0.16, 14], [0.32, 10], [0.48, 7], [0.62, 3], [0.75, 2], [0.77, 45], [1, 45]];
    var pricePts = [
      [0, 990], [0.158, 990], [0.162, 1010],      // <14 дней → +2%
      [0.318, 1010], [0.322, 1020],               // <10 дней → +3%
      [0.478, 1020], [0.482, 1040],               // <7 дней → +5%
      [0.618, 1040], [0.622, 1089],               // <3 дней → +10%
      [0.768, 1089], [0.772, 990], [1, 990],      // поставка → РРЦ
    ];
    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    function apply(t) {
      var days = pw(t, daysPts);
      elNum.textContent = Math.round(days);
      elFill.style.width = Math.max(4, Math.min(100, days / 45 * 100)) + '%';
      elPrice.textContent = fmt(pw(t, pricePts)) + ' ₽';
      var st, tone;
      if (t < 0.16) { st = 'Запас в норме · цена РРЦ'; tone = 'n'; }
      else if (t < 0.32) { st = 'Меньше 14 дней · цена +2%'; tone = 'l'; }
      else if (t < 0.48) { st = 'Меньше 10 дней · цена +3%'; tone = 'l'; }
      else if (t < 0.62) { st = 'Меньше 7 дней · цена +5%'; tone = 'd'; }
      else if (t < 0.77) { st = 'Меньше 3 дней · цена +10%'; tone = 'd'; }
      else { st = 'Больше 30 дней · цена РРЦ'; tone = 'ok'; }
      elStatus.textContent = st;
      elStatus.className = 'oosd__status oosd__status--' + tone;
      elFill.className = 'oosd__fill' + (tone === 'd' ? ' is-danger' : '');
      var drawT = Math.max(0, Math.min(1, t / 0.45));
      var off = 100 * (1 - drawT);
      elRed.style.strokeDashoffset = off; elLime.style.strokeDashoffset = off;
      elArea.style.opacity = drawT >= 1 ? 0.9 : (drawT * 0.9);
      elOos.style.opacity = (t >= 0.45 && t < 0.9) ? 1 : 0;
      elOk.style.opacity = (t >= 0.5) ? 1 : 0;
      elResult.style.opacity = (t >= 0.82) ? 1 : 0;
    }

    demoRunner(root, apply);
    return root;
  }

  // Управление анимацией демо: кнопка «Пауза» + blur-оверлей «Смотреть», rAF-цикл
  function demoRunner(root, apply, period) {
    period = period || 8200;
    var elapsed = 0, lastNow = null, playing = false;
    var pauseBtn = h('<button class="oosd__ctrl" aria-label="Пауза"><svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg><span>Пауза</span></button>');
    var overlay = h(
      '<button class="oosd__overlay" aria-label="Запустить анимацию">' +
        '<span class="oosd__playbtn"><svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M8 5v14l11-7z"/></svg></span>' +
        '<span class="oosd__playlbl">Смотреть, как работает Дживио</span>' +
      '</button>'
    );
    function state() { root.classList.toggle('is-paused', !playing); }
    function frame(now) {
      if (!document.body.contains(root)) { playing = false; return; }
      if (lastNow === null) lastNow = now;
      elapsed += now - lastNow; lastNow = now;
      apply((elapsed % period) / period);
      if (playing) requestAnimationFrame(frame);
    }
    function play() { if (playing) return; playing = true; lastNow = null; state(); requestAnimationFrame(frame); }
    function pause() { playing = false; state(); }
    pauseBtn.addEventListener('click', pause);
    overlay.addEventListener('click', play);
    root.querySelector('.oosd__chart').appendChild(pauseBtn);
    root.appendChild(overlay);
    // По умолчанию на паузе — запускается по кнопке «Смотреть»
    apply(0.95);
    state();
  }

  // ---------- Демо-визуализация «Высвобождение средств из неликвида» ----------
  function destockDemoBlock() {
    var root = h(
      '<div class="oos-demo reveal">' +
        '<div class="oosd__body">' +
          '<div class="oosd__chart">' +
            '<svg viewBox="0 0 620 240" preserveAspectRatio="none">' +
              '<line class="oosd__base" x1="40" y1="200" x2="600" y2="200"/>' +
              '<path class="oosd__area" d="M40 74 C160 96 250 132 340 160 C420 182 500 194 600 197 L600 200 L40 200 Z"/>' +
              '<path class="oosd__red" pathLength="100" d="M40 74 C180 70 320 74 600 70"/>' +
              '<path class="oosd__lime" pathLength="100" d="M40 74 C160 96 250 132 340 160 C420 182 500 194 600 197"/>' +
              '<g class="oosd__ok"><circle cx="600" cy="197" r="7"/></g>' +
              '<g class="oosd__oos"><circle cx="600" cy="70" r="6"/><text x="588" y="58">лежит</text></g>' +
            '</svg>' +
            '<div class="oosd__legend"><span class="lg lg--red">без агента</span><span class="lg lg--lime">с Дживио</span></div>' +
          '</div>' +
          '<div class="oosd__side">' +
            '<div class="oosd__stock"><span class="oosd__k">Заморожено средств</span><b><span class="oosd__num">480 000</span> ₽</b>' +
              '<div class="oosd__track"><span class="oosd__fill"></span></div></div>' +
            '<div class="oosd__row"><span class="oosd__k">Цена (раскачка)</span><span class="oosd__price">1 490 ₽</span></div>' +
            '<div class="oosd__row"><span class="oosd__k">Статус</span><span class="oosd__status">Неликвид копится</span></div>' +
            '<div class="oosd__result">' + ICONS.check + '<span>Деньги высвобождены в оборот, хранение снижено</span></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var elNum = root.querySelector('.oosd__num');
    var elFill = root.querySelector('.oosd__fill');
    var elPrice = root.querySelector('.oosd__price');
    var elStatus = root.querySelector('.oosd__status');
    var elResult = root.querySelector('.oosd__result');
    var elRed = root.querySelector('.oosd__red');
    var elLime = root.querySelector('.oosd__lime');
    var elArea = root.querySelector('.oosd__area');
    var elOos = root.querySelector('.oosd__oos');
    var elOk = root.querySelector('.oosd__ok');

    function pw(t, pts) {
      for (var i = 0; i < pts.length - 1; i++) {
        if (t >= pts[i][0] && t <= pts[i + 1][0]) {
          var k = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
          return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
        }
      }
      return pts[pts.length - 1][1];
    }
    var frozenPts = [[0, 480000], [0.3, 480000], [0.75, 140000], [1, 60000]];
    var pricePts = [[0, 1490], [0.3, 1490], [0.7, 1190], [1, 1190]];
    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    function apply(t) {
      var frozen = pw(t, frozenPts);
      elNum.textContent = fmt(Math.round(frozen / 1000) * 1000);
      elFill.style.width = Math.max(4, Math.min(100, frozen / 480000 * 100)) + '%';
      elPrice.textContent = fmt(pw(t, pricePts)) + ' ₽';
      var st, tone;
      if (t < 0.3) { st = 'Неликвид копится'; tone = 'd'; }
      else if (t < 0.75) { st = 'Дживио разгоняет продажи'; tone = 'l'; }
      else { st = 'Средства высвобождены'; tone = 'ok'; }
      elStatus.textContent = st;
      elStatus.className = 'oosd__status oosd__status--' + tone;
      elFill.className = 'oosd__fill' + (t < 0.3 ? ' is-danger' : '');
      var drawT = Math.max(0, Math.min(1, t / 0.6));
      var off = 100 * (1 - drawT);
      elRed.style.strokeDashoffset = off; elLime.style.strokeDashoffset = off;
      elArea.style.opacity = drawT >= 1 ? 0.9 : (drawT * 0.9);
      elOos.style.opacity = (t >= 0.15) ? 1 : 0;
      elOk.style.opacity = (t >= 0.7) ? 1 : 0;
      elResult.style.opacity = (t >= 0.78) ? 1 : 0;
    }

    demoRunner(root, apply);
    return root;
  }

  // ---------- Демо-визуализация «Предотвращение падения заказов» ----------
  function ordersDemoBlock() {
    var root = h(
      '<div class="oos-demo reveal">' +
        '<div class="oosd__body">' +
          '<div class="oosd__chart">' +
            '<svg viewBox="0 0 620 240" preserveAspectRatio="none">' +
              '<line class="oosd__base" x1="40" y1="200" x2="600" y2="200"/>' +
              '<path class="oosd__area" d="M40 62 C150 92 250 116 300 116 C380 116 470 96 600 80 L600 200 L40 200 Z"/>' +
              '<path class="oosd__red" pathLength="100" d="M40 62 C170 92 330 132 600 172"/>' +
              '<path class="oosd__lime" pathLength="100" d="M40 62 C150 92 250 116 300 116 C380 116 470 96 600 80"/>' +
              '<g class="oosd__oos"><circle cx="300" cy="116" r="6"/><text x="300" y="138">просадка</text></g>' +
              '<g class="oosd__ok"><circle cx="600" cy="80" r="7"/></g>' +
            '</svg>' +
            '<div class="oosd__legend"><span class="lg lg--red">без агента</span><span class="lg lg--lime">с Дживио</span></div>' +
          '</div>' +
          '<div class="oosd__side">' +
            '<div class="oosd__stock"><span class="oosd__k">Заказы в день</span><b><span class="oosd__num">60</span></b>' +
              '<div class="oosd__track"><span class="oosd__fill"></span></div></div>' +
            '<div class="oosd__row"><span class="oosd__k">Цена</span><span class="oosd__price">990 ₽</span></div>' +
            '<div class="oosd__row"><span class="oosd__k">Статус</span><span class="oosd__status">Заказы стабильны</span></div>' +
            '<div class="oosd__result">' + ICONS.check + '<span>Заказы удержаны, цена почти не просела</span></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var elNum = root.querySelector('.oosd__num');
    var elFill = root.querySelector('.oosd__fill');
    var elPrice = root.querySelector('.oosd__price');
    var elStatus = root.querySelector('.oosd__status');
    var elResult = root.querySelector('.oosd__result');
    var elRed = root.querySelector('.oosd__red');
    var elLime = root.querySelector('.oosd__lime');
    var elArea = root.querySelector('.oosd__area');
    var elOos = root.querySelector('.oosd__oos');
    var elOk = root.querySelector('.oosd__ok');

    function pw(t, pts) {
      for (var i = 0; i < pts.length - 1; i++) {
        if (t >= pts[i][0] && t <= pts[i + 1][0]) {
          var k = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
          return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
        }
      }
      return pts[pts.length - 1][1];
    }
    var ordersPts = [[0, 60], [0.28, 60], [0.46, 36], [0.72, 54], [1, 58]];
    var pricePts = [[0, 990], [0.32, 990], [0.6, 950], [1, 950]];
    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    function apply(t) {
      var ord = pw(t, ordersPts);
      elNum.textContent = Math.round(ord);
      elFill.style.width = Math.max(4, Math.min(100, ord / 60 * 100)) + '%';
      elPrice.textContent = fmt(pw(t, pricePts)) + ' ₽';
      var st, tone;
      if (t < 0.28) { st = 'Заказы стабильны'; tone = 'ok'; }
      else if (t < 0.46) { st = 'Просадка спроса'; tone = 'd'; }
      else if (t < 0.72) { st = 'Дживио корректирует цену'; tone = 'l'; }
      else { st = 'Заказы удержаны'; tone = 'ok'; }
      elStatus.textContent = st;
      elStatus.className = 'oosd__status oosd__status--' + tone;
      elFill.className = 'oosd__fill' + (t >= 0.28 && t < 0.46 ? ' is-danger' : '');
      var drawT = Math.max(0, Math.min(1, t / 0.6));
      var off = 100 * (1 - drawT);
      elRed.style.strokeDashoffset = off; elLime.style.strokeDashoffset = off;
      elArea.style.opacity = drawT >= 1 ? 0.9 : (drawT * 0.9);
      elOos.style.opacity = (t >= 0.3 && t < 0.62) ? 1 : 0;
      elOk.style.opacity = (t >= 0.72) ? 1 : 0;
      elResult.style.opacity = (t >= 0.8) ? 1 : 0;
    }

    demoRunner(root, apply);
    return root;
  }

  // ---------- Блок с готовым промптом (копируется в один клик) ----------
  function promptBlock(prompts) {
    if (typeof prompts === 'string') prompts = [{ text: prompts }];
    var block = h(
      '<section class="prompt-block reveal">' +
        '<div class="pb__head">' +
          '<span class="pb__ico">' + ICONS.bolt + '</span>' +
          '<div><h3>Готовый промпт для агента</h3><p>Начните создание агента с этого промпта — он будет выполнять правила автоматически, ежедневно</p></div>' +
        '</div>' +
        '<div class="pb__grid"></div>' +
      '</section>'
    );
    var grid = block.querySelector('.pb__grid');
    prompts.forEach(function (pr) {
      var card = h(
        '<div class="pb__card">' +
          '<div class="pb__cardhead">' +
            (pr.title ? '<span class="pb__cardtitle">' + esc(pr.title) + '</span>' : '') +
            '<button class="pb__copy">' + ICONS.copy + '<span>Копировать</span></button>' +
          '</div>' +
          '<pre class="pb__text"></pre>' +
        '</div>'
      );
      var pre = card.querySelector('.pb__text');
      pre.textContent = pr.text;
      var btn = card.querySelector('.pb__copy');
      btn.addEventListener('click', function () {
        function done() {
          btn.classList.add('is-copied');
          btn.innerHTML = ICONS.check + '<span>Скопировано</span>';
          setTimeout(function () { btn.classList.remove('is-copied'); btn.innerHTML = ICONS.copy + '<span>Копировать</span>'; }, 2200);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pr.text).then(done, done);
        } else {
          try {
            var r = document.createRange(); r.selectNodeContents(pre);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            document.execCommand('copy'); sel.removeAllRanges();
          } catch (e) {}
          done();
        }
      });
      grid.appendChild(card);
    });
    if (prompts.length > 1) block.classList.add('prompt-block--multi');
    return block;
  }

  // ---------- Конструктор промпта с чекбоксами ----------
  // ---------- Конструктор командных промптов (несколько агентов + связки) ----------
  function teamBuilderBlock(cfg) {
    var block = h(
      '<section class="prompt-block pbt reveal">' +
        '<div class="pb__head">' +
          '<span class="pb__ico">' + ICONS.bolt + '</span>' +
          '<div><h3>Соберите промпты для команды агентов</h3><p>' + esc(cfg.note || 'Выберите процессы — промпты для всех агентов соберутся автоматически.') + '</p></div>' +
          '<button class="pb__copy pbt__copyall">' + ICONS.copy + '<span>Копировать всё</span></button>' +
        '</div>' +
        '<div class="pb__opts"></div>' +
        '<div class="pbt__links"></div>' +
        '<div class="pbt__grid"></div>' +
      '</section>'
    );
    var optsEl = block.querySelector('.pb__opts');
    var linksEl = block.querySelector('.pbt__links');
    var gridEl = block.querySelector('.pbt__grid');
    var state = cfg.options.map(function (o) { return o.on ? 'on' : 'off'; });

    // Карточки агентов
    var cards = {};
    cfg.agents.forEach(function (a) {
      var card = h(
        '<div class="pb__card pbt__card" data-tone="' + (a.tone || '') + '">' +
          '<div class="pb__cardhead">' +
            '<span class="pbt__adot"></span>' +
            '<span class="pb__cardtitle">' + esc(a.title) + '</span>' +
            '<button class="pb__copy pb__copy--sm">' + ICONS.copy + '<span>Копировать</span></button>' +
          '</div>' +
          '<pre class="pb__text"></pre>' +
        '</div>'
      );
      cards[a.key] = card;
      gridEl.appendChild(card);
      bindCopy(card.querySelector('.pb__copy'), function () { return textFor(a.key); });
    });

    function rulesFor(key) {
      var agent = cfg.agents.filter(function (a) { return a.key === key; })[0] || {};
      var rules = (agent.head || []).slice();
      cfg.options.forEach(function (o, i) {
        if (state[i] === 'off') return;                                  // выключен везде
        if (state[i] === 'partial' && key === o.owner) return;           // выключен только у своего агента
        if (o.rules && o.rules[key]) rules = rules.concat(o.rules[key]);
      });
      return rules.concat(agent.tail || []);
    }
    function agentTitle(key) {
      var a = cfg.agents.filter(function (x) { return x.key === key; })[0];
      return a ? a.title : key;
    }
    function otherAgents(o) {
      return Object.keys(o.rules || {}).filter(function (k) { return k !== o.owner; });
    }
    function textFor(key) {
      return rulesFor(key).map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n');
    }
    function allText() {
      return cfg.agents.map(function (a) {
        return '=== ' + a.title + ' ===\n' + textFor(a.key);
      }).join('\n\n');
    }

    function refresh() {
      cfg.agents.forEach(function (a) { cards[a.key].querySelector('.pb__text').textContent = textFor(a.key); });
      // Пояснения: где процесс ещё остался, если выключен частично
      linksEl.innerHTML = '';
      cfg.options.forEach(function (o, i) {
        if (state[i] !== 'partial') return;
        var others = otherAgents(o).map(agentTitle);
        if (!others.length) return;
        linksEl.appendChild(h(
          '<div class="pbt__link">' + ICONS.arrow +
          '<span>«' + esc(o.label) + '» выключен у агента «' + esc(agentTitle(o.owner)) + '», но остаётся у: ' + esc(others.join(', ')) + '</span></div>'
        ));
      });
      linksEl.classList.toggle('is-empty', !linksEl.children.length);
    }

    var chips = [];
    function syncChips() {
      chips.forEach(function (c, i) {
        c.classList.toggle('is-on', state[i] === 'on');
        c.classList.toggle('is-partial', state[i] === 'partial');
      });
    }
    var groupEls = {};
    cfg.options.forEach(function (o, i) {
      var chip = h(
        '<button class="pb__opt' + (state[i] === 'on' ? ' is-on' : '') + '">' +
          '<span class="pb__optbox">' + ICONS.check + '</span>' +
          '<span>' + esc(o.label) + '</span>' +
        '</button>'
      );
      chips[i] = chip;
      chip.addEventListener('click', function () {
        if (state[i] === 'on') {
          var others = otherAgents(o);
          if (!others.length) { state[i] = 'off'; syncChips(); refresh(); return; }
          confirmDialog({
            title: 'Убрать этот процесс у других агентов?',
            text: '«' + o.label + '» также настроен у: ' + others.map(agentTitle).join(', ') +
                  '. Убрать процесс и там — или оставить, чтобы его продолжали вести другие агенты?',
            yes: 'Убрать везде',
            no: 'Оставить у других',
          }, function (removeAll) {
            state[i] = removeAll ? 'off' : 'partial';
            syncChips(); refresh();
          });
        } else {
          if (o.group) cfg.options.forEach(function (oo, j) { if (oo.group === o.group) state[j] = 'off'; });
          state[i] = 'on';
          syncChips(); refresh();
        }
      });
      if (o.group) {
        if (!groupEls[o.group]) {
          groupEls[o.group] = h('<div class="pb__group"><span class="pb__grouplbl">' + esc(o.group) + ' · одно из</span></div>');
          optsEl.appendChild(groupEls[o.group]);
        }
        groupEls[o.group].appendChild(chip);
      } else { optsEl.appendChild(chip); }
    });
    syncChips();
    refresh();
    bindCopy(block.querySelector('.pbt__copyall'), allText);
    return block;
  }

  // Диалог подтверждения (да / нет)
  function confirmDialog(opts, cb) {
    var ov = h(
      '<div class="modal-ov">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<button class="modal__close" aria-label="Закрыть">&times;</button>' +
          '<div class="modal__ico">' + ICONS.bolt + '</div>' +
          '<h3>' + esc(opts.title) + '</h3>' +
          '<div class="modal__why"><span class="modal__why-txt">' + esc(opts.text) + '</span></div>' +
          '<div class="modal__actions">' +
            '<button class="btn btn--pink modal__yes">' + esc(opts.yes || 'Да') + '</button>' +
            '<button class="btn btn--ghost modal__no">' + esc(opts.no || 'Нет') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    function close() { ov.classList.remove('show'); document.removeEventListener('keydown', onKey); setTimeout(function () { if (ov.parentNode) ov.remove(); }, 200); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.querySelector('.modal__yes').addEventListener('click', function () { close(); cb(true); });
    ov.querySelector('.modal__no').addEventListener('click', function () { close(); cb(false); });
    ov.querySelector('.modal__close').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
  }

  // Общая обвязка копирования для кнопок промптов
  function bindCopy(btn, getText) {
    var label = btn.querySelector('span') ? btn.querySelector('span').textContent : 'Копировать';
    btn.addEventListener('click', function () {
      var text = getText();
      function done() {
        btn.classList.add('is-copied');
        btn.innerHTML = ICONS.check + '<span>Скопировано</span>';
        setTimeout(function () { btn.classList.remove('is-copied'); btn.innerHTML = ICONS.copy + '<span>' + label + '</span>'; }, 2200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else { try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (e) {} done(); }
    });
  }

  function promptBuilderBlock(cfg) {
    var block = h(
      '<section class="prompt-block reveal">' +
        '<div class="pb__head">' +
          '<span class="pb__ico">' + ICONS.bolt + '</span>' +
          '<div><h3>Соберите промпт для агента</h3><p>' + esc(cfg.note || 'Выберите процессы — промпт соберётся автоматически.') + '</p></div>' +
          '<button class="pb__copy">' + ICONS.copy + '<span>Копировать</span></button>' +
        '</div>' +
        '<div class="pb__opts"></div>' +
        '<pre class="pb__text"></pre>' +
      '</section>'
    );
    var optsEl = block.querySelector('.pb__opts');
    var pre = block.querySelector('.pb__text');
    var state = cfg.options.map(function (o) { return !!o.on; });

    function buildText() {
      var rules = (cfg.head || []).slice();
      cfg.options.forEach(function (o, i) { if (state[i]) rules = rules.concat(o.rules); });
      rules = rules.concat(cfg.tail || []);
      return rules.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n');
    }
    function refresh() { pre.textContent = buildText(); }

    var chips = [];
    function syncChips() { chips.forEach(function (c, i) { c.classList.toggle('is-on', state[i]); }); }
    var groupEls = {};
    cfg.options.forEach(function (o, i) {
      var chip = h(
        '<button class="pb__opt' + (state[i] ? ' is-on' : '') + '">' +
          '<span class="pb__optbox">' + ICONS.check + '</span>' +
          '<span>' + esc(o.label) + '</span>' +
        '</button>'
      );
      chips[i] = chip;
      chip.addEventListener('click', function () {
        if (!state[i] && o.group) {
          // радио-поведение внутри группы: включаем эту, выключаем остальные
          cfg.options.forEach(function (oo, j) { if (oo.group === o.group) state[j] = false; });
          state[i] = true;
        } else {
          state[i] = !state[i];
        }
        syncChips();
        refresh();
      });
      if (o.group) {
        if (!groupEls[o.group]) {
          groupEls[o.group] = h('<div class="pb__group"><span class="pb__grouplbl">' + esc(o.group) + ' · одно из</span></div>');
          optsEl.appendChild(groupEls[o.group]);
        }
        groupEls[o.group].appendChild(chip);
      } else {
        optsEl.appendChild(chip);
      }
    });
    refresh();

    var btn = block.querySelector('.pb__copy');
    btn.addEventListener('click', function () {
      var text = buildText();
      function done() {
        btn.classList.add('is-copied');
        btn.innerHTML = ICONS.check + '<span>Скопировано</span>';
        setTimeout(function () { btn.classList.remove('is-copied'); btn.innerHTML = ICONS.copy + '<span>Копировать</span>'; }, 2200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        try {
          var r = document.createRange(); r.selectNodeContents(pre);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          document.execCommand('copy'); sel.removeAllRanges();
        } catch (e) {}
        done();
      }
    });
    return block;
  }

  // ---------- Универсальный конструктор демо (на конфиге) ----------
  // ---------- ВАУ-демо для экспертных уроков: 4 агента в связке ----------
  function expertDemoBlock(cfg) {
    var pts = cfg.pts || [[30, 132], [130, 126], [230, 112], [330, 92], [430, 66], [520, 44], [590, 30]];
    var linePath = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L ');
    var areaPath = linePath + ' L ' + pts[pts.length - 1][0] + ' 150 L ' + pts[0][0] + ' 150 Z';
    var toneName = { price: 'Агент цен', ads: 'Агент рекламы', comm: 'Агент коммуникации', data: 'Агент аналитики' };

    var agentsHtml = cfg.agents.map(function (a) {
      return '<div class="exd__agent" data-tone="' + a.tone + '">' +
        '<div class="exd__ahead"><span class="exd__adot"></span><b>' + esc(a.name || toneName[a.tone]) + '</b>' +
          (a.ctrl ? '<span class="exd__actrl">' + esc(a.ctrl) + '</span>' : '') + '</div>' +
        '<div class="exd__ametric"></div>' +
        '<div class="exd__aact"></div>' +
        '<div class="exd__abar"><span class="exd__afill"></span></div>' +
      '</div>';
    }).join('');

    var deltaSuffix = cfg.goal.delta === 'abs' ? '' : '%';
    var root = h(
      '<div class="oos-demo exd reveal">' +
        '<div class="exd__top">' +
          '<div class="exd__goal">' +
            '<span class="exd__goallbl">' + esc(cfg.goal.label) + '</span>' +
            '<b class="exd__goalnum"></b>' +
            '<span class="exd__goaldelta"></span>' +
          '</div>' +
          '<div class="oosd__chart exd__chart"><svg viewBox="0 0 620 160" preserveAspectRatio="none">' +
            '<line class="exd__base" x1="30" y1="150" x2="590" y2="150"/>' +
            '<path class="exd__red" pathLength="100" d="' + (cfg.red || 'M30 134 C170 132 330 136 590 130') + '"/>' +
            '<path class="exd__area" d="' + areaPath + '"/>' +
            '<path class="exd__line" pathLength="100" d="' + linePath + '"/>' +
            '<circle class="exd__glow" r="13" cx="' + pts[0][0] + '" cy="' + pts[0][1] + '"/>' +
            '<circle class="exd__dot" r="5.5" cx="' + pts[0][0] + '" cy="' + pts[0][1] + '"/>' +
          '</svg>' +
          '<div class="oosd__legend"><span class="lg lg--red">без связки</span><span class="lg lg--lime">все агенты вместе</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="exd__agents">' + agentsHtml + '</div>' +
        '<div class="exd__result">' + ICONS.bolt + '<span>' + esc(cfg.result) + '</span></div>' +
      '</div>'
    );

    var elNum = root.querySelector('.exd__goalnum');
    var elDelta = root.querySelector('.exd__goaldelta');
    var elLine = root.querySelector('.exd__line');
    var elDot = root.querySelector('.exd__dot');
    var elGlow = root.querySelector('.exd__glow');
    var agentEls = [].slice.call(root.querySelectorAll('.exd__agent'));
    var actEls = agentEls.map(function (a) { return a.querySelector('.exd__aact'); });
    var metricEls = agentEls.map(function (a) { return a.querySelector('.exd__ametric'); });
    var fillEls = agentEls.map(function (a) { return a.querySelector('.exd__afill'); });

    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function ptAt(f) {
      var seg = (pts.length - 1) * Math.max(0, Math.min(1, f));
      var i = Math.min(pts.length - 2, Math.floor(seg));
      var k = seg - i;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    var drawStart = 0.08, drawEnd = 0.95;

    function apply(t) {
      var f = Math.max(0, Math.min(1, (t - drawStart) / (drawEnd - drawStart)));
      var ease = 1 - (1 - f) * (1 - f);
      // Итоговая метрика
      var v = cfg.goal.from + (cfg.goal.to - cfg.goal.from) * ease;
      elNum.textContent = fmt(Math.round(v / (cfg.goal.step || 1)) * (cfg.goal.step || 1)) + (cfg.goal.suffix || '');
      var d = cfg.goal.delta === 'abs' ? (v - cfg.goal.from) : (v / cfg.goal.from - 1) * 100;
      elDelta.textContent = '+' + Math.round(d) + deltaSuffix;
      // Линия и бегущая точка
      elLine.style.strokeDashoffset = 100 * (1 - ease);
      var pt = ptAt(ease);
      elDot.setAttribute('cx', pt[0]); elDot.setAttribute('cy', pt[1]);
      elGlow.setAttribute('cx', pt[0]); elGlow.setAttribute('cy', pt[1]);
      // Агенты
      cfg.agents.forEach(function (a, i) {
        var act = a.actions[a.actions.length - 1];
        for (var j = 0; j < a.actions.length; j++) { if (t < a.actions[j].until) { act = a.actions[j]; break; } }
        if (actEls[i].textContent !== act.text) actEls[i].textContent = act.text;
        if (metricEls[i] && act.metric != null && metricEls[i].textContent !== act.metric) metricEls[i].textContent = act.metric;
        fillEls[i].style.width = Math.round(act.val * 100) + '%';
        agentEls[i].classList.toggle('is-on', act.val > 0.05);
      });
      // Финальная синхронизация — ВАУ-момент
      root.classList.toggle('is-synced', t >= 0.9);
      root.querySelector('.exd__result').style.opacity = t >= 0.82 ? 1 : 0;
    }

    demoRunner(root, apply, cfg.period || 10000);
    return root;
  }

  var EXPERT_DEMOS = {
    expert_orders: {
      goal: { label: 'Заказы за неделю', from: 320, to: 690, delta: 'pct' },
      result: 'Заказы растут стабильно — все агенты тянут в одну сторону',
      agents: [
        { tone: 'price', ctrl: 'Цена', actions: [
          { until: 0.18, text: 'Анализ спроса по просмотрам…', metric: '990 ₽', val: 0.15 },
          { until: 0.42, text: 'Просмотры упали → цена −2%', metric: '970 ₽', val: 0.5 },
          { until: 0.66, text: 'Зависшие корзины → −2% на 3 дня', metric: '950 ₽', val: 0.75 },
          { until: 0.9, text: 'Держит доступную цену', metric: '950 ₽', val: 0.92 },
          { until: 1.01, text: 'Цена настроена на максимум заказов', metric: '950 ₽', val: 1 },
        ] },
        { tone: 'ads', ctrl: 'ДРР', actions: [
          { until: 0.2, text: 'Проверка позиций…', metric: '26%', val: 0.18 },
          { until: 0.46, text: 'Позиция №7 → ставка +10%', metric: '22%', val: 0.55 },
          { until: 0.72, text: 'В ТОП-3 · ставка держится', metric: '18%', val: 0.82 },
          { until: 1.01, text: 'Чистит пустые кластеры', metric: '15%', val: 1 },
        ] },
        { tone: 'comm', ctrl: 'Ответы', actions: [
          { until: 0.22, text: 'Новый вопрос о товаре', metric: '1', val: 0.2 },
          { until: 0.48, text: 'Ответ + призыв к заказу', metric: '9', val: 0.55 },
          { until: 0.72, text: 'Нет в наличии → замена', metric: '18', val: 0.82 },
          { until: 1.01, text: 'Сомнение снято → заказ', metric: '27', val: 1 },
        ] },
        { tone: 'data', ctrl: 'Отчёт', actions: [
          { until: 0.58, text: 'Ожидание данных за неделю…', metric: 'ждёт', val: 0.1 },
          { until: 0.82, text: 'Связка цены и рекламы: +18% заказов', metric: 'анализ', val: 0.7 },
          { until: 1.01, text: 'Отчёт готов · 5 точек роста', metric: 'готов', val: 1 },
        ] },
      ],
    },
    expert_margin: {
      goal: { label: 'Прибыль за неделю', from: 180000, to: 320000, step: 1000, suffix: ' ₽', delta: 'pct' },
      result: 'Прибыль растёт — все агенты работают на маржу, а не только на оборот',
      pts: [[30, 130], [130, 124], [230, 114], [330, 96], [430, 72], [520, 50], [590, 34]],
      agents: [
        { tone: 'price', ctrl: 'Маржа', actions: [
          { until: 0.2, text: 'Тест цены: +2% на 7 дней…', metric: '22%', val: 0.2 },
          { until: 0.44, text: 'Маржа выросла → ещё +2%', metric: '25%', val: 0.55 },
          { until: 0.68, text: 'Точка максимума маржи найдена', metric: '28%', val: 0.82 },
          { until: 1.01, text: 'Неликвид распродан, деньги в обороте', metric: '30%', val: 1 },
        ] },
        { tone: 'ads', ctrl: 'CPO', actions: [
          { until: 0.22, text: 'Уходим с дорогого ТОП-1…', metric: '210 ₽', val: 0.25 },
          { until: 0.46, text: 'Мин. рабочая позиция · ДРР ↓', metric: '170 ₽', val: 0.6 },
          { until: 0.72, text: 'CPO в пределах 50% маржи', metric: '140 ₽', val: 0.85 },
          { until: 1.01, text: 'Пустые кластеры отключены', metric: '130 ₽', val: 1 },
        ] },
        { tone: 'comm', ctrl: 'Допродажи', actions: [
          { until: 0.24, text: 'Вопрос покупателя', metric: '0', val: 0.2 },
          { until: 0.48, text: 'Кросс-продажа с аргументом', metric: '3', val: 0.58 },
          { until: 0.72, text: 'Допродажа оформлена', metric: '7', val: 0.82 },
          { until: 1.01, text: 'Негатив закрыт без скидок', metric: '11', val: 1 },
        ] },
        { tone: 'data', ctrl: 'Отчёт', actions: [
          { until: 0.58, text: 'Сводим прибыль за неделю…', metric: 'ждёт', val: 0.1 },
          { until: 0.82, text: 'Маржинальность +6 п.п.', metric: '+6 п.п.', val: 0.7 },
          { until: 1.01, text: 'Отчёт по прибыли готов', metric: 'готов', val: 1 },
        ] },
      ],
    },
    expert_stock: {
      goal: { label: 'Товаров в норме, из 100', from: 58, to: 94, delta: 'abs' },
      result: 'Сток здоровый: ходовое в наличии, неликвид распродаётся',
      agents: [
        { tone: 'price', ctrl: 'Цена', actions: [
          { until: 0.2, text: 'Дефицит → цена +5%', metric: '+5%', val: 0.3 },
          { until: 0.44, text: 'Неликвид −10% лесенкой', metric: '−10%', val: 0.6 },
          { until: 0.68, text: 'Здоровый сток не трогаем', metric: 'РРЦ', val: 0.85 },
          { until: 1.01, text: 'Спрос выровнен по остаткам', metric: 'баланс', val: 1 },
        ] },
        { tone: 'ads', ctrl: 'Ставка', actions: [
          { until: 0.22, text: 'Мало остатка → ставка −50%', metric: '−50%', val: 0.3 },
          { until: 0.46, text: 'Критично → пауза кампании', metric: 'пауза', val: 0.55 },
          { until: 0.72, text: 'Затоварено → разгон +10%', metric: '+10%', val: 0.85 },
          { until: 1.01, text: 'Реклама следует за складом', metric: 'следит', val: 1 },
        ] },
        { tone: 'comm', ctrl: 'Замены', actions: [
          { until: 0.24, text: 'Нет в наличии → замена', metric: '0', val: 0.3 },
          { until: 0.5, text: 'Кросс-продажа с большим запасом', metric: '4', val: 0.62 },
          { until: 0.75, text: 'Заказ сохранён', metric: '9', val: 0.85 },
          { until: 1.01, text: 'Продажи не потеряны', metric: '12', val: 1 },
        ] },
        { tone: 'data', ctrl: 'Прогноз', actions: [
          { until: 0.58, text: 'Прогноз остатков на 30 дней…', metric: 'ждёт', val: 0.15 },
          { until: 0.82, text: 'Риски дефицита и затоваривания', metric: 'риски', val: 0.7 },
          { until: 1.01, text: 'План поставок готов', metric: 'план', val: 1 },
        ] },
      ],
    },
    expert_launch: {
      goal: { label: 'Заказы новинки · цель 100', from: 8, to: 100, delta: 'abs' },
      result: 'Новинка быстро набирает заказы, отзывы и позиции',
      pts: [[30, 138], [130, 130], [230, 116], [330, 94], [430, 66], [520, 42], [590, 26]],
      agents: [
        { tone: 'price', ctrl: 'Цена', actions: [
          { until: 0.2, text: 'Старт −5% к РРЦ', metric: '−5%', val: 0.25 },
          { until: 0.46, text: 'Дожим корзин −2%', metric: '−7%', val: 0.55 },
          { until: 0.72, text: '100 заказов → возврат к РРЦ', metric: 'РРЦ', val: 0.9 },
          { until: 1.01, text: 'Разгон завершён', metric: 'РРЦ', val: 1 },
        ] },
        { tone: 'ads', ctrl: 'ДРР', actions: [
          { until: 0.22, text: 'Режим разгона · ДРР 30%', metric: '30%', val: 0.3 },
          { until: 0.48, text: 'Ставка +10% для видимости', metric: '28%', val: 0.62 },
          { until: 0.72, text: 'База набрана → ДРР 15%', metric: '15%', val: 0.85 },
          { until: 1.01, text: 'Переход в штатный режим', metric: '15%', val: 1 },
        ] },
        { tone: 'comm', ctrl: 'Отзывы', actions: [
          { until: 0.24, text: 'Первый вопрос о новинке', metric: '1', val: 0.22 },
          { until: 0.5, text: 'Тёплый ответ на 1-й отзыв', metric: '4', val: 0.58 },
          { until: 0.75, text: 'Продвигаем в ответах по каталогу', metric: '8', val: 0.82 },
          { until: 1.01, text: 'Репутация сформирована', metric: '11', val: 1 },
        ] },
        { tone: 'data', ctrl: 'Прогресс', actions: [
          { until: 0.58, text: 'Прогресс к 100 заказам и 10 отзывам…', metric: '12/100', val: 0.2 },
          { until: 0.82, text: '92 заказа · 11 отзывов', metric: '92/100', val: 0.8 },
          { until: 1.01, text: 'Новинка вышла в топ выдачи', metric: '100/100', val: 1 },
        ] },
      ],
    },
  };

  function buildDemo(cfg) {
    var m = cfg.metric;
    var suffix = m.money ? ' ₽' : (m.suffix ? (' ' + m.suffix) : '');
    var root = h(
      '<div class="oos-demo reveal"><div class="oosd__body">' +
        '<div class="oosd__chart"><svg viewBox="0 0 620 240" preserveAspectRatio="none">' +
          '<line class="oosd__base" x1="40" y1="200" x2="600" y2="200"/>' +
          '<path class="oosd__area" d="' + cfg.chart.area + '"/>' +
          '<path class="oosd__red" pathLength="100" d="' + cfg.chart.red + '"/>' +
          '<path class="oosd__lime" pathLength="100" d="' + cfg.chart.lime + '"/>' +
          (cfg.chart.oos ? '<g class="oosd__oos"><circle cx="' + cfg.chart.oos.cx + '" cy="' + cfg.chart.oos.cy + '" r="6"/><text x="' + cfg.chart.oos.cx + '" y="' + (cfg.chart.oos.cy + 22) + '">' + esc(cfg.chart.oos.text) + '</text></g>' : '') +
          (cfg.chart.ok ? '<g class="oosd__ok"><circle cx="' + cfg.chart.ok.cx + '" cy="' + cfg.chart.ok.cy + '" r="7"/></g>' : '') +
        '</svg>' +
        '<div class="oosd__legend"><span class="lg lg--red">' + esc(cfg.chart.redLabel || 'без агента') + '</span><span class="lg lg--lime">' + esc(cfg.chart.limeLabel || 'с Дживио') + '</span></div>' +
        '</div>' +
        '<div class="oosd__side">' +
          '<div class="oosd__stock"><span class="oosd__k">' + esc(m.label) + '</span><b><span class="oosd__num"></span>' + suffix + '</b>' +
            (m.max ? '<div class="oosd__track"><span class="oosd__fill"></span></div>' : '') + '</div>' +
          (cfg.price ? '<div class="oosd__row"><span class="oosd__k">' + esc(cfg.price.label) + '</span><span class="oosd__price"></span></div>' : '') +
          '<div class="oosd__row"><span class="oosd__k">Статус</span><span class="oosd__status"></span></div>' +
          '<div class="oosd__result">' + ICONS.check + '<span>' + esc(cfg.result) + '</span></div>' +
        '</div></div></div>'
    );

    var elNum = root.querySelector('.oosd__num');
    var elFill = root.querySelector('.oosd__fill');
    var elPrice = root.querySelector('.oosd__price');
    var elStatus = root.querySelector('.oosd__status');
    var elResult = root.querySelector('.oosd__result');
    var elRed = root.querySelector('.oosd__red');
    var elLime = root.querySelector('.oosd__lime');
    var elArea = root.querySelector('.oosd__area');
    var elOos = root.querySelector('.oosd__oos');
    var elOk = root.querySelector('.oosd__ok');

    function pw(t, pts) {
      for (var i = 0; i < pts.length - 1; i++) {
        if (t >= pts[i][0] && t <= pts[i + 1][0]) {
          var k = (t - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
          return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
        }
      }
      return pts[pts.length - 1][1];
    }
    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    var step = m.step || 1;
    function inRange(t, r) { return r && t >= r[0] && t < r[1]; }

    function apply(t) {
      var v = pw(t, m.pts);
      elNum.textContent = fmt(Math.round(v / step) * step);
      if (elFill && m.max) {
        elFill.style.width = Math.max(4, Math.min(100, v / m.max * 100)) + '%';
        elFill.className = 'oosd__fill' + (inRange(t, m.danger) ? ' is-danger' : '');
      }
      if (elPrice && cfg.price) elPrice.textContent = fmt(pw(t, cfg.price.pts)) + (cfg.price.suffix || ' ₽');
      var s = cfg.statuses[cfg.statuses.length - 1];
      for (var i = 0; i < cfg.statuses.length; i++) { if (t < cfg.statuses[i].until) { s = cfg.statuses[i]; break; } }
      elStatus.textContent = s.text;
      elStatus.className = 'oosd__status oosd__status--' + s.tone;
      var drawT = Math.max(0, Math.min(1, t / (cfg.chart.drawUntil || 0.5)));
      var off = 100 * (1 - drawT);
      elRed.style.strokeDashoffset = off; elLime.style.strokeDashoffset = off;
      elArea.style.opacity = drawT >= 1 ? 0.9 : (drawT * 0.9);
      if (elOos) elOos.style.opacity = inRange(t, cfg.chart.oos.range) ? 1 : 0;
      if (elOk) elOk.style.opacity = (t >= cfg.chart.ok.from) ? 1 : 0;
      elResult.style.opacity = (t >= (cfg.resultFrom || 0.78)) ? 1 : 0;
    }

    demoRunner(root, apply, cfg.period);
    return root;
  }

  // Конфиги демо для уроков ценообразования
  var DEMOS = {
    price_master: {
      metric: { label: 'Цена товара', pts: [[0, 990], [0.14, 990], [0.17, 1010], [0.34, 1010], [0.37, 1040], [0.54, 1040], [0.58, 990], [0.72, 990], [0.75, 970], [0.87, 970], [0.9, 990], [1, 990]], money: true },
      price: { label: 'Запас на складе', pts: [[0, 25], [0.36, 14], [0.52, 6], [0.58, 45], [1, 45]], suffix: ' дн' },
      statuses: [
        { until: 0.15, text: 'Всё спокойно · цена РРЦ', tone: 'n' },
        { until: 0.35, text: 'Просмотры выросли · цена +2%', tone: 'l' },
        { until: 0.55, text: 'Запас тает · контроль остатка +5%', tone: 'd' },
        { until: 0.73, text: 'Поставка пришла · возврат к РРЦ', tone: 'ok' },
        { until: 0.88, text: 'Корзины зависли · временно −2%', tone: 'l' },
        { until: 1.01, text: 'Корзины выкуплены · цена РРЦ', tone: 'ok' },
      ],
      chart: {
        redLabel: 'вручную', limeLabel: 'с агентом',
        red: 'M40 120 C200 124 400 132 600 138',
        lime: 'M40 120 L130 120 L130 106 L230 106 L230 84 L330 84 L330 120 L430 120 L430 134 L520 134 L520 120 L600 120',
        area: 'M40 120 L130 120 L130 106 L230 106 L230 84 L330 84 L330 120 L430 120 L430 134 L520 134 L520 120 L600 120 L600 200 L40 200 Z',
        ok: { cx: 600, cy: 120, from: 0.9 }, drawUntil: 0.6,
      },
      result: 'Все сценарии работают вместе: цена сама реагирует на спрос, склад и корзины',
    },
    ad_master: {
      metric: { label: 'ДРР кампании', pts: [[0, 22], [0.3, 22], [0.55, 14], [0.75, 12], [1, 12]], max: 30, suffix: '%', danger: [0, 0.3] },
      price: { label: 'Ставка', pts: [[0, 60], [0.2, 54], [0.4, 48], [0.6, 52], [1, 52]] },
      statuses: [
        { until: 0.2, text: 'ДРР выше цели · ставка вниз', tone: 'd' },
        { until: 0.45, text: 'Чистка кластеров без заказов', tone: 'l' },
        { until: 0.65, text: 'Позиция в ТОП-3 · держим', tone: 'l' },
        { until: 0.85, text: 'ДРР в норме · экономим', tone: 'ok' },
        { until: 1.01, text: 'Работает 24/7 по правилам', tone: 'ok' },
      ],
      chart: {
        redLabel: 'вручную', limeLabel: 'с агентом',
        red: 'M40 90 C200 88 400 92 600 90',
        lime: 'M40 90 C180 104 340 140 600 152',
        area: 'M40 90 C180 104 340 140 600 152 L600 200 L40 200 Z',
        ok: { cx: 600, cy: 152, from: 0.7 }, drawUntil: 0.55,
      },
      result: 'Реклама держит позицию и экономику сама — по вашим правилам',
    },
    setup: {
      metric: { label: 'Товаров под управлением', pts: [[0, 0], [0.25, 0], [0.75, 320], [1, 320]], max: 320, suffix: 'шт' },
      statuses: [{ until: 0.28, text: 'Настройка правил', tone: 'n' }, { until: 0.72, text: 'Запуск агента', tone: 'l' }, { until: 1.01, text: 'Агент управляет ценой', tone: 'ok' }],
      chart: { redLabel: 'вручную', red: 'M40 176 C200 172 400 178 600 174', lime: 'M40 190 C170 150 300 96 600 70', area: 'M40 190 C170 150 300 96 600 70 L600 200 L40 200 Z', ok: { cx: 600, cy: 70, from: 0.7 }, drawUntil: 0.6 },
      result: 'Единые правила ценообразования, маржа под защитой',
    },
    competitor: {
      metric: { label: 'Ваши просмотры/день', pts: [[0, 850], [0.5, 880], [1, 870]], max: 1000 },
      price: { label: 'Ваша цена', pts: [[0, 1290], [1, 1290]] },
      statuses: [{ until: 0.3, text: 'Конкурент снизил цену', tone: 'd' }, { until: 0.6, text: 'Просмотры не упали', tone: 'l' }, { until: 1.01, text: 'Цену держим — демпинг не нужен', tone: 'ok' }],
      chart: { redLabel: 'цена конкурента', limeLabel: 'ваши просмотры', red: 'M40 70 C200 110 380 160 600 178', lime: 'M40 92 C200 88 400 90 600 86', area: 'M40 92 C200 88 400 90 600 86 L600 200 L40 200 Z', oos: { cx: 360, cy: 150, text: 'конкурент −15%', range: [0.3, 0.72] }, ok: { cx: 600, cy: 86, from: 0.6 }, drawUntil: 0.5 },
      result: 'Просмотры не упали — цену не снижаем, маржа сохранена',
    },
    elasticity: {
      metric: { label: 'Выручка/день', pts: [[0, 120000], [0.3, 120000], [0.7, 178000], [1, 182000]], max: 200000, money: true, step: 1000 },
      price: { label: 'Цена', pts: [[0, 890], [0.35, 890], [0.7, 1140], [1, 1140]] },
      statuses: [{ until: 0.3, text: 'Цена наугад', tone: 'n' }, { until: 0.7, text: 'Дживио ищет оптимум', tone: 'l' }, { until: 1.01, text: 'Найдена точка максимума', tone: 'ok' }],
      chart: { redLabel: 'наугад', red: 'M40 150 C200 148 400 152 600 150', lime: 'M40 150 C180 120 320 84 460 76 C520 74 560 78 600 80', area: 'M40 150 C180 120 320 84 460 76 C520 74 560 78 600 80 L600 200 L40 200 Z', ok: { cx: 600, cy: 80, from: 0.7 }, drawUntil: 0.55 },
      result: 'Цена в точке максимума заказов и выручки',
    },
    promo: {
      metric: { label: 'Маржа в акции', pts: [[0, 18], [0.4, 15], [0.7, 20], [1, 21]], max: 25, suffix: '%' },
      price: { label: 'Акционная цена', pts: [[0, 990], [0.4, 890], [0.7, 890], [0.78, 990], [1, 990]] },
      statuses: [{ until: 0.3, text: 'Оценка акции', tone: 'n' }, { until: 0.62, text: 'Вошли в выгодную акцию', tone: 'l' }, { until: 1.01, text: 'Убыточные — пропускаем', tone: 'ok' }],
      chart: { redLabel: 'без контроля', red: 'M40 90 C200 140 340 200 600 150', lime: 'M40 90 C200 110 340 120 600 96', area: 'M40 90 C200 110 340 120 600 96 L600 200 L40 200 Z', oos: { cx: 350, cy: 196, text: 'убыток', range: [0.3, 0.7] }, ok: { cx: 600, cy: 96, from: 0.6 }, drawUntil: 0.5 },
      result: 'Участвуем только в выгодных акциях — без просадки маржи',
    },
    niceprice: {
      metric: { label: 'Цена на витрине', pts: [[0, 1023], [0.35, 1023], [0.5, 990], [1, 990]], money: true },
      statuses: [{ until: 0.35, text: 'Пересчёт: 1 023 ₽', tone: 'n' }, { until: 0.6, text: 'Дживио округляет', tone: 'l' }, { until: 1.01, text: 'Красивая цена: 990 ₽', tone: 'ok' }],
      chart: { redLabel: 'без округления', red: 'M40 110 C200 108 400 112 600 110', lime: 'M40 110 C170 110 210 150 330 150 C430 150 470 168 600 168', area: 'M40 110 C170 110 210 150 330 150 C430 150 470 168 600 168 L600 200 L40 200 Z', ok: { cx: 600, cy: 168, from: 0.5 }, drawUntil: 0.5 },
      result: 'Цены всегда красивые: 990, 1 790, 1 990 ₽',
    },
    drr: {
      metric: { label: 'ДРР', pts: [[0, 22], [0.3, 22], [0.75, 13], [1, 12]], max: 30, suffix: '%', danger: [0, 0.3] },
      price: { label: 'Цена', pts: [[0, 990], [0.3, 990], [0.75, 1080], [1, 1080]] },
      statuses: [{ until: 0.3, text: 'ДРР выше цели', tone: 'd' }, { until: 0.75, text: 'Поднимаем цену на 1%/день', tone: 'l' }, { until: 1.01, text: 'ДРР в норме', tone: 'ok' }],
      chart: { redLabel: 'без контроля', red: 'M40 90 C200 88 400 92 600 90', lime: 'M40 90 C200 100 380 130 600 140', area: 'M40 90 C200 100 380 130 600 140 L600 200 L40 200 Z', ok: { cx: 600, cy: 140, from: 0.7 }, drawUntil: 0.55 },
      result: 'ДРР под контролем, маржа растёт без обвала заказов',
    },
    carts: {
      metric: { label: 'Неоплаченные корзины', pts: [[0, 320], [0.3, 320], [0.7, 90], [1, 60]], max: 350, suffix: 'шт', danger: [0, 0.3] },
      price: { label: 'Цена', pts: [[0, 1290], [0.35, 1290], [0.5, 1190], [0.8, 1190], [0.86, 1290], [1, 1290]] },
      statuses: [{ until: 0.3, text: 'Корзины без заказа', tone: 'd' }, { until: 0.7, text: 'Дживио снизил цену', tone: 'l' }, { until: 1.01, text: 'Корзины реализованы', tone: 'ok' }],
      chart: { redLabel: 'без агента', red: 'M40 74 C200 72 400 76 600 74', lime: 'M40 74 C180 96 300 140 600 186', area: 'M40 74 C180 96 300 140 600 186 L600 200 L40 200 Z', oos: { cx: 300, cy: 140, text: 'висят', range: [0.3, 0.7] }, ok: { cx: 600, cy: 186, from: 0.7 }, drawUntil: 0.55 },
      result: 'Накопленные корзины превратились в заказы',
    },
    realtime: {
      metric: { label: 'Отклонение от цели', pts: [[0, 14], [0.3, 14], [0.7, 2], [1, 1]], max: 20, suffix: '%', danger: [0, 0.3] },
      price: { label: 'Цена', pts: [[0, 990], [0.2, 1010], [0.4, 980], [0.6, 1002], [0.8, 995], [1, 997]] },
      statuses: [{ until: 0.3, text: 'Обновление каждые 15 мин', tone: 'n' }, { until: 0.7, text: 'Агент подстраивает на лету', tone: 'l' }, { until: 1.01, text: 'Держит цель 24/7', tone: 'ok' }],
      chart: { redLabel: 'без реалтайма', red: 'M40 96 C200 94 400 120 600 132', lime: 'M40 96 C200 110 380 168 600 190', area: 'M40 96 C200 110 380 168 600 190 L600 200 L40 200 Z', ok: { cx: 600, cy: 190, from: 0.7 }, drawUntil: 0.55 },
      result: 'Цена держит цель круглосуточно, без ручного контроля',
    },

    // ---- Реклама ----
    ad_top: {
      metric: { label: 'Показы в ТОП', pts: [[0, 20], [0.3, 20], [0.7, 88], [1, 92]], max: 100, suffix: '%' },
      price: { label: 'Ставка', pts: [[0, 45], [0.3, 45], [0.7, 72], [1, 72]] },
      statuses: [{ until: 0.3, text: 'Вне ТОП', tone: 'n' }, { until: 0.7, text: 'Занимаем позицию', tone: 'l' }, { until: 1.01, text: 'В ТОП по выгодной ставке', tone: 'ok' }],
      chart: { redLabel: 'без агента', red: 'M40 176 C200 174 400 178 600 176', lime: 'M40 178 C180 150 320 96 600 72', area: 'M40 178 C180 150 320 96 600 72 L600 200 L40 200 Z', ok: { cx: 600, cy: 72, from: 0.7 }, drawUntil: 0.55 },
      result: 'В ТОП по минимально достаточной ставке — без переплат',
    },
    ad_minpos: {
      metric: { label: 'Клики в день', pts: [[0, 140], [0.5, 142], [1, 145]], max: 200 },
      price: { label: 'Ставка за клик', pts: [[0, 90], [0.3, 90], [0.7, 34], [1, 32]] },
      statuses: [{ until: 0.3, text: 'Топ-1 любой ценой', tone: 'n' }, { until: 0.7, text: 'Ищем мин. рабочую позицию', tone: 'l' }, { until: 1.01, text: 'Трафик тот же, ставка ×3 ниже', tone: 'ok' }],
      chart: { redLabel: 'топ-1', limeLabel: 'мин. позиция', red: 'M40 78 C200 76 400 80 600 78', lime: 'M40 78 C180 110 320 150 600 172', area: 'M40 78 C180 110 320 150 600 172 L600 200 L40 200 Z', ok: { cx: 600, cy: 172, from: 0.7 }, drawUntil: 0.55 },
      result: 'Тот же трафик при ставке в 2–3 раза ниже',
    },
    ad_drr: {
      metric: { label: 'ДРР кампании', pts: [[0, 24], [0.3, 24], [0.7, 14], [1, 13]], max: 30, suffix: '%', danger: [0, 0.3] },
      price: { label: 'Расход в день', pts: [[0, 3200], [0.35, 3200], [0.7, 2100], [1, 2100]], step: 100 },
      statuses: [{ until: 0.3, text: 'ДРР выше порога', tone: 'd' }, { until: 0.7, text: 'Урезаем кампании', tone: 'l' }, { until: 1.01, text: 'ДРР в норме', tone: 'ok' }],
      chart: { redLabel: 'без контроля', red: 'M40 88 C200 86 400 90 600 88', lime: 'M40 88 C200 98 380 128 600 140', area: 'M40 88 C200 98 380 128 600 140 L600 200 L40 200 Z', ok: { cx: 600, cy: 140, from: 0.7 }, drawUntil: 0.55 },
      result: 'Реклама не съедает больше заданного порога ДРР',
    },
    ad_launch: {
      metric: { label: 'Заказы новинки', pts: [[0, 4], [0.3, 4], [0.7, 42], [1, 48]], max: 60 },
      price: { label: 'ДРР разгона', pts: [[0, 15], [0.2, 32], [0.7, 32], [0.85, 16], [1, 16]], suffix: ' %' },
      statuses: [{ until: 0.3, text: 'Старт новинки', tone: 'n' }, { until: 0.72, text: 'Разгон: повышенный ДРР', tone: 'l' }, { until: 1.01, text: 'Набрала заказы и отзывы', tone: 'ok' }],
      chart: { redLabel: 'без разгона', red: 'M40 180 C200 178 400 182 600 180', lime: 'M40 186 C160 150 300 96 460 80 C520 76 560 80 600 78', area: 'M40 186 C160 150 300 96 460 80 C520 76 560 80 600 78 L600 200 L40 200 Z', ok: { cx: 600, cy: 78, from: 0.72 }, drawUntil: 0.55 },
      result: 'Новинка быстро набрала заказы, отзывы и позиции',
    },
    ad_stock: {
      metric: { label: 'Остаток на складе', pts: [[0, 90], [0.4, 22], [0.62, 18], [0.68, 200], [1, 200]], max: 200, suffix: 'шт', danger: [0.35, 0.62] },
      statuses: [{ until: 0.35, text: 'Реклама разгоняет продажи', tone: 'n' }, { until: 0.62, text: 'Низкий остаток — реклама на паузе', tone: 'd' }, { until: 1.01, text: 'Поставка — реклама включена', tone: 'ok' }],
      chart: { redLabel: 'без стопа', red: 'M40 74 C150 130 250 196 320 200', lime: 'M40 74 C150 128 240 170 320 176 C380 180 430 176 470 150 C500 130 550 122 600 108', area: 'M40 74 C150 128 240 170 320 176 C380 180 430 176 470 150 C500 130 550 122 600 108 L600 200 L40 200 Z', oos: { cx: 320, cy: 200, text: 'OOS', range: [0.4, 0.9] }, ok: { cx: 600, cy: 108, from: 0.62 }, drawUntil: 0.5 },
      result: 'Товар не ушёл в OOS, реклама включилась после поставки',
    },
    ad_daypart: {
      metric: { label: 'ДРР', pts: [[0, 18], [0.3, 18], [0.7, 12], [1, 11]], max: 25, suffix: '%' },
      price: { label: 'Ставка сейчас', pts: [[0, 60], [0.25, 30], [0.5, 70], [0.75, 28], [1, 55]] },
      statuses: [{ until: 0.3, text: 'Ставки одинаковые 24/7', tone: 'n' }, { until: 0.7, text: 'Снижаем в слабые часы', tone: 'l' }, { until: 1.01, text: 'Бюджет — в эффективные часы', tone: 'ok' }],
      chart: { redLabel: 'без расписания', red: 'M40 92 C200 90 400 94 600 92', lime: 'M40 92 C200 104 380 132 600 146', area: 'M40 92 C200 104 380 132 600 146 L600 200 L40 200 Z', ok: { cx: 600, cy: 146, from: 0.7 }, drawUntil: 0.55 },
      result: 'Бюджет тратится в часы, когда он окупается',
    },
    ad_promo: {
      metric: { label: 'Заказы в день', pts: [[0, 50], [0.35, 50], [0.6, 86], [0.8, 86], [1, 80]], max: 100 },
      price: { label: 'Ставка', pts: [[0, 50], [0.4, 80], [0.75, 80], [0.82, 50], [1, 50]] },
      statuses: [{ until: 0.35, text: 'Старт акции', tone: 'n' }, { until: 0.62, text: 'Усилили ставки — конверсия выше', tone: 'l' }, { until: 1.01, text: 'После акции ставки вернулись', tone: 'ok' }],
      chart: { redLabel: 'без усиления', red: 'M40 130 C200 128 400 132 600 130', lime: 'M40 130 C180 100 320 78 430 76 C500 76 540 96 600 108', area: 'M40 130 C180 100 320 78 430 76 C500 76 540 96 600 108 L600 200 L40 200 Z', ok: { cx: 600, cy: 108, from: 0.62 }, drawUntil: 0.5 },
      result: 'Акции принесли больше заказов, ставки не остались задранными',
    },
    ad_cpo: {
      metric: { label: 'CPO (стоимость заказа)', pts: [[0, 320], [0.3, 320], [0.7, 180], [1, 175]], max: 400, money: true, step: 5, danger: [0, 0.3] },
      price: { label: 'Порог CPO от маржи', pts: [[0, 200], [1, 200]] },
      statuses: [{ until: 0.3, text: 'CPO по бенчмаркам', tone: 'n' }, { until: 0.7, text: 'CPO выводим из маржи', tone: 'l' }, { until: 1.01, text: 'Заказ окупается маржой', tone: 'ok' }],
      chart: { redLabel: 'бенчмарк', red: 'M40 84 C200 82 400 86 600 84', lime: 'M40 84 C200 100 380 132 600 146', area: 'M40 84 C200 100 380 132 600 146 L600 200 L40 200 Z', ok: { cx: 600, cy: 146, from: 0.7 }, drawUntil: 0.55 },
      result: 'Стоимость заказа окупается вашей маржой, а не чужими цифрами',
    },
    ad_realtime: {
      metric: { label: 'Отклонение ДРР от цели', pts: [[0, 12], [0.3, 12], [0.7, 2], [1, 1]], max: 20, suffix: '%', danger: [0, 0.3] },
      price: { label: 'Ставка', pts: [[0, 55], [0.2, 70], [0.4, 45], [0.6, 60], [0.8, 52], [1, 54]] },
      statuses: [{ until: 0.3, text: 'Данные каждые 15 мин', tone: 'n' }, { until: 0.7, text: 'Ставки на лету', tone: 'l' }, { until: 1.01, text: 'Держит ДРР 24/7', tone: 'ok' }],
      chart: { redLabel: 'без реалтайма', red: 'M40 96 C200 94 400 120 600 132', lime: 'M40 96 C200 110 380 168 600 190', area: 'M40 96 C200 110 380 168 600 190 L600 200 L40 200 Z', ok: { cx: 600, cy: 190, from: 0.7 }, drawUntil: 0.55 },
      result: 'Реклама держит цель круглосуточно, реагирует за минуты',
    },
  };

  // ---------- Видео-блок ----------
  function videoBlock(video, title) {
    video = video || { type: 'none' };
    var inner;
    if (video.type === 'youtube') {
      inner = '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(video.src) + '" title="' + esc(title) +
        '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    } else if (video.type === 'vimeo') {
      inner = '<iframe src="https://player.vimeo.com/video/' + esc(video.src) + '" title="' + esc(title) +
        '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    } else if (video.type === 'file') {
      inner = '<video controls preload="metadata"' + (video.poster ? ' poster="' + esc(video.poster) + '"' : '') +
        '><source src="' + esc(video.src) + '"></video>';
    } else {
      inner = '<div class="video-placeholder">' +
        '<div class="play">' + ICONS.play + '</div>' +
        '<h4>Видео появится позже</h4>' +
        '<p>Добавьте ссылку на видео в content.js — оно встроится сюда автоматически.</p>' +
      '</div>';
    }
    var block = h('<div class="video-block reveal"><div class="video-frame">' + inner + '</div></div>');
    var cap = video.type === 'none'
      ? 'К этому процессу пока не привязано видео.'
      : 'Посмотрите короткое видео, затем примените шаги ниже.';
    block.appendChild(h('<div class="video-cap"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><span>' + cap + '</span></div>'));
    return block;
  }

  // ---------- Хлебные крошки ----------
  function crumbs(items) {
    var html = '<nav class="crumbs">';
    items.forEach(function (it, i) {
      if (i) html += '<span class="sep">/</span>';
      html += it[1] ? '<a href="' + it[1] + '">' + esc(it[0]) + '</a>' : '<span>' + esc(it[0]) + '</span>';
    });
    return h(html + '</nav>');
  }

  // ============================================================
  // Роутинг
  // ============================================================
  function currentRoute() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'p' && parts[1] && parts[2]) return { name: 'process', dir: parts[1], proc: parts[2] };
    if (parts[0] === 'd' && parts[1]) return { name: 'direction', dir: parts[1] };
    return { name: 'home' };
  }

  function render() {
    var route = currentRoute();
    var main = document.getElementById('view');
    main.innerHTML = '';
    var content;

    if (route.name === 'direction') {
      var d = findDir(route.dir);
      content = d ? viewDirection(d) : viewHome();
    } else if (route.name === 'process') {
      var dd = findDir(route.dir);
      var pp = dd && findProc(dd, route.proc);
      content = (dd && pp) ? viewProcess(dd, pp) : (dd ? viewDirection(dd) : viewHome());
    } else {
      content = viewHome();
    }

    main.appendChild(content);
    // Тёмный премиум-режим для разделов с theme:'dark' (Экспертный уровень)
    var curDir = (route.name === 'direction' || route.name === 'process') ? findDir(route.dir) : null;
    var nowExpert = !!(curDir && curDir.theme === 'dark');
    document.body.classList.toggle('expert-mode', nowExpert);
    renderSidebar(route);
    updateGradeMini();
    if (nowExpert !== prevExpert) { sweepSidebar(nowExpert); prevExpert = nowExpert; }
    observeReveals();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ---------- Плавная перекраска сайдбара за текстом ----------
  // Вход в экспертный — заливка справа налево; выход — слева направо.
  var prevExpert = false;
  function sweepSidebar(toDark) {
    var sb = document.getElementById('sidebar');
    if (!sb) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || sb.getBoundingClientRect().width < 40) { // мобилка/reduced-motion — без анимации
      document.body.classList.toggle('sidebar-expert', toDark);
      return;
    }
    var sweep = document.createElement('div');
    sweep.className = 'px-sweep';
    sweep.style.background = toDark
      ? 'radial-gradient(120% 70% at 0% 0%, #2a1230 0%, #15181F 55%, #0a0b10 100%)'
      : 'var(--eggplant)';
    // старт: вход — видно у правого края (растёт влево); выход — у левого (растёт вправо)
    sweep.style.clipPath = toDark ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)';
    sb.appendChild(sweep);
    // запускаем анимацию в след. кадре, чтобы стартовое значение применилось
    requestAnimationFrame(function () { sweep.classList.add('px-sweep--go'); });
    setTimeout(function () { document.body.classList.toggle('sidebar-expert', toDark); }, 620);
    setTimeout(function () { if (sweep.parentNode) sweep.remove(); }, 760);
  }

  // ---------- Анимация появления ----------
  var io;
  function observeReveals() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.reveal').forEach(function (n) { n.classList.add('in'); });
      return;
    }
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(function (n, i) {
      n.style.transitionDelay = Math.min(i * 40, 240) + 'ms';
      io.observe(n);
    });
  }

  // ---------- Мобильное меню ----------
  function openMenu() { document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
  function closeMenu() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }

  // ---------- Поиск ----------
  var SEARCH_INDEX = null;
  function buildSearchIndex() {
    var items = [];
    allOrdered().forEach(function (d) {
      items.push({ kind: 'Модуль', title: d.title, hint: d.tagline || d.intro || '',
        blob: (d.title + ' ' + (d.tagline || '') + ' ' + (d.intro || '')).toLowerCase(),
        hash: '#/d/' + d.id, icon: d.icon });
      (d.processes || []).forEach(function (p) {
        var badgeBlob = p.badge ? (p.badge + ' лидеры лидер лидеров топ поставщики поставщиков лучшие практики') : '';
        items.push({ kind: 'Процесс', title: p.title, hint: d.title, badge: p.badge,
          blob: (p.title + ' ' + (p.summary || '') + ' ' + ((p.tags || []).join(' ')) + ' ' + badgeBlob + ' ' + d.title).toLowerCase(),
          hash: '#/p/' + d.id + '/' + p.id, icon: d.icon });
      });
    });
    return items;
  }
  function hi(text, q) {
    var i = text.toLowerCase().indexOf(q);
    if (i < 0 || !q) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  var searchActiveIdx = -1;
  function renderSearch(raw) {
    if (!SEARCH_INDEX) SEARCH_INDEX = buildSearchIndex();
    var box = document.getElementById('searchResults');
    var field = document.querySelector('.search-field');
    var q = (raw || '').trim().toLowerCase();
    field.classList.toggle('has-value', !!raw);
    searchActiveIdx = -1;
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    var terms = q.split(/\s+/).filter(Boolean);
    var res = SEARCH_INDEX.filter(function (it) {
      return terms.every(function (t) { return it.blob.indexOf(t) >= 0; });
    }).slice(0, 24);
    if (!res.length) { box.innerHTML = '<div class="sr-empty">Ничего не найдено</div>'; box.classList.add('show'); return; }
    box.innerHTML = res.map(function (it) {
      return '<button class="sr-item" data-hash="' + it.hash + '">' +
        '<img class="sr-ico" src="' + esc(it.icon) + '" alt="">' +
        '<span class="sr-body">' +
          '<span class="sr-title">' + hi(it.title, q) + '</span>' +
          '<span class="sr-hint"><span class="sr-kind">' + esc(it.kind) + '</span>' + (it.hint ? ' · ' + esc(it.hint) : '') + '</span>' +
        '</span>' +
        (it.badge ? '<span class="sr-lead' + (/обязательн/i.test(it.badge) ? ' sr-lead--must' : '') + '" title="' + esc(it.badge) + '">' +
          (/обязательн/i.test(it.badge)
            ? '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 2l2.9 6.2 6.6.9-4.8 4.7 1.2 6.7L12 17.3 6.1 20.5l1.2-6.7L2.5 9.1l6.6-.9z"/></svg>'
            : ICONS.crown) + '</span>' : '') +
        '<span class="sr-arrow">' + ICONS.arrow + '</span>' +
      '</button>';
    }).join('');
    box.classList.add('show');
    Array.prototype.forEach.call(box.querySelectorAll('.sr-item'), function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); goSearch(b.getAttribute('data-hash')); });
    });
  }
  function goSearch(hash) {
    location.hash = hash;
    var input = document.getElementById('search');
    input.value = ''; input.blur(); renderSearch(''); closeMenu();
  }
  function moveSearch(dir) {
    var box = document.getElementById('searchResults');
    var items = box.querySelectorAll('.sr-item');
    if (!items.length) return;
    searchActiveIdx = (searchActiveIdx + dir + items.length) % items.length;
    Array.prototype.forEach.call(items, function (n, i) { n.classList.toggle('is-active', i === searchActiveIdx); });
    items[searchActiveIdx].scrollIntoView({ block: 'nearest' });
  }
  function initSearch() {
    var input = document.getElementById('search');
    var clear = document.getElementById('searchClear');
    var box = document.getElementById('searchResults');
    if (!input) return;
    input.addEventListener('input', function () { renderSearch(input.value); });
    input.addEventListener('focus', function () { if (input.value.trim()) renderSearch(input.value); });
    input.addEventListener('blur', function () { setTimeout(function () { box.classList.remove('show'); }, 130); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
      else if (e.key === 'Enter') {
        var items = box.querySelectorAll('.sr-item');
        var pick = items[searchActiveIdx >= 0 ? searchActiveIdx : 0];
        if (pick) goSearch(pick.getAttribute('data-hash'));
      } else if (e.key === 'Escape') { input.value = ''; renderSearch(''); input.blur(); }
    });
    clear.addEventListener('click', function () { input.value = ''; renderSearch(''); input.focus(); });
  }

  // ---------- Тост ----------
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ---------- Инициализация ----------
  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('burger').addEventListener('click', openMenu);
    document.getElementById('scrim').addEventListener('click', closeMenu);
    document.querySelectorAll('.js-home').forEach(function (n) {
      n.addEventListener('click', function (e) { e.preventDefault(); location.hash = '#/'; closeMenu(); });
    });
    reorderProcesses();
    initSearch();
    render();
  });
})();
