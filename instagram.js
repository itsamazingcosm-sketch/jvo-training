/* ============================================================================
   ДЖИВИО · Instagram аналитика — приложение
   Подключение к Meta Graph API (вход через Instagram или Facebook),
   загрузка статистики аккаунта и видео, рендер графиков (SVG, без зависимостей).
   ============================================================================ */
(function () {
  'use strict';

  var V = 'v23.0';
  var STORE = 'jvo-ig-dash-v1';
  var C = {
    c1: '#8A2272', c2: '#E0569F', c3: '#5E8C13', c4: '#2F6FD6',
    ramp: ['#D493BF', '#BD67A6', '#A2418A', '#82206C', '#5E0C4D'],
    dim: '#D9D2D8', surface: '#FFFFFF'
  };
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    mode: null,            // 'live' | 'demo'
    token: null, base: null, igId: null, login: null,
    account: null, days: 30, kind: 'all', sort: 'views',
    acc: null,             // статистика аккаунта за период
    media: [],             // видео с метриками
    loadedAt: null
  };

  // ---------- Хранилище ----------
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function saveStore(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {} }

  // ---------- Форматирование ----------
  var nfFull = new Intl.NumberFormat('ru-RU');
  var nfCompact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
  function fmt(n) { if (n == null || isNaN(n)) return '—'; return Math.abs(n) >= 10000 ? nfCompact.format(n) : nfFull.format(Math.round(n)); }
  function fmtFull(n) { if (n == null || isNaN(n)) return '—'; return nfFull.format(Math.round(n)); }
  function fmtPct(x) { if (x == null || isNaN(x)) return '—'; return (Math.round(x * 10) / 10).toLocaleString('ru-RU') + '%'; }
  function fmtDate(d) { return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
  function fmtDateFull(d) { return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function fmtDur(ms) { if (ms == null || isNaN(ms)) return '—'; var s = Math.round(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' мин ' + (s % 60) + ' с' : s + ' с'; }
  function fmtTick(n) { if (Math.abs(n) >= 1000) return nfCompact.format(n); return String(Math.round(n)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function sum(a) { return a.reduce(function (s, x) { return s + (x || 0); }, 0); }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var m = v / p; var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * p; }
  function ext(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

  // ---------- Graph API ----------
  function api(base, path, params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(base + '/' + V + '/' + path + '?' + qs).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.error) { var e = new Error((j.error && j.error.message) || ('HTTP ' + r.status)); e.code = j.error && j.error.code; throw e; }
        return j;
      });
    });
  }
  function nil() { return null; }

  var ACC_FIELDS = 'id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography';

  // Пробуем токен Instagram Login, затем Facebook Login
  function connect(token) {
    return api('https://graph.instagram.com', 'me', { fields: 'user_id,' + ACC_FIELDS, access_token: token })
      .then(function (me) { return { base: 'https://graph.instagram.com', igId: 'me', account: me, login: 'instagram' }; })
      .catch(function (e1) {
        return api('https://graph.facebook.com', 'me/accounts', { fields: 'name,instagram_business_account{' + ACC_FIELDS + '}', limit: 50, access_token: token })
          .then(function (r) {
            var page = (r.data || []).filter(function (p) { return p.instagram_business_account; })[0];
            if (!page) throw new Error('у страниц Facebook этого токена нет привязанного Instagram-аккаунта');
            return { base: 'https://graph.facebook.com', igId: page.instagram_business_account.id, account: page.instagram_business_account, login: 'facebook' };
          })
          .catch(function (e2) { throw new Error('Не удалось подключиться. Instagram: ' + e1.message + ' · Facebook: ' + e2.message); });
      });
  }

  function series(r) {
    var d = r && r.data && r.data[0]; if (!d || !d.values) return null;
    return d.values.map(function (v) { return { t: new Date(v.end_time), v: typeof v.value === 'number' ? v.value : 0 }; });
  }
  function totals(r) {
    var o = {}; ((r && r.data) || []).forEach(function (d) { o[d.name] = d.total_value ? d.total_value.value : (d.values && d.values[0] ? d.values[0].value : null); }); return o;
  }
  function breakdown(r) {
    var d = r && r.data && r.data[0]; var b = d && d.total_value && d.total_value.breakdowns && d.total_value.breakdowns[0];
    if (!b) return null;
    return b.results.map(function (x) { return { label: x.dimension_values[0], value: x.value }; });
  }
  function onlineAvg(r) {
    var d = r && r.data && r.data[0]; if (!d || !d.values || !d.values.length) return null;
    var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
    var n = 0;
    d.values.forEach(function (v) { if (v.value && typeof v.value === 'object') { n++; for (var k in v.value) hours[+k] += v.value[k]; } });
    if (!n) return null;
    return hours.map(function (x, i) { return { label: i + ':00', value: Math.round(x / n) }; });
  }

  // Метрики total_value: одним запросом, при ошибке — по одной
  function totalsSafe(metrics, since, until) {
    var p = { period: 'day', metric_type: 'total_value', since: since, until: until, access_token: state.token };
    return api(state.base, state.igId + '/insights', ext(p, { metric: metrics.join(',') })).then(totals)
      .catch(function () {
        return Promise.all(metrics.map(function (m) {
          return api(state.base, state.igId + '/insights', ext(p, { metric: m })).then(totals).catch(function () { return {}; });
        })).then(function (parts) { return parts.reduce(function (o, x) { return ext(o, x); }, {}); });
      });
  }

  function loadAccount() {
    var until = Math.floor(Date.now() / 1000), since = until - state.days * 86400;
    var p = { access_token: state.token };
    var id = state.igId, base = state.base;
    function demog(br) {
      return api(base, id + '/insights', ext(p, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: br })).then(breakdown).catch(nil);
    }
    var keys = ['followers', 'reach', 'totals', 'age', 'gender', 'city', 'online'];
    return Promise.all([
      api(base, id + '/insights', ext(p, { metric: 'follower_count', period: 'day', since: since, until: until })).then(series).catch(nil),
      api(base, id + '/insights', ext(p, { metric: 'reach', period: 'day', since: since, until: until })).then(series).catch(nil),
      totalsSafe(['views', 'reach', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'profile_views'], since, until),
      demog('age'), demog('gender'), demog('city'),
      api(base, id + '/insights', ext(p, { metric: 'online_followers', period: 'lifetime', since: since, until: until })).then(onlineAvg).catch(nil)
    ]).then(function (res) { var o = {}; keys.forEach(function (k, i) { o[k] = res[i]; }); return o; });
  }

  function pool(items, n, fn) {
    var i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var it = items[i++]; return fn(it).then(next, next); }
    var w = []; for (var k = 0; k < n; k++) w.push(next());
    return Promise.all(w);
  }

  function loadMedia(onProgress) {
    var fields = 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count';
    var out = [];
    function page(url) {
      return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        if (j.error) throw new Error(j.error.message);
        out = out.concat(j.data || []);
        return (j.paging && j.paging.next && out.length < 150) ? page(j.paging.next) : out;
      });
    }
    return api(state.base, state.igId + '/media', { fields: fields, limit: 50, access_token: state.token })
      .then(function (j) { out = j.data || []; return (j.paging && j.paging.next && out.length < 150) ? page(j.paging.next) : out; })
      .then(function (all) {
        var vids = all.filter(function (m) { return m.media_type === 'VIDEO'; });
        var done = 0;
        return pool(vids, 4, function (m) {
          return loadMediaInsights(m).then(function () { done++; if (onProgress) onProgress(done, vids.length); });
        }).then(function () { return vids.map(normalizeMedia); });
      });
  }

  function loadMediaInsights(m) {
    var reels = m.media_product_type === 'REELS';
    var full = reels
      ? 'views,reach,likes,comments,shares,saves,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time'
      : 'views,reach,likes,comments,shares,saves,total_interactions';
    function get(metrics) {
      return api(state.base, m.id + '/insights', { metric: metrics, access_token: state.token }).then(function (r) {
        m.ins = {};
        (r.data || []).forEach(function (d) { m.ins[d.name] = d.values && d.values[0] ? d.values[0].value : (d.total_value ? d.total_value.value : null); });
      });
    }
    return get(full)
      .catch(function () { return get('views,reach'); })
      .catch(function (e) { m.ins = {}; m.insError = e.message; });
  }

  function normalizeMedia(m) {
    var ins = m.ins || {};
    var o = {
      id: m.id, caption: (m.caption || '').split('\n')[0] || 'Без подписи', fullCaption: m.caption || '',
      thumb: m.thumbnail_url || m.media_url || '', link: m.permalink, date: new Date(m.timestamp),
      kind: m.media_product_type === 'REELS' ? 'REELS' : 'FEED',
      views: ins.views != null ? ins.views : null,
      reach: ins.reach != null ? ins.reach : null,
      likes: ins.likes != null ? ins.likes : (m.like_count != null ? m.like_count : null),
      comments: ins.comments != null ? ins.comments : (m.comments_count != null ? m.comments_count : null),
      shares: ins.shares != null ? ins.shares : null,
      saves: ins.saves != null ? ins.saves : null,
      avgWatch: ins.ig_reels_avg_watch_time != null ? ins.ig_reels_avg_watch_time : null,
      totalWatch: ins.ig_reels_video_view_total_time != null ? ins.ig_reels_video_view_total_time : null,
      error: m.insError || null
    };
    o.total_interactions = ins.total_interactions != null ? ins.total_interactions : sum([o.likes, o.comments, o.shares, o.saves]);
    var den = o.reach || o.views;
    o.er = den ? o.total_interactions / den * 100 : null;
    return o;
  }

  // ---------- Демо-данные ----------
  function demoData() {
    var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var now = new Date(); now.setHours(0, 0, 0, 0);
    function day(i) { var d = new Date(now); d.setDate(d.getDate() - (29 - i)); return d; }
    var followers = [], reach = [];
    for (var i = 0; i < 30; i++) {
      var spike = (i === 9 || i === 21) ? 1 : 0;
      followers.push({ t: day(i), v: Math.round(18 + rnd() * 30 + spike * 140) });
      reach.push({ t: day(i), v: Math.round(4200 + rnd() * 2600 + spike * 9000 + Math.sin(i / 4) * 900) });
    }
    var reachTotal = sum(reach.map(function (p) { return p.v; }));
    var acc = {
      followers: followers, reach: reach,
      totals: { views: Math.round(reachTotal * 2.9), reach: reachTotal, accounts_engaged: Math.round(reachTotal * 0.11), total_interactions: 18940, likes: 14210, comments: 1120, shares: 1860, saves: 1750, profile_views: 6420 },
      age: [['13-17', 2.1], ['18-24', 19.4], ['25-34', 38.7], ['35-44', 24.3], ['45-54', 10.2], ['55-64', 3.9], ['65+', 1.4]].map(function (x) { return { label: x[0], value: Math.round(x[1] * 124) }; }),
      gender: [{ label: 'F', value: 7210 }, { label: 'M', value: 4830 }, { label: 'U', value: 360 }],
      city: [['Москва', 2840], ['Санкт-Петербург', 1390], ['Алматы', 760], ['Казань', 540], ['Екатеринбург', 470], ['Новосибирск', 410], ['Минск', 380], ['Краснодар', 330]].map(function (x) { return { label: x[0], value: x[1] }; }),
      online: []
    };
    for (var h = 0; h < 24; h++) acc.online.push({ label: h + ':00', value: Math.round(1200 + 3800 * Math.max(0, Math.sin((h - 7) / 24 * Math.PI * 1.6)) + rnd() * 400) });
    var caps = ['Как мы сократили время сборки заказа на 40%', 'Ошибка №1 при выходе на Ozon', 'Разбор юнит-экономики за 60 секунд', 'Три сценария автоматизации ответов на отзывы', 'Склад: день из жизни', 'Что менять в карточке товара, чтобы росли продажи', 'Почему реклама на WB сливает бюджет', 'Подключаем API маркетплейса за 5 минут', 'Как читать аналитику без боли', 'Логистика до клиента: чек-лист', 'Ценообразование: автоматический демпинг-контроль', 'Команда Дживио: кто мы', 'Распродажа 11.11: как подготовиться', 'SEO карточки — 4 правила', 'Мониторинг цен конкурентов в реальном времени', 'Ответ на негатив, который продаёт', 'Автоматизация рутины продавца', 'Что такое out-of-stock и как его победить', 'Live: отвечаем на вопросы', 'Реклама: ставки и стратегии', 'Экспресс-аудит магазина', 'Как мы росли: цифры квартала', 'Партнёрство с фулфилментом', 'Коротко о главном: обновления месяца'];
    var media = caps.map(function (c, i) {
      var d = new Date(now); d.setDate(d.getDate() - Math.round(i * 3.4 + rnd() * 2));
      var isReel = i % 5 !== 3;
      var views = Math.round(isReel ? (3000 + rnd() * 22000 + (i === 1 || i === 6 ? 60000 : 0)) : 1500 + rnd() * 5000);
      var reach = Math.round(views * (0.55 + rnd() * 0.25));
      var likes = Math.round(views * (0.03 + rnd() * 0.04)), comments = Math.round(views * 0.003 * (0.5 + rnd())), shares = Math.round(views * 0.008 * (0.5 + rnd())), saves = Math.round(views * 0.012 * (0.5 + rnd()));
      var m = { id: 'demo' + i, caption: c, fullCaption: c, thumb: '', link: '#', date: d, kind: isReel ? 'REELS' : 'FEED', views: views, reach: reach, likes: likes, comments: comments, shares: shares, saves: saves, avgWatch: isReel ? Math.round((6 + rnd() * 14) * 1000) : null, totalWatch: null, error: null };
      m.total_interactions = likes + comments + shares + saves; m.er = m.total_interactions / reach * 100;
      if (m.avgWatch) m.totalWatch = m.avgWatch * views;
      return m;
    });
    var account = { id: 'demo', username: 'jvo.demo', name: 'Дживио · демо', profile_picture_url: 'sign-pink.png', followers_count: 12400, follows_count: 318, media_count: 212, biography: 'Автоматизация e-commerce. Демонстрационный аккаунт — данные сгенерированы.' };
    return { account: account, acc: acc, media: media };
  }

  // ---------- Тултип ----------
  var tip = $('tip');
  function showTip(x, y, title, rows) {
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    if (title) { var t = document.createElement('div'); t.className = 'ig-tip__t'; t.textContent = title; tip.appendChild(t); }
    rows.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'ig-tip__row';
      if (r.color) { var k = document.createElement('i'); k.className = 'ig-tip__key'; k.style.background = r.color; row.appendChild(k); }
      var b = document.createElement('b'); b.textContent = r.v; row.appendChild(b);
      var s = document.createElement('span'); s.textContent = r.label; row.appendChild(s);
      tip.appendChild(row);
    });
    tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var px = x + 14, py = y + 14;
    if (px + w > window.innerWidth - 8) px = x - w - 14;
    if (py + h > window.innerHeight - 8) py = y - h - 14;
    tip.style.left = px + 'px'; tip.style.top = py + 'px';
  }
  function hideTip() { tip.hidden = true; }

  // ---------- Графики (SVG) ----------
  function empty(el, text) { el.innerHTML = '<div class="ig-empty">' + esc(text) + '</div>'; }
  function svgEl(el, w, h) { el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img"></svg>'; return el.firstChild; }
  function colPath(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y + ' L' + (x + w - r) + ',' + y + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' L' + (x + w) + ',' + (y + h) + ' Z';
  }
  function barPath(x, y, w, h, r) { // горизонтальная, скругление справа
    if (w <= 0) return '';
    r = Math.min(r, h / 2, w);
    return 'M' + x + ',' + y + ' L' + (x + w - r) + ',' + y + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' L' + (x + w) + ',' + (y + h - r) + ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + ' L' + x + ',' + (y + h) + ' Z';
  }
  function gridY(max, plotH, top, left, right, fmtFn) {
    var steps = 4, s = '';
    for (var i = 0; i <= steps; i++) {
      var v = max * i / steps, y = top + plotH - plotH * i / steps;
      s += '<line class="grid" x1="' + left + '" x2="' + right + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="tick" x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + esc((fmtFn || fmtTick)(v)) + '</text>';
    }
    return s;
  }

  // Столбцы: items [{label, value, color?, tipRows?}]
  function columnChart(el, o) {
    var items = o.items || [];
    if (!items.length) return empty(el, o.emptyText || 'Нет данных');
    var W = Math.max(el.clientWidth || 480, 280), H = o.height || 230;
    var left = 44, right = 8, top = 14, bottom = 28, plotW = W - left - right, plotH = H - top - bottom;
    var max = niceMax(Math.max.apply(null, items.map(function (i) { return Math.abs(i.value || 0); })));
    var n = items.length, slot = plotW / n, bw = Math.min(24, Math.max(3, slot - 2));
    var svg = svgEl(el, W, H), s = gridY(max, plotH, top, left, W - right, o.fmtTick);
    var maxIdx = 0; items.forEach(function (it, i) { if ((it.value || 0) > (items[maxIdx].value || 0)) maxIdx = i; });
    var labelEvery = Math.ceil(n / Math.floor(plotW / 44));
    items.forEach(function (it, i) {
      var v = it.value || 0, h = plotH * Math.abs(v) / max, x = left + slot * i + (slot - bw) / 2, y = top + plotH - h;
      s += '<path class="bar" data-i="' + i + '" d="' + colPath(x, y, bw, h, 4) + '" fill="' + (it.color || o.color || C.c1) + '"/>';
      if (i === maxIdx && v > 0 && o.labelMax !== false) s += '<text class="lbl" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + esc(fmt(v)) + '</text>';
      if (i % labelEvery === 0 || n <= 8) s += '<text class="tick" x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(it.label) + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (left + slot * i) + '" y="' + top + '" width="' + slot + '" height="' + plotH + '"/>';
    });
    svg.innerHTML = s;
    hookHits(svg, function (i, ev) {
      var it = items[i];
      showTip(ev.clientX, ev.clientY, it.title || it.label, it.tipRows || [{ v: fmtFull(it.value), label: o.unit || '', color: it.color || o.color || C.c1 }]);
    });
  }

  // Горизонтальные полосы: items [{label, value}]
  function barChartH(el, o) {
    var items = o.items || [];
    if (!items.length) return empty(el, o.emptyText || 'Нет данных');
    var W = Math.max(el.clientWidth || 480, 280), rowH = o.rowH || 30, labelW = o.labelW || 120;
    var top = 6, H = top + rowH * items.length + 6, left = labelW, right = 64, plotW = W - left - right;
    var max = Math.max.apply(null, items.map(function (i) { return i.value || 0; })) || 1;
    var total = o.pct ? sum(items.map(function (i) { return i.value || 0; })) : 0;
    var svg = svgEl(el, W, H), s = '';
    items.forEach(function (it, i) {
      var v = it.value || 0, w = plotW * v / max, y = top + rowH * i + (rowH - 18) / 2;
      s += '<text class="lbl lbl--muted" x="' + (left - 10) + '" y="' + (y + 13) + '" text-anchor="end">' + esc(it.label) + '</text>';
      s += '<path class="bar" data-i="' + i + '" d="' + barPath(left, y, w, 18, 4) + '" fill="' + (it.color || o.color || C.c1) + '"/>';
      var txt = o.pct ? fmtPct(total ? v / total * 100 : 0) : fmt(v);
      s += '<text class="lbl" x="' + (left + w + 8) + '" y="' + (y + 13) + '">' + esc(txt) + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="0" y="' + (top + rowH * i) + '" width="' + W + '" height="' + rowH + '"/>';
    });
    svg.innerHTML = s;
    hookHits(svg, function (i, ev) {
      var it = items[i];
      showTip(ev.clientX, ev.clientY, it.title || it.label, it.tipRows || [{ v: fmtFull(it.value), label: o.unit || '', color: it.color || o.color || C.c1 }]);
    });
  }

  // Линия со временем: points [{t: Date, v}]
  function lineChart(el, o) {
    var pts = o.points || [];
    if (pts.length < 2) return empty(el, o.emptyText || 'Нет данных за период');
    var W = Math.max(el.clientWidth || 480, 280), H = o.height || 230;
    var left = 44, right = 56, top = 14, bottom = 28, plotW = W - left - right, plotH = H - top - bottom;
    var max = niceMax(Math.max.apply(null, pts.map(function (p) { return p.v; })));
    var xs = pts.map(function (p, i) { return left + plotW * i / (pts.length - 1); });
    var ys = pts.map(function (p) { return top + plotH - plotH * p.v / max; });
    var color = o.color || C.c1;
    var svg = svgEl(el, W, H), s = gridY(max, plotH, top, left, W - right);
    var d = xs.map(function (x, i) { return (i ? 'L' : 'M') + x.toFixed(1) + ',' + ys[i].toFixed(1); }).join(' ');
    s += '<path d="' + d + ' L' + xs[xs.length - 1].toFixed(1) + ',' + (top + plotH) + ' L' + xs[0] + ',' + (top + plotH) + ' Z" fill="' + color + '" opacity=".1"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var every = Math.ceil(pts.length / Math.floor(plotW / 56));
    pts.forEach(function (p, i) { if (i % every === 0 || i === pts.length - 1) s += '<text class="tick" x="' + xs[i] + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(fmtDate(p.t)) + '</text>'; });
    var last = pts.length - 1;
    s += '<circle cx="' + xs[last] + '" cy="' + ys[last] + '" r="5" fill="' + color + '" stroke="' + C.surface + '" stroke-width="2"/>';
    s += '<text class="lbl" x="' + (xs[last] + 9) + '" y="' + (ys[last] + 4) + '">' + esc(fmt(pts[last].v)) + '</text>';
    s += '<line class="xhair" x1="0" x2="0" y1="' + top + '" y2="' + (top + plotH) + '"/>';
    s += '<circle class="pt" r="5" fill="' + color + '" stroke="' + C.surface + '" stroke-width="2"/>';
    s += '<rect class="hit" x="' + left + '" y="' + top + '" width="' + plotW + '" height="' + plotH + '"/>';
    svg.innerHTML = s;
    var xh = svg.querySelector('.xhair'), pt = svg.querySelector('.pt'), hit = svg.querySelector('.hit');
    function move(ev) {
      var r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * W / r.width;
      var i = Math.round((mx - left) / plotW * (pts.length - 1)); i = Math.max(0, Math.min(pts.length - 1, i));
      xh.setAttribute('x1', xs[i]); xh.setAttribute('x2', xs[i]); xh.classList.add('is-on');
      pt.setAttribute('cx', xs[i]); pt.setAttribute('cy', ys[i]); pt.classList.add('is-on');
      showTip(ev.clientX, ev.clientY, fmtDateFull(pts[i].t), [{ v: fmtFull(pts[i].v), label: o.unit || '', color: color }]);
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', function () { xh.classList.remove('is-on'); pt.classList.remove('is-on'); hideTip(); });
  }

  // Точки по дате: points [{t, v, m}]
  function scatterChart(el, o) {
    var pts = (o.points || []).filter(function (p) { return p.v != null; });
    if (!pts.length) return empty(el, o.emptyText || 'Нет данных');
    var W = Math.max(el.clientWidth || 480, 280), H = o.height || 230;
    var left = 44, right = 16, top = 14, bottom = 28, plotW = W - left - right, plotH = H - top - bottom;
    var max = niceMax(Math.max.apply(null, pts.map(function (p) { return p.v; })));
    var t0 = Math.min.apply(null, pts.map(function (p) { return +p.t; })), t1 = Math.max.apply(null, pts.map(function (p) { return +p.t; }));
    if (t1 === t0) t1 = t0 + 86400000;
    var color = o.color || C.c1;
    var svg = svgEl(el, W, H), s = gridY(max, plotH, top, left, W - right);
    for (var k = 0; k <= 4; k++) { var tt = new Date(t0 + (t1 - t0) * k / 4); s += '<text class="tick" x="' + (left + plotW * k / 4) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(fmtDate(tt)) + '</text>'; }
    pts.forEach(function (p, i) {
      var x = left + plotW * (+p.t - t0) / (t1 - t0), y = top + plotH - plotH * p.v / max;
      var fill = p.m && p.m.kind === 'FEED' ? C.c2 : color;
      s += '<circle class="bar" data-i="' + i + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="' + fill + '" stroke="' + C.surface + '" stroke-width="2"/>';
      s += '<circle class="hit" data-i="' + i + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="13"/>';
    });
    svg.innerHTML = s;
    el.insertAdjacentHTML('beforeend', '<div class="ig-legend"><span><i style="background:' + C.c1 + '"></i>Reels</span><span><i style="background:' + C.c2 + '"></i>Видео в ленте</span></div>');
    hookHits(svg, function (i, ev) {
      var m = pts[i].m;
      showTip(ev.clientX, ev.clientY, m.caption, [
        { v: fmtFull(m.views), label: 'просмотров', color: m.kind === 'FEED' ? C.c2 : color },
        { v: fmtFull(m.reach), label: 'охват' },
        { v: fmtDateFull(m.date), label: '' }
      ]);
    });
  }

  function sparkline(pts, color) {
    if (!pts || pts.length < 2) return '';
    var W = 120, H = 28, max = Math.max.apply(null, pts.map(function (p) { return p.v; })) || 1;
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (W * i / (pts.length - 1)).toFixed(1) + ',' + (H - 2 - (H - 4) * p.v / max).toFixed(1); }).join(' ');
    var lx = W, ly = H - 2 - (H - 4) * pts[pts.length - 1].v / max;
    return '<div class="ig-kpi__spark"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + C.dim + '" stroke-width="2" stroke-linejoin="round"/><circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="3.5" fill="' + color + '"/></svg></div>';
  }

  function hookHits(svg, onHover) {
    var cur = null;
    svg.addEventListener('pointermove', function (ev) {
      var t = ev.target.closest('.hit'); if (!t) return;
      var i = +t.getAttribute('data-i');
      if (cur) cur.classList.remove('is-hover');
      cur = svg.querySelector('.bar[data-i="' + i + '"]'); if (cur) cur.classList.add('is-hover');
      onHover(i, ev);
    });
    svg.addEventListener('pointerleave', function () { if (cur) cur.classList.remove('is-hover'); cur = null; hideTip(); });
  }

  // ---------- Рендер ----------
  function kpi(label, value, opts) {
    opts = opts || {};
    var na = value == null;
    var delta = '';
    if (opts.delta != null) {
      var up = opts.delta > 0, cls = opts.delta === 0 ? '' : (up === !opts.downIsGood ? 'is-up' : 'is-down');
      delta = '<span class="ig-kpi__delta ' + cls + '">' + (opts.delta > 0 ? '+' : '') + esc(fmt(opts.delta)) + ' ' + esc(opts.deltaLabel || '') + '</span>';
    } else if (opts.sub) delta = '<span class="ig-kpi__delta">' + esc(opts.sub) + '</span>';
    return '<div class="ig-kpi' + (na ? ' ig-kpi--na' : '') + '" title="' + esc(opts.title || '') + '"><span class="ig-kpi__label">' + esc(label) + '</span><span class="ig-kpi__value">' + (na ? 'нет данных' : esc(opts.raw || fmt(value))) + '</span>' + delta + (opts.spark || '') + '</div>';
  }

  function renderProfile() {
    var a = state.account, acc = state.acc || {};
    var newF = acc.followers ? sum(acc.followers.map(function (p) { return p.v; })) : null;
    $('profile').innerHTML =
      (a.profile_picture_url ? '<img class="ig-profile__ava" src="' + esc(a.profile_picture_url) + '" alt="">' : '<div class="ig-profile__ava"></div>') +
      '<div class="ig-profile__id"><div class="ig-profile__name">' + esc(a.name || a.username) + '</div>' +
      '<div class="ig-profile__user"><a href="https://www.instagram.com/' + esc(a.username) + '/" target="_blank" rel="noopener">@' + esc(a.username) + '</a>' + (state.mode === 'demo' ? ' · демо-данные' : ' · ' + (state.login === 'instagram' ? 'вход через Instagram' : 'вход через Facebook')) + '</div>' +
      (a.biography ? '<div class="ig-profile__bio">' + esc(a.biography) + '</div>' : '') + '</div>' +
      '<div class="ig-profile__nums">' +
      '<div class="ig-profile__num is-hero"><b>' + esc(fmtFull(a.followers_count)) + '</b><span>подписчиков' + (newF != null ? ' · +' + fmt(newF) + ' за ' + state.days + ' дн.' : '') + '</span></div>' +
      '<div class="ig-profile__num"><b>' + esc(fmtFull(a.follows_count)) + '</b><span>подписок</span></div>' +
      '<div class="ig-profile__num"><b>' + esc(fmtFull(a.media_count)) + '</b><span>публикаций</span></div>' +
      '</div>';
    var st = $('topStatus');
    st.innerHTML = '<span class="ig-dot' + (state.mode === 'demo' ? ' ig-dot--demo' : '') + '"></span>' + (a.profile_picture_url ? '<img src="' + esc(a.profile_picture_url) + '" alt="">' : '') + '<span>@' + esc(a.username) + '</span>';
  }

  function renderAccount() {
    var acc = state.acc || {}, t = acc.totals || {};
    $('periodLabel').textContent = 'последние ' + state.days + ' дн.';
    var newF = acc.followers ? sum(acc.followers.map(function (p) { return p.v; })) : null;
    var er = t.reach ? (t.total_interactions || 0) / t.reach * 100 : null;
    $('kpis').innerHTML =
      kpi('Новые подписчики', newF, { spark: sparkline(acc.followers, C.c1), title: 'Сумма новых подписчиков по дням' }) +
      kpi('Охват', t.reach, { spark: sparkline(acc.reach, C.c1), title: 'Уникальные аккаунты, видевшие контент' }) +
      kpi('Просмотры', t.views, { sub: 'весь контент', title: 'Просмотры постов, Reels, историй и профиля' }) +
      kpi('Взаимодействия', t.total_interactions, { sub: 'лайки, комментарии, репосты, сохранения' }) +
      kpi('Вовлечённые аккаунты', t.accounts_engaged, { sub: er != null ? 'ER ' + fmtPct(er) + ' от охвата' : '' }) +
      kpi('Просмотры профиля', t.profile_views, { sub: 'переходы в профиль' });

    $('subFollowers').textContent = newF != null ? 'всего +' + fmt(newF) : '';
    columnChart($('chFollowers'), { items: (acc.followers || []).map(function (p) { return { label: fmtDate(p.t), title: fmtDateFull(p.t), value: p.v }; }), unit: 'новых подписчиков', emptyText: 'Нет данных: метрика доступна при 100+ подписчиках' });
    lineChart($('chReach'), { points: acc.reach, unit: 'охват' });
    var inter = [['Лайки', t.likes], ['Комментарии', t.comments], ['Репосты', t.shares], ['Сохранения', t.saves]].filter(function (x) { return x[1] != null; }).map(function (x) { return { label: x[0], value: x[1] }; });
    barChartH(el('chInteractions'), { items: inter, labelW: 110, rowH: 40, emptyText: 'Нет данных о взаимодействиях' });
    columnChart($('chOnline'), { items: (acc.online || []).map(function (h) { return { label: h.label, value: h.value }; }), unit: 'подписчиков онлайн', color: C.c1, labelMax: false, emptyText: 'Нет данных' });

    var ageOrder = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    var age = (acc.age || []).slice().sort(function (a, b) { return ageOrder.indexOf(a.label) - ageOrder.indexOf(b.label); });
    var ageTotal = sum(age.map(function (a) { return a.value; }));
    columnChart($('chAge'), {
      items: age.map(function (a, i) { return { label: a.label, value: a.value, color: C.ramp[Math.min(C.ramp.length - 1, Math.floor(i / age.length * C.ramp.length))], tipRows: [{ v: fmtPct(a.value / ageTotal * 100), label: 'подписчиков' }, { v: fmtFull(a.value), label: '' }] }; }),
      emptyText: 'Демография доступна при 100+ подписчиках', labelMax: false
    });
    var gl = { F: 'Женщины', M: 'Мужчины', U: 'Не указан' };
    barChartH($('chGender'), { items: (acc.gender || []).map(function (g) { return { label: gl[g.label] || g.label, value: g.value }; }), pct: true, labelW: 90, rowH: 44, emptyText: 'Демография доступна при 100+ подписчиках' });
    barChartH($('chCity'), { items: (acc.city || []).slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 8), pct: true, labelW: 130, rowH: 28, emptyText: 'Демография доступна при 100+ подписчиках' });
  }
  function el(id) { return $(id); }

  function filteredMedia() {
    var list = state.media.filter(function (m) { return state.kind === 'all' || m.kind === state.kind; });
    var k = state.sort;
    list.sort(function (a, b) {
      if (k === 'date') return b.date - a.date;
      var av = a[k] == null ? -1 : a[k], bv = b[k] == null ? -1 : b[k];
      return bv - av;
    });
    return list;
  }

  function renderVideos() {
    var list = filteredMedia();
    var all = state.media;
    $('videoCount').textContent = list.length + ' из ' + all.length + (all.length ? ' · с ' + fmtDate(all.reduce(function (m, x) { return x.date < m ? x.date : m; }, all[0].date)) : '');
    var views = list.map(function (m) { return m.views; }).filter(function (v) { return v != null; });
    var best = list.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); })[0];
    var reels = list.filter(function (m) { return m.kind === 'REELS' && m.avgWatch != null; });
    var avgWatch = reels.length ? sum(reels.map(function (m) { return m.avgWatch; })) / reels.length : null;
    var ers = list.map(function (m) { return m.er; }).filter(function (v) { return v != null; });
    $('videoKpis').innerHTML =
      kpi('Видео', list.length, { sub: list.filter(function (m) { return m.kind === 'REELS'; }).length + ' Reels' }) +
      kpi('Просмотры всего', views.length ? sum(views) : null) +
      kpi('В среднем на видео', views.length ? sum(views) / views.length : null, { sub: 'просмотров' }) +
      kpi('Лучшее видео', best && best.views != null ? best.views : null, { sub: best ? best.caption : '', title: best ? best.caption : '' }) +
      kpi('Средний ER', ers.length ? sum(ers) / ers.length : null, { raw: ers.length ? fmtPct(sum(ers) / ers.length) : '', sub: 'взаимодействия / охват' }) +
      kpi('Ср. время просмотра', avgWatch, { raw: avgWatch != null ? fmtDur(avgWatch) : '', sub: 'только Reels' });

    var top = list.filter(function (m) { return m.views != null; }).sort(function (a, b) { return b.views - a.views; }).slice(0, 10);
    barChartH($('chTopVideos'), {
      items: top.map(function (m) { return { label: m.caption.length > 22 ? m.caption.slice(0, 21) + '…' : m.caption, title: m.caption, value: m.views, color: m.kind === 'FEED' ? C.c2 : C.c1, tipRows: [{ v: fmtFull(m.views), label: 'просмотров', color: m.kind === 'FEED' ? C.c2 : C.c1 }, { v: fmtFull(m.reach), label: 'охват' }, { v: fmtPct(m.er), label: 'ER' }, { v: fmtDateFull(m.date), label: '' }] }; }),
      labelW: 170, rowH: 30, emptyText: 'Нет видео с данными о просмотрах'
    });
    scatterChart($('chViewsByDate'), { points: list.map(function (m) { return { t: m.date, v: m.views, m: m }; }) });
    renderTable(list);
  }

  var COLS = [
    { k: 'caption', t: 'Видео' }, { k: 'kind', t: 'Тип' }, { k: 'date', t: 'Дата', num: true },
    { k: 'views', t: 'Просмотры', num: true }, { k: 'reach', t: 'Охват', num: true }, { k: 'likes', t: 'Лайки', num: true },
    { k: 'comments', t: 'Комм.', num: true }, { k: 'shares', t: 'Репосты', num: true }, { k: 'saves', t: 'Сохр.', num: true },
    { k: 'avgWatch', t: 'Ср. просмотр', num: true }, { k: 'er', t: 'ER', num: true }
  ];
  function renderTable(list) {
    var maxV = Math.max.apply(null, list.map(function (m) { return m.views || 0; })) || 1;
    var h = '<thead><tr>' + COLS.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.num ? 'num' : '') + (state.sort === c.k ? ' is-sort' : '') + '">' + esc(c.t) + '</th>'; }).join('') + '</tr></thead><tbody>';
    list.forEach(function (m) {
      h += '<tr>' +
        '<td><div class="ig-vid">' + (m.thumb ? '<img class="ig-vid__thumb" src="' + esc(m.thumb) + '" alt="" loading="lazy">' : '<div class="ig-vid__thumb ig-vid__thumb--empty">▶</div>') +
        '<div><span class="ig-vid__cap" title="' + esc(m.fullCaption) + '">' + esc(m.caption) + '</span><span class="ig-vid__meta">' + (m.link && m.link !== '#' ? '<a href="' + esc(m.link) + '" target="_blank" rel="noopener">Открыть в Instagram</a>' : '') + (m.error ? ' · статистика недоступна' : '') + '</span></div></div></td>' +
        '<td><span class="ig-kind' + (m.kind === 'FEED' ? ' ig-kind--feed' : '') + '">' + (m.kind === 'REELS' ? 'Reels' : 'Видео') + '</span></td>' +
        '<td class="num">' + esc(fmtDate(m.date)) + '</td>' +
        '<td class="num"><div class="ig-bar-cell"><i style="width:' + Math.round(60 * (m.views || 0) / maxV) + 'px"></i>' + esc(fmtFull(m.views)) + '</div></td>' +
        '<td class="num">' + esc(fmtFull(m.reach)) + '</td><td class="num">' + esc(fmtFull(m.likes)) + '</td><td class="num">' + esc(fmtFull(m.comments)) + '</td>' +
        '<td class="num">' + esc(fmtFull(m.shares)) + '</td><td class="num">' + esc(fmtFull(m.saves)) + '</td>' +
        '<td class="num">' + esc(fmtDur(m.avgWatch)) + '</td><td class="num">' + esc(fmtPct(m.er)) + '</td></tr>';
    });
    $('videoTable').innerHTML = h + '</tbody>';
  }

  function renderAll() { renderProfile(); renderAccount(); renderVideos(); $('freshNote').textContent = state.loadedAt ? 'Обновлено ' + state.loadedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; }

  // ---------- Управление ----------
  function setLoading(text) { $('loading').hidden = !text; if (text) $('loadingText').textContent = text; }
  function showError(msg) { var e = $('connectError'); e.textContent = msg; e.hidden = !msg; }
  function setStale(on) { Array.prototype.forEach.call(document.querySelectorAll('.ig-chart'), function (c) { c.classList.toggle('is-stale', on); }); }

  function enterDashboard() {
    $('dash').hidden = false; $('connect').classList.add('is-compact');
    $('logoutBtn').hidden = false; $('connectBtn').textContent = 'Другой токен';
    $('connectForm').querySelector('.ig-field').style.display = state.mode === 'live' ? '' : 'none';
  }

  function startLive(token, silent) {
    showError(''); setLoading('Подключаем аккаунт…'); $('connectBtn').disabled = true;
    return connect(token).then(function (c) {
      state.mode = 'live'; state.token = token; state.base = c.base; state.igId = c.igId; state.account = c.account; state.login = c.login;
      saveStore({ token: token, days: state.days });
      enterDashboard(); renderProfile();
      return reloadAll();
    }).catch(function (e) {
      if (!silent) showError(e.message); else showError('Сохранённый токен больше не работает: ' + e.message);
      $('connect').classList.remove('is-compact');
    }).then(function () { setLoading(null); $('connectBtn').disabled = false; });
  }

  function reloadAll() {
    setStale(true); setLoading('Загружаем статистику аккаунта…');
    return loadAccount().then(function (acc) {
      state.acc = acc; renderProfile(); renderAccount();
      setLoading('Загружаем видео…');
      return loadMedia(function (d, n) { setLoading('Статистика видео: ' + d + ' из ' + n + '…'); });
    }).then(function (media) {
      state.media = media; state.loadedAt = new Date(); renderAll();
    }).catch(function (e) { showError('Ошибка загрузки: ' + e.message); })
      .then(function () { setStale(false); setLoading(null); });
  }

  function reloadAccountOnly() {
    if (state.mode !== 'live') { renderAll(); return; }
    setStale(true); setLoading('Пересчитываем период…');
    loadAccount().then(function (acc) { state.acc = acc; state.loadedAt = new Date(); renderAll(); })
      .catch(function (e) { showError('Ошибка загрузки: ' + e.message); })
      .then(function () { setStale(false); setLoading(null); });
  }

  function startDemo() {
    var d = demoData();
    state.mode = 'demo'; state.token = null; state.account = d.account; state.acc = d.acc; state.media = d.media; state.loadedAt = new Date();
    showError(''); enterDashboard(); renderAll();
    $('freshNote').textContent = 'Демо-данные · сгенерированы для примера';
  }

  function logout() {
    saveStore({ days: state.days });
    state.mode = null; state.token = null; state.account = null; state.acc = null; state.media = [];
    $('dash').hidden = true; $('connect').classList.remove('is-compact'); $('logoutBtn').hidden = true;
    $('connectBtn').textContent = 'Подключить'; $('connectForm').querySelector('.ig-field').style.display = '';
    $('tokenInput').value = ''; $('topStatus').innerHTML = ''; showError('');
  }

  // ---------- События ----------
  $('connectForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var t = $('tokenInput').value.trim();
    if (!t) { $('connectForm').querySelector('.ig-field').style.display = ''; $('tokenInput').focus(); return; }
    startLive(t, false);
  });
  $('demoBtn').addEventListener('click', startDemo);
  $('logoutBtn').addEventListener('click', logout);
  $('refreshBtn').addEventListener('click', function () { if (state.mode === 'live') reloadAll(); else startDemo(); });

  $('filters').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-days], button[data-kind]'); if (!b) return;
    Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle('is-on', x === b); });
    if (b.dataset.days) { state.days = +b.dataset.days; saveStore(ext(loadStore(), { days: state.days })); reloadAccountOnly(); }
    else { state.kind = b.dataset.kind; renderVideos(); }
  });
  $('sortSel').addEventListener('change', function () { state.sort = this.value; renderVideos(); });
  $('videoTable').addEventListener('click', function (ev) {
    var th = ev.target.closest('th[data-k]'); if (!th) return;
    state.sort = th.dataset.k; $('sortSel').value = COLS.some(function (c) { return c.k === state.sort; }) && $('sortSel').querySelector('option[value="' + state.sort + '"]') ? state.sort : $('sortSel').value;
    renderVideos();
  });

  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (state.mode) renderAll(); }, 150); });

  // ---------- Старт ----------
  var saved = loadStore();
  if (saved.days) { state.days = saved.days; Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (b) { b.classList.toggle('is-on', +b.dataset.days === state.days); }); }
  if (/[?&]demo/.test(location.search)) startDemo();
  else if (saved.token) { $('tokenInput').value = saved.token; startLive(saved.token, true); }
})();
