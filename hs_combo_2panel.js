/**
 * HungerStation - "Combo chart with 2nd panel" (Looker custom visualization)
 * ---------------------------------------------------------------------------
 * Main panel : Delivery NPS bars (left axis) + Avg DT line (left axis)
 *              + Delay % / DT>60 % / Failure % / On-time % lines (right axis)
 * 2nd panel  : NPS survey volume bars hanging below the main panel
 *
 * Small multiples: if the query contains a `vertical` dimension, one chart is
 * drawn per vertical. Filter the dashboard to a single vertical and the other
 * charts disappear, the remaining one fills the tile.
 *
 * Series are matched by measure name (last part after the dot):
 *   delivery_nps | nps_survey_volume | avg_delivery_time | delay_pct |
 *   dt_gt_60_pct | failure_rate | ontime_pct
 * No external dependencies.
 */
(function () {
  'use strict';

  var VIZ_ID = 'hs_combo_2panel';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var HS = {
    yellow: '#FBEF00',
    cream: '#FEFFF8',
    brown: '#5E2D20',
    blue: '#13B1E2',
    pink: '#ED2FB7',
    sky: '#D4E9FF',
    orange: '#F57C00',
    grid: '#EFE9DC',
    muted: '#8C7268',
    up: '#1E9E5A',
    down: '#D6336C'
  };

  var SERIES = [
    { key: 'nps',     names: ['delivery_nps', 'nps'],                          label: 'Delivery NPS',  kind: 'bar',    axis: 'left' },
    { key: 'surveys', names: ['nps_survey_volume', 'nps_surveys', 'survey_volume'], label: 'NPS surveys', kind: 'bar2', axis: 'bottom' },
    { key: 'dt',      names: ['avg_delivery_time', 'dt_average_mins', 'avg_dt'], label: 'Avg DT (min)', kind: 'line', axis: 'left',  marker: 'square',   dash: null },
    { key: 'delay',   names: ['delay_pct', 'delay_rate'],                      label: 'Delay %',       kind: 'line',   axis: 'right', marker: 'circle',   dash: null },
    { key: 'dt60',    names: ['dt_gt_60_pct', 'dt_60_pct'],                    label: 'DT>60 min %',       kind: 'line',   axis: 'right', marker: 'diamond',  dash: '7 4' },
    { key: 'failure', names: ['failure_rate', 'fr_pct', 'failure_pct'],        label: 'Failure %',     kind: 'line',   axis: 'right', marker: 'triangle', dash: '1 4' },
    { key: 'ontime',  names: ['ontime_pct', 'on_time_pct'],                    label: 'On-time %',     kind: 'line',   axis: 'right', marker: 'circle',   dash: '9 3 2 3' }
  ];

  var DEFAULT_ORDER = 'overall,restaurants,hsm,local_shops,multivertical';
  var PRETTY = { overall: 'Overall', restaurants: 'Restaurants', hsm: 'HSM', local_shops: 'Local shops', multivertical: 'Multivertical' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function div(cls, parent, text) {
    var n = document.createElement('div');
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function shortName(name) { return String(name).split('.').pop().toLowerCase(); }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }
  function fmtNum(v, dp) {
    if (v === null) return '\u2013';
    return (Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp)).toFixed(dp);
  }
  function fmtPct(v, dp) { return v === null ? '\u2013' : (v * 100).toFixed(dp) + '%'; }
  function fmtCompact(v) {
    if (v === null) return '\u2013';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
  function cellText(cell) {
    if (!cell) return '';
    try {
      if (window.LookerCharts && LookerCharts.Utils && LookerCharts.Utils.textForCell) return LookerCharts.Utils.textForCell(cell);
    } catch (e) { /* ignore */ }
    return cell.rendered !== undefined && cell.rendered !== null ? String(cell.rendered) : String(cell.value);
  }
  function monthKey(v) {
    // Accepts "2026-09", "2026-09-01", Date-ish strings
    var s = String(v || '');
    var m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return { y: +m[1], m: +m[2] };
    var d = new Date(s);
    return isNaN(d) ? null : { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  function prettyVertical(v) {
    var k = String(v).toLowerCase();
    return PRETTY[k] || String(v).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // ------------------------------------------------------------------ styles
  var CSS = [
    '.hsc{position:relative;width:100%;height:100%;box-sizing:border-box;overflow-x:hidden;overflow-y:auto;',
    'font-family:"Google Sans","Inter",Roboto,"Helvetica Neue",Arial,sans-serif;color:#5E2D20;background:transparent}',
    '.hsc *{box-sizing:border-box}',
    '.hsc-legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:center;padding:2px 8px 8px;font-size:12px;color:#5E2D20}',
    '.hsc-li{display:flex;align-items:center;gap:6px;white-space:nowrap}',
    '.hsc-grid{display:flex;flex-wrap:wrap;gap:12px}',
    '.hsc-panel{background:#FEFFF8;border:1px solid #EFE6CF;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}',
    '.hsc-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:9px 14px 0;min-height:34px}',
    '.hsc-title{font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px}',
    '.hsc-title:before{content:"";width:10px;height:10px;border-radius:3px;background:#FBEF00;box-shadow:0 0 0 1px #E3D400}',
    '.hsc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}',
    '.hsc-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:#FFFBCC;color:#5E2D20;white-space:nowrap}',
    '.hsc-chip b{font-weight:700}',
    '.hsc-svg{display:block;flex:1 1 auto}',
    '.hsc-tip{position:absolute;pointer-events:none;z-index:10;background:#5E2D20;color:#FEFFF8;border-radius:10px;padding:8px 10px;',
    'font-size:12px;line-height:1.45;box-shadow:0 6px 18px rgba(94,45,32,.25);min-width:160px;display:none}',
    '.hsc-tip .t{font-weight:700;margin-bottom:4px;color:#FBEF00}',
    '.hsc-tip .r{display:flex;justify-content:space-between;gap:14px}',
    '.hsc-tip .sw{display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid #FEFFF8;margin-right:6px;vertical-align:middle}',
    '.hsc-empty{padding:24px;text-align:center;color:#8C7268;font-size:13px}'
  ].join('');

  // ------------------------------------------------------------------ viz
  looker.plugins.visualizations.add({
    id: VIZ_ID,
    label: 'Combo chart with 2nd panel',

    options: {
      // Layout
      panel_columns: { section: 'Layout', order: 1, type: 'string', label: 'Charts per row', display: 'select',
        values: [{ 'Auto': 'auto' }, { '1': '1' }, { '2': '2' }, { '3': '3' }, { '4': '4' }], default: 'auto' },
      vertical_order: { section: 'Layout', order: 2, type: 'string', label: 'Vertical order (comma separated)', default: DEFAULT_ORDER },
      min_panel_height: { section: 'Layout', order: 3, type: 'number', label: 'Min chart height (px)', default: 300 },
      survey_panel_ratio: { section: 'Layout', order: 4, type: 'number', label: '2nd panel height (0.15-0.5)', default: 0.28 },
      show_legend: { section: 'Layout', order: 5, type: 'boolean', label: 'Show legend', default: true },
      show_header_kpis: { section: 'Layout', order: 6, type: 'boolean', label: 'Show latest-month KPI chips', default: true },
      mtd_label: { section: 'Layout', order: 7, type: 'boolean', label: 'Add "MTD" to current month', default: true },
      single_title: { section: 'Layout', order: 8, type: 'string', label: 'Title when no vertical dimension', default: 'Overall' },

      // Series
      show_value_labels: { section: 'Series', order: 1, type: 'boolean', label: 'Bar value labels', default: true },
      show_end_labels: { section: 'Series', order: 2, type: 'boolean', label: 'Last-point line labels', default: true },
      show_dt: { section: 'Series', order: 3, type: 'boolean', label: 'Show Avg DT', default: true },
      show_delay: { section: 'Series', order: 4, type: 'boolean', label: 'Show Delay %', default: true },
      show_dt60: { section: 'Series', order: 5, type: 'boolean', label: 'Show DT>60 min %', default: true },
      show_failure: { section: 'Series', order: 6, type: 'boolean', label: 'Show Failure %', default: true },
      show_ontime: { section: 'Series', order: 7, type: 'boolean', label: 'Show On-time %', default: false },
      left_axis_max: { section: 'Series', order: 8, type: 'number', label: 'Left axis max (blank = auto)' },
      right_axis_max: { section: 'Series', order: 9, type: 'number', label: 'Right axis max, decimal e.g. 0.15 (blank = auto)' },

      // Colors (HungerStation)
      color_nps: { section: 'Colors', order: 1, type: 'string', display: 'color', label: 'Delivery NPS', default: HS.yellow },
      color_surveys: { section: 'Colors', order: 2, type: 'string', display: 'color', label: 'NPS surveys', default: HS.sky },
      color_dt: { section: 'Colors', order: 3, type: 'string', display: 'color', label: 'Avg DT', default: HS.brown },
      color_delay: { section: 'Colors', order: 4, type: 'string', display: 'color', label: 'Delay %', default: HS.pink },
      color_dt60: { section: 'Colors', order: 5, type: 'string', display: 'color', label: 'DT>60 min %', default: HS.blue },
      color_failure: { section: 'Colors', order: 6, type: 'string', display: 'color', label: 'Failure %', default: HS.orange },
      color_ontime: { section: 'Colors', order: 7, type: 'string', display: 'color', label: 'On-time %', default: '#1E9E5A' }
    },

    create: function (element) {
      var style = document.createElement('style');
      style.textContent = CSS;
      element.appendChild(style);
      this._root = div('hsc', element);
      this._tip = div('hsc-tip', this._root);
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      try {
        this.clearErrors();
        config = config || {};
        var opt = function (k) {
          var o = this.options[k];
          return config[k] === undefined || config[k] === null || config[k] === '' ? (o ? o.default : undefined) : config[k];
        }.bind(this);

        var dims = (queryResponse.fields.dimension_like || []);
        var meas = (queryResponse.fields.measure_like || []).concat(queryResponse.fields.table_calculations || []);

        if (queryResponse.fields.pivots && queryResponse.fields.pivots.length) {
          this.addError({ title: 'Remove pivots', message: 'This chart groups by the vertical dimension itself - please un-pivot.' });
          return done();
        }

        // Field mapping
        var vField = null, mField = null;
        dims.forEach(function (f) {
          var s = shortName(f.name);
          if (!vField && /vertical$/.test(s)) vField = f;
        });
        dims.forEach(function (f) {
          if (mField || f === vField) return;
          if (/month|date|week|quarter|year/.test(shortName(f.name)) || f.is_timeframe) mField = f;
        });
        if (!mField) mField = dims.filter(function (f) { return f !== vField; })[0];

        var map = {};
        SERIES.forEach(function (s) {
          var f = meas.filter(function (m) { return s.names.indexOf(shortName(m.name)) !== -1; })[0];
          if (f) map[s.key] = f;
        });

        if (!mField || !map.nps) {
          this.addError({ title: 'Missing fields', message: 'Needs a month dimension and the delivery_nps measure (optional: vertical, nps_survey_volume, avg_delivery_time, delay_pct, dt_gt_60_pct, failure_rate, ontime_pct).' });
          return done();
        }

        var colors = {
          nps: opt('color_nps'), surveys: opt('color_surveys'), dt: opt('color_dt'), delay: opt('color_delay'),
          dt60: opt('color_dt60'), failure: opt('color_failure'), ontime: opt('color_ontime')
        };
        var active = SERIES.filter(function (s) {
          if (!map[s.key]) return false;
          if (s.kind === 'line') return !!opt('show_' + s.key);
          return true;
        });

        // Group rows
        var groups = {}, order = [];
        data.forEach(function (row) {
          var vk = vField ? String(row[vField.name].value) : '__single__';
          if (!groups[vk]) { groups[vk] = []; order.push(vk); }
          var mk = monthKey(row[mField.name].value);
          var rec = { row: row, key: mk, raw: row[mField.name].value, text: cellText(row[mField.name]), v: {} };
          active.forEach(function (s) { rec.v[s.key] = num(row[map[s.key].name].value); });
          groups[vk].push(rec);
        });
        var pref = String(opt('vertical_order') || DEFAULT_ORDER).split(',').map(function (x) { return x.trim().toLowerCase(); });
        order.sort(function (a, b) {
          var ia = pref.indexOf(a.toLowerCase()), ib = pref.indexOf(b.toLowerCase());
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
        });
        order.forEach(function (k) {
          groups[k].sort(function (a, b) {
            if (a.key && b.key) return (a.key.y - b.key.y) || (a.key.m - b.key.m);
            return String(a.raw).localeCompare(String(b.raw));
          });
        });

        // ---- Build DOM
        var root = this._root, tip = this._tip;
        while (root.firstChild) root.removeChild(root.firstChild);
        root.appendChild(tip);
        tip.style.display = 'none';

        if (!data.length) {
          div('hsc-empty', root, 'No results');
          return done();
        }

        var W = element.clientWidth || 800;
        var H = element.clientHeight || 500;

        if (opt('show_legend')) this._legend(root, active, colors);
        var legendH = opt('show_legend') ? (root.querySelector('.hsc-legend').offsetHeight || 30) : 0;

        var n = order.length;
        var colsOpt = String(opt('panel_columns'));
        var cols;
        if (colsOpt === 'auto') {
          // Balanced grid: 2 -> 2x1, 3 -> 3x1, 4 -> 2x2, 5-6 -> 3 per row
          if (n === 1 || W < 760) cols = 1;
          else if (n === 2 || n === 4) cols = 2;
          else if (n === 3) cols = W >= 1100 ? 3 : 1;
          else cols = W >= 1100 ? 3 : 2;
        }
        else cols = Math.max(1, Math.min(n, parseInt(colsOpt, 10) || 1));
        var rows = Math.ceil(n / cols);
        var gap = 12;
        var minH = Math.max(200, num(opt('min_panel_height')) || 300);
        var panelH = Math.max(minH, Math.floor((H - legendH - gap * (rows - 1) - 2) / rows));

        var grid = div('hsc-grid', root);
        var scrollW = panelH * rows + gap * (rows - 1) + legendH > H ? 12 : 0;
        // Panels in a shorter last row stretch to use the full width (no empty gaps)
        var widthFor = function (i) {
          var row = Math.floor(i / cols);
          var inRow = row < rows - 1 ? cols : n - cols * (rows - 1);
          return Math.floor((W - scrollW - gap * (inRow - 1)) / inRow);
        };

        var self = this;
        var now = new Date();
        order.forEach(function (vk, i) {
          var title = vk === '__single__' ? (opt('single_title') || '') : prettyVertical(vk);
          self._panel(grid, groups[vk], title, active, map, colors, opt, widthFor(i), panelH, now, tip, root);
        });
      } catch (err) {
        this.addError({ title: 'Chart error', message: String(err && err.message || err) });
        if (window.console) console.error(err);
      }
      done();
    },

    // ---------------------------------------------------------------- legend
    _legend: function (root, active, colors) {
      var lg = div('hsc-legend', root);
      active.forEach(function (s) {
        var li = div('hsc-li', lg);
        var sv = el('svg', { width: 26, height: 12 });
        if (s.kind === 'bar' || s.kind === 'bar2') {
          el('rect', { x: 6, y: 0, width: 14, height: 12, rx: 3, fill: colors[s.key], stroke: s.kind === 'bar' ? '#E3D400' : '#A9CFF5' }, sv);
        } else {
          el('line', { x1: 1, x2: 25, y1: 6, y2: 6, stroke: colors[s.key], 'stroke-width': 2.5, 'stroke-dasharray': s.dash, 'stroke-linecap': 'round' }, sv);
          drawMarker(sv, s.marker, 13, 6, 3.5, colors[s.key]);
        }
        li.appendChild(sv);
        div(null, li, s.label);
      });
    },

    // ---------------------------------------------------------------- panel
    _panel: function (grid, recs, title, active, map, colors, opt, W, H, now, tip, root) {
      var panel = div('hsc-panel', grid);
      panel.style.height = H + 'px';
      panel.style.width = W + 'px';
      panel.style.flex = '0 0 ' + W + 'px';
      var head = div('hsc-head', panel);
      div('hsc-title', head, title);

      var has = function (k) { return active.some(function (s) { return s.key === k; }); };

      // KPI chips (latest month + change vs previous)
      if (opt('show_header_kpis') && recs.length) {
        var chips = div('hsc-chips', head);
        var last = recs[recs.length - 1], prev = recs.length > 1 ? recs[recs.length - 2] : null;
        var chip = function (label, key, fmt, betterUp, deltaFmt) {
          if (!has(key) || last.v[key] === null) return;
          var c = div('hsc-chip', chips);
          c.appendChild(document.createTextNode(label + ' '));
          var b = document.createElement('b'); b.textContent = fmt(last.v[key]); c.appendChild(b);
          if (prev && prev.v[key] !== null) {
            var d = last.v[key] - prev.v[key];
            if (Math.abs(d) > 1e-9) {
              var good = betterUp ? d > 0 : d < 0;
              var sp = document.createElement('span');
              sp.style.color = good ? HS.up : HS.down;
              sp.style.marginLeft = '4px';
              sp.textContent = (d > 0 ? '\u25B2' : '\u25BC') + deltaFmt(Math.abs(d));
              c.appendChild(sp);
            }
          }
        };
        chip('NPS', 'nps', function (v) { return fmtNum(v, 1); }, true, function (d) { return fmtNum(d, 1); });
        chip('DT', 'dt', function (v) { return fmtNum(v, 1) + 'm'; }, false, function (d) { return fmtNum(d, 1); });
        chip('Delay', 'delay', function (v) { return fmtPct(v, 1); }, false, function (d) { return (d * 100).toFixed(1) + 'pp'; });
        chip('Fail', 'failure', function (v) { return fmtPct(v, 1); }, false, function (d) { return (d * 100).toFixed(1) + 'pp'; });
      }

      var headH = head.offsetHeight || 34;
      var svgH = Math.max(160, H - headH - 2);
      var svg = el('svg', { class: 'hsc-svg', width: W, height: svgH, viewBox: '0 0 ' + W + ' ' + svgH }, panel);

      var lineSeries = active.filter(function (s) { return s.kind === 'line'; });
      var rightLines = lineSeries.filter(function (s) { return s.axis === 'right'; });
      var hasSurveys = has('surveys');
      var endLabels = !!opt('show_end_labels') && lineSeries.length > 0;

      var mL = 52, mR = 46 + (endLabels ? 52 : 0), mT = 28, mB = 26;
      var plotL = mL, plotR = W - mR, plotW = Math.max(40, plotR - plotL);
      var plotT = mT, plotB = svgH - mB, plotH = Math.max(60, plotB - plotT);
      var ratio = Math.min(0.5, Math.max(0.15, num(opt('survey_panel_ratio')) || 0.28));
      var gapMid = hasSurveys ? 8 : 0;
      var mainH = hasSurveys ? Math.round(plotH * (1 - ratio)) : plotH;
      var zeroY0 = plotT + mainH;                 // bottom of main panel
      var subT = zeroY0 + gapMid, subB = plotB;   // 2nd panel

      // ---- scales (left: NPS + DT, right: %), gridlines aligned
      var leftVals = [], rightVals = [];
      recs.forEach(function (r) {
        if (r.v.nps !== null) leftVals.push(r.v.nps);
        if (has('dt') && r.v.dt !== null) leftVals.push(r.v.dt);
        rightLines.forEach(function (s) { if (r.v[s.key] !== null) rightVals.push(r.v[s.key]); });
      });
      var lMaxData = num(opt('left_axis_max')) || Math.max(1, Math.max.apply(null, leftVals.concat([0])) * 1.12);
      var lMinData = Math.min(0, Math.min.apply(null, leftVals.concat([0])) * 1.12);
      var step = null, lMin, lMax;
      [4, 5, 3].forEach(function (iv) {
        var st = niceStep((lMaxData - lMinData) / iv);
        var mn = Math.floor(lMinData / st) * st, mx = Math.ceil(lMaxData / st) * st;
        if (step === null || (mx - mn) < (lMax - lMin) - 1e-9) { step = st; lMin = mn; lMax = mx; }
      });
      var k = Math.round((lMax - lMin) / step);
      var z = Math.round(-lMin / step);
      var pos = Math.max(1, k - z);
      var rMaxData = num(opt('right_axis_max')) || Math.max(0.01, Math.max.apply(null, rightVals.concat([0])) * 1.12);
      var rStep = niceStep(rMaxData / pos);
      var rMax = rStep * pos, rMin = -rStep * z;

      var yL = function (v) { return plotT + mainH - (v - lMin) / (lMax - lMin) * mainH; };
      var yR = function (v) { return plotT + mainH - (v - rMin) / (rMax - rMin) * mainH; };
      var zeroY = yL(0);

      var n = recs.length;
      var band = plotW / Math.max(1, n);
      var barW = Math.max(6, Math.min(58, band * 0.6));
      var xc = function (i) { return plotL + band * (i + 0.5); };

      var gAxis = el('g', {}, svg);
      var rDec = Math.abs(rStep * 100 - Math.round(rStep * 100)) < 1e-6 ? 0 : 1;
      for (var t = 0; t <= k; t++) {
        var lv = lMin + t * step, yy = yL(lv);
        el('line', { x1: plotL, x2: plotR + (endLabels ? 52 : 0), y1: yy, y2: yy, stroke: lv === 0 ? '#D9CDB5' : HS.grid, 'stroke-width': 1 }, gAxis);
        txt(gAxis, plotL - 8, yy + 4, fmtAxis(lv), { anchor: 'end', size: 11, fill: HS.muted });
        var rv = rMin + t * rStep;
        if (rightLines.length && rv >= -1e-9) {
          txt(gAxis, W - mR + (endLabels ? 52 : 0) + 8, yy + 4, parseFloat((rv * 100).toFixed(rDec)) + '%', { anchor: 'start', size: 11, fill: HS.muted });
        }
      }
      txt(gAxis, 4, plotT - 14, has('dt') ? 'NPS \u00B7 min' : 'NPS', { anchor: 'start', size: 10, fill: HS.muted });

      // ---- 2nd panel: survey bars hanging down
      var gBars = el('g', {}, svg);
      if (hasSurveys) {
        var sMax = Math.max(1, Math.max.apply(null, recs.map(function (r) { return r.v.surveys || 0; })) * 1.08);
        var subH = Math.max(10, subB - subT);
        el('rect', { x: plotL, y: subT, width: plotW, height: subH, fill: '#F7FBFF', rx: 6 }, gBars);
        txt(gBars, plotL - 8, subT + 12, 'Surveys', { anchor: 'end', size: 10, fill: HS.muted });
        recs.forEach(function (r, i) {
          if (r.v.surveys === null) return;
          var h = r.v.surveys / sMax * subH;
          var x = xc(i) - barW / 2;
          el('path', { d: roundedBottomBar(x, subT, barW, h, 5), fill: colors.surveys }, gBars);
          el('line', { x1: x, x2: x + barW, y1: subT, y2: subT, stroke: HS.blue, 'stroke-width': 2 }, gBars);
          if (opt('show_value_labels') && band > 26) {
            var label = cellText(r.row[map.surveys.name]) || fmtCompact(r.v.surveys);
            var inside = h > 22;
            txt(gBars, xc(i), inside ? subT + h - 7 : subT + h + 12, label, { anchor: 'middle', size: 11, weight: 700, fill: HS.brown });
          }
        });
      }

      // ---- main bars: Delivery NPS
      recs.forEach(function (r, i) {
        if (r.v.nps === null) return;
        var y1 = yL(r.v.nps);
        var top = Math.min(y1, zeroY), h = Math.abs(zeroY - y1);
        var x = xc(i) - barW / 2;
        var bar = el('path', { d: r.v.nps >= 0 ? roundedTopBar(x, top, barW, h, 6) : roundedBottomBar(x, top, barW, h, 6),
          fill: colors.nps, stroke: '#E3D400', 'stroke-width': 1, style: 'cursor:pointer' }, gBars);
        bar.addEventListener('click', drill(r.row[map.nps.name]));
      });

      // ---- value labels on NPS bars (near the base -> no collision with lines)
      var gLabels = el('g', {}, svg);
      if (opt('show_value_labels') && band > 24) {
        recs.forEach(function (r, i) {
          if (r.v.nps === null) return;
          var h = Math.abs(zeroY - yL(r.v.nps));
          var label = fmtNum(r.v.nps, 1);
          var y;
          if (h >= 26) y = r.v.nps >= 0 ? zeroY - 9 : zeroY + 17;
          else y = r.v.nps >= 0 ? yL(r.v.nps) - 6 : yL(r.v.nps) + 14;
          pill(gLabels, xc(i), y, label, h >= 26);
        });
      }

      // ---- lines
      var gLines = el('g', {}, svg);
      var ends = [];
      lineSeries.forEach(function (s) {
        var yf = s.axis === 'right' ? yR : yL;
        var pts = recs.map(function (r, i) { return r.v[s.key] === null ? null : [xc(i), yf(r.v[s.key])]; });
        var d = '', pen = false;
        pts.forEach(function (p) {
          if (!p) { pen = false; return; }
          d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
          pen = true;
        });
        if (!d) return;
        el('path', { d: d, fill: 'none', stroke: HS.cream, 'stroke-width': 5.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.9 }, gLines);
        el('path', { d: d, fill: 'none', stroke: colors[s.key], 'stroke-width': 2.5, 'stroke-dasharray': s.dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, gLines);
        pts.forEach(function (p) { if (p) drawMarker(gLines, s.marker, p[0], p[1], 4.2, colors[s.key], HS.cream); });
        var li = -1;
        for (var q = pts.length - 1; q >= 0; q--) if (pts[q]) { li = q; break; }
        if (li >= 0) {
          var v = recs[li].v[s.key];
          ends.push({ y: pts[li][1], x: pts[li][0], text: s.axis === 'right' ? fmtPct(v, 1) : fmtNum(v, 1) + 'm', color: colors[s.key] });
        }
      });

      // ---- end labels with simple collision avoidance
      if (endLabels && ends.length) {
        ends.sort(function (a, b) { return a.y - b.y; });
        for (var e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 14) ends[e].y = ends[e - 1].y + 14;
        var overflow = ends[ends.length - 1].y - (plotT + mainH - 4);
        if (overflow > 0) ends.forEach(function (o) { o.y -= overflow; });
        var ex = xc(n - 1) + barW / 2 + 6;
        ends.forEach(function (o) {
          txt(gLines, ex, o.y + 4, o.text, { anchor: 'start', size: 12, weight: 700, fill: o.color, halo: true });
        });
      }

      // ---- x axis labels
      var gX = el('g', {}, svg);
      var every = Math.max(1, Math.ceil(62 / band));
      recs.forEach(function (r, i) {
        if (i % every !== 0 && i !== n - 1) return;
        var lbl = r.key ? MONTHS[r.key.m - 1] + "'" + String(r.key.y).slice(2) : r.text;
        if (opt('mtd_label') && r.key && r.key.y === now.getFullYear() && r.key.m === now.getMonth() + 1) lbl += ' MTD';
        txt(gX, xc(i), svgH - 8, lbl, { anchor: 'middle', size: 11, fill: HS.brown });
      });

      // ---- hover / tooltip
      var gHover = el('g', {}, svg);
      var hl = el('rect', { x: 0, y: plotT, width: band, height: plotB - plotT, fill: HS.brown, opacity: 0, rx: 6, 'pointer-events': 'none' }, gHover);
      gBars.parentNode.insertBefore(hl, gBars);
      recs.forEach(function (r, i) {
        var hit = el('rect', { x: plotL + band * i, y: plotT, width: band, height: plotB - plotT, fill: 'transparent' }, gHover);
        hit.addEventListener('mousemove', function (ev) {
          hl.setAttribute('x', plotL + band * i + 2); hl.setAttribute('width', Math.max(0, band - 4)); hl.setAttribute('opacity', 0.05);
          showTip(ev, r, i);
        });
        hit.addEventListener('mouseleave', function () { hl.setAttribute('opacity', 0); tip.style.display = 'none'; });
        hit.addEventListener('click', drill(r.row[map.nps.name]));
      });

      function showTip(ev, r, i) {
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        var monthTxt = r.key ? MONTHS[r.key.m - 1] + ' ' + r.key.y : String(r.raw);
        div('t', tip, (title ? title + ' \u00B7 ' : '') + monthTxt);
        active.forEach(function (s) {
          var row = div('r', tip);
          var left = div(null, row);
          var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = colors[s.key];
          left.appendChild(sw); left.appendChild(document.createTextNode(s.label));
          var val = r.row[map[s.key].name];
          div(null, row, r.v[s.key] === null ? '\u2013' : (cellText(val) || String(r.v[s.key])));
        });
        tip.style.display = 'block';
        var rb = root.getBoundingClientRect();
        var x = ev.clientX - rb.left + root.scrollLeft + 14;
        var y = ev.clientY - rb.top + root.scrollTop + 14;
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        if (x + tw > root.clientWidth - 4) x = ev.clientX - rb.left - tw - 14;
        if (y + th > root.scrollTop + root.clientHeight - 4) y = ev.clientY - rb.top + root.scrollTop - th - 10;
        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top = Math.max(4, y) + 'px';
      }
    }
  });

  // ------------------------------------------------------------------ drawing utils
  function txt(parent, x, y, s, o) {
    o = o || {};
    var attrs = { x: x, y: y, 'text-anchor': o.anchor || 'start', 'font-size': o.size || 11, 'font-weight': o.weight || 400, fill: o.fill || HS.brown };
    if (o.halo) {
      var h = el('text', Object.assign({}, attrs, { fill: HS.cream, stroke: HS.cream, 'stroke-width': 4, 'stroke-linejoin': 'round' }), parent);
      h.textContent = s;
    }
    var t = el('text', attrs, parent);
    t.textContent = s;
    return t;
  }
  function pill(parent, x, y, s, onBar) {
    var w = s.length * 6.6 + 10, h = 16;
    el('rect', { x: x - w / 2, y: y - 12, width: w, height: h, rx: 8, fill: onBar ? HS.brown : 'transparent' }, parent);
    txt(parent, x, y, s, { anchor: 'middle', size: 11, weight: 700, fill: onBar ? HS.yellow : HS.brown });
  }
  function fmtAxis(v) {
    var a = Math.abs(v);
    if (a >= 1000) return fmtCompact(v);
    return (Math.round(v * 10) / 10).toString();
  }
  function roundedTopBar(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function roundedBottomBar(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ',' + y + 'V' + (y + h - r) + 'Q' + x + ',' + (y + h) + ' ' + (x + r) + ',' + (y + h) +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w) + ',' + (y + h - r) + 'V' + y + 'Z';
  }
  function drawMarker(parent, type, x, y, r, color, outline) {
    var common = { fill: color, stroke: outline || 'none', 'stroke-width': outline ? 1.5 : 0 };
    if (type === 'square') return el('rect', Object.assign({ x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1 }, common), parent);
    if (type === 'diamond') { var d = r * 1.3; return el('path', Object.assign({ d: 'M' + x + ',' + (y - d) + 'L' + (x + d) + ',' + y + 'L' + x + ',' + (y + d) + 'L' + (x - d) + ',' + y + 'Z' }, common), parent); }
    if (type === 'triangle') { var tr = r * 1.3; return el('path', Object.assign({ d: 'M' + x + ',' + (y - tr) + 'L' + (x + tr) + ',' + (y + tr * 0.8) + 'L' + (x - tr) + ',' + (y + tr * 0.8) + 'Z' }, common), parent); }
    return el('circle', Object.assign({ cx: x, cy: y, r: r }, common), parent);
  }
  function drill(cell) {
    return function (ev) {
      if (!cell || !cell.links || !cell.links.length) return;
      try { LookerCharts.Utils.openDrillMenu({ links: cell.links, event: ev }); } catch (e) { /* ignore */ }
    };
  }
})();
