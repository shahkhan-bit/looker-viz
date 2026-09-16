/**
 * HungerStation - AI Summary Card (Looker custom visualization)
 * ---------------------------------------------------------------------------
 * Renders the one-row output of the nps_delay_factor_ai view as a clean,
 * deck-ready card. Fields are matched by name (last part after the dot):
 *   ai_status | period_label | scope_label | headline | summary |
 *   highlights_json | by_vertical_json | watch_next | generated_at
 * No external dependencies. All text is inserted with textContent (safe).
 */
(function () {
  'use strict';

  var C = {
    yellow: '#FBEF00', cream: '#FEFFF8', brown: '#5E2D20', blue: '#13B1E2',
    pink: '#ED2FB7', sky: '#D4E9FF', green: '#1E9E5A', muted: '#8C7268', line: '#EFE6CF'
  };
  var TONE = {
    positive: { color: C.green, label: 'Positive', icon: '▲' },
    negative: { color: C.pink, label: 'Concern', icon: '▼' },
    neutral:  { color: C.blue, label: 'Note', icon: '●' }
  };

  var CSS = [
    '.hsa{width:100%;height:100%;overflow:auto;box-sizing:border-box;padding:2px;',
    'font-family:"Google Sans","Inter",Roboto,"Helvetica Neue",Arial,sans-serif;color:#5E2D20}',
    '.hsa *{box-sizing:border-box}',
    '.hsa-card{position:relative;background:#FEFFF8;border:1px solid #EFE6CF;border-radius:16px;padding:calc(20px*var(--s)) calc(26px*var(--s)) calc(18px*var(--s)) calc(30px*var(--s));overflow:hidden}',
    '.hsa-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:7px;background:#FBEF00}',
    '.hsa-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}',
    '.hsa-badge{display:inline-flex;align-items:center;gap:6px;background:#5E2D20;color:#FBEF00;border-radius:999px;padding:4px 11px;font-size:calc(11px*var(--s));font-weight:700;letter-spacing:.6px;text-transform:uppercase}',
    '.hsa-meta{font-size:calc(13px*var(--s));color:#8C7268}',
    '.hsa-meta b{color:#5E2D20;font-weight:600}',
    '.hsa-headline{font-size:calc(25px*var(--s));line-height:1.25;font-weight:800;margin:calc(12px*var(--s)) 0 calc(8px*var(--s));letter-spacing:-.2px;max-width:1150px}',
    '.hsa-summary{font-size:calc(15.5px*var(--s));line-height:1.6;color:#4B2A20;max-width:1150px;margin:0}',
    '.hsa-sec{font-size:calc(11px*var(--s));font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#8C7268;margin:calc(18px*var(--s)) 0 calc(8px*var(--s))}',
    '.hsa-grid{display:grid;gap:calc(12px*var(--s))}',
    '.hsa-hl{background:#fff;border:1px solid #F0E8D2;border-top:4px solid var(--tone);border-radius:12px;padding:calc(12px*var(--s)) calc(14px*var(--s))}',
    '.hsa-tag{display:inline-flex;align-items:center;gap:5px;font-size:calc(11px*var(--s));font-weight:700;color:var(--tone);text-transform:uppercase;letter-spacing:.5px}',
    '.hsa-hl-title{font-size:calc(15px*var(--s));font-weight:700;margin:4px 0 4px;line-height:1.3}',
    '.hsa-hl-detail{font-size:calc(13.5px*var(--s));line-height:1.5;color:#4B2A20}',
    '.hsa-vt{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #F0E8D2;border-radius:12px;padding:calc(10px*var(--s)) calc(12px*var(--s))}',
    '.hsa-dot{flex:0 0 auto;width:10px;height:10px;border-radius:50%;margin-top:calc(5px*var(--s));background:var(--tone)}',
    '.hsa-vt-name{font-size:calc(14px*var(--s));font-weight:700}',
    '.hsa-vt-detail{font-size:calc(13px*var(--s));line-height:1.45;color:#4B2A20}',
    '.hsa-watch{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-top:calc(16px*var(--s));background:#FFF9B3;border-radius:12px;padding:calc(11px*var(--s)) calc(16px*var(--s))}',
    '.hsa-watch-label{background:#5E2D20;color:#FBEF00;border-radius:6px;padding:3px 9px;font-size:calc(11px*var(--s));font-weight:700;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap}',
    '.hsa-watch-text{font-size:calc(14.5px*var(--s));font-weight:600;line-height:1.45;flex:1 1 300px}',
    '.hsa-foot{margin-top:calc(12px*var(--s));font-size:calc(11px*var(--s));color:#A08A80}',
    '.hsa-state{display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;text-align:center;color:#8C7268;font-size:14px;padding:16px}'
  ].join('');

  function div(cls, parent, text) {
    var n = document.createElement('div');
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function short(name) { return String(name).split('.').pop().toLowerCase(); }
  function parseArr(s) {
    if (!s) return [];
    try { var v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function tone(t) { return TONE[String(t || '').toLowerCase()] || TONE.neutral; }

  looker.plugins.visualizations.add({
    id: 'hs_ai_summary_card',
    label: 'AI Summary Card',
    options: {
      badge_text:      { section: 'Card', order: 1, type: 'string',  label: 'Badge text', default: 'AI summary' },
      font_scale:      { section: 'Card', order: 2, type: 'number',  label: 'Text size (0.8 - 1.4)', default: 1 },
      show_highlights: { section: 'Card', order: 3, type: 'boolean', label: 'Show highlights', default: true },
      show_verticals:  { section: 'Card', order: 4, type: 'boolean', label: 'Show by-vertical notes', default: true },
      show_watch:      { section: 'Card', order: 5, type: 'boolean', label: 'Show "Watch next"', default: true },
      show_footer:     { section: 'Card', order: 6, type: 'boolean', label: 'Show footer', default: true }
    },

    create: function (element) {
      var st = document.createElement('style');
      st.textContent = CSS;
      element.appendChild(st);
      this._root = div('hsa', element);
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      this.clearErrors();
      var self = this;
      var opt = function (k) {
        var v = config && config[k];
        return v === undefined || v === null || v === '' ? self.options[k].default : v;
      };
      var root = this._root;
      while (root.firstChild) root.removeChild(root.firstChild);

      var fields = (queryResponse.fields.dimension_like || []).concat(queryResponse.fields.measure_like || []);
      var F = {};
      fields.forEach(function (f) { F[short(f.name)] = f.name; });
      if (!F.headline && !F.summary) {
        this.addError({ title: 'Missing fields', message: 'Add at least headline and summary from the nps_delay_factor_ai view.' });
        return done();
      }

      var row = data[0] || {};
      var get = function (k) { return F[k] && row[F[k]] ? row[F[k]].value : null; };
      var status = String(get('ai_status') || (data.length ? 'ok' : 'no_data'));

      if (status === 'no_data') { div('hsa-state', root, 'No data for the selected period and verticals.'); return done(); }
      if (status === 'failed' || (!get('headline') && !get('summary'))) {
        div('hsa-state', root, 'The AI summary could not be generated for this selection. Please refresh the tile.');
        return done();
      }

      var s = Math.max(0.8, Math.min(1.4, Number(opt('font_scale')) || 1));
      var W = element.clientWidth || 1000;
      if (W < 700) s = Math.min(s, 0.9);

      var card = div('hsa-card', root);
      card.style.setProperty('--s', s);

      // Top line
      var top = div('hsa-top', card);
      div('hsa-badge', top, '✦ ' + opt('badge_text'));
      var meta = div('hsa-meta', top);
      var parts = [];
      if (get('period_label')) parts.push(['', get('period_label')]);
      if (get('scope_label')) parts.push(['', get('scope_label')]);
      parts.forEach(function (p, i) {
        if (i) meta.appendChild(document.createTextNode('  ·  '));
        var b = document.createElement('b'); b.textContent = p[1]; meta.appendChild(b);
      });

      if (get('headline')) div('hsa-headline', card, get('headline'));
      if (get('summary')) div('hsa-summary', card, get('summary'));

      // Highlights
      var hls = parseArr(get('highlights_json'));
      if (opt('show_highlights') && hls.length) {
        div('hsa-sec', card, 'Key highlights');
        var g = div('hsa-grid', card);
        var cols = W >= 1100 ? Math.min(4, hls.length) : W >= 700 ? 2 : 1;
        g.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0,1fr))';
        hls.forEach(function (h) {
          var t = tone(h.tone);
          var c = div('hsa-hl', g);
          c.style.setProperty('--tone', t.color);
          div('hsa-tag', c, t.icon + ' ' + t.label);
          div('hsa-hl-title', c, h.title || '');
          div('hsa-hl-detail', c, h.detail || '');
        });
      }

      // By vertical
      var vts = parseArr(get('by_vertical_json'));
      if (opt('show_verticals') && vts.length > 1) {
        div('hsa-sec', card, 'By vertical');
        var gv = div('hsa-grid', card);
        var vc = W >= 1100 ? Math.min(vts.length, 5) : W >= 700 ? 2 : 1;
        gv.style.gridTemplateColumns = 'repeat(' + vc + ', minmax(0,1fr))';
        vts.forEach(function (v) {
          var t = tone(v.tone);
          var c = div('hsa-vt', gv);
          c.style.setProperty('--tone', t.color);
          div('hsa-dot', c);
          var body = div(null, c);
          div('hsa-vt-name', body, v.vertical || '');
          div('hsa-vt-detail', body, v.detail || '');
        });
      }

      // Watch next
      if (opt('show_watch') && get('watch_next')) {
        var w = div('hsa-watch', card);
        div('hsa-watch-label', w, 'Watch next');
        div('hsa-watch-text', w, get('watch_next'));
      }

      if (opt('show_footer')) {
        div('hsa-foot', card, 'Generated with Gemini from dashboard data' +
          (get('generated_at') ? ' on ' + get('generated_at') + ' (Riyadh)' : '') +
          '. Directional - verify key numbers before sharing.');
      }
      done();
    }
  });
})();
