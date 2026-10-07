/**
 * hs_vsat_cr_table.js — Looker custom visualization
 * Replicates the "VSAT per Chat CR / Non Live Cases CRs — WoW Performance" tables:
 *   contact reasons as ROWS, weeks (or months) as COLUMNS, then WOW, Trend, "W32 % Share".
 *
 * QUERY SHAPE (flat, or with the week dimension pivoted)
 *   - 1 time dimension      e.g. all_contacts.created_week_monday
 *   - 1 category dimension  e.g. all_contacts.contact_reason_l3
 *   - measure 1 = RATE           e.g. all_contacts.positive_sat_percentage
 *   - measure 2 = SURVEY VOLUME  e.g. all_contacts.count_surveys_filled   (optional; used to grey out tiny samples)
 *   - measure 3 = SHARE BASIS    e.g. all_contacts.count                  (optional; if absent, measure 2 is used)
 *
 * % Share = share-basis of the row / total share-basis in the latest period shown.
 * Rows are sorted by that share (desc). WOW = difference in points of the last 2 periods.
 */
(function () {
  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAY = 864e5;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
  function hex(c) { c = String(c || "#ffffff").replace("#", ""); if (c.length === 3) c = c.split("").map(function (x) { return x + x; }).join(""); var n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function scale3(t, bad, mid, good) { t = Math.max(0, Math.min(1, t)); var c = t < 0.5 ? mix(bad, mid, t / 0.5) : mix(mid, good, (t - 0.5) / 0.5); return "rgb(" + c.join(",") + ")"; }
  function parseDay(v) { var m = String(v == null ? "" : v).slice(0, 10).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/); return m ? Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) : null; }
  function isoWeek(ms) { var d = new Date(ms), day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); var j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - j) / DAY - 3 + ((j.getUTCDay() + 6) % 7)) / 7); }
  function minMax(a) { var n = a.filter(function (v) { return v !== null; }); return n.length ? [Math.min.apply(null, n), Math.max.apply(null, n)] : [null, null]; }
  function isPctField(f, vals) {
    if (((f.value_format || "") + (f.format || "")).indexOf("%") >= 0) return true;
    if (/percent|rate|%|share|vsat|csat|sat/i.test((f.label || "") + " " + f.name)) {
      var n = vals.filter(function (v) { return v !== null; });
      return n.length > 0 && n.every(function (v) { return v >= 0 && v <= 1.5; });
    }
    return false;
  }
  function buildPeriods(raws, dimName, config) {
    var seen = {}, list = [];
    raws.forEach(function (v) { if (v == null) return; var k = String(v); if (!seen[k]) { seen[k] = 1; list.push({ raw: k, ms: parseDay(k) }); } });
    var allDates = list.length && list.every(function (p) { return p.ms !== null; });
    var grain = config.grain || "auto";
    if (grain === "auto") {
      if (/week/i.test(dimName)) grain = "week";
      else if (/month/i.test(dimName)) grain = "month";
      else if (allDates && list.length > 1) { var s = list.map(function (p) { return p.ms; }).sort(function (a, b) { return a - b; }); grain = s[1] - s[0] <= 7 * DAY ? "week" : "month"; }
      else grain = "week";
    }
    var now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var off = Number(config.week_offset) || 0;
    list.forEach(function (p) {
      p.label = p.raw; p.isCurrent = false; p.sort = p.ms;
      if (p.ms !== null) {
        var d = new Date(p.ms);
        if (grain === "week") { p.label = "W" + String(isoWeek(p.ms + 3 * DAY) + off).padStart(2, "0"); p.isCurrent = today >= p.ms && today < p.ms + 7 * DAY; }
        else { p.label = MON[d.getUTCMonth()]; p.isCurrent = d.getUTCFullYear() === now.getFullYear() && d.getUTCMonth() === now.getMonth(); }
        if (p.isCurrent && config.show_partial_tag !== false) p.label += grain === "week" ? " WTD" : " MTD";
      } else { var n = Number(p.raw); p.sort = isFinite(n) ? n : p.raw; if (grain === "week" && isFinite(n)) p.label = "W" + String(n + off).padStart(2, "0"); }
    });
    list.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    return { grain: grain, list: list };
  }

  looker.plugins.visualizations.add({
    id: "hs_vsat_cr_table",
    label: "HS VSAT Contact Reason Table (WoW)",
    options: {
      pill_title:       { type: "string",  label: "Title pill (e.g. WoW Performance)", default: "", section: "Layout", order: 1 },
      corner_label:     { type: "string",  label: "Top-left header label (e.g. Live Chat CRs)", default: "", section: "Layout", order: 2 },
      bold_labels:      { type: "boolean", label: "Bold row labels", default: true, section: "Layout", order: 3 },
      grain:            { type: "string",  label: "Period grain", display: "select", default: "auto", values: [{ "Auto": "auto" }, { "Month": "month" }, { "Week": "week" }], section: "Layout", order: 4 },
      show_partial_tag: { type: "boolean", label: "Tag current period (WTD / MTD)", default: true, section: "Layout", order: 5 },
      week_offset:      { type: "number",  label: "Week number offset vs ISO", default: 0, section: "Layout", order: 6 },
      show_trend:       { type: "boolean", label: "Show Trend column", default: true, section: "Layout", order: 7 },
      show_share:       { type: "boolean", label: "Show % Share column", default: true, section: "Layout", order: 8 },
      sort_by:          { type: "string",  label: "Sort rows", display: "select", default: "share", values: [{ "% Share (desc)": "share" }, { "Query order": "none" }, { "A–Z": "alpha" }], section: "Layout", order: 9 },
      top_n:            { type: "number",  label: "Show top N rows (0 = all)", default: 15, section: "Layout", order: 10 },
      hide_rows:        { type: "string",  label: "Hide rows (comma-sep names; still counted in % Share)", default: "", section: "Layout", order: 11 },
      drop_empty:       { type: "boolean", label: "Hide rows with no VSAT in any period", default: true, section: "Layout", order: 12 },
      decimals:         { type: "number",  label: "Decimals for %", default: 0, section: "Values", order: 1 },
      show_plus:        { type: "boolean", label: "Show + sign on positive deltas", default: false, section: "Values", order: 2 },
      delta_bold_text:  { type: "boolean", label: "WOW: bold coloured text (Non-Live style)", default: false, section: "Values", order: 3 },
      higher_is_better: { type: "boolean", label: "Higher is better", default: true, section: "Values", order: 4 },
      shade_scope:      { type: "string",  label: "Shading scale", display: "select", default: "row", values: [{ "Per row": "row" }, { "Whole table": "table" }, { "None": "none" }], section: "Values", order: 5 },
      min_volume:       { type: "number",  label: "Don't shade cells with fewer surveys than", default: 5, section: "Values", order: 6 },
      header_bg:        { type: "string",  label: "Header background", default: "#FFE600", display: "color", section: "Colours", order: 1 },
      firstcol_bg:      { type: "string",  label: "Row-label background", default: "#FFFFFF", display: "color", section: "Colours", order: 2 },
      title_bg:         { type: "string",  label: "Title pill background", default: "#5B2A12", display: "color", section: "Colours", order: 3 },
      grid_color:       { type: "string",  label: "Grid line colour", default: "#BDBDBD", display: "color", section: "Colours", order: 4 },
      color_bad:        { type: "string",  label: "Worst colour", default: "#E67C73", display: "color", section: "Colours", order: 5 },
      color_mid:        { type: "string",  label: "Mid colour", default: "#FFFFFF", display: "color", section: "Colours", order: 6 },
      color_good:       { type: "string",  label: "Best colour", default: "#57BB8A", display: "color", section: "Colours", order: 7 },
      spark_color:      { type: "string",  label: "Trend line colour", default: "#222222", display: "color", section: "Colours", order: 8 }
    },

    create: function (element) {
      element.innerHTML =
        "<style>" +
        ".hsvc-wrap{font-family:Montserrat,Poppins,'Helvetica Neue',Arial,sans-serif;overflow:auto;height:100%;padding:6px;box-sizing:border-box;}" +
        ".hsvc-title{display:inline-block;background:var(--hsvc-title);color:#fff;font-weight:700;font-size:15px;padding:6px 22px;border-radius:16px;margin:0 0 10px;}" +
        ".hsvc{border-collapse:collapse;width:100%;font-size:12px;color:#1a1a1a;border:2px solid #8a8a8a;}" +
        ".hsvc th,.hsvc td{border:1px solid var(--hsvc-grid);padding:3px 6px;text-align:center;white-space:nowrap;}" +
        ".hsvc th{background:var(--hsvc-header);font-weight:600;position:sticky;top:0;z-index:1;}" +
        ".hsvc th.last{font-weight:800;}" +
        ".hsvc th.corner{font-style:italic;font-weight:700;left:0;z-index:3;}" +
        ".hsvc th.share{white-space:normal;line-height:1.1;}" +
        ".hsvc td.lbl{background:var(--hsvc-firstcol);text-align:left;position:sticky;left:0;z-index:2;}" +
        ".hsvc.bl td.lbl{font-weight:700;}" +
        ".hsvc td.num{font-variant-numeric:tabular-nums;}" +
        ".hsvc td.lowvol{color:#9e9e9e;}" +
        ".hsvc td.spark{padding:1px 4px;}" +
        ".hsvc-msg{padding:16px;color:#a33;font-family:Arial;}" +
        "</style><div class='hsvc-wrap'></div>";
      this._wrap = element.querySelector(".hsvc-wrap");
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      var wrap = this._wrap;
      try {
        wrap.style.setProperty("--hsvc-grid", config.grid_color || "#BDBDBD");
        wrap.style.setProperty("--hsvc-header", config.header_bg || "#FFE600");
        wrap.style.setProperty("--hsvc-firstcol", config.firstcol_bg || "#FFFFFF");
        wrap.style.setProperty("--hsvc-title", config.title_bg || "#5B2A12");

        var F = queryResponse.fields || {}, dims = F.dimension_like || [], meas = F.measure_like || [];
        var pivF = (F.pivots || [])[0];
        var pivots = (queryResponse.pivots || []).filter(function (p) { return !p.is_total; });
        var timeDim = null, catDim = null;
        if (pivF && dims.length >= 1) { timeDim = pivF; catDim = dims[0]; }
        else if (dims.length >= 2) {
          timeDim = dims.find(function (f) { return /date|week|month/i.test((f.type || "") + " " + f.name); }) || dims[0];
          catDim = dims.find(function (f) { return f.name !== timeDim.name; });
        }
        if (!timeDim || !catDim || !meas.length) {
          wrap.innerHTML = "<div class='hsvc-msg'>HS VSAT Contact Reason Table needs a week/month dimension, a category dimension " +
            "(e.g. Contact Reason L3), a rate measure, and optionally survey-count and share-basis measures. For metric rows use <b>HS VSAT Metric Table</b>.</div>";
          done(); return;
        }

        var dec = (config.decimals == null || config.decimals === "") ? 0 : Number(config.decimals);
        var hib = config.higher_is_better !== false, plus = config.show_plus === true;
        var BAD = hex(config.color_bad || "#E67C73"), MID = hex(config.color_mid || "#FFFFFF"), GOOD = hex(config.color_good || "#57BB8A");
        var spark = config.spark_color || "#222";

        var rateF = meas[0], volF = meas[1] || null, shrF = meas[2] || meas[1] || null, tuples = [];
        function cellOf(row, f, key) { if (!f || !row[f.name]) return null; var c = key === undefined ? row[f.name] : row[f.name][key]; return c ? num(c.value) : null; }
        if (pivF) {
          data.forEach(function (row) {
            var c = row[catDim.name] ? row[catDim.name].value : null;
            pivots.forEach(function (pv) {
              tuples.push({ p: pv.data ? pv.data[pivF.name] : pv.key, c: c, rate: cellOf(row, rateF, pv.key), vol: cellOf(row, volF, pv.key), shr: cellOf(row, shrF, pv.key) });
            });
          });
        } else {
          data.forEach(function (row) {
            tuples.push({ p: row[timeDim.name] ? row[timeDim.name].value : null, c: row[catDim.name] ? row[catDim.name].value : null,
              rate: cellOf(row, rateF), vol: cellOf(row, volF), shr: cellOf(row, shrF) });
          });
        }

        var P = buildPeriods(tuples.map(function (t) { return t.p; }), timeDim.name, config);
        var periods = P.list, pIdx = {};
        periods.forEach(function (p, i) { pIdx[p.raw] = i; });
        var last = periods.length - 1, prev = periods.length - 2;

        var cats = [], cIdx = {};
        tuples.forEach(function (t) {
          if (t.p == null) return;
          var i = pIdx[String(t.p)]; if (i === undefined) return;
          var key = t.c == null ? "∅" : String(t.c);
          if (!(key in cIdx)) {
            cIdx[key] = cats.length;
            cats.push({ label: t.c == null ? "(blank)" : String(t.c), rates: periods.map(function () { return null; }), vols: periods.map(function () { return null; }), shrs: periods.map(function () { return null; }) });
          }
          var c = cats[cIdx[key]]; c.rates[i] = t.rate; c.vols[i] = t.vol; c.shrs[i] = t.shr;
        });

        var tot = 0; cats.forEach(function (c) { tot += c.shrs[last] || 0; });
        cats.forEach(function (c) { c.share = tot ? (c.shrs[last] || 0) / tot : null; });
        var hide = {}; String(config.hide_rows || "").split(",").forEach(function (h) { h = h.trim().toLowerCase(); if (h) hide[h] = 1; });
        cats = cats.filter(function (c) {
          if (hide[c.label.toLowerCase()]) return false;
          if (config.drop_empty !== false && c.rates.every(function (r) { return r === null; })) return false;
          return true;
        });
        if (config.sort_by === "alpha") cats.sort(function (a, b) { return a.label.localeCompare(b.label); });
        else if (config.sort_by !== "none" && shrF) cats.sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
        var topN = Number(config.top_n) || 0; if (topN > 0) cats = cats.slice(0, topN);

        var minVol = Number(config.min_volume) || 0, scope = config.shade_scope || "row";
        function usable(c) { return c.rates.map(function (r, i) { return (c.vols[i] === null || c.vols[i] >= minVol) ? r : null; }); }
        var tableMM = minMax([].concat.apply([], cats.map(usable)));
        var showShare = config.show_share !== false && !!shrF, showTrend = config.show_trend !== false;

        function sparkline(vals) {
          var pts = []; vals.forEach(function (v, i) { if (v !== null) pts.push([i, v]); });
          if (pts.length < 2) return "";
          var w = 70, h = 20, pad = 2, xs = vals.length - 1 || 1, mm = minMax(vals);
          function X(i) { return pad + (i / xs) * (w - 2 * pad); }
          function Y(v) { return mm[1] === mm[0] ? h / 2 : h - pad - ((v - mm[0]) / (mm[1] - mm[0])) * (h - 2 * pad); }
          var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
          return "<svg width='" + w + "' height='" + h + "'><path d='" + d + "' fill='none' stroke='" + spark + "' stroke-width='1.2'/></svg>";
        }
        function deltaCell(a, b) {
          if (a === null || b === null) return "<td class='num'></td>";
          var v = (b - a) * 100, txt = (v > 0 && plus ? "+" : "") + v.toFixed(dec) + "%";
          if (Math.abs(v) < 1e-9 || txt === "0%" || txt === "-0%") return "<td class='num'>" + txt.replace("-0", "0") + "</td>";
          var good = hib ? v > 0 : v < 0;
          var st = "background:" + (good ? "#D4EDDA" : "#F8D0CC") + ";";
          if (config.delta_bold_text) st += "font-weight:700;color:" + (good ? "#1E7B3A" : "#C62828") + ";";
          return "<td class='num' style='" + st + "'>" + txt + "</td>";
        }

        var html = config.pill_title ? "<div class='hsvc-title'>" + esc(config.pill_title) + "</div>" : "";
        html += "<table class='hsvc" + (config.bold_labels !== false ? " bl" : "") + "'><thead><tr><th class='corner'>" + esc(config.corner_label || catDim.label_short || catDim.label || "") + "</th>";
        periods.forEach(function (p, i) { html += "<th" + (i === last ? " class='last'" : "") + ">" + esc(p.label) + "</th>"; });
        html += "<th class='last'>" + (P.grain === "week" ? "WOW" : "MOM") + "</th>";
        if (showTrend) html += "<th class='last'>Trend</th>";
        if (showShare) html += "<th class='last share'>" + esc(periods[last] ? periods[last].label : "") + "<br>% Share</th>";
        html += "</tr></thead><tbody>";

        cats.forEach(function (c) {
          var mm = scope === "row" ? minMax(usable(c)) : tableMM;
          html += "<tr><td class='lbl'>" + esc(c.label) + "</td>";
          periods.forEach(function (p, i) {
            var r = c.rates[i], low = c.vols[i] !== null && c.vols[i] < minVol, bg = null;
            if (scope !== "none" && !low && r !== null && mm[0] !== null && mm[1] !== mm[0]) { var t = (r - mm[0]) / (mm[1] - mm[0]); bg = scale3(hib ? t : 1 - t, BAD, MID, GOOD); }
            var tip = c.vols[i] !== null ? " title='Surveys: " + Math.round(c.vols[i]).toLocaleString() + "'" : "";
            html += "<td class='num" + (low ? " lowvol" : "") + "'" + tip + (bg ? " style='background:" + bg + "'" : "") + ">" + (r === null ? "" : (r * 100).toFixed(dec) + "%") + "</td>";
          });
          html += prev < 0 ? "<td class='num'></td>" : deltaCell(c.rates[prev], c.rates[last]);
          if (showTrend) html += "<td class='spark'>" + sparkline(c.rates) + "</td>";
          if (showShare) html += "<td class='num'>" + (c.share === null ? "" : Math.round(c.share * 100) + "%") + "</td>";
          html += "</tr>";
        });
        wrap.innerHTML = html + "</tbody></table>";
      } catch (err) {
        wrap.innerHTML = "<div class='hsvc-msg'>Viz error: " + esc(err && err.message ? err.message : err) + "</div>";
      }
      done();
    }
  });
})();
