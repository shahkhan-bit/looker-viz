/**
 * hs_vm_okrs_tracker.js
 * -----------------------------------------------------------------------
 * Looker custom visualization: "HungerStation - VM OKRs Tracker"
 *
 * Renders a single self-contained table that reproduces the Tableau
 * "VM OKRs Tracker": Business Unit / KPI rows, one column per month
 * (value on top, MoM delta with an arrow underneath), and a trailing
 * inline sparkline (trend) column per row — in the HungerStation
 * red/yellow palette.
 *
 * Repo:  shahkhan-bit/looker-viz  ->  hs_vm_okrs_tracker.js
 * Register in Looker: Admin > Visualizations > Add Visualization
 *   ID:    hs_vm_okrs_tracker
 *   Label: HungerStation - VM OKRs Tracker
 *   Main script URL: (jsdelivr URL to this file — see STEPS.md)
 *
 * Expected explore fields (query built by the dashboard element, no pivot):
 *   dimensions: business_unit, business_unit_sort (optional, for grouping
 *               order only — LookML `sorts:` already orders the rows),
 *               kpi_display_name, tim_month (date), tim_sort (optional
 *               integer YYYYMM — falls back to tim_month if absent),
 *               month_label (optional display label, falls back to
 *               formatting tim_month), is_percent_kpi (yesno)
 *   measures:   value, variance_smart
 * -----------------------------------------------------------------------
 */
