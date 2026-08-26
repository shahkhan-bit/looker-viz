/**
 * HS Monthly Table — Looker custom visualization
 * Renders a metric-rows x month-columns table with:
 *   - month headers formatted "Jan'26", current month tagged "(MTD)"
 *   - a MoM column (last two COMPLETED months, color-coded by sign)
 *   - an inline SVG sparkline "Trend" column
 *   - red->green conditional shading on rows matching `shade_regex`
 *
 * Query shape: 1 date dimension (month) + N measures (the rows, in display order).
 * The viz transposes: each measure becomes a row, each month a column.
 */
looker.plugins.visualizations.add({
  id: "hs_monthly_table",
  label: "HS Monthly Table",

  options: {
    corner_label:  { type: "string", label: "Top-left header label", default: "", section: "Style", order: 1 },
    shade_regex:   { type: "string", label: "Shade rows matching (regex, case-insensitive)", default: "share of acq", section: "Style", order: 2 },
    header_bg:     { type: "string", label: "Header background", default: "#FFEE58", display: "color", section: "Style", order: 3 },
    firstcol_bg:   { type: "string", label: "Row-label background", default: "#FFF7C0", display: "color", section: "Style", order: 4 },
    grid_color:    { type: "string", label: "Grid line color", default: "#9E9E9E", display: "color", section: "Style", order: 5 },
    spark_color:   { type: "string", label: "Sparkline color", default: "#333333", display: "color", section: "Style", order: 6 }
  },

  create: function (element, config) {
    element.innerHTML =
      '<style>' +
      '.hsmt-wrap{font-family:Poppins,"Helvetica Neue",Arial,sans-serif;overflow:auto;height:100%;padding:6px;box-sizing:border-box;}' +
      '.hsmt{border-collapse:collapse;width:100%;font-size:12px;color:#2b2b2b;}' +
      '.hsmt th,.hsmt td{border:1px solid var(--hsmt-grid);padding:6px 8px;text-align:center;white-space:nowrap;}' +
      '.hsmt th{background:var(--hsmt-header);font-weight:700;}' +
      '.hsmt td.lbl{background:var(--hsmt-firstcol);text-align:left;font-weight:600;}' +
      '.hsmt td.num{font-variant-numeric:tabular-nums;}' +
      '.hsmt-msg{padding:16px;color:#a33;font-family:Arial;}' +
      '</style>' +
      '<div class="hsmt-wrap"></div>';
    this._wrap = element.querySelector(".hsmt-wrap");
  },

  updateAsync: function (data, element, config, queryResponse, details, done) {
    var wrap = this._wrap;
    try {
      wrap.style.setProperty("--hsmt-grid", config.grid_color || "#9E9E9E");
      wrap.style.setProperty("--hsmt-header", config.header_bg || "#FFEE58");
      wrap.style.setProperty("--hsmt-firstcol", config.firstcol_bg || "#FFF7C0");

      var dims = (queryResponse.fields.dimension_like) || [];
      var meas = (queryResponse.fields.measure_like) || [];
      if (!dims.length || !meas.length) {
        wrap.innerHTML = '<div class="hsmt-msg">Add one date dimension (month) and at least one measure.</div>';
        done(); return;
      }
      var dim = dims[0];

      // ---- sort rows by month ascending ----
      var recs = data.map(function (r) { return { k: (r[dim.name].value || "").slice(0, 10), r: r }; });
      recs.sort(function (a, b) { return a.k < b.k ? -1 : (a.k > b.k ? 1 : 0); });
      var months = recs.map(function (x) { return x.k; });

      var now = new Date();
      var curFirst = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
      var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      function monthLabel(k) {
        var p = k.split("-"); var mi = parseInt(p[1], 10) - 1;
        var lab = MON[mi] + "'" + p[0].slice(2);
        if (k === curFirst) lab += " (MTD)";
        return lab;
      }
      function isPct(f) { return !!(f.value_format && f.value_format.indexOf("%") >= 0); }
      function num(v) { return (v === null || v === undefined || v === "" || isNaN(v)) ? null : Number(v); }
      function fmt(f, v) {
        if (v === null) return "-";
        if (isPct(f)) return (v * 100).toFixed(2) + "%";
        return Math.round(v).toLocaleString();
      }
      function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
      function hex(c){ c=c.replace('#',''); return [parseInt(c.substr(0,2),16),parseInt(c.substr(2,2),16),parseInt(c.substr(4,2),16)]; }
      // red -> white -> green diverging
      var RED = hex("#E88B87"), WHITE = hex("#FFFFFF"), GREEN = hex("#A6D5A6");
      function divergeColor(t) { // t in [0,1]
        var a, b, tt;
        if (t < 0.5) { a = RED; b = WHITE; tt = t / 0.5; }
        else { a = WHITE; b = GREEN; tt = (t - 0.5) / 0.5; }
        return "rgb(" + lerp(a[0],b[0],tt) + "," + lerp(a[1],b[1],tt) + "," + lerp(a[2],b[2],tt) + ")";
      }

      var shadeRe = null;
      if (config.shade_regex) { try { shadeRe = new RegExp(config.shade_regex, "i"); } catch (e) { shadeRe = null; } }

      function sparkline(vals) {
        var pts = [];
        vals.forEach(function (v, i) { if (v !== null) pts.push([i, v]); });
        if (pts.length < 2) return "";
        var w = 96, h = 28, pad = 3;
        var xsAll = vals.length - 1 || 1;
        var ys = pts.map(function (p) { return p[1]; });
        var mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys);
        function X(i) { return pad + (i / xsAll) * (w - 2 * pad); }
        function Y(v) { return (mx === mn) ? h / 2 : (h - pad - ((v - mn) / (mx - mn)) * (h - 2 * pad)); }
        var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
        var last = pts[pts.length - 1];
        return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
          '<path d="' + d + '" fill="none" stroke="' + (config.spark_color || "#333") + '" stroke-width="1.5"/>' +
          '<circle cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="2" fill="' + (config.spark_color || "#333") + '"/>' +
          '</svg>';
      }

      // ---- header ----
      var html = '<table class="hsmt"><thead><tr>';
      html += "<th>" + (config.corner_label || "") + "</th>";
      months.forEach(function (m) { html += "<th>" + monthLabel(m) + "</th>"; });
      html += "<th>MoM</th><th>Trend</th></tr></thead><tbody>";

      var completed = months.filter(function (m) { return m < curFirst; });

      meas.forEach(function (f) {
        var vals = recs.map(function (x) { return num(x.r[f.name].value); });
        html += "<tr><td class='lbl'>" + (f.label_short || f.label || f.name) + "</td>";

        // conditional shade scale for this row?
        var doShade = shadeRe && shadeRe.test(f.label || f.name) && !/target/i.test(f.label || f.name);
        var mn = null, mx = null;
        if (doShade) {
          var nn = vals.filter(function (v) { return v !== null; });
          if (nn.length) { mn = Math.min.apply(null, nn); mx = Math.max.apply(null, nn); }
        }
        months.forEach(function (m, i) {
          var v = vals[i], style = "";
          if (doShade && v !== null && mx !== mn) {
            style = " style='background:" + divergeColor((v - mn) / (mx - mn)) + "'";
          }
          html += "<td class='num'" + style + ">" + fmt(f, v) + "</td>";
        });

        // MoM: last two completed months
        var mom = null;
        if (completed.length >= 2) {
          var iL = months.indexOf(completed[completed.length - 1]);
          var iP = months.indexOf(completed[completed.length - 2]);
          var a = vals[iP], b = vals[iL];
          if (a !== null && b !== null && a !== 0) mom = b / a - 1;
        }
        var momStyle = "", momTxt = "-";
        if (mom !== null) {
          momTxt = (mom * 100).toFixed(2) + "%";
          momStyle = " style='background:" + (mom >= 0 ? "#CDECD5" : "#F3C9C6") + ";font-weight:600'";
        }
        html += "<td class='num'" + momStyle + ">" + momTxt + "</td>";

        // Trend
        html += "<td>" + sparkline(vals) + "</td>";
        html += "</tr>";
      });

      html += "</tbody></table>";
      wrap.innerHTML = html;
    } catch (err) {
      wrap.innerHTML = '<div class="hsmt-msg">Viz error: ' + (err && err.message ? err.message : err) + "</div>";
    }
    done();
  }
});
