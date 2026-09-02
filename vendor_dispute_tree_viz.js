/* =====================================================================
 * Vendor Dispute Tree -- Looker Custom Visualization  (vanilla SVG, no deps)
 * ---------------------------------------------------------------------
 * Expects a query that returns the ROLLUP shape (one row per tree node):
 *   node    (dimension)  -- the node label            e.g. "Rejected"
 *   parent  (dimension)  -- the parent node label     e.g. "Raised to dispute system"
 *   orders  (measure)    -- COUNT(DISTINCT order_id)
 *   total_disputes (measure, optional) -- COUNT(DISTINCT dispute_id)
 *   sar     (measure)    -- SUM(order_amount_dedup)
 * Field mapping is by name (contains node/parent/order/disput/sar|amount|fund);
 * you can override with the options below.
 * ===================================================================== */

looker.plugins.visualizations.add({
  id: "vendor_dispute_tree",
  label: "Vendor Dispute Tree",

  options: {
    title_text:   { type: "string",  label: "Title",              default: "", section: "Style", order: 1 },
    currency:     { type: "string",  label: "Amount suffix",      default: "SAR", section: "Style", order: 2 },
    count_word:   { type: "string",  label: "Count word",         default: "orders", section: "Style", order: 3 },
    date_count_word: { type: "string", label: "Date-node count word", default: "disputes", section: "Style", order: 4 },
    box_w:        { type: "number",  label: "Box width (px)",     default: 172, section: "Layout", order: 1 },
    h_gap:        { type: "number",  label: "Horizontal gap (px)",default: 20,  section: "Layout", order: 2 },
    level_gap:    { type: "number",  label: "Level gap (px)",     default: 118, section: "Layout", order: 3 }
  },

  create: function (element, config) {
    element.innerHTML = "";
    var style = document.createElement("style");
    style.innerHTML =
      ".vdt-wrap{width:100%;height:100%;overflow:auto;font-family:Roboto,Arial,Helvetica,sans-serif;background:#fff;}" +
      ".vdt-title{font-size:15px;font-weight:600;color:#202124;padding:10px 14px 0;}" +
      ".vdt-node-title{font-weight:600;}" +
      ".vdt-node-metric{font-weight:400;opacity:.9;}" +
      ".vdt-note{fill:#5f6368;font-style:italic;}";
    element.appendChild(style);
    this._wrap = document.createElement("div");
    this._wrap.className = "vdt-wrap";
    element.appendChild(this._wrap);
  },

  updateAsync: function (data, element, config, queryResponse, details, done) {
    try {
      this._wrap.innerHTML = "";
      this.clearErrors && this.clearErrors();

      var dims = queryResponse.fields.dimension_like || [];
      var meas = queryResponse.fields.measure_like || [];
      if (dims.length < 2) {
        this.addError && this.addError({ title: "Need node + parent dimensions",
          message: "Query must return a node label and a parent label as dimensions." });
        return done();
      }
      var short = function (f) { return (f.name || "").split(".").pop().toLowerCase(); };
      var pick = function (arr, re, fb) { for (var i=0;i<arr.length;i++){ if(re.test(short(arr[i]))) return arr[i]; } return fb; };

      var fNode   = pick(dims, /node/, dims[0]);
      var fParent = pick(dims, /parent/, dims[1]);
      var fOrders = pick(meas, /order/, meas[0]);
      var fDisp   = pick(meas, /disput/, null);
      var fSar    = pick(meas, /sar|amount|fund|value/, meas[meas.length-1]);

      var val = function (row, f) { return f && row[f.name] ? row[f.name].value : null; };

      // ---- build node list -------------------------------------------
      var nodes = data.map(function (row) {
        return {
          id:     val(row, fNode),
          parent: val(row, fParent),
          orders: Number(val(row, fOrders)) || 0,
          disputes: fDisp ? (Number(val(row, fDisp)) || 0) : null,
          sar:    Number(val(row, fSar)) || 0
        };
      }).filter(function (n) { return n.id != null && n.id !== ""; });

      if (!nodes.length) { this._wrap.innerHTML = "<div class='vdt-title'>No rows.</div>"; return done(); }

      // ---- hierarchy --------------------------------------------------
      var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
      var kids = {};
      nodes.forEach(function (n) {
        var p = (n.parent == null || n.parent === "") ? null : n.parent;
        if (p != null) { (kids[p] = kids[p] || []).push(n); }
      });
      var roots = nodes.filter(function (n) { return n.parent == null || n.parent === "" || !byId[n.parent]; });
      var root = roots[0];

      // stable, sensible child ordering
      var ORDER = ["Not raised", "Raised to dispute system", "Approved", "Unaccounted / Pending", "Rejected"];
      var orderKey = function (n) {
        var i = ORDER.indexOf(n.id);
        if (i > -1) return i;
        if (/^raised on/i.test(n.id)) return 1000 - n.disputes; // dates: biggest first
        return 500 - n.orders; // reasons / buckets: biggest first
      };
      Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return orderKey(a) - orderKey(b); }); });

      // ---- config -----------------------------------------------------
      var BOXW = +config.box_w || 172, HGAP = +config.h_gap || 20, LGAP = +config.level_gap || 118;
      var currency = config.currency || "SAR", cword = config.count_word || "orders",
          dword = config.date_count_word || "disputes";

      var fmt = function (n) {
        n = Number(n) || 0; var a = Math.abs(n);
        if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(Math.round(n));
      };
      var wrap = function (s, max) {
        s = String(s || ""); var words = s.split(/\s+/), lines = [], cur = "";
        words.forEach(function (w) {
          if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
          else { cur = (cur ? cur + " " : "") + w; }
        });
        if (cur) lines.push(cur);
        return lines.slice(0, 3);
      };

      // ---- layout (tidy top-down, with vertical stacking) ------------
      // A node whose children are ALL leaves and number >= STACK_MIN is
      // rendered as a vertical column (keeps the tree from getting wide).
      var STACK_MIN = 3, INDENT = 16, STACKV = 10;
      var measure = function (n) {
        n.titleLines = wrap(n.id, Math.floor((BOXW - 18) / 6.6));
        n.h = 14 + n.titleLines.length * 15 + 18;
      };
      var isLeaf = function (n) { return !(kids[n.id] && kids[n.id].length); };
      var leafX = 0, maxBottom = 0;
      (function layout(node, depth, y) {
        node.depth = depth; node.y = y; measure(node);
        var ch = kids[node.id] || [];
        var stacked = ch.length >= STACK_MIN && ch.every(isLeaf);
        node.stacked = stacked;
        if (!ch.length) {
          node.x = leafX * (BOXW + HGAP); leafX++;
        } else if (stacked) {
          node.x = leafX * (BOXW + HGAP); leafX++;         // occupies one column
          var cy = y + node.h + 26;
          ch.forEach(function (c) {
            c.depth = depth + 1; measure(c);
            c.x = node.x + INDENT; c.y = cy;
            cy += c.h + STACKV;
            if (c.y + c.h > maxBottom) maxBottom = c.y + c.h;
          });
        } else {
          ch.forEach(function (c) { layout(c, depth + 1, y + LGAP); });
          node.x = (ch[0].x + ch[ch.length - 1].x) / 2;
        }
        if (node.y + node.h > maxBottom) maxBottom = node.y + node.h;
      })(root, 0, 0);

      var totalW = Math.max(leafX * (BOXW + HGAP) + INDENT, BOXW + 40);
      var totalH = maxBottom + 20;
      var PADX = 20, PADY = 10;

      // ---- colours (match the reference diagram) ---------------------
      var styleFor = function (n) {
        var id = (n.id || "").toLowerCase(), p = (n.parent || "").toLowerCase();
        if (n.depth === 0) return { fill: "#0f2444", stroke: "#0f2444", text: "#ffffff" };
        if (id === "raised to dispute system") return { fill: "#e8f1fe", stroke: "#1a73e8", text: "#1967d2" };
        if (id === "not raised") return { fill: "#f1f3f4", stroke: "#9aa0a6", text: "#5f6368" };
        if (id === "approved") return { fill: "#e6f4ea", stroke: "#34a853", text: "#188038" };
        if (id.indexOf("unaccounted") === 0 || id.indexOf("pending") > -1) return { fill: "#fef7e0", stroke: "#f9ab00", text: "#a1620a" };
        if (id === "rejected") return { fill: "#fce8e6", stroke: "#d93025", text: "#c5221f" };
        if (p.indexOf("time limit") > -1) return { fill: "#c5221f", stroke: "#a50e0e", text: "#ffffff" }; // date boxes
        if (p.indexOf("not compensated to the customer") > -1)                                            // eligibility buckets
          return { fill: "#f3e8fd", stroke: "#8e44ad", text: "#6c2fb3" };
        return { fill: "#fdecec", stroke: "#e79b95", text: "#c5221f" }; // other reasons
      };

      // ---- render SVG -------------------------------------------------
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", totalW + PADX * 2);
      svg.setAttribute("height", totalH + PADY * 2);
      svg.style.display = "block";

      var linkG = document.createElementNS(NS, "g");
      var nodeG = document.createElementNS(NS, "g");
      svg.appendChild(linkG); svg.appendChild(nodeG);

      var cx = function (n) { return PADX + n.x + BOXW / 2; };
      var addPath = function (d) {
        var path = document.createElementNS(NS, "path");
        path.setAttribute("d", d); path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#0f2444"); path.setAttribute("stroke-width", "1.3");
        path.setAttribute("opacity", "0.55"); linkG.appendChild(path);
      };

      // links
      nodes.forEach(function (n) {
        var ch = kids[n.id] || [];
        if (!ch.length) return;
        if (n.stacked) {
          // elbow from parent down to a left spine, horizontal stub to each child
          var pcx = cx(n), top = PADY + n.y + n.h, sx = PADX + n.x + 8;
          var lastMid = PADY + ch[ch.length - 1].y + ch[ch.length - 1].h / 2;
          addPath("M" + pcx + "," + top + " V" + (top + 12) + " H" + sx + " V" + lastMid);
          ch.forEach(function (c) {
            var cym = PADY + c.y + c.h / 2, cxl = PADX + c.x;
            addPath("M" + sx + "," + cym + " H" + cxl);
          });
        } else {
          ch.forEach(function (c) {
            var x1 = cx(n), y1 = PADY + n.y + n.h, x2 = cx(c), y2 = PADY + c.y, my = (y1 + y2) / 2;
            addPath("M" + x1 + "," + y1 + " V" + my + " H" + x2 + " V" + y2);
          });
        }
      });

      // boxes
      nodes.forEach(function (n) {
        var s = styleFor(n), gx = PADX + n.x, gy = PADY + n.y;
        var g = document.createElementNS(NS, "g");

        var rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", gx); rect.setAttribute("y", gy);
        rect.setAttribute("width", BOXW); rect.setAttribute("height", n.h);
        rect.setAttribute("rx", 8); rect.setAttribute("ry", 8);
        rect.setAttribute("fill", s.fill); rect.setAttribute("stroke", s.stroke);
        rect.setAttribute("stroke-width", "1.6");
        g.appendChild(rect);

        var ty = gy + 17;
        n.titleLines.forEach(function (ln) {
          var t = document.createElementNS(NS, "text");
          t.setAttribute("x", gx + BOXW / 2); t.setAttribute("y", ty);
          t.setAttribute("text-anchor", "middle");
          t.setAttribute("font-size", "12"); t.setAttribute("font-weight", "600");
          t.setAttribute("fill", s.text);
          t.textContent = ln; g.appendChild(t); ty += 15;
        });

        var isDate = (n.parent || "").toLowerCase().indexOf("time limit") > -1;
        var cnt = isDate && n.disputes != null ? n.disputes : n.orders;
        var word = isDate ? dword : cword;
        var metric = document.createElementNS(NS, "text");
        metric.setAttribute("x", gx + BOXW / 2); metric.setAttribute("y", ty + 1);
        metric.setAttribute("text-anchor", "middle");
        metric.setAttribute("font-size", "11.5"); metric.setAttribute("fill", s.text);
        metric.textContent = fmt(cnt) + " " + word + "  |  " + fmt(n.sar) + " " + currency;
        g.appendChild(metric);

        var title = document.createElementNS(NS, "title");
        title.textContent = n.id + "\n" + cnt + " " + word + " | " + Math.round(n.sar) + " " + currency;
        g.appendChild(title);

        nodeG.appendChild(g);
      });

      if (config.title_text) {
        var h = document.createElement("div");
        h.className = "vdt-title"; h.textContent = config.title_text;
        this._wrap.appendChild(h);
      }
      this._wrap.appendChild(svg);
      done();
    } catch (e) {
      if (this.addError) this.addError({ title: "Render error", message: String(e && e.message || e) });
      done();
    }
  }
});
