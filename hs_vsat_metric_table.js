/**
 * hs_vsat_metric_table.js — Looker custom visualization
 * Replicates the "Monthly Performance" / "Weekly Performance" VSAT tables:
 *   metrics as ROWS, months or weeks as COLUMNS, then MoM / WoW and Trend.
 *
 * QUERY SHAPE
 *   - exactly 1 time dimension, no pivot:
 *       month -> vsat_targets.target_month           (labels: Apr, May, ... "Aug MTD")
 *       week  -> all_csat_responses.created_week_monday (labels: W27, W28 ...)
 *   - N measures = the rows, in display order.
 *
 * BEHAVIOUR
 *   - Months after the current month (target only) are shown; actual cells stay blank.
 *   - MoM/WoW compares the last two COMPLETED periods that have data in that row.
 *       % rows     -> difference in points   (85.49% -> 85.54% = 0.05%)
 *       count rows -> relative change        (3459 -> 3569 = 3.2%)
 *   - Rows whose label matches `shade_regex` get a red→white→green scale.
 *     A row whose label contains "Target" is never shaded and is shown bold italic.
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
  function idxList(s) { var o = {}; String(s || "").split(",").forEach(function (x) { var n = parseInt(x, 10); if (n > 0) o[n] = true; }); return o; }
  function isPctField(f, vals) {
    if (((f.value_format || "") + (f.format || "")).indexOf("%") >= 0) return true;
    if (/percent|rate|%|share|vsat|csat|target/i.test((f.label || "") + " " + f.name)) {
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
      else grain = "month";
    }
    var now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var curMonth = Date.UTC(now.getFullYear(), now.getMonth(), 1);
    var off = Number(config.week_offset) || 0;
    var tag = config.show_partial_tag !== false;
    list.forEach(function (p) {
      p.label = p.raw; p.isCurrent = false; p.isFuture = false; p.sort = p.ms;
      if (p.ms !== null) {
        var d = new Date(p.ms);
        if (grain === "week") {
          p.label = "W" + String(isoWeek(p.ms + 3 * DAY) + off).padStart(2, "0");
          p.isCurrent = today >= p.ms && today < p.ms + 7 * DAY;
          p.isFuture = p.ms > today;
          if (p.isCurrent && tag) p.label += " WTD";
        } else {
          p.label = MON[d.getUTCMonth()] + (config.month_with_year ? "'" + String(d.getUTCFullYear()).slice(2) : "");
          p.isCurrent = p.ms === curMonth;
          p.isFuture = p.ms > curMonth;
          if (p.isCurrent && tag) p.label += " MTD";
        }
      } else { var n = Number(p.raw); p.sort = isFinite(n) ? n : p.raw; if (grain === "week" && isFinite(n)) p.label = "W" + String(n + off).padStart(2, "0"); }
    });
    list.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    return { grain: grain, list: list };
  }

  looker.plugins.visualizations.add({
    id: "hs_vsat_metric_table",
    label: "HS VSAT Metric Table (Monthly/Weekly)",
    options: {
      pill_title:       { type: "string",  label: "Title pill (e.g. Monthly Performance)", default: "", section: "Layout", order: 1 },
      corner_label:     { type: "string",  label: "Top-left header label (e.g. Chats)", default: "", section: "Layout", order: 2 },
      row_labels:       { type: "string",  label: "Row labels (pipe-separated, in measure order)", default: "", section: "Layout", order: 3 },
      italic_rows:      { type: "string",  label: "Italic rows (row numbers, comma-separated)", default: "", section: "Layout", order: 4 },
      right_align_rows: { type: "string",  label: "Right-aligned row labels (row numbers)", default: "", section: "Layout", order: 5 },
      separator_after:  { type: "string",  label: "Thick line after rows (row numbers)", default: "", section: "Layout", order: 6 },
      grain:            { type: "string",  label: "Period grain", display: "select", default: "auto", values: [{ "Auto": "auto" }, { "Month": "month" }, { "Week": "week" }], section: "Layout", order: 7 },
      month_with_year:  { type: "boolean", label: "Month labels with year (Apr'26)", default: false, section: "Layout", order: 8 },
      show_partial_tag: { type: "boolean", label: "Tag current period (MTD / WTD)", default: true, section: "Layout", order: 9 },
      include_current:  { type: "boolean", label: "MoM/WoW includes current (partial) period", default: false, section: "Layout", order: 10 },
      week_offset:      { type: "number",  label: "Week number offset vs ISO", default: 0, section: "Layout", order: 11 },
      show_trend:       { type: "boolean", label: "Show Trend column", default: true, section: "Layout", order: 12 },
      decimals:         { type: "number",  label: "Decimals for %", default: 2, section: "Values", order: 1 },
      show_plus:        { type: "boolean", label: "Show + sign on positive deltas", default: false, section: "Values", order: 2 },
      delta_style:      { type: "string",  label: "Delta colouring", display: "select", default: "text", values: [{ "Coloured text": "text" }, { "Coloured fill": "fill" }, { "None": "none" }], section: "Values", order: 3 },
      higher_is_better: { type: "boolean", label: "Higher is better", default: true, section: "Values", order: 4 },
      shade_regex:      { type: "string",  label: "Shade rows matching (regex)", default: "vsat", section: "Values", order: 5 },
      header_bg:        { type: "string",  label: "Header background", default: "#FFE600", display: "color", section: "Colours", order: 1 },
      firstcol_bg:      { type: "string",  label: "Row-label background", default: "#FFE600", display: "color", section: "Colours", order: 2 },
      title_bg:         { type: "string",  label: "Title pill background", default: "#5B2A12", display: "color", section: "Colours", order: 3 },
      grid_color:       { type: "string",  label: "Grid line colour", default: "#9E9E9E", display: "color", section: "Colours", order: 4 },
      color_bad:        { type: "string",  label: "Worst colour", default: "#E67C73", display: "color", section: "Colours", order: 5 },
      color_mid:        { type: "string",  label: "Mid colour", default: "#FFFFFF", display: "color", section: "Colours", order: 6 },
      color_good:       { type: "string",  label: "Best colour", default: "#57BB8A", display: "color", section: "Colours", order: 7 },
      spark_color:      { type: "string",  label: "Trend line colour", default: "#222222", display: "color", section: "Colours", order: 8 }
    },

    create: function (element) {
      element.innerHTML =
        "<style>" +
        ".hsvm-wrap{font-family:Montserrat,Poppins,'Helvetica Neue',Arial,sans-serif;overflow:auto;height:100%;padding:6px;box-sizing:border-box;}" +
        ".hsvm-title{display:inline-block;background:var(--hsvm-title);color:#fff;font-weight:700;font-size:15px;padding:6px 22px;border-radius:16px;margin:0 0 10px;}" +
        ".hsvm{border-collapse:collapse;font-size:12px;color:#1a1a1a;border:2px solid var(--hsvm-grid);}" +
        ".hsvm th,.hsvm td{border:1px solid var(--hsvm-grid);padding:4px 10px;text-align:center;white-space:nowrap;}" +
        ".hsvm th{background:var(--hsvm-header);font-weight:700;position:sticky;top:0;z-index:1;}" +
        ".hsvm th.corner{font-style:italic;left:0;z-index:3;}" +
        ".hsvm th.delta,.hsvm td.delta{border-left:2px solid var(--hsvm-grid);}" +
        ".hsvm td.lbl{background:var(--hsvm-firstcol);text-align:left;position:sticky;left:0;z-index:2;}" +
        ".hsvm td.lbl.r{text-align:right;}" +
        ".hsvm tr.it td.lbl{font-style:italic;}" +
        ".hsvm tr.tgt td{font-weight:700;}.hsvm tr.tgt td.lbl{font-style:italic;}" +
        ".hsvm tr.sep td{border-top:2px solid var(--hsvm-grid);}" +
        ".hsvm td.num{font-variant-numeric:tabular-nums;}" +
        ".hsvm td.spark{padding:1px 6px;}" +
        ".hsvm-msg{padding:16px;color:#a33;font-family:Arial;}" +
        "</style><div class='hsvm-wrap'></div>";
      this._wrap = element.querySelector(".hsvm-wrap");
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      var wrap = this._wrap;
      try {
        wrap.style.setProperty("--hsvm-grid", config.grid_color || "#9E9E9E");
        wrap.style.setProperty("--hsvm-header", config.header_bg || "#FFE600");
        wrap.style.setProperty("--hsvm-firstcol", config.firstcol_bg || "#FFE600");
        wrap.style.setProperty("--hsvm-title", config.title_bg || "#5B2A12");

        var F = queryResponse.fields || {}, dims = F.dimension_like || [], meas = F.measure_like || [];
        if (dims.length !== 1 || !meas.length || (queryResponse.pivots && queryResponse.pivots.length)) {
          wrap.innerHTML = "<div class='hsvm-msg'>HS VSAT Metric Table needs exactly 1 month/week dimension (no pivot) and at least 1 measure. " +
            "For contact-reason rows use <b>HS VSAT Contact Reason Table</b>.</div>";
          done(); return;
        }
        var dec = (config.decimals == null || config.decimals === "") ? 2 : Number(config.decimals);
        var hib = config.higher_is_better !== false, plus = config.show_plus === true, dstyle = config.delta_style || "text";
        var BAD = hex(config.color_bad || "#E67C73"), MID = hex(config.color_mid || "#FFFFFF"), GOOD = hex(config.color_good || "#57BB8A");
        var spark = config.spark_color || "#222";
        var italic = idxList(config.italic_rows), right = idxList(config.right_align_rows), sep = idxList(config.separator_after);

        var dim = dims[0];
        var P = buildPeriods(data.map(function (r) { return r[dim.name] ? r[dim.name].value : null; }), dim.name, config);
        var per = P.list, byRaw = {};
        data.forEach(function (r) { var v = r[dim.name] ? r[dim.name].value : null; if (v != null) byRaw[String(v)] = r; });
        var overrides = (config.row_labels || "").split("|").map(function (s) { return s.trim(); });

        var rows = meas.map(function (f, k) {
          var vals = per.map(function (p) { var r = byRaw[p.raw]; return r && r[f.name] ? num(r[f.name].value) : null; });
          var orig = f.label_short || f.label || f.name, lbl = overrides[k] || orig;
          return { label: lbl, vals: vals, pct: isPctField(f, vals), isTarget: /target/i.test(lbl) || /target/i.test(orig) };
        });
        var re = null; if (config.shade_regex) { try { re = new RegExp(config.shade_regex, "i"); } catch (e) { re = null; } }

        function fmt(v, pct) { return v === null ? "" : pct ? (v * 100).toFixed(dec) + "%" : Math.round(v).toLocaleString(); }
        // last two completed periods WITH data in this row
        function pair(vals) {
          var idx = [];
          per.forEach(function (p, i) { if (vals[i] !== null && !p.isFuture && (config.include_current || !p.isCurrent)) idx.push(i); });
          return idx.length < 2 ? null : [idx[idx.length - 2], idx[idx.length - 1]];
        }
        function deltaCell(row) {
          var pr = pair(row.vals);
          if (!pr) return "<td class='num delta'></td>";
          var a = row.vals[pr[0]], b = row.vals[pr[1]];
          if (!row.pct && a === 0) return "<td class='num delta'></td>";
          var v = row.pct ? (b - a) * 100 : (b / a - 1) * 100;
          var txt = (v > 0 && plus ? "+" : "") + v.toFixed(row.pct ? dec : 1) + "%";
          var good = hib ? v > 0 : v < 0, st = "";
          if (Math.abs(v) >= 1e-9 && !row.isTarget) {
            if (dstyle === "text") st = "color:" + (good ? "#2E9E57" : "#C62828") + ";";
            else if (dstyle === "fill") st = "background:" + (good ? "#CDECD5" : "#F3C9C6") + ";";
          }
          return "<td class='num delta' style='" + st + "'>" + txt + "</td>";
        }
        function sparkline(vals) {
          var pts = []; vals.forEach(function (v, i) { if (v !== null) pts.push([i, v]); });
          if (pts.length < 2) return "-";
          var w = 80, h = 24, pad = 3, x0 = pts[0][0], xs = (pts[pts.length - 1][0] - x0) || 1, mm = minMax(vals);
          function X(i) { return pad + ((i - x0) / xs) * (w - 2 * pad); }
          function Y(v) { return mm[1] === mm[0] ? h / 2 : h - pad - ((v - mm[0]) / (mm[1] - mm[0])) * (h - 2 * pad); }
          var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
          return "<svg width='" + w + "' height='" + h + "'><path d='" + d + "' fill='none' stroke='" + spark + "' stroke-width='1.3'/></svg>";
        }

        var showTrend = config.show_trend !== false;
        var html = config.pill_title ? "<div class='hsvm-title'>" + esc(config.pill_title) + "</div>" : "";
        html += "<table class='hsvm'><thead><tr><th class='corner'>" + esc(config.corner_label || "") + "</th>";
        per.forEach(function (p) { html += "<th>" + esc(p.label) + "</th>"; });
        html += "<th class='delta'>" + (P.grain === "week" ? "WoW" : "MoM") + "</th>" + (showTrend ? "<th>Trend</th>" : "") + "</tr></thead><tbody>";

        rows.forEach(function (row, k) {
          var n = k + 1, cls = [];
          if (row.isTarget) cls.push("tgt");
          if (italic[n]) cls.push("it");
          if (sep[n - 1]) cls.push("sep");
          var doShade = re && !row.isTarget && re.test(row.label);
          var mm = doShade ? minMax(row.vals) : [null, null];
          html += "<tr class='" + cls.join(" ") + "'><td class='lbl" + (right[n] ? " r" : "") + "'>" + esc(row.label) + "</td>";
          row.vals.forEach(function (v) {
            var bg = null;
            if (doShade && v !== null && mm[1] !== mm[0]) { var t = (v - mm[0]) / (mm[1] - mm[0]); bg = scale3(hib ? t : 1 - t, BAD, MID, GOOD); }
            html += "<td class='num'" + (bg ? " style='background:" + bg + "'" : "") + ">" + fmt(v, row.pct) + "</td>";
          });
          html += deltaCell(row);
          if (showTrend) html += "<td class='spark'>" + sparkline(row.vals) + "</td>";
          html += "</tr>";
        });
        wrap.innerHTML = html + "</tbody></table>";
      } catch (err) {
        wrap.innerHTML = "<div class='hsvm-msg'>Viz error: " + esc(err && err.message ? err.message : err) + "</div>";
      }
      done();
    }
  });
})();
