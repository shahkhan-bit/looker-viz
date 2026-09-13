/**
 * hs_monthly_heatmap.js
 * Looker custom visualization — month × city heatmap table with an Overall
 * column and MoM / YoY footer rows. Replaces the Google-Sheets look.
 *
 * EXPECTED QUERY (per tile):
 *   - Dimension 1: month (a DATE dimension, e.g. hs_nso_red_flags.month_start)
 *   - Dimension 2: city  (hs_nso_red_flags.city)
 *   - Measure 1:  NUMERATOR   (e.g. sum_nso)      <-- must be first measure
 *   - Measure 2:  DENOMINATOR (e.g. total_orders) <-- must be second measure
 *   Do NOT pivot. The viz builds the pivot itself so the Overall column is a
 *   true SUM(num)/SUM(den) across every city in the result (incl. 'Other').
 *
 * If you supply only ONE measure it is treated as a pre-computed rate and the
 * Overall column becomes a simple average (mathematically weaker — prefer 2).
 */

(function () {
  // ---- helpers -------------------------------------------------------------
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // 3-colour scale: best -> mid -> worst (Excel-style green/yellow/red)
  function scaleColor(t, good, mid, bad) {
    t = clamp(t, 0, 1);
    var from, to, tt;
    if (t < 0.5) { from = good; to = mid; tt = t / 0.5; }
    else         { from = mid;  to = bad; tt = (t - 0.5) / 0.5; }
    return "rgb(" +
      Math.round(lerp(from[0], to[0], tt)) + "," +
      Math.round(lerp(from[1], to[1], tt)) + "," +
      Math.round(lerp(from[2], to[2], tt)) + ")";
  }

  function hexToRgb(h) {
    h = (h || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtMonth(d) { return MONTHS[d.getMonth()] + "'" + String(d.getFullYear()).slice(2); }

  function parseMonth(v) {
    // v is usually 'YYYY-MM-DD' or 'YYYY-MM'
    if (v == null) return null;
    var s = String(v).slice(0, 10);
    var p = s.split("-");
    if (p.length < 2) return null;
    return new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1));
  }

  function fmtPct(rate, decimals, isRatio) {
    if (rate == null || isNaN(rate)) return "";
    var v = isRatio ? rate * 100 : rate;
    return v.toFixed(decimals) + "%";
  }

  function fmtDelta(rate, decimals, isRatio) {
    if (rate == null || isNaN(rate)) return "";
    var v = isRatio ? rate * 100 : rate;
    return (v >= 0 ? "+" : "") + v.toFixed(decimals) + "%";
  }

  // -------------------------------------------------------------------------
  looker.plugins.visualizations.add({
    id: "hs_monthly_heatmap",
    label: "HS Monthly Heatmap (MoM/YoY)",

    options: {
      title:            { type: "string",  label: "Title",             default: "",            section: "Layout", order: 1 },
      overall_label:    { type: "string",  label: "Overall column label", default: "KSA",      section: "Layout", order: 2 },
      show_overall:     { type: "boolean", label: "Show Overall column", default: true,        section: "Layout", order: 3 },
      city_order:       { type: "string",  label: "City order (comma-sep)", default: "Dammam,Jeddah,Khobar,Madinah,Mecca,Riyadh", section: "Layout", order: 4 },
      show_mom:         { type: "boolean", label: "Show MoM row",      default: true,          section: "Layout", order: 5 },
      show_yoy:         { type: "boolean", label: "Show YoY row",      default: true,          section: "Layout", order: 6 },
      decimals:         { type: "number",  label: "Decimals",          default: 2,             section: "Values", order: 1 },
      value_is_ratio:   { type: "boolean", label: "Value is a ratio (×100 for %)", default: true, section: "Values", order: 2 },
      higher_is_better: { type: "boolean", label: "Higher is better (invert colours)", default: false, section: "Values", order: 3 },
      color_good:       { type: "string",  label: "Best colour",  default: "#63BE7B", display: "color", section: "Colours", order: 1 },
      color_mid:        { type: "string",  label: "Mid colour",   default: "#FFEB84", display: "color", section: "Colours", order: 2 },
      color_bad:        { type: "string",  label: "Worst colour", default: "#F8696B", display: "color", section: "Colours", order: 3 }
    },

    create: function (element, config) {
      var style = document.createElement("style");
      style.innerHTML =
        ".hsmh{font-family:'Open Sans',Arial,sans-serif;font-size:12px;width:100%;height:100%;overflow:auto;box-sizing:border-box;}" +
        ".hsmh table{border-collapse:collapse;width:100%;}" +
        ".hsmh caption{font-weight:700;padding:6px;background:#5b1a12;color:#fff;text-align:center;font-size:13px;}" +
        ".hsmh th{background:#4a86c5;color:#fff;font-weight:600;padding:5px 8px;text-align:center;border:1px solid #fff;white-space:nowrap;}" +
        ".hsmh th.rowhdr{background:#dbe7f3;color:#1a1a1a;text-align:right;}" +
        ".hsmh td{padding:5px 8px;text-align:center;border:1px solid #fff;color:#1a1a1a;}" +
        ".hsmh td.rowhdr{background:#dbe7f3;color:#1a1a1a;text-align:right;font-weight:600;white-space:nowrap;}" +
        ".hsmh tr.footer td{font-weight:600;}" +
        ".hsmh tr.footer td.rowhdr{background:#f6c445;}" +
        ".hsmh .err{padding:12px;color:#b00;}";
      element.appendChild(style);
      this._el = document.createElement("div");
      this._el.className = "hsmh";
      element.appendChild(this._el);
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      var el = this._el;
      el.innerHTML = "";

      var dims = queryResponse.fields.dimension_like || [];
      var meas = queryResponse.fields.measure_like || [];

      if (dims.length < 2 || meas.length < 1) {
        el.innerHTML = "<div class='err'>Need 2 dimensions (month, city) and 1–2 measures (numerator[, denominator]).</div>";
        done();
        return;
      }

      // detect the month dimension (date-typed or name contains 'month')
      var monthDim = dims.find(function (f) {
        return /date|month/i.test(f.type || "") || /month/i.test(f.name || "");
      }) || dims[0];
      var cityDim = dims.find(function (f) { return f.name !== monthDim.name; }) || dims[1];

      var numName = meas[0].name;
      var denName = meas.length > 1 ? meas[1].name : null;

      // ---- aggregate into month -> city -> {num,den} + month overall -------
      var months = {};        // key -> {date, cells:{city:{num,den}}, oNum, oDen}
      var citySet = {};

      data.forEach(function (row) {
        var mv = row[monthDim.name] ? row[monthDim.name].value : null;
        var d = parseMonth(mv);
        if (!d) return;
        var mkey = d.getTime();
        if (!months[mkey]) months[mkey] = { date: d, cells: {}, oNum: 0, oDen: 0 };

        var city = row[cityDim.name] ? String(row[cityDim.name].value) : "—";
        citySet[city] = true;

        var num = row[numName] && row[numName].value != null ? Number(row[numName].value) : 0;
        var den = denName ? (row[denName] && row[denName].value != null ? Number(row[denName].value) : 0) : 1;

        var c = months[mkey].cells[city] || { num: 0, den: 0 };
        c.num += num; c.den += den;
        months[mkey].cells[city] = c;

        months[mkey].oNum += num;
        months[mkey].oDen += den;
      });

      var monthKeys = Object.keys(months).map(Number).sort(function (a, b) { return a - b; }); // ascending
      if (!monthKeys.length) { el.innerHTML = "<div class='err'>No dated rows to display.</div>"; done(); return; }

      // ---- column order ----------------------------------------------------
      var requested = (config.city_order || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var cols = requested.filter(function (c) { return citySet[c]; });
      Object.keys(citySet).forEach(function (c) {           // append any city not listed (except 'Other')
        if (cols.indexOf(c) === -1 && c !== "Other") cols.push(c);
      });

      var isRatio = config.value_is_ratio !== false;
      var dec = (config.decimals == null) ? 2 : config.decimals;
      var hib = config.higher_is_better === true;

      // rate() per (month, col); Overall uses month.oNum/oDen (ALL cities incl Other)
      function rateFor(mk, col) {
        var m = months[mk];
        if (col === "__OVERALL__") return m.oDen ? m.oNum / m.oDen : null;
        var c = m.cells[col];
        return c && c.den ? c.num / c.den : null;
      }

      var displayCols = cols.slice();
      if (config.show_overall !== false) displayCols.push("__OVERALL__");

      // ---- colour scale across all body cells ------------------------------
      var vals = [];
      monthKeys.forEach(function (mk) {
        displayCols.forEach(function (col) {
          var r = rateFor(mk, col);
          if (r != null && !isNaN(r)) vals.push(r);
        });
      });
      var vmin = Math.min.apply(null, vals);
      var vmax = Math.max.apply(null, vals);
      var good = hexToRgb(config.color_good || "#63BE7B");
      var mid  = hexToRgb(config.color_mid  || "#FFEB84");
      var bad  = hexToRgb(config.color_bad  || "#F8696B");
      function cellColor(r) {
        if (r == null || isNaN(r) || vmax === vmin) return "#ffffff";
        var t = (r - vmin) / (vmax - vmin);   // 0 = smallest value
        if (!hib) t = t;                       // lower is better -> small = green
        else t = 1 - t;                        // higher is better -> invert
        return scaleColor(t, good, mid, bad);
      }

      // ---- build table -----------------------------------------------------
      var html = "<table>";
      if (config.title) html += "<caption>" + config.title + "</caption>";

      html += "<thead><tr><th class='rowhdr'>Month</th>";
      displayCols.forEach(function (col) {
        html += "<th>" + (col === "__OVERALL__" ? (config.overall_label || "KSA") : col) + "</th>";
      });
      html += "</tr></thead><tbody>";

      monthKeys.forEach(function (mk) {
        html += "<tr><td class='rowhdr'>" + fmtMonth(months[mk].date) + "</td>";
        displayCols.forEach(function (col) {
          var r = rateFor(mk, col);
          html += "<td style='background:" + cellColor(r) + "'>" + fmtPct(r, dec, isRatio) + "</td>";
        });
        html += "</tr>";
      });

      // ---- footer rows: MoM & YoY -----------------------------------------
      var last = monthKeys[monthKeys.length - 1];
      var prev = monthKeys.length >= 2 ? monthKeys[monthKeys.length - 2] : null;

      // YoY: find month exactly 12 months before 'last'
      var lastDate = months[last].date;
      var yoyTargetKey = null;
      var yoyDate = new Date(Date.UTC(lastDate.getUTCFullYear() - 1, lastDate.getUTCMonth(), 1));
      monthKeys.forEach(function (mk) { if (mk === yoyDate.getTime()) yoyTargetKey = mk; });

      function deltaColor(delta) {
        // improvement = lower (when lower is better). Green good / red bad.
        if (delta == null || isNaN(delta)) return "#ffffff";
        var improving = hib ? delta > 0 : delta < 0;
        if (delta === 0) return "#ffffff";
        return improving ? "rgb(198,239,206)" : "rgb(255,199,206)";
      }

      if (config.show_mom !== false && prev != null) {
        html += "<tr class='footer'><td class='rowhdr'>MoM (" + fmtMonth(months[last].date) + ")</td>";
        displayCols.forEach(function (col) {
          var a = rateFor(last, col), b = rateFor(prev, col);
          var d = (a != null && b != null) ? a - b : null;
          html += "<td style='background:" + deltaColor(d) + "'>" + fmtDelta(d, dec, isRatio) + "</td>";
        });
        html += "</tr>";
      }

      if (config.show_yoy !== false && yoyTargetKey != null) {
        html += "<tr class='footer'><td class='rowhdr'>YoY (" + fmtMonth(months[last].date) + ")</td>";
        displayCols.forEach(function (col) {
          var a = rateFor(last, col), b = rateFor(yoyTargetKey, col);
          var d = (a != null && b != null) ? a - b : null;
          html += "<td style='background:" + deltaColor(d) + "'>" + fmtDelta(d, dec, isRatio) + "</td>";
        });
        html += "</tr>";
      }

      html += "</tbody></table>";
      el.innerHTML = html;
      done();
    }
  });
})();
