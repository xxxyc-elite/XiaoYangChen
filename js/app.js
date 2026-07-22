/* =====================================================================
   肖阳晨的个人网站 — 交互逻辑
   依赖：leaflet.js / china-prov-geo.js / china-city-geo.js / marked.min.js / data.js
   ===================================================================== */
(function () {
  "use strict";

  var D = window.SITE_DATA;
  if (!D) { console.error("未找到 SITE_DATA，请检查 js/data.js"); return; }

  // Markdown 渲染配置
  if (window.marked && marked.parse) {
    marked.setOptions({ gfm: true, breaks: true });
  }
  function md(text) {
    if (!text) return "";
    return window.marked ? marked.parse(String(text)) : String(text);
  }

  var TRAVEL_COLOR = "#3b82f6";
  var activeTags = new Set();          // 当前选中的标签
  var activeProvince = null;           // 当前选中的省级行政区（null = 全部）
  var map = null;
  var markerLayer, provLayer, cityLayer;
  var markerByName = {};

  /* ---------------- 顶部 / Hero ---------------- */
  var p = D.profile || {};
  document.title = (p.name || "个人网站") + " 的个人网站";
  setText("brandName", p.name);
  setText("heroName", p.name);
  setText("heroTagline", p.tagline);
  setText("heroLoc", p.location ? "📍 " + p.location : "");
  setText("footerName", "© " + (p.name || ""));

  // 头像
  var avatar = document.getElementById("avatar");
  if (p.avatar) {
    avatar.innerHTML = '<img src="' + p.avatar + '" alt="头像" />';
  } else if (p.name) {
    avatar.textContent = p.name.charAt(0);
  }

  // 个人简介（Markdown）
  var bioEl = document.getElementById("bio");
  if (bioEl) bioEl.innerHTML = md(p.bio || "");

  // 联系方式
  var contactsEl = document.getElementById("contacts");
  if (contactsEl && p.contacts) {
    contactsEl.innerHTML = p.contacts.map(function (c) {
      var val = c.href
        ? '<a href="' + c.href + '" target="_blank" rel="noopener">' + esc(c.value) + "</a>"
        : '<span class="c-val">' + esc(c.value) + "</span>";
      return '<li><span class="c-label">' + esc(c.label || "") + "</span>" + val + "</li>";
    }).join("");
  }

  /* ---------------- 兴趣爱好 ---------------- */
  var hobbyGrid = document.getElementById("hobbyGrid");
  if (hobbyGrid && D.hobbies) {
    hobbyGrid.innerHTML = D.hobbies.map(function (h, i) {
      var tags = (h.tags || []).map(function (t) {
        return '<span class="mini-tag">' + esc(t) + "</span>";
      }).join("");
      return (
        '<div class="hobby" data-tags="' + esc((h.tags || []).join(",")) + '" data-i="' + i + '">' +
        '<div class="h-icon">' + (h.icon || "✦") + "</div>" +
        '<div class="h-name">' + esc(h.name) + "</div>" +
        '<div class="h-desc">' + esc(h.desc || "") + "</div>" +
        '<div class="h-tags">' + tags + "</div>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------------- 标签云 ---------------- */
  // 统计每个标签命中的条目数（兴趣 + 旅行 + 垂钓）
  function tagCount(name) {
    var n = 0;
    (D.hobbies || []).forEach(function (h) { if ((h.tags || []).indexOf(name) >= 0) n++; });
    (D.travel || []).forEach(function (t) { if ((t.tags || []).indexOf(name) >= 0) n++; });
    (D.fishSpecies || []).forEach(function (f) { if ((f.tags || []).indexOf(name) >= 0) n++; });
    return n;
  }
  var tagCloud = document.getElementById("tagCloud");
  if (tagCloud && D.tags) {
    tagCloud.innerHTML = D.tags.map(function (t) {
      return (
        '<span class="tag" data-tag="' + esc(t.name) + '" style="background:' + t.color + '">' +
        esc(t.name) + '<span class="t-count">' + tagCount(t.name) + "</span></span>"
      );
    }).join("");
    tagCloud.querySelectorAll(".tag").forEach(function (el) {
      el.addEventListener("click", function () { toggleTag(el.getAttribute("data-tag")); });
    });
    updateTagBar();
  }

  function toggleTag(name) {
    if (!name) return;
    var el = tagCloud.querySelector('.tag[data-tag="' + name + '"]');
    if (activeTags.has(name)) { activeTags.delete(name); if (el) el.classList.remove("active"); }
    else { activeTags.add(name); if (el) el.classList.add("active"); }
    applyTagFilter();
    updateTagBar();
  }

  function updateTagBar() {
    var bar = document.getElementById("tagFilterBar");
    if (!bar) return;
    if (activeTags.size === 0) { bar.hidden = true; bar.innerHTML = ""; return; }
    var chips = [];
    activeTags.forEach(function (n) {
      chips.push('<button type="button" class="tf-chip" data-tag="' + esc(n) + '">' + esc(n) + ' <span class="tf-x">✕</span></button>');
    });
    bar.hidden = false;
    bar.innerHTML = '<span class="tf-label">正在筛选</span>' + chips.join("") +
      '<button type="button" class="tf-clear" id="tfClear">清除全部</button>';
    bar.querySelectorAll(".tf-chip").forEach(function (b) {
      b.addEventListener("click", function () { toggleTag(b.getAttribute("data-tag")); });
    });
    var clr = bar.querySelector("#tfClear");
    if (clr) clr.addEventListener("click", function () {
      activeTags.clear();
      tagCloud.querySelectorAll(".tag.active").forEach(function (t) { t.classList.remove("active"); });
      applyTagFilter();
      updateTagBar();
    });
  }

  /* ---------------- 地图数据 ---------------- */
  function toPoint(item) {
    return {
      name: item.name,
      value: item.coord,
      date: item.date,
      note: item.note,
      tags: item.tags || [],
      province: item.province || "",
      city: item.city || "",
      county: item.county || "",
      img: item.img || "",
      type: "travel",
    };
  }
  var travelPts = (D.travel || []).map(toPoint);

  // 同时受「标签」与「省级行政区」两个维度筛选
  function passFilters(pt) {
    if (activeProvince && pt.province !== activeProvince) return false;
    if (activeTags.size > 0 && !pt.tags.some(function (t) { return activeTags.has(t); })) return false;
    return true;
  }
  function filtered(points) {
    return points.filter(passFilters);
  }

  /* ---------------- 初始化 Leaflet 中国地形图（省界 + 地级市界 + 地形瓦片） ---------------- */
  // 省份名归一化：「江西省」→「江西」、「广西壮族自治区」→「广西」、「北京市」→「北京」
  function normProv(n) {
    return (n || "")
      .replace(/(省|市|特别行政区|自治区)$/, "")
      .replace(/(壮族|回族|维吾尔|藏族)/, "")
      .trim();
  }
  var visitedProvSet = new Set(
    travelPts.map(function (p) { return normProv(p.province); }).filter(Boolean)
  );

  function makeTip(d) {
    var s = "<b>" + esc(d.name || "") + "</b><br/>";
    s += "📍 旅行足迹<br/>日期：" + esc(d.date || "-");
    if (d.note) s += "<br/><span style='color:#666'>" + esc(d.note) + "</span>";
    return s;
  }

  function initMap() {
    var container = document.getElementById("chinaMap");
    if (!window.L || !window.CHINA_PROV_GEO || !window.CHINA_CITY_GEO) {
      container.innerHTML =
        '<p style="padding:40px;text-align:center;color:#cdd">地图加载失败，请确认 js/leaflet.js 与边界数据文件存在。</p>';
      return;
    }
    map = L.map(container, {
      center: [35.5, 104], zoom: 4, minZoom: 3, maxZoom: 12,
      zoomControl: true, attributionControl: true, worldCopyJump: false,
    });

    // 地形底图（Esri）：两种可切换
    var relief = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 13, attribution: "地形 © Esri" }
    ).addTo(map);
    var physical = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 13, attribution: "自然地理 © Esri" }
    );
    L.control.layers(
      { "地形晕渲": relief, "自然地理": physical },
      null,
      { position: "topright" }
    ).addTo(map);

    // 地级市界（细线，浅色）
    cityLayer = L.geoJSON(window.CHINA_CITY_GEO, {
      style: { color: "rgba(60,90,120,0.45)", weight: 0.7, fill: false },
      interactive: false,
    }).addTo(map);

    // 省界（加粗；去过的省份高亮蓝，未去过的灰蓝）
    provLayer = L.geoJSON(window.CHINA_PROV_GEO, {
      style: function (f) {
        var visited = visitedProvSet.has(normProv(f.properties.name));
        return {
          color: visited ? "#1f7ae0" : "rgba(70,90,110,0.8)",
          weight: visited ? 2 : 1.2,
          fill: false,
        };
      },
      interactive: false,
    }).addTo(map);

    // 旅行发光点
    markerLayer = L.layerGroup().addTo(map);
    drawMarkers(filtered(travelPts));

    window.addEventListener("resize", function () { if (map) map.invalidateSize(); });
    window.addEventListener("load", function () { if (map) map.invalidateSize(); });
    // reveal 动画后容器尺寸才稳定，多次 invalidate
    [300, 800, 1500].forEach(function (t) { setTimeout(function () { if (map) map.invalidateSize(); }, t); });
  }

  // 绘制 / 重绘旅行点（受标签 + 省份筛选影响）
  function drawMarkers(pts) {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    markerByName = {};
    pts.forEach(function (pt) {
      if (!pt.value || pt.value.length !== 2) return;
      var m = L.marker([pt.value[1], pt.value[0]], {
        icon: L.divIcon({
          className: "travel-dot",
          html: '<span class="dot-core"></span>',
          iconSize: [18, 18], iconAnchor: [9, 9],
        }),
        title: pt.name,
        riseOnHover: true,
      });
      m.bindTooltip(makeTip(pt), { className: "travel-tip", direction: "top", offset: [0, -8] });
      m.on("click", function () {
        showDetail(pt);
        highlightRecord(pt.name);
        map.panTo([pt.value[1], pt.value[0]]);
      });
      m.addTo(markerLayer);
      markerByName[pt.name] = m;
    });
  }

  // 点击地图标记时，联动高亮下方对应的记录卡片
  function highlightRecord(name) {
    if (!name) return;
    var el = document.querySelector('.record[data-name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1600);
  }

  function renderMapData() {
    if (!map) return;
    var tData = filtered(travelPts);
    drawMarkers(tData);
    updateMapStat(tData.length);
  }

  function updateMapStat(tn) {
    var el = document.getElementById("mapStat");
    if (!el) return;
    var totalProv = new Set(travelPts.map(function (p) { return p.province; })).size;
    el.textContent = "足迹覆盖 " + totalProv + " 个省级行政区 · 已显示 " + (tn == null ? travelPts.length : tn) + " 个地点";
  }

  /* ---------------- 详情面板 ---------------- */
  function showDetail(d) {
    var empty = document.getElementById("detailEmpty");
    var body = document.getElementById("detailBody");
    if (!body) return;
    empty.hidden = true;
    body.hidden = false;
    var locParts = [d.province, d.city, d.county].filter(Boolean);
    var locLine = locParts.length
      ? '<p class="d-loc">📍 ' + esc(locParts.join(" · ")) + "</p>"
      : "";
    var imgLine = d.img
      ? '<div class="detail-img"><img src="' + esc(d.img) + '" alt="' + esc(d.name) + '" /></div>'
      : '<div class="detail-img placeholder">📷 配图待添加</div>';
    body.innerHTML =
      '<span class="d-type" style="background:' + TRAVEL_COLOR + '">📍 旅行足迹</span>' +
      "<h3>" + esc(d.name) + "</h3>" +
      imgLine +
      locLine +
      '<p class="d-meta"><b>日期：</b>' + esc(d.date || "-") +
      "　<b>坐标：</b>" + esc(d.value ? d.value[0].toFixed(2) + ", " + d.value[1].toFixed(2) : "-") + "</p>" +
      (d.note ? '<div class="d-note">' + md(d.note) + "</div>" : "");
  }

  /* ---------------- 记录列表（去过的地方，按省级行政区分组） ---------------- */
  function buildRecords() {
    var list = document.getElementById("recordList");
    if (!list) return;

    // 按省级行政区首次出现顺序分组，组内按原顺序
    var groups = [];
    var groupMap = {};
    travelPts.forEach(function (pt) {
      var pr = pt.province || "未分类";
      if (!groupMap[pr]) { groupMap[pr] = []; groups.push(pr); }
      if (passFilters(pt)) groupMap[pr].push(pt);
    });

    list.innerHTML = groups
      .filter(function (pr) { return groupMap[pr].length; })
      .map(function (pr) {
        var items = groupMap[pr].map(function (d) {
          var locParts = [d.city, d.county].filter(Boolean);
          var locLine = locParts.length ? '<div class="r-loc">' + esc(locParts.join(" · ")) + "</div>" : "";
          var thumb = d.img
            ? '<div class="r-thumb"><img src="' + esc(d.img) + '" alt="' + esc(d.name) + '" loading="lazy" /></div>'
            : '<div class="r-thumb placeholder">📷</div>';
          return (
            '<div class="record" data-name="' + esc(d.name) + '">' +
            thumb +
            '<div class="r-top"><span class="r-name">' + esc(d.name) + "</span>" +
            '<span class="r-date">' + esc(d.date || "") + "</span></div>" +
            locLine +
            (d.note ? '<p class="r-note">' + esc(d.note) + "</p>" : "") +
            "</div>"
          );
        }).join("");
        return (
          '<section class="prov-group">' +
          '<h3 class="prov-title">' + esc(pr) + ' <span class="tax-count">' + groupMap[pr].length + " 处</span></h3>" +
          '<div class="prov-items">' + items + "</div>" +
          "</section>"
        );
      }).join("");

    list.querySelectorAll(".record").forEach(function (el) {
      el.addEventListener("click", function () {
        var name = el.getAttribute("data-name");
        var pt = travelPts.filter(function (x) { return x.name === name; })[0];
        if (pt) {
          showDetail(pt);
          document.getElementById("detailCard").scrollIntoView({ behavior: "smooth", block: "center" });
          if (map && markerByName[pt.name]) {
            var mk = markerByName[pt.name];
            map.panTo(mk.getLatLng());
            mk.openTooltip();
          }
        }
      });
    });
  }

  /* ---------------- 钓鱼种类图鉴（按生物学分类：目 → 科） ---------------- */
  var fishGrid = document.getElementById("fishGrid");
  if (fishGrid && D.fishSpecies) {
    var ORDER_META = {
      "鲤形目": "Cypriniformes",
      "鲇形目": "Siluriformes",
      "合鳃目": "Synbranchiformes",
      "鲈形目": "Perciformes",
    };
    var FAMILY_META = {
      "鲤科": "Cyprinidae",
      "鳅科": "Cobitidae",
      "鲇科": "Siluridae",
      "鲿科": "Bagridae",
      "合鳃科": "Synbranchidae",
      "刺鳅科": "Mastacembelidae",
      "鳢科": "Channidae",
      "虾虎鱼科": "Gobiidae",
      "太阳鱼科": "Centrarchidae",
    };
    var ORDER_ORDER = ["鲤形目", "鲇形目", "合鳃目", "鲈形目"];

    function fishCard(f) {
      var tags = (f.tags || []).map(function (t) {
        return '<span class="mini-tag">' + esc(t) + "</span>";
      }).join("");
      var media = f.img
        ? '<div class="fish-img"><img src="' + esc(f.img) + '" alt="' + esc(f.name) + '" loading="lazy" /></div>'
        : '<div class="fish-emoji">' + (f.emoji || "🐟") + "</div>";
      var recordLine = f.record ? '<p class="fish-record">🏆 ' + esc(f.record) + "</p>" : "";
      var storyLine = f.story ? '<div class="fish-story">' + md(f.story) + "</div>" : "";
      return (
        '<div class="fish" data-tags="' + esc((f.tags || []).join(",")) + '">' +
        media +
        '<div class="fish-name">' + esc(f.name) + "</div>" +
        '<div class="fish-desc">' + esc(f.desc || "") + "</div>" +
        recordLine +
        storyLine +
        '<div class="fish-tags">' + tags + "</div>" +
        "</div>"
      );
    }

    // 按 目 -> 科 分组
    var byOrder = {};
    D.fishSpecies.forEach(function (f) {
      var o = f.order || "未分类";
      byOrder[o] = byOrder[o] || {};
      var fa = f.family || "未定科";
      byOrder[o][fa] = byOrder[o][fa] || [];
      byOrder[o][fa].push(f);
    });
    var orders = ORDER_ORDER.filter(function (o) { return byOrder[o]; });
    Object.keys(byOrder).forEach(function (o) { if (orders.indexOf(o) < 0) orders.push(o); });

    // 概览统计条（种数 / 目数 / 科数）
    var fishOverview = document.getElementById("fishOverview");
    if (fishOverview) {
      var familyCount = orders.reduce(function (s, o) {
        return s + Object.keys(byOrder[o]).length;
      }, 0);
      fishOverview.innerHTML =
        '<div class="fish-stat"><span class="num">' + D.fishSpecies.length + '</span><span class="lbl">鱼种总数</span></div>' +
        '<div class="fish-stat"><span class="num">' + orders.length + '</span><span class="lbl">目（Orders）</span></div>' +
        '<div class="fish-stat"><span class="num">' + familyCount + '</span><span class="lbl">科（Families）</span></div>';
    }

    fishGrid.innerHTML = orders.map(function (o) {
      var fams = byOrder[o];
      var famHtml = Object.keys(fams).map(function (fa) {
        var latin = FAMILY_META[fa] ? ' <span class="tax-latin">' + FAMILY_META[fa] + "</span>" : "";
        return (
          '<div class="fish-family">' +
          '<h4 class="fish-family-title">' + esc(fa) + latin +
          ' <span class="tax-count">' + fams[fa].length + " 种</span></h4>" +
          '<div class="fish-grid">' + fams[fa].map(fishCard).join("") + "</div>" +
          "</div>"
        );
      }).join("");
      var oLatin = ORDER_META[o] ? ' <span class="tax-latin">' + ORDER_META[o] + "</span>" : "";
      var oCount = Object.keys(fams).reduce(function (s, fa) { return s + fams[fa].length; }, 0);
      return (
        '<section class="fish-order">' +
        '<h3 class="fish-order-title">' + esc(o) + oLatin +
        ' <span class="tax-count">' + oCount + " 种</span></h3>" +
        famHtml +
        "</section>"
      );
    }).join("");
  }

  /* ---------------- 标签联动筛选 ---------------- */
  function applyTagFilter() {
    // 兴趣卡片 + 鱼种卡片
    document.querySelectorAll(".hobby, .fish").forEach(function (el) {
      var tags = (el.getAttribute("data-tags") || "").split(",").filter(Boolean);
      var hit = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
      el.classList.toggle("dim", !hit);
    });
    // 筛选后隐藏无内容的 目 / 科 分组
    document.querySelectorAll(".fish-family").forEach(function (fam) {
      fam.classList.toggle("hidden", fam.querySelectorAll(".fish:not(.dim)").length === 0);
    });
    document.querySelectorAll(".fish-order").forEach(function (sec) {
      sec.classList.toggle("hidden", sec.querySelectorAll(".fish:not(.dim)").length === 0);
    });
    // 地图 + 记录列表（按当前标签与省份重新渲染）
    refresh();
  }

  /* ---------------- 统一刷新（地图 + 列表 + 统计） ---------------- */
  function refresh() {
    renderMapData();
    buildRecords();
  }

  /* ---------------- 省级行政区筛选条 ---------------- */
  function buildProvFilter() {
    var el = document.getElementById("provFilter");
    if (!el) return;
    var seen = [];
    var countMap = {};
    travelPts.forEach(function (pt) {
      var pr = pt.province || "未分类";
      if (countMap[pr] == null) { countMap[pr] = 0; seen.push(pr); }
      countMap[pr]++;
    });
    el.innerHTML =
      '<button class="prov-chip active" data-prov="__all">全部 (' + travelPts.length + ")</button>" +
      seen.map(function (pr) {
        return '<button class="prov-chip" data-prov="' + esc(pr) + '">' + esc(pr) +
          ' <span class="p-count">' + countMap[pr] + "</span></button>";
      }).join("");
    el.querySelectorAll(".prov-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pr = btn.getAttribute("data-prov");
        activeProvince = (pr === "__all") ? null : pr;
        el.querySelectorAll(".prov-chip").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        refresh();
      });
    });
  }

  /* ---------------- 随笔（Markdown） ---------------- */
  var journalList = document.getElementById("journalList");
  if (journalList && D.journal) {
    journalList.innerHTML = D.journal.map(function (j) {
      return (
        '<div class="card journal-card">' +
        '<div class="j-head"><h3>' + esc(j.title || "无标题") + "</h3>" +
        '<span class="j-date">' + esc(j.date || "") + "</span></div>" +
        '<div class="markdown">' + md(j.content || "") + "</div>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------------- 开关（原 旅行/垂钓，已移除垂钓） ---------------- */

  /* ---------------- 移动端菜单 ---------------- */
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () { navLinks.classList.toggle("open"); });
    navLinks.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { navLinks.classList.remove("open"); });
    });
  }

  /* ---------------- 启动 ---------------- */
  initMap();
  buildProvFilter();
  if (map) updateMapStat(travelPts.length);
  buildRecords();

  /* ---------------- 滚动渐显（Apple 风 reveal） ---------------- */
  (function () {
    var sels = [".hero-inner", ".section-title", ".hint", ".about-card", ".contact-card",
      ".hobby", ".tag", ".map-layout", ".prov-filter", ".record-list",
      ".prov-group", ".record", ".fish-order", ".journal-card"];
    var els = [];
    sels.forEach(function (s) {
      document.querySelectorAll(s).forEach(function (e) { els.push(e); });
    });
    els.forEach(function (el) { el.classList.add("reveal"); });
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ---------------- 导航滚动阴影 ---------------- */
  window.addEventListener("scroll", function () {
    var n = document.getElementById("nav");
    if (n) n.classList.toggle("scrolled", window.scrollY > 8);
  }, { passive: true });

  /* ---------------- 工具 ---------------- */
  function setText(id, txt) { var el = document.getElementById(id); if (el && txt != null) el.textContent = txt; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
