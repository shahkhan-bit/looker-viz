/**
 * hs_vm_okrs_tracker.js  — v2
 * -----------------------------------------------------------------------
 * Looker custom visualization: "HS VM OKRs Tracker"
 *
 * Reproduces the Tableau "VM OKRs Tracker": Business Unit / KPI rows, one
 * column per month (value, MoM delta underneath with a scaled colour bar),
 * and a trailing sparkline column — in the HungerStation yellow/brown/blue
 * palette.
 *
 * v2 changes
 *  - FIX: percentage detection. `is_percent_kpi` is a LookML yesno, which
 *    arrives as the STRING "Yes"/"No" — and !!"No" === true in JS, so every
 *    absolute KPI was being rendered as a percentage ("AMC - Active Users
 *    16.0%" instead of "16"). Now reads kpi_calculation (preferred) and
 *    parses the yesno properly as a fallback.
 *  - Smart number formatting: whole numbers render with no decimals
 *    (2,465 not 2,465.0), fractional values with one.
 *  - Readability pass: larger type, taller rows, row/group rules, wrapping
 *    BU + KPI columns, centred month cells, bigger sparklines.
 *  - Theme: yellow banner, brown text, blue accent rule, centred title.
 *  - Deltas match Tableau: no arrow glyph, no "+" prefix, magnitude-scaled
 *    colour bar underneath.
 *  - Sparkline can exclude the current (incomplete) month while the table
 *    still shows it.
 *
 * Repo:  shahkhan-bit/looker-viz  ->  hs_vm_okrs_tracker.js
 * Looker Admin > Visualizations:
 *   ID: hs_vm_okrs_tracker   Label: HS VM OKRs Tracker (Value + MoM + Trend)
 * -----------------------------------------------------------------------
 */
