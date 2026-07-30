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

  var TRAVEL_COLOR = "#c2740a";
  var activeTags = new Set();          // 当前选中的标签
  var activeProvince = null;           // 当前选中的省级行政区（null = 全部）
  var map = null;
  var mapReady = false;             // 地图懒加载标记（切到足迹版块才初始化）
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

  // 封面签名数据条（省份 / 鱼种 / 城市，全部由数据自动统计）
  var heroStats = document.getElementById("heroStats");
  if (heroStats) {
    var tr = D.travel || [];
    var provs = {}, cities = {};
    tr.forEach(function (t) {
      if (t.province) provs[t.province] = 1;
      if (t.city) cities[t.city] = 1;
    });
    var statData = [
      { num: Object.keys(provs).length, lbl: "省份" },
      { num: (D.fishSpecies || []).length, lbl: "鱼种" },
      { num: Object.keys(cities).length, lbl: "城市" }
    ];
    heroStats.innerHTML = statData.map(function (s) {
      return '<div class="hstat"><span class="hstat-num">' + s.num +
        '</span><span class="hstat-lbl">' + s.lbl + "</span></div>";
    }).join("");
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

  // 地图 / 记录列表仅受「省级行政区」筛选（标签筛选独立作用于兴趣 / 鱼种卡片）
  function passFilters(pt) {
    if (activeProvince && pt.province !== activeProvince) return false;
    return true;
  }
  function filtered(points) {
    return points.filter(passFilters);
  }

  /* ---------------- 地图边界数据懒加载（首次打开足迹版块才注入，减少首屏体积） ---------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("load fail: " + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureMapScripts(cb) {
    if (window.CHINA_PROV_GEO && window.CHINA_CITY_GEO) { cb(); return; }
    Promise.all([
      loadScript("js/china-prov-geo.js"),
      loadScript("js/china-city-geo.js"),
    ]).then(cb).catch(function () {
      var c = document.getElementById("chinaMap");
      if (c) c.innerHTML = '<p style="padding:40px;text-align:center;color:#cdd">地图边界数据加载失败，请检查网络后重试。</p>';
    });
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
          html: '<span class="dot-core" role="img" aria-label="' + esc(pt.name) + ' 旅行足迹"></span>',
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
      '<button class="detail-close" type="button" aria-label="关闭详情">✕</button>' +
      '<span class="d-type" style="background:' + TRAVEL_COLOR + '">📍 旅行足迹</span>' +
      "<h3>" + esc(d.name) + "</h3>" +
      imgLine +
      locLine +
      '<p class="d-meta"><b>日期：</b>' + esc(d.date || "-") +
      "　<b>坐标：</b>" + esc(d.value ? d.value[0].toFixed(2) + ", " + d.value[1].toFixed(2) : "-") + "</p>" +
      (d.note ? '<div class="d-note">' + md(d.note) + "</div>" : "");
    var closeBtn = body.querySelector(".detail-close");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      body.hidden = true; empty.hidden = false;
    });
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

  /* ---------------- 标签联动筛选（作用于兴趣 / 鱼种卡片） ---------------- */
  function applyTagFilter() {
    // 兴趣卡片 + 鱼种卡片：命中的高亮，未命中的淡化
    document.querySelectorAll(".hobby, .fish").forEach(function (el) {
      var tags = (el.getAttribute("data-tags") || "").split(",").filter(Boolean);
      var hit = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
      el.classList.toggle("dim", !hit);
    });
    // 筛选后隐藏无匹配内容的 目 / 科 分组
    document.querySelectorAll(".fish-family").forEach(function (fam) {
      fam.classList.toggle("hidden", fam.querySelectorAll(".fish:not(.dim)").length === 0);
    });
    document.querySelectorAll(".fish-order").forEach(function (sec) {
      sec.classList.toggle("hidden", sec.querySelectorAll(".fish:not(.dim)").length === 0);
    });
  }

  /* ---------------- 标签筛选条（兴趣 / 鱼种共用 activeTags） ---------------- */
  function buildTagFilter() {
    var bars = document.querySelectorAll(".tag-filter");
    if (!bars.length) return;
    var tagsDef = (D.tags && D.tags.length) ? D.tags : [];
    function syncChips() {
      bars.forEach(function (bar) {
        bar.querySelectorAll(".tag-chip").forEach(function (c) {
          var tg = c.getAttribute("data-tag");
          var on = tg === "__all" ? activeTags.size === 0 : activeTags.has(tg);
          c.classList.toggle("active", on);
        });
      });
    }
    bars.forEach(function (bar) {
      bar.innerHTML =
        '<button class="tag-chip" data-tag="__all">全部</button>' +
        tagsDef.map(function (t) {
          var name = t.name || t, color = t.color || "var(--plan)";
          return '<button class="tag-chip" data-tag="' + esc(name) + '" style="--tc:' + esc(color) + '">' + esc(name) + "</button>";
        }).join("");
    });
    syncChips();
    bars.forEach(function (bar) {
      bar.addEventListener("click", function (e) {
        var chip = e.target.closest ? e.target.closest(".tag-chip") : null;
        if (!chip) return;
        var tg = chip.getAttribute("data-tag");
        if (tg === "__all") activeTags.clear();
        else if (activeTags.has(tg)) activeTags.delete(tg);
        else activeTags.add(tg);
        syncChips();
        applyTagFilter();
      });
    });
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

  /* ---------------- 左侧目录 + 单版块切换 ---------------- */
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.getElementById("menuBtn");
  var backdrop = document.getElementById("backdrop");
  var sideLinks = document.querySelectorAll(".side-link");

  function openDrawer() {
    if (sidebar) sidebar.classList.add("open");
    if (backdrop) backdrop.classList.add("show");
  }
  function closeDrawer() {
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("show");
  }
  if (menuBtn) menuBtn.addEventListener("click", openDrawer);
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  function revealPanel(panel) {
    if (!panel) return;
    panel.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  // 只显示目标版块，其余隐藏
  function showPanel(target) {
    var panel = document.getElementById("panel-" + target);
    if (!panel) return;
    document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
    panel.classList.add("active");
    sideLinks.forEach(function (l) {
      l.classList.toggle("active", l.getAttribute("data-target") === target);
    });
    closeDrawer();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // 地图：切到足迹版块时再加载边界数据并初始化（懒加载，省首屏体积）
    if (target === "map") {
      if (!mapReady) {
        ensureMapScripts(function () {
          initMap(); mapReady = true;
          setTimeout(function () { if (map) map.invalidateSize(); }, 80);
          updateMapStat(filtered(travelPts).length);
        });
      } else {
        setTimeout(function () { if (map) map.invalidateSize(); }, 80);
        updateMapStat(filtered(travelPts).length);
      }
    }
    revealPanel(panel);
  }

  sideLinks.forEach(function (l) {
    l.addEventListener("click", function () { showPanel(l.getAttribute("data-target")); });
  });

  // 拦截 #锚点（封面 / 各版块按钮）→ 切换到对应版块
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var href = a.getAttribute("href");
    var t = href === "#top" ? "hero" : href.slice(1);
    if (document.getElementById("panel-" + t)) {
      e.preventDefault();
      showPanel(t);
      history.replaceState(null, "", href === "#top" ? "#hero" : href);
    }
  });

  /* ---------------- 启动 ---------------- */
  buildTagFilter();
  buildProvFilter();
  buildRecords();
  updateMapStat(travelPts.length);

  /* ---------------- 滚动渐显（按版块激活时触发 reveal） ---------------- */
  (function () {
    var sels = [".section-title", ".hint", ".about-card", ".contact-card",
      ".hobby", ".map-layout", ".prov-filter", ".record-list",
      ".prov-group", ".record", ".fish-order", ".journal-card"];
    var els = [];
    sels.forEach(function (s) {
      document.querySelectorAll(s).forEach(function (e) { els.push(e); });
    });
    els.forEach(function (el) { el.classList.add("reveal"); });
    // 初始面板（支持 #hash 直达）：封面 / 对应版块
    var initial = (location.hash && location.hash !== "#top") ? location.hash.slice(1) : "hero";
    if (!document.getElementById("panel-" + initial)) initial = "hero";
    showPanel(initial);
  })();

  /* ---------------- 工具 ---------------- */
  function setText(id, txt) { var el = document.getElementById(id); if (el && txt != null) el.textContent = txt; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