(function () {
  var HS_RED = "#ED1C24";
  var HS_RED_DARK = "#B3141A";
  var HS_YELLOW = "#FFC72C";
  var HS_INK = "#1F2430";

  looker.plugins.visualizations.add({
    id: "hs_vm_okrs_tracker",
    label: "HungerStation - VM OKRs Tracker",

    options: {
      header_title: {
        type: "string",
        label: "Header title",
        default: "VM OKRs TRACKER",
        section: "Style",
        order: 1
      },
      scope_label: {
        type: "string",
        label: "Scope column label (leftmost column, blank = auto from filters)",
        default: "",
        section: "Style",
        order: 2
      },
      header_bg_color: {
        type: "string",
        label: "Header background",
        display: "color",
        default: HS_RED,
        section: "Style",
        order: 3
      },
      header_text_color: {
        type: "string",
        label: "Header text",
        display: "color",
        default: "#FFFFFF",
        section: "Style",
        order: 4
      },
      accent_color: {
        type: "string",
        label: "Accent / positive delta color",
        display: "color",
        default: "#2D7FF9",
        section: "Style",
        order: 5
      },
      negative_color: {
        type: "string",
        label: "Negative delta color",
        display: "color",
        default: HS_RED,
        section: "Style",
        order: 6
      },
      sparkline_color: {
        type: "string",
        label: "Sparkline line color",
        display: "color",
        default: HS_INK,
        section: "Style",
        order: 7
      },
      show_sparkline: {
        type: "boolean",
        label: "Show trend sparkline column",
        default: true,
        section: "Style",
        order: 8
      },
      decimals_value: {
        type: "number",
        label: "Decimals — value",
        default: 1,
        section: "Formatting",
        order: 1
      },
      decimals_pp: {
        type: "number",
        label: "Decimals — pp delta (% KPIs)",
        default: 2,
        section: "Formatting",
        order: 2
      },
      decimals_pct: {
        type: "number",
        label: "Decimals — relative % delta (non-% KPIs)",
        default: 1,
        section: "Formatting",
        order: 3
      },
      row_height: {
        type: "number",
        label: "Row height (px)",
        default: 46,
        section: "Layout",
        order: 1
      },
      sparkline_width: {
        type: "number",
        label: "Sparkline width (px)",
        default: 170,
        section: "Layout",
        order: 2
      }
    },

    create: function (element, config) {
      element.innerHTML =
        '<div class="hs-okr-root">' +
        '  <div class="hs-okr-banner"><span class="hs-okr-dot"></span><span class="hs-okr-title"></span></div>' +
        '  <div class="hs-okr-scroll"><table class="hs-okr-table"><thead></thead><tbody></tbody></table></div>' +
        '  <div class="hs-okr-empty" style="display:none;">No data returned for this query.</div>' +
        "</div>";

      var style = document.createElement("style");
      style.appendChild(
        document.createTextNode(
          "" +
            ".hs-okr-root{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
            "  height:100%;display:flex;flex-direction:column;background:#F5F5F5;color:" +
            HS_INK +
            ";box-sizing:border-box;overflow:hidden;}" +
            ".hs-okr-banner{flex:0 0 auto;display:flex;align-items:center;gap:10px;" +
            "  padding:10px 18px;background:" +
            HS_RED +
            ";}" +
            ".hs-okr-dot{width:14px;height:14px;border-radius:50%;background:" +
            HS_YELLOW +
            ";flex:0 0 auto;}" +
            ".hs-okr-title{color:#fff;font-weight:700;letter-spacing:.06em;font-size:15px;text-transform:uppercase;}" +
            ".hs-okr-scroll{flex:1 1 auto;overflow:auto;background:#fff;}" +
            ".hs-okr-table{border-collapse:collapse;width:100%;font-size:12px;}" +
            ".hs-okr-table thead th{position:sticky;top:0;z-index:3;background:#fff;" +
            "  border-bottom:2px solid #E3E3E8;padding:8px 10px;text-align:right;" +
            "  font-weight:600;color:#6B7280;white-space:nowrap;}" +
            ".hs-okr-table thead th.hs-lbl{text-align:left;}" +
            ".hs-okr-table td{border-bottom:1px solid #EEEEF1;padding:6px 10px;vertical-align:middle;" +
            "  text-align:right;white-space:nowrap;}" +
            ".hs-okr-table td.hs-col-scope,.hs-okr-table td.hs-col-bu,.hs-okr-table td.hs-col-kpi{" +
            "  text-align:left;position:sticky;background:#fff;z-index:2;}" +
            ".hs-okr-table td.hs-col-scope{left:0;min-width:64px;font-weight:600;color:#6B7280;}" +
            ".hs-okr-table td.hs-col-bu{left:64px;min-width:150px;font-weight:600;color:" +
            HS_INK +
            ";}" +
            ".hs-okr-table td.hs-col-kpi{left:214px;min-width:190px;box-shadow:2px 0 4px -2px rgba(0,0,0,.08);color:#374151;}" +
            ".hs-okr-table thead th.hs-col-scope{position:sticky;left:0;z-index:4;}" +
            ".hs-okr-table thead th.hs-col-bu{position:sticky;left:64px;z-index:4;}" +
            ".hs-okr-table thead th.hs-col-kpi{position:sticky;left:214px;z-index:4;box-shadow:2px 0 4px -2px rgba(0,0,0,.08);}" +
            ".hs-okr-cell-val{font-weight:600;font-size:13px;color:" +
            HS_INK +
            ";}" +
            ".hs-okr-cell-delta{font-size:10.5px;margin-top:2px;font-weight:600;}" +
            ".hs-okr-cell-delta .hs-bar{display:inline-block;height:2px;width:22px;border-radius:2px;margin-top:2px;}" +
            ".hs-okr-tr:hover td{background:#FAFAFC;}" +
            ".hs-okr-tr-newbu td{border-top:1px solid #E3E3E8;}" +
            ".hs-okr-spark-td{text-align:left;}" +
            ".hs-okr-empty{padding:24px;color:#6B7280;font-size:13px;}"
        )
      );
      element.appendChild(style);

      this._el = element;
      this._nodes = {
        banner: element.querySelector(".hs-okr-title"),
        thead: element.querySelector("thead"),
        tbody: element.querySelector("tbody"),
        empty: element.querySelector(".hs-okr-empty"),
        scroll: element.querySelector(".hs-okr-scroll")
      };
    },

    updateAsync: function (data, element, config, queryResponse, details, done) {
      this.clearErrors();
      var nodes = this._nodes;

      if (!data || data.length === 0) {
        nodes.thead.innerHTML = "";
        nodes.tbody.innerHTML = "";
        nodes.empty.style.display = "block";
        done();
        return;
      }
      nodes.empty.style.display = "none";

      // ---- resolve fields dynamically by suffix, so this keeps working
      //      even if you rename the model/explore. --------------------
      var dims = queryResponse.fields.dimensions || [];
      var meas = queryResponse.fields.measures || [];

      function findField(list, suffixes) {
        for (var s = 0; s < suffixes.length; s++) {
          for (var i = 0; i < list.length; i++) {
            if (list[i].name.indexOf(suffixes[s]) !== -1) return list[i].name;
          }
        }
        return null;
      }

      var buField = findField(dims, [".business_unit"]);
      var kpiField = findField(dims, [".kpi_display_name"]);
      var timField = findField(dims, [".tim_month", ".tim_date", ".tim_raw"]);
      var sortField = findField(dims, [".tim_sort"]) || timField;
      var labelField = findField(dims, [".month_label"]);
      var pctFlagField = findField(dims, [".is_percent_kpi"]);
      var valueField = findField(meas, [".value"]);
      var deltaField = findField(meas, [".variance_smart"]);

      var missing = [];
      if (!buField) missing.push("business_unit");
      if (!kpiField) missing.push("kpi_display_name");
      if (!timField) missing.push("tim_month (or tim_date)");
      if (!valueField) missing.push("value");
      if (missing.length) {
        this.addError({
          title: "Missing required field(s)",
          message: "This visualization needs: " + missing.join(", ") + "."
        });
        done();
        return;
      }

      var decV = config.decimals_value != null ? config.decimals_value : 1;
      var decPp = config.decimals_pp != null ? config.decimals_pp : 2;
      var decPct = config.decimals_pct != null ? config.decimals_pct : 1;
      var posColor = config.accent_color || "#2D7FF9";
      var negColor = config.negative_color || HS_RED;
      var sparkColor = config.sparkline_color || HS_INK;
      var showSpark = config.show_sparkline !== false;
      var sparkW = config.sparkline_width || 170;
      var sparkH = Math.max(24, (config.row_height || 46) - 16);

      nodes.banner.textContent = config.header_title || "VM OKRs TRACKER";

      // ---- 1. unique, chronologically-sorted month list ---------------
      var monthMap = {}; // sortKey -> { key, label }
      data.forEach(function (row) {
        var sortVal = row[sortField] ? row[sortField].value : row[timField].value;
        var key = String(sortVal);
        if (!monthMap[key]) {
          var lbl = labelField && row[labelField] ? row[labelField].value : formatMonthLabel(row[timField].value);
          monthMap[key] = { key: key, label: lbl, sortVal: sortVal };
        }
      });
      var months = Object.keys(monthMap)
        .map(function (k) {
          return monthMap[k];
        })
        .sort(function (a, b) {
          return a.sortVal < b.sortVal ? -1 : a.sortVal > b.sortVal ? 1 : 0;
        });

      // ---- 2. group rows by Business Unit -> KPI, preserving the order
      //         the query already returned them in (LookML `sorts:`) ----
      var buOrder = [];
      var buMap = {}; // buName -> { kpiOrder: [], kpis: { kpiName -> {isPercent, cells:{monthKey:{value,delta}}} } }

      data.forEach(function (row) {
        var bu = row[buField].value;
        var kpi = row[kpiField].value;
        var sortVal = row[sortField] ? row[sortField].value : row[timField].value;
        var mKey = String(sortVal);

        if (!buMap[bu]) {
          buMap[bu] = { kpiOrder: [], kpis: {} };
          buOrder.push(bu);
        }
        var buEntry = buMap[bu];
        if (!buEntry.kpis[kpi]) {
          buEntry.kpis[kpi] = {
            isPercent: pctFlagField ? !!row[pctFlagField].value : false,
            cells: {}
          };
          buEntry.kpiOrder.push(kpi);
        }
        buEntry.kpis[kpi].cells[mKey] = {
          value: row[valueField] ? row[valueField].value : null,
          delta: deltaField && row[deltaField] ? row[deltaField].value : null
        };
      });

      // ---- 3. scope label (leftmost merged column) ---------------------
      var scopeLabel = config.scope_label;
      if (!scopeLabel) {
        scopeLabel = "Global";
        try {
          var af = queryResponse.applied_filters || [];
          for (var i = 0; i < af.length; i++) {
            if (af[i].field && /management_entity|sub_entity/.test(af[i].field.name)) {
              scopeLabel = af[i].filter_value || scopeLabel;
              break;
            }
          }
        } catch (e) {
          /* noop — keep default */
        }
      }

      // ---- 4. render <thead> --------------------------------------------
      var theadHtml =
        "<tr>" +
        '<th class="hs-lbl hs-col-scope"></th>' +
        '<th class="hs-lbl hs-col-bu"></th>' +
        '<th class="hs-lbl hs-col-kpi"></th>';
      months.forEach(function (m) {
        theadHtml += "<th>" + escapeHtml(m.label) + "</th>";
      });
      if (showSpark) theadHtml += '<th class="hs-lbl">Trend</th>';
      theadHtml += "</tr>";
      nodes.thead.innerHTML = theadHtml;

      // ---- 5. render <tbody> ----------------------------------------------
      var rowsHtml = [];
      var totalRows = 0;
      buOrder.forEach(function (bu) {
        totalRows += buMap[bu].kpiOrder.length;
      });
      var scopeRowsLeft = totalRows;

      buOrder.forEach(function (bu) {
        var buEntry = buMap[bu];
        var kpiCount = buEntry.kpiOrder.length;

        buEntry.kpiOrder.forEach(function (kpi, idx) {
          var kpiEntry = buEntry.kpis[kpi];
          var tr = ['<tr class="hs-okr-tr' + (idx === 0 ? " hs-okr-tr-newbu" : "") + '">'];

          if (bu === buOrder[0] && idx === 0) {
            tr.push('<td class="hs-col-scope" rowspan="' + totalRows + '">' + escapeHtml(scopeLabel) + "</td>");
          } else if (scopeRowsLeft === totalRows) {
            // already emitted above on the very first row only — nothing to do
          }

          if (idx === 0) {
            tr.push('<td class="hs-col-bu" rowspan="' + kpiCount + '">' + escapeHtml(bu) + "</td>");
          }

          tr.push('<td class="hs-col-kpi">' + escapeHtml(kpi) + "</td>");

          var seriesVals = [];
          months.forEach(function (m) {
            var cell = kpiEntry.cells[m.key];
            var val = cell ? cell.value : null;
            var delta = cell ? cell.delta : null;
            seriesVals.push(val);

            var valText = formatValue(val, kpiEntry.isPercent, decV);
            var deltaHtml = "";
            if (delta !== null && delta !== undefined) {
              var isPos = delta >= 0;
              var color = isPos ? posColor : negColor;
              var arrow = isPos ? "▲" : "▼";
              var deltaText = kpiEntry.isPercent
                ? (isPos ? "+" : "") + delta.toFixed(decPp)
                : (isPos ? "+" : "") + delta.toFixed(decPct) + "%";
              deltaHtml =
                '<div class="hs-okr-cell-delta" style="color:' +
                color +
                ';">' +
                arrow +
                " " +
                deltaText +
                '<div class="hs-bar" style="background:' +
                color +
                ';"></div></div>';
            }
            tr.push(
              "<td><div class=\"hs-okr-cell-val\">" + valText + "</div>" + deltaHtml + "</td>"
            );
          });

          if (showSpark) {
            tr.push(
              '<td class="hs-okr-spark-td">' +
                buildSparkline(seriesVals, sparkW, sparkH, sparkColor) +
                "</td>"
            );
          }

          tr.push("</tr>");
          rowsHtml.push(tr.join(""));
        });
      });

      nodes.tbody.innerHTML = rowsHtml.join("");
      done();

      // ---------------------------------------------------------------
      function formatMonthLabel(rawDate) {
        var d = new Date(rawDate);
        if (isNaN(d.getTime())) return String(rawDate);
        var months3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return months3[d.getUTCMonth()] + "-" + String(d.getUTCFullYear()).slice(2);
      }

      function formatValue(val, isPercent, decimals) {
        if (val === null || val === undefined || isNaN(val)) return "–";
        var num = Number(val);
        var text = num.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        });
        return isPercent ? text + "%" : text;
      }

      function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      }

      function buildSparkline(values, w, h, color) {
        var pts = [];
        var nums = [];
        values.forEach(function (v, i) {
          if (v !== null && v !== undefined && !isNaN(v)) nums.push({ i: i, v: Number(v) });
        });
        if (nums.length < 2) {
          return '<svg width="' + w + '" height="' + h + '"></svg>';
        }
        var min = Math.min.apply(null, nums.map(function (n) { return n.v; }));
        var max = Math.max.apply(null, nums.map(function (n) { return n.v; }));
        var range = max - min || 1;
        var n = values.length;
        var padX = 4,
          padY = 4;
        var innerW = w - padX * 2,
          innerH = h - padY * 2;

        nums.forEach(function (n2) {
          var x = padX + (n === 1 ? 0 : (n2.i / (n - 1)) * innerW);
          var y = padY + innerH - ((n2.v - min) / range) * innerH;
          pts.push(x.toFixed(1) + "," + y.toFixed(1));
        });

        var last = nums[nums.length - 1];
        var lastX = padX + (n === 1 ? 0 : (last.i / (n - 1)) * innerW);
        var lastY = padY + innerH - ((last.v - min) / range) * innerH;

        return (
          '<svg width="' +
          w +
          '" height="' +
          h +
          '" viewBox="0 0 ' +
          w +
          " " +
          h +
          '">' +
          '<polyline fill="none" stroke="' +
          color +
          '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' +
          pts.join(" ") +
          '" />' +
          '<circle cx="' +
          lastX.toFixed(1) +
          '" cy="' +
          lastY.toFixed(1) +
          '" r="2.5" fill="' +
          HS_RED +
          '" />' +
          "</svg>"
        );
      }
    }
  });
})();