(function () {
  // --- HungerStation palette (from the brand mark) ---------------------
  var HS_YELLOW = "#FFE81A";
  var HS_BROWN = "#5A2D1C";
  var HS_BLUE = "#29ABE2";
  var HS_INK = "#2B2B2B";
  var POS = "#1B87C9"; // up  — blue
  var NEG = "#D9531E"; // down — burnt orange

  looker.plugins.visualizations.add({
    id: "hs_vm_okrs_tracker",
    label: "HS VM OKRs Tracker",

    options: {
      header_title: {
        type: "string", label: "Header title", default: "VM OKRS TRACKER",
        section: "Style", order: 1
      },
      show_header: {
        type: "boolean", label: "Show header banner", default: true,
        section: "Style", order: 2
      },
      scope_label: {
        type: "string", label: "Scope column label (blank = auto from filters)",
        default: "", section: "Style", order: 3
      },
      header_bg_color: {
        type: "string", label: "Header background", display: "color",
        default: HS_YELLOW, section: "Style", order: 4
      },
      header_text_color: {
        type: "string", label: "Header text", display: "color",
        default: HS_BROWN, section: "Style", order: 5
      },
      accent_color: {
        type: "string", label: "Header accent rule", display: "color",
        default: HS_BLUE, section: "Style", order: 6
      },
      positive_color: {
        type: "string", label: "Positive delta", display: "color",
        default: POS, section: "Style", order: 7
      },
      negative_color: {
        type: "string", label: "Negative delta", display: "color",
        default: NEG, section: "Style", order: 8
      },
      sparkline_color: {
        type: "string", label: "Sparkline line", display: "color",
        default: HS_INK, section: "Style", order: 9
      },
      show_delta_arrows: {
        type: "boolean", label: "Show ▲▼ arrows on deltas", default: false,
        section: "Style", order: 10
      },
      delta_bar_scaled: {
        type: "boolean", label: "Scale the delta bar by magnitude", default: true,
        section: "Style", order: 11
      },

      smart_decimals: {
        type: "boolean",
        label: "Smart decimals (whole numbers get none)",
        default: true, section: "Formatting", order: 1
      },
      decimals_value: {
        type: "number", label: "Decimals — value (when not whole)",
        default: 1, section: "Formatting", order: 2
      },
      decimals_pp: {
        type: "number", label: "Decimals — pp delta (% KPIs)",
        default: 1, section: "Formatting", order: 3
      },
      decimals_pct: {
        type: "number", label: "Decimals — relative % delta",
        default: 1, section: "Formatting", order: 4
      },

      show_sparkline: {
        type: "boolean", label: "Show trend column", default: true,
        section: "Trend", order: 1
      },
      exclude_current_month: {
        type: "boolean",
        label: "Exclude current (incomplete) month from the trend line",
        default: true, section: "Trend", order: 2
      },
      sparkline_width: {
        type: "number", label: "Trend width (px)", default: 220,
        section: "Trend", order: 3
      },
      show_sparkline_points: {
        type: "boolean", label: "Show dots on each point", default: true,
        section: "Trend", order: 4
      },

      row_height: {
        type: "number", label: "Minimum row height (px)", default: 52,
        section: "Layout", order: 1
      },
      kpi_col_width: {
        type: "number", label: "KPI column width (px)", default: 210,
        section: "Layout", order: 2
      },
      bu_col_width: {
        type: "number", label: "Business Unit column width (px)", default: 130,
        section: "Layout", order: 3
      },
      scope_col_width: {
        type: "number", label: "Scope column width (px)", default: 62,
        section: "Layout", order: 4
      },
      month_col_width: {
        type: "number", label: "Month column min width (px)", default: 78,
        section: "Layout", order: 5
      }
    },

    create: function (element) {
      element.innerHTML =
        '<div class="hs-okr-root">' +
        '  <div class="hs-okr-banner"><span class="hs-okr-title"></span></div>' +
        '  <div class="hs-okr-scroll">' +
        '    <table class="hs-okr-table"><thead></thead><tbody></tbody></table>' +
        "  </div>" +
        '  <div class="hs-okr-empty" style="display:none;">No data returned for this query.</div>' +
        "</div>";

      var style = document.createElement("style");
      style.textContent = `
        .hs-okr-root{
          font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
          height:100%;display:flex;flex-direction:column;background:#fff;
          color:${HS_INK};box-sizing:border-box;overflow:hidden;
        }
        .hs-okr-banner{
          flex:0 0 auto;display:flex;align-items:center;justify-content:center;
          padding:12px 18px;background:${HS_YELLOW};
          border-bottom:4px solid ${HS_BLUE};
        }
        .hs-okr-title{
          color:${HS_BROWN};font-weight:800;letter-spacing:.08em;
          font-size:17px;text-transform:uppercase;text-align:center;
        }
        .hs-okr-scroll{flex:1 1 auto;overflow:auto;background:#fff;}
        .hs-okr-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px;}

        .hs-okr-table thead th{
          position:sticky;top:0;z-index:3;background:#fff;
          border-bottom:1.5px solid #BFBFBF;padding:10px 8px;
          text-align:center;font-weight:600;font-size:12px;color:#555;
          white-space:nowrap;
        }
        .hs-okr-table thead th.hs-lbl{text-align:left;}

        .hs-okr-table td{
          border-bottom:1px solid #E6E6E6;padding:9px 8px;
          vertical-align:middle;text-align:center;
        }
        .hs-okr-table tr.hs-newbu td{border-top:1px solid #BFBFBF;}

        .hs-okr-table td.hs-col-scope,
        .hs-okr-table td.hs-col-bu,
        .hs-okr-table td.hs-col-kpi{
          text-align:left;position:sticky;background:#fff;z-index:2;
          white-space:normal;line-height:1.35;vertical-align:top;
        }
        .hs-okr-table td.hs-col-scope{left:0;color:#555;font-weight:600;padding-top:12px;}
        .hs-okr-table td.hs-col-bu{font-weight:600;color:${HS_BROWN};padding-top:12px;}
        .hs-okr-table td.hs-col-kpi{
          color:#333;border-right:1.5px solid #BFBFBF;vertical-align:middle;
        }
        .hs-okr-table thead th.hs-col-scope,
        .hs-okr-table thead th.hs-col-bu,
        .hs-okr-table thead th.hs-col-kpi{position:sticky;z-index:4;}
        .hs-okr-table thead th.hs-col-kpi{border-right:1.5px solid #BFBFBF;}

        /* Fixed-height, top-anchored box so a cell without a delta still
           lines its value up with the rest of the row. */
        .hs-okr-cellbox{
          display:flex;flex-direction:column;align-items:center;
          justify-content:flex-start;min-height:38px;
        }
        .hs-okr-val{font-weight:600;font-size:13.5px;color:${HS_INK};line-height:1.25;}
        .hs-okr-delta{font-size:11px;font-weight:600;line-height:1.3;margin-top:1px;}
        .hs-okr-bar{display:block;height:2.5px;border-radius:2px;margin:2px auto 0;}
        .hs-okr-null{color:#AAA;font-size:13px;}

        .hs-okr-spark{text-align:center;border-left:1.5px solid #BFBFBF;}
        .hs-okr-table tbody tr:hover td{background:#FFFDF0;}
        .hs-okr-empty{padding:24px;color:#666;font-size:13px;}
      `;
      element.appendChild(style);

      this._nodes = {
        root: element.querySelector(".hs-okr-root"),
        banner: element.querySelector(".hs-okr-banner"),
        title: element.querySelector(".hs-okr-title"),
        thead: element.querySelector("thead"),
        tbody: element.querySelector("tbody"),
        empty: element.querySelector(".hs-okr-empty")
      };
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      this.clearErrors();
      var n = this._nodes;

      if (!data || !data.length) {
        n.thead.innerHTML = "";
        n.tbody.innerHTML = "";
        n.empty.style.display = "block";
        done();
        return;
      }
      n.empty.style.display = "none";

      // ---- field resolution (by suffix, so renames are safe) -----------
      var dims = queryResponse.fields.dimensions || [];
      var meas = queryResponse.fields.measures || [];
      var find = function (list, suffixes) {
        for (var s = 0; s < suffixes.length; s++)
          for (var i = 0; i < list.length; i++)
            if (list[i].name.indexOf(suffixes[s]) !== -1) return list[i].name;
        return null;
      };

      var fBu = find(dims, [".business_unit"]);
      var fKpi = find(dims, [".kpi_display_name"]);
      var fTim = find(dims, [".tim_month", ".tim_date", ".tim_raw"]);
      var fSort = find(dims, [".tim_sort"]) || fTim;
      var fLabel = find(dims, [".month_label"]);
      var fCalc = find(dims, [".kpi_calculation"]);
      var fPctFlag = find(dims, [".is_percent_kpi"]);
      var fVal = find(meas, [".value"]);
      var fDelta = find(meas, [".variance_smart"]);

      var missing = [];
      if (!fBu) missing.push("business_unit");
      if (!fKpi) missing.push("kpi_display_name");
      if (!fTim) missing.push("tim_month");
      if (!fVal) missing.push("value");
      if (missing.length) {
        this.addError({
          title: "Missing required field(s)",
          message: "This visualization needs: " + missing.join(", ") + "."
        });
        done();
        return;
      }

      // ---- config -------------------------------------------------------
      var c = config || {};
      var smart = c.smart_decimals !== false;
      var decV = c.decimals_value == null ? 1 : c.decimals_value;
      var decPp = c.decimals_pp == null ? 1 : c.decimals_pp;
      var decPct = c.decimals_pct == null ? 1 : c.decimals_pct;
      var colPos = c.positive_color || POS;
      var colNeg = c.negative_color || NEG;
      var colSpark = c.sparkline_color || HS_INK;
      var showSpark = c.show_sparkline !== false;
      var sparkW = c.sparkline_width || 220;
      var sparkPts = c.show_sparkline_points !== false;
      var dropCurrent = c.exclude_current_month !== false;
      var arrows = c.show_delta_arrows === true;
      var scaledBar = c.delta_bar_scaled !== false;
      var rowH = c.row_height || 52;
      var wKpi = c.kpi_col_width || 210;
      var wBu = c.bu_col_width || 130;
      var wScope = c.scope_col_width || 62;
      var wMonth = c.month_col_width || 78;
      var sparkH = Math.max(26, rowH - 22);

      // banner
      n.banner.style.display = c.show_header === false ? "none" : "flex";
      n.banner.style.background = c.header_bg_color || HS_YELLOW;
      n.banner.style.borderBottomColor = c.accent_color || HS_BLUE;
      n.title.style.color = c.header_text_color || HS_BROWN;
      n.title.textContent = c.header_title || "VM OKRS TRACKER";

      // sticky column offsets
      var leftBu = wScope;
      var leftKpi = wScope + wBu;

      // ---- current month key (for trimming the trend line) -------------
      var now = new Date();
      var nowYm = now.getFullYear() * 100 + (now.getMonth() + 1);
      function ymOf(sortVal) {
        if (sortVal == null) return null;
        var num = Number(sortVal);
        if (!isNaN(num) && num >= 190001 && num <= 999912) return num; // YYYYMM
        var d = new Date(sortVal);
        if (isNaN(d.getTime())) return null;
        return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
      }

      // ---- months (chronological) ---------------------------------------
      var monthMap = {};
      data.forEach(function (row) {
        var sv = row[fSort] ? row[fSort].value : row[fTim].value;
        var key = String(sv);
        if (!monthMap[key]) {
          monthMap[key] = {
            key: key,
            sortVal: sv,
            ym: ymOf(sv),
            label:
              fLabel && row[fLabel] && row[fLabel].value
                ? row[fLabel].value
                : monthLabel(row[fTim].value)
          };
        }
      });
      var months = Object.keys(monthMap)
        .map(function (k) { return monthMap[k]; })
        .sort(function (a, b) {
          if (a.ym != null && b.ym != null) return a.ym - b.ym;
          return a.sortVal < b.sortVal ? -1 : a.sortVal > b.sortVal ? 1 : 0;
        });

      // ---- percentage detection ------------------------------------------
      // kpi_calculation is authoritative ('..._perc', '..._as_perc').
      // The is_percent_kpi yesno arrives as the STRING "Yes"/"No", so it must
      // be parsed, never coerced with !! (that made every KPI a percentage).
      function rowIsPercent(row) {
        if (fCalc && row[fCalc] && row[fCalc].value != null)
          return /perc/i.test(String(row[fCalc].value));
        if (fPctFlag && row[fPctFlag]) {
          var v = row[fPctFlag].value;
          return v === true || v === 1 || /^(yes|true|1)$/i.test(String(v));
        }
        return false;
      }

      // ---- group by BU -> KPI (query order is already the LookML sort) ---
      var buOrder = [], buMap = {};
      data.forEach(function (row) {
        var bu = row[fBu].value == null ? "—" : row[fBu].value;
        var kpi = row[fKpi].value == null ? "—" : row[fKpi].value;
        var key = String(row[fSort] ? row[fSort].value : row[fTim].value);

        if (!buMap[bu]) { buMap[bu] = { order: [], kpis: {} }; buOrder.push(bu); }
        var b = buMap[bu];
        if (!b.kpis[kpi]) {
          b.kpis[kpi] = { isPercent: rowIsPercent(row), cells: {} };
          b.order.push(kpi);
        }
        b.kpis[kpi].cells[key] = {
          value: row[fVal] ? row[fVal].value : null,
          delta: fDelta && row[fDelta] ? row[fDelta].value : null
        };
      });

      // ---- scope label ----------------------------------------------------
      // Matches Tableau's "Global". The actual entity/sub-entity in play is
      // already visible in the dashboard filter bar, so don't repeat it here
      // (a long value like "HS - Saudi Arabia" just wraps in a narrow column).
      // Override per tile with the scope_label option if you want it named.
      var scopeLabel = c.scope_label || "Global";

      // ---- head -----------------------------------------------------------
      var th = [
        '<tr>',
        '<th class="hs-lbl hs-col-scope" style="left:0;min-width:' + wScope + 'px;width:' + wScope + 'px;"></th>',
        '<th class="hs-lbl hs-col-bu" style="left:' + leftBu + 'px;min-width:' + wBu + 'px;width:' + wBu + 'px;"></th>',
        '<th class="hs-lbl hs-col-kpi" style="left:' + leftKpi + 'px;min-width:' + wKpi + 'px;width:' + wKpi + 'px;"></th>'
      ];
      months.forEach(function (m) {
        th.push('<th style="min-width:' + wMonth + 'px;">' + esc(m.label) + "</th>");
      });
      if (showSpark) th.push('<th style="min-width:' + sparkW + 'px;">Trend</th>');
      th.push("</tr>");
      n.thead.innerHTML = th.join("");

      // ---- body -------------------------------------------------------------
      var totalRows = buOrder.reduce(function (s, bu) { return s + buMap[bu].order.length; }, 0);
      var html = [];
      var firstRowDone = false;

      buOrder.forEach(function (bu) {
        var b = buMap[bu];
        b.order.forEach(function (kpi, idx) {
          var k = b.kpis[kpi];
          var tr = ['<tr class="' + (idx === 0 ? "hs-newbu" : "") + '" style="height:' + rowH + 'px;">'];

          if (!firstRowDone) {
            tr.push('<td class="hs-col-scope" rowspan="' + totalRows + '" style="left:0;width:' + wScope + 'px;">' + esc(scopeLabel) + "</td>");
            firstRowDone = true;
          }
          if (idx === 0) {
            tr.push('<td class="hs-col-bu" rowspan="' + b.order.length + '" style="left:' + leftBu + 'px;width:' + wBu + 'px;">' + esc(bu) + "</td>");
          }
          tr.push('<td class="hs-col-kpi" style="left:' + leftKpi + 'px;width:' + wKpi + 'px;">' + esc(kpi) + "</td>");

          // Row-level scan: max |delta| for bar scaling, and whether ANY
          // value in the row is fractional. Decimals are decided per ROW, not
          // per cell — otherwise one KPI renders as "2,289.8, 2,114, 2,388".
          var maxAbs = 0;
          var rowHasFraction = false;
          months.forEach(function (m) {
            var cell = k.cells[m.key];
            if (!cell) return;
            if (cell.delta != null && !isNaN(cell.delta))
              maxAbs = Math.max(maxAbs, Math.abs(Number(cell.delta)));
            if (cell.value != null && !isNaN(cell.value)) {
              var nv = Number(cell.value);
              if (Math.abs(nv - Math.round(nv)) > 1e-9) rowHasFraction = true;
            }
          });
          var rowDec = k.isPercent || !smart ? decV : rowHasFraction ? decV : 0;

          var series = [];
          months.forEach(function (m) {
            var cell = k.cells[m.key];
            var v = cell ? cell.value : null;
            var d = cell ? cell.delta : null;

            var inTrend = !(dropCurrent && m.ym != null && m.ym >= nowYm);
            series.push(inTrend ? v : null);

            if (v == null || v === "" || isNaN(v)) {
              tr.push('<td><div class="hs-okr-cellbox"><span class="hs-okr-null">–</span></div></td>');
              return;
            }

            var cellHtml = '<div class="hs-okr-val">' + fmtValue(Number(v), k.isPercent, rowDec) + "</div>";

            if (d != null && !isNaN(d)) {
              var dn = Number(d);
              var col = dn < 0 ? colNeg : colPos;
              var txt = k.isPercent ? dn.toFixed(decPp) : dn.toFixed(decPct) + "%";
              if (arrows) txt = (dn < 0 ? "▼ " : "▲ ") + txt;
              var barW = scaledBar && maxAbs > 0
                ? 10 + 22 * Math.min(1, Math.abs(dn) / maxAbs)
                : 24;
              cellHtml +=
                '<div class="hs-okr-delta" style="color:' + col + ';">' + txt + "</div>" +
                '<span class="hs-okr-bar" style="background:' + col + ";width:" + barW.toFixed(0) + 'px;"></span>';
            }
            tr.push('<td><div class="hs-okr-cellbox">' + cellHtml + "</div></td>");
          });

          if (showSpark) {
            tr.push('<td class="hs-okr-spark">' + spark(series, sparkW, sparkH, colSpark, sparkPts) + "</td>");
          }
          tr.push("</tr>");
          html.push(tr.join(""));
        });
      });

      n.tbody.innerHTML = html.join("");
      done();

      // ---------------- helpers ----------------
      function fmtValue(v, isPercent, decimals) {
        var text = v.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        });
        return isPercent ? text + "%" : text;
      }

      function monthLabel(raw) {
        var d = new Date(raw);
        if (isNaN(d.getTime())) return String(raw);
        var M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return M[d.getUTCMonth()] + "-" + String(d.getUTCFullYear()).slice(2);
      }

      function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
      }

      function spark(values, w, h, color, dots) {
        var pts = [];
        values.forEach(function (v, i) {
          if (v != null && v !== "" && !isNaN(v)) pts.push({ i: i, v: Number(v) });
        });
        if (pts.length < 2) return '<svg width="' + w + '" height="' + h + '"></svg>';

        var vals = pts.map(function (p) { return p.v; });
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        var range = max - min || 1;
        var n = values.length;
        var padX = 6, padY = 5;
        var iw = w - padX * 2, ih = h - padY * 2;

        var xy = pts.map(function (p) {
          return {
            x: padX + (n === 1 ? 0 : (p.i / (n - 1)) * iw),
            y: padY + ih - ((p.v - min) / range) * ih
          };
        });

        var poly = xy.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
        var circles = dots
          ? xy.map(function (p) {
              return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="1.9" fill="' + color + '"/>';
            }).join("")
          : "";

        return (
          '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
          '<polyline fill="none" stroke="' + color + '" stroke-width="1.4" ' +
          'stroke-linejoin="round" stroke-linecap="round" points="' + poly + '"/>' +
          circles +
          "</svg>"
        );
      }
    }
  });
})();
