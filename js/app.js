/* =====================================================================
   肖阳晨的个人网站 — 交互逻辑
   依赖：marked.min.js / data.js
   按需加载：leaflet.js + leaflet.css + china-prov-geo.js + china-city-geo.js
             （仅在首次进入「旅行足迹」版块时注入，首屏不为其买单）
   ===================================================================== */
(function () {
  "use strict";

  var D = window.SITE_DATA;
  if (!D) { console.error("未找到 SITE_DATA，请检查 js/data.js"); return; }

  // 是否偏好「减少动态效果」（顶部声明，供后续 FX 初始化使用）
  var fxReduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  var mapReady = false;                // 地图懒加载标记（切到足迹版块才初始化）
  var mapLoading = false;              // 防止重复注入
  var markerLayer, provLayer, cityLayer;
  var markerByName = {};

  /* ---------------- 图片：WebP 优先，原图兜底 ----------------
   * index.html 的探测脚本会为支持 WebP 的浏览器给 <html> 加上 .webp 类。
   * 内容图统一走 assets/_opt/ 下的 WebP（列表用 -t 缩略图，放大看用全尺寸），
   * 原 JPG/PNG 一律保留在 <img src> 上作为兜底，永不会出现裂图。
   */
  var WEBP = document.documentElement.classList.contains("webp");

  function webpSrc(src, thumb) {
    if (!WEBP || !src) return src;
    var m = String(src).match(/^(.+\/)?([^\/]+)\.(jpe?g|png)$/i);
    if (!m) return src;
    var base = m[2];
    if (base === "avatar" || base.indexOf("bg-") === 0) return (m[1] || "") + base + ".webp";
    return "assets/_opt/" + base + (thumb ? "-t" : "") + ".webp";
  }

  // 生成 <picture>（支持 WebP 时加 source，否则退回普通 <img>）
  function pic(src, alt, opt) {
    opt = opt || {};
    if (!src) return "";
    var w = webpSrc(src, opt.thumb);
    var attrs = ' alt="' + esc(alt || "") + '"' +
      (opt.lazy === false ? "" : ' loading="lazy"') +
      ' decoding="async" />';
    if (w === src) return '<img src="' + esc(src) + '"' + attrs;
    return '<picture><source srcset="' + esc(w) + '" type="image/webp" />' +
      '<img src="' + esc(src) + '"' + attrs + "</picture>";
  }

  // 可放大查看的图片：data-lb 存全尺寸地址，bindLightbox() 统一接管点击
  function lbAttrs(src, title, sub) {
    return ' data-lb="' + esc(webpSrc(src)) + '"' +
      ' data-lb-title="' + esc(title || "") + '"' +
      ' data-lb-sub="' + esc(sub || "") + '"';
  }

  /* ---------------- 顶部 / Hero ---------------- */
  var p = D.profile || {};
  document.title = (p.name || "个人网站") + " 的个人网站";
  setText("brandName", p.name);
  setText("heroName", p.name);
  setText("heroTagline", p.tagline);
  setText("heroLoc", p.location ? "📍 " + p.location : "");
  setText("footerName", "© " + (p.name || ""));

  // 头像（WebP 优先，PNG 兜底）
  var avatar = document.getElementById("avatar");
  if (p.avatar) {
    avatar.innerHTML = pic(p.avatar, "头像", { lazy: false });
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

  /* ---------------- 按需加载（脚本 / 样式） ---------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("load fail: " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = function () { resolve(); };
      l.onerror = function () { resolve(); }; // 样式失败不致命
      document.head.appendChild(l);
    });
  }
  function mapLoadFail() {
    var c = document.getElementById("chinaMap");
    if (c) c.innerHTML = '<p style="padding:40px;text-align:center;color:#5f6e80">地图资源加载失败，请检查网络后重试。</p>';
  }

  // 只有切到「旅行足迹」才真正拉取 Leaflet（147KB）+ 边界数据（约 3.2MB）
  function ensureMapScripts(cb) {
    if (window.L && window.CHINA_PROV_GEO && window.CHINA_CITY_GEO) { cb(); return; }
    if (mapLoading) return;
    mapLoading = true;
    var jobs = [];
    var needLeaflet = !window.L;
    if (needLeaflet) {
      jobs.push(loadScript("js/leaflet.js"));
      jobs.push(loadCss("css/leaflet.css"));
    }
    if (!window.CHINA_PROV_GEO) jobs.push(loadScript("js/china-prov-geo.js"));
    if (!window.CHINA_CITY_GEO) jobs.push(loadScript("js/china-city-geo.js"));
    Promise.all(jobs).then(function () {
      mapLoading = false;
      if (window.L && window.CHINA_PROV_GEO && window.CHINA_CITY_GEO) cb();
      else mapLoadFail();
    }).catch(function () { mapLoading = false; mapLoadFail(); });
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
    travelPts.map(function (x) { return normProv(x.province); }).filter(Boolean)
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
        '<p style="padding:40px;text-align:center;color:#5f6e80">地图加载失败，请确认 js/leaflet.js 与边界数据文件存在。</p>';
      return;
    }
    container.innerHTML = ""; // 清掉 loading 占位
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

  // 绘制 / 重绘旅行点（受省级筛选影响）
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
    el.scrollIntoView({ behavior: fxReduce ? "auto" : "smooth", block: "center" });
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
    var totalProv = new Set(travelPts.map(function (x) { return x.province; })).size;
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
      ? '<div class="detail-img"' + lbAttrs(d.img, d.name, [d.province, d.date].filter(Boolean).join(" · ")) + ">" +
        pic(d.img, d.name, { lazy: false }) + "</div>"
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
    bindLightbox(); // 详情图也要能放大
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
            ? '<div class="r-thumb"' + lbAttrs(d.img, d.name, [pr, d.date].filter(Boolean).join(" · ")) + ">" +
              pic(d.img, d.name, { thumb: true }) + "</div>"
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
      el.addEventListener("click", function (e) {
        // 点图片是「放大查看」，不触发详情
        if (e.target.closest && e.target.closest("[data-lb]")) return;
        var name = el.getAttribute("data-name");
        var pt = travelPts.filter(function (x) { return x.name === name; })[0];
        if (pt) {
          showDetail(pt);
          document.getElementById("detailCard").scrollIntoView({ behavior: fxReduce ? "auto" : "smooth", block: "center" });
          if (map && markerByName[pt.name]) {
            var mk = markerByName[pt.name];
            map.panTo(mk.getLatLng());
            mk.openTooltip();
          }
        }
      });
    });
    bindLightbox();
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
        ? '<div class="fish-img"' + lbAttrs(f.img, f.name, [f.order, f.family, f.record].filter(Boolean).join(" · ")) + ">" +
          pic(f.img, f.name, { thumb: true }) + "</div>"
        : '<div class="fish-emoji">' + (f.emoji || "🐟") + "</div>";
      var recordLine = f.record ? '<p class="fish-record">🏆 ' + esc(f.record) + "</p>" : "";
      var storyLine = f.story ? '<div class="fish-story">' + md(f.story) + "</div>" : "";
      return (
        '<div class="fish" data-tags="' + esc((f.tags || []).join(",")) + '" data-fish="' + esc(f.name) + '">' +
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
  var syncChips = function () {}; // 占位，buildTagFilter 里被覆盖（供命令面板清除筛选）

  /* ---------------- 标签筛选条（兴趣 / 鱼种共用 activeTags） ---------------- */
  function buildTagFilter() {
    var bars = document.querySelectorAll(".tag-filter");
    if (!bars.length) return;
    var tagsDef = (D.tags && D.tags.length) ? D.tags : [];
    syncChips = function () {
      bars.forEach(function (bar) {
        bar.querySelectorAll(".tag-chip").forEach(function (c) {
          var tg = c.getAttribute("data-tag");
          var on = tg === "__all" ? activeTags.size === 0 : activeTags.has(tg);
          c.classList.toggle("active", on);
        });
      });
    };
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

  /* ---------------- 足迹数据可视化（年份分布 + 省级覆盖） ---------------- */
  var TOTAL_PROVINCE = 34; // 23 省 + 5 自治区 + 4 直辖市 + 2 特别行政区
  var vizYearBars = [];

  function buildTravelViz() {
    var host = document.getElementById("travelViz");
    if (!host || !travelPts.length) return;

    // ① 年份分布：date 字段可能含多个年份（如 "2009.01 / 2012.01"），去重后各计一次
    var yearCount = {};
    travelPts.forEach(function (pt) {
      var ys = String(pt.date || "").match(/\d{4}/g) || [];
      var seen = {};
      ys.forEach(function (y) {
        if (seen[y]) return;
        seen[y] = 1;
        yearCount[y] = (yearCount[y] || 0) + 1;
      });
    });
    var years = Object.keys(yearCount).map(Number).sort(function (a, b) { return a - b; });
    var minY = years[0], maxY = years[years.length - 1];
    var maxCount = 0;
    for (var y = minY; y <= maxY; y++) { if ((yearCount[y] || 0) > maxCount) maxCount = yearCount[y] || 0; }

    var bars = "";
    for (var yy = minY; yy <= maxY; yy++) {
      var c = yearCount[yy] || 0;
      var h = c ? Math.max(Math.round((c / maxCount) * 100), 7) : 0;
      bars += '<div class="yb' + (c ? "" : " zero") + '" title="' + yy + " 年 · " + c + ' 处">' +
        '<div class="yb-bar" data-h="' + h + '"></div>' +
        '<span class="yb-lbl">' + (c ? String(yy).slice(2) : "") + "</span></div>";
    }

    // ② 省级行政区覆盖率
    var provSet = {}, citySet = {};
    travelPts.forEach(function (pt) {
      if (pt.province) provSet[pt.province] = 1;
      if (pt.city) citySet[pt.city] = 1;
    });
    var provCount = Object.keys(provSet).length;
    var cityCount = Object.keys(citySet).length;
    var pct = Math.min(provCount / TOTAL_PROVINCE, 1);
    var R = 52, C = 2 * Math.PI * R; // 周长 ≈ 326.7
    var span = maxY - minY + 1;

    host.innerHTML =
      '<div class="viz-card">' +
        '<div class="viz-title"><h4>足迹年份分布</h4>' +
        '<span class="viz-note">' + minY + "–" + maxY + "</span></div>" +
        '<div class="year-chart">' + bars + "</div>" +
      "</div>" +
      '<div class="viz-card">' +
        '<div class="viz-title"><h4>省级行政区覆盖</h4>' +
        '<span class="viz-note">' + Math.round(pct * 100) + "%</span></div>" +
        '<div class="ring-wrap">' +
          '<div class="ring-box">' +
            '<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="省级行政区覆盖率 ' + Math.round(pct * 100) + '%">' +
              '<circle class="ring-bg" cx="60" cy="60" r="' + R + '"></circle>' +
              '<circle class="ring-fg" cx="60" cy="60" r="' + R + '" ' +
                'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"></circle>' +
            "</svg>" +
            '<div class="ring-center"><b>' + provCount + "</b><i>/ " + TOTAL_PROVINCE + " 省级</i></div>" +
          "</div>" +
          '<ul class="ring-stats">' +
            "<li><span>地级市</span><b>" + cityCount + "</b></li>" +
            "<li><span>时间跨度</span><b>" + span + " 年</b></li>" +
            "<li><span>足迹点</span><b>" + travelPts.length + "</b></li>" +
          "</ul>" +
        "</div>" +
      "</div>";

    vizYearBars = Array.prototype.slice.call(host.querySelectorAll(".yb-bar"));
  }

  // 柱状图生长 + 覆盖率环填充（进入本版块时才播放，避免 display:none 期间动画被吃掉）
  function animateViz() {
    vizYearBars.forEach(function (b, i) {
      var h = b.getAttribute("data-h") || 0;
      setTimeout(function () { b.style.height = h + "%"; }, fxReduce ? 0 : i * 26);
    });
    var fg = document.querySelector("#travelViz .ring-fg");
    if (fg) {
      var C = parseFloat(fg.getAttribute("stroke-dasharray")) || 326.7;
      var provSet = {};
      travelPts.forEach(function (pt) { if (pt.province) provSet[pt.province] = 1; });
      var pct = Math.min(Object.keys(provSet).length / TOTAL_PROVINCE, 1);
      setTimeout(function () {
        fg.setAttribute("stroke-dashoffset", (C * (1 - pct)).toFixed(1));
      }, fxReduce ? 0 : 120);
    }
  }

  /* ---------------- 随笔（Markdown） ---------------- */
  var journalList = document.getElementById("journalList");
  if (journalList && D.journal) {
    journalList.innerHTML = D.journal.map(function (j) {
      return (
        '<div class="card journal-card" data-journal="' + esc(j.title || "") + '">' +
        '<div class="j-head"><h3>' + esc(j.title || "无标题") + "</h3>" +
        '<span class="j-date">' + esc(j.date || "") + "</span></div>" +
        '<div class="markdown">' + md(j.content || "") + "</div>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------------- 图片放大查看（Lightbox） ---------------- */
  var lbEl = document.getElementById("lightbox");
  var lbImg = document.getElementById("lbImg");
  var lbTitle = document.getElementById("lbTitle");
  var lbSub = document.getElementById("lbSub");
  var lbPrev = document.getElementById("lbPrev");
  var lbNext = document.getElementById("lbNext");
  var lbItems = [];
  var lbIdx = 0;

  // 收集「当前版块」内可放大的图片（每次重绘 / 切换版块后重新绑定，
  // 避免在鱼图鉴里按 → 翻到旅行照片）
  function bindLightbox() {
    if (!lbEl) return;
    var scope = document.querySelector(".panel.active") || document;
    var nodes = scope.querySelectorAll("[data-lb]");
    lbItems = [];
    Array.prototype.forEach.call(nodes, function (n, i) {
      lbItems.push({
        src: n.getAttribute("data-lb") || "",
        title: n.getAttribute("data-lb-title") || "",
        sub: n.getAttribute("data-lb-sub") || "",
      });
      n.setAttribute("data-lb-i", i);
      n.style.cursor = "zoom-in";
    });
  }

  function lbOpen(i) {
    if (!lbEl || !lbItems.length) return;
    lbIdx = (i + lbItems.length) % lbItems.length;
    var it = lbItems[lbIdx];
    lbImg.src = it.src;
    lbImg.alt = it.title || "";
    lbTitle.textContent = it.title || "";
    var pos = (lbIdx + 1) + " / " + lbItems.length;
    lbSub.textContent = it.sub ? it.sub + "　·　" + pos : pos;
    lbEl.hidden = false;
    var single = lbItems.length < 2;
    if (lbPrev) lbPrev.disabled = single;
    if (lbNext) lbNext.disabled = single;
    syncBodyLock();
  }
  function lbClose() {
    if (!lbEl) return;
    lbEl.hidden = true;
    lbImg.removeAttribute("src");
    syncBodyLock();
  }
  if (lbEl) {
    lbEl.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-lb-close]")) { lbClose(); return; }
      if (e.target === lbPrev) { lbOpen(lbIdx - 1); return; }
      if (e.target === lbNext) { lbOpen(lbIdx + 1); return; }
    });
  }
  // 委托：点击任意带 data-lb 的图片 → 放大
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-lb-i]") : null;
    if (!t) return;
    e.preventDefault();
    lbOpen(parseInt(t.getAttribute("data-lb-i"), 10) || 0);
  });

  /* ---------------- ⌘K 全局命令面板 ---------------- */
  var cmdkEl = document.getElementById("cmdk");
  var cmdkInput = document.getElementById("cmdkInput");
  var cmdkList = document.getElementById("cmdkList");
  var cmdkCount = document.getElementById("cmdkCount");
  var cmdkIndex = [];
  var cmdkResults = [];
  var cmdkActive = 0;
  var lastFocus = null;

  var PANEL_DESC = {
    hero: "回到封面",
    about: "教育与联系方式",
    hobbies: "垂钓 · 旅行 · 健身",
    map: "中国地形图 · " + travelPts.length + " 处足迹",
    fish: "鱼种图鉴 · " + (D.fishSpecies || []).length + " 种",
    journal: "Markdown 日志 · " + (D.journal || []).length + " 篇",
  };
  var PANEL_ICO = { hero: "⌂", about: "☺", hobbies: "✦", map: "📍", fish: "🐟", journal: "✎" };

  function flashEl(el) {
    if (!el) return;
    el.classList.remove("flash");
    // 强制重排以重启动画
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1600);
  }

  function gotoTravel(pt) {
    showPanel("map");
    setTimeout(function () {
      showDetail(pt);
      highlightRecord(pt.name);
      if (map && pt.value) map.panTo([pt.value[1], pt.value[0]]);
    }, 60);
  }

  function gotoFish(name) {
    // 清掉标签筛选，避免目标卡片处于淡化/隐藏状态
    if (activeTags.size) { activeTags.clear(); syncChips(); applyTagFilter(); }
    showPanel("fish");
    setTimeout(function () {
      var el = document.querySelector('.fish[data-fish="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
      if (el) {
        el.scrollIntoView({ behavior: fxReduce ? "auto" : "smooth", block: "center" });
        flashEl(el);
      }
    }, 80);
  }

  function gotoJournal(title) {
    showPanel("journal");
    setTimeout(function () {
      var el = document.querySelector('.journal-card[data-journal="' + (window.CSS && CSS.escape ? CSS.escape(title) : title) + '"]');
      if (el) {
        el.scrollIntoView({ behavior: fxReduce ? "auto" : "smooth", block: "center" });
        flashEl(el);
      }
    }, 80);
  }

  function buildSearchIndex() {
    var items = [];
    document.querySelectorAll(".side-link").forEach(function (a) {
      var id = a.getAttribute("data-target");
      var st = a.querySelector(".st");
      items.push({
        g: "版块", ico: PANEL_ICO[id] || "§",
        t: st ? st.textContent : id, s: PANEL_DESC[id] || "",
        run: function () { showPanel(id); },
      });
    });
    travelPts.forEach(function (t) {
      items.push({
        g: "旅行足迹", ico: "📍", t: t.name,
        s: [t.province, t.city, t.date].filter(Boolean).join(" · "),
        run: function () { gotoTravel(t); },
      });
    });
    (D.fishSpecies || []).forEach(function (f) {
      items.push({
        g: "钓鱼图鉴", ico: f.emoji || "🐟", t: f.name,
        s: [f.order, f.family, f.record].filter(Boolean).join(" · "),
        run: function () { gotoFish(f.name); },
      });
    });
    (D.journal || []).forEach(function (j) {
      items.push({
        g: "随笔", ico: "✎", t: j.title || "无标题", s: j.date || "",
        run: function () { gotoJournal(j.title || ""); },
      });
    });
    return items;
  }

  // 打分排序：标题全等 > 标题前缀 > 标题包含 > 副标题包含
  function searchItems(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return cmdkIndex.slice(0, 8);
    var hits = [];
    cmdkIndex.forEach(function (it) {
      var t = String(it.t).toLowerCase();
      var s = String(it.s || "").toLowerCase();
      var sc = 0;
      if (t === q) sc = 100;
      else if (t.indexOf(q) === 0) sc = 80;
      else if (t.indexOf(q) > -1) sc = 60;
      else if (s.indexOf(q) > -1) sc = 30;
      if (sc) hits.push({ it: it, sc: sc });
    });
    hits.sort(function (a, b) { return b.sc - a.sc; });
    return hits.slice(0, 40).map(function (h) { return h.it; });
  }

  function renderCmdk(q) {
    if (!cmdkList) return;
    cmdkResults = searchItems(q);
    cmdkActive = 0;
    if (!cmdkResults.length) {
      cmdkList.innerHTML = '<div class="cmdk-empty">没有匹配 <b>' + esc(q) + "</b> 的结果</div>";
      if (cmdkCount) cmdkCount.textContent = "0 条";
      return;
    }
    var html = "", lastG = null;
    cmdkResults.forEach(function (it, i) {
      if (it.g !== lastG) {
        lastG = it.g;
        html += '<div class="cmdk-group">' + esc(it.g) + "</div>";
      }
      html += '<div class="cmdk-item" data-i="' + i + '" role="option">' +
        '<span class="ci-ico">' + (it.ico || "·") + "</span>" +
        '<span class="ci-main"><span class="ci-t">' + esc(it.t) + "</span>" +
        (it.s ? '<br /><span class="ci-s">' + esc(it.s) + "</span>" : "") + "</span>" +
        (it.g ? '<span class="ci-k kbd">' + esc(it.g) + "</span>" : "") +
        "</div>";
    });
    cmdkList.innerHTML = html;
    if (cmdkCount) cmdkCount.textContent = cmdkResults.length + " 条";
    paintCmdkActive();
  }

  function paintCmdkActive() {
    cmdkList.querySelectorAll(".cmdk-item").forEach(function (el) {
      var on = parseInt(el.getAttribute("data-i"), 10) === cmdkActive;
      el.classList.toggle("active", on);
      if (on && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    });
  }

  function cmdkMove(d) {
    if (!cmdkResults.length) return;
    cmdkActive = (cmdkActive + d + cmdkResults.length) % cmdkResults.length;
    paintCmdkActive();
  }

  function openCmdk() {
    if (!cmdkEl) return;
    if (!cmdkIndex.length) cmdkIndex = buildSearchIndex();
    if (lbEl && !lbEl.hidden) lbClose();
    lastFocus = document.activeElement;
    cmdkEl.hidden = false;
    syncBodyLock();
    cmdkInput.value = "";
    renderCmdk("");
    setTimeout(function () { cmdkInput.focus(); }, 20);
  }
  function closeCmdk() {
    if (!cmdkEl) return;
    cmdkEl.hidden = true;
    syncBodyLock();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function cmdkRun(i) {
    var it = cmdkResults[i];
    closeCmdk();
    if (it && typeof it.run === "function") it.run();
  }

  if (cmdkEl) {
    cmdkEl.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-cmdk-close]")) { closeCmdk(); return; }
      var item = e.target.closest ? e.target.closest(".cmdk-item") : null;
      if (item) cmdkRun(parseInt(item.getAttribute("data-i"), 10) || 0);
    });
    cmdkEl.addEventListener("mousemove", function (e) {
      var item = e.target.closest ? e.target.closest(".cmdk-item") : null;
      if (!item) return;
      var i = parseInt(item.getAttribute("data-i"), 10);
      if (i !== cmdkActive) { cmdkActive = i; paintCmdkActive(); }
    });
    cmdkInput.addEventListener("input", function () { renderCmdk(cmdkInput.value); });
  }
  var searchBtn = document.getElementById("searchBtn");
  if (searchBtn) searchBtn.addEventListener("click", openCmdk);

  // 浮层打开时锁定页面滚动
  function syncBodyLock() {
    var locked = (cmdkEl && !cmdkEl.hidden) || (lbEl && !lbEl.hidden);
    document.body.style.overflow = locked ? "hidden" : "";
  }

  /* ---------------- 左侧目录 + 单版块切换 ---------------- */
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.getElementById("menuBtn");
  var backdrop = document.getElementById("backdrop");
  var sideLinks = document.querySelectorAll(".side-link");
  var PANEL_ORDER = ["hero", "about", "hobbies", "map", "fish", "journal"];

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

  function currentPanel() {
    var a = document.querySelector(".panel.active");
    return a ? String(a.id).replace("panel-", "") : "hero";
  }

  // 只显示目标版块，其余隐藏
  function showPanel(target) {
    var panel = document.getElementById("panel-" + target);
    if (!panel) return;
    document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
    panel.classList.add("active");
    sideLinks.forEach(function (l) {
      l.classList.toggle("active", l.getAttribute("data-target") === target);
    });
    bindLightbox(); // 放大图库随版块切换而重定范围
    closeDrawer();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // 地图：切到足迹版块时才加载 Leaflet 与边界数据（首屏不为此付费）
    if (target === "map") {
      if (!mapReady) {
        var holder = document.getElementById("chinaMap");
        if (holder && !holder.firstChild) {
          holder.innerHTML = '<div class="map-loading">地图加载中…</div>';
        }
        ensureMapScripts(function () {
          initMap(); mapReady = true;
          setTimeout(function () { if (map) map.invalidateSize(); }, 80);
          updateMapStat(filtered(travelPts).length);
        });
      } else {
        setTimeout(function () { if (map) map.invalidateSize(); }, 80);
        updateMapStat(filtered(travelPts).length);
      }
      setTimeout(animateViz, 120); // 柱状图 / 覆盖率环入场
    }
    revealPanel(panel);
    if (typeof FXpanel === "function") FXpanel(target);
  }

  // 同步地址栏 hash（file:// 或受限 iframe 下 replaceState 会抛错，忽略即可）
  function setHash(h) {
    try { history.replaceState(null, "", h); } catch (err) {}
  }

  function stepPanel(dir) {
    var i = PANEL_ORDER.indexOf(currentPanel());
    if (i < 0) i = 0;
    var next = PANEL_ORDER[(i + dir + PANEL_ORDER.length) % PANEL_ORDER.length];
    showPanel(next);
    setHash("#" + next);
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
      setHash(href === "#top" ? "#hero" : href);
    }
  });

  /* ---------------- 键盘导航 ---------------- */
  function isTyping(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }
  document.addEventListener("keydown", function (e) {
    // Ctrl/Cmd + K：命令面板
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (cmdkEl && cmdkEl.hidden) openCmdk(); else closeCmdk();
      return;
    }
    // Esc：逐层关闭浮层
    if (e.key === "Escape") {
      if (lbEl && !lbEl.hidden) { lbClose(); return; }
      if (cmdkEl && !cmdkEl.hidden) { closeCmdk(); return; }
      return;
    }
    // Lightbox：左右切图
    if (lbEl && !lbEl.hidden) {
      if (e.key === "ArrowLeft") { e.preventDefault(); lbOpen(lbIdx - 1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); lbOpen(lbIdx + 1); return; }
      return;
    }
    // 命令面板：上下选择 / 回车打开
    if (cmdkEl && !cmdkEl.hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); cmdkMove(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); cmdkMove(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); cmdkRun(cmdkActive); return; }
      return;
    }
    // / 唤起搜索；← → 切换版块
    if (isTyping(e.target)) return;
    if (e.key === "/") { e.preventDefault(); openCmdk(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); stepPanel(1); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); stepPanel(-1); return; }
  });

  /* ---------------- 回到顶部 ---------------- */
  var toTop = document.getElementById("toTop");
  if (toTop) {
    window.addEventListener("scroll", function () {
      toTop.classList.toggle("show", window.scrollY > 520);
    }, { passive: true });
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: fxReduce ? "auto" : "smooth" });
    });
  }

  /* ---------------- 启动 ---------------- */
  buildTagFilter();
  buildProvFilter();
  buildTravelViz();
  buildRecords();
  updateMapStat(travelPts.length);
  initFX();

  /* ---------------- 滚动渐显（按版块激活时触发 reveal） ---------------- */
  (function () {
    var sels = [".section-title", ".hint", ".about-card", ".contact-card",
      ".hobby", ".map-layout", ".prov-filter", ".record-list",
      ".prov-group", ".record", ".fish-order", ".journal-card", ".travel-viz"];
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

  /* ---------------- 高级动态视觉层（FX） ---------------- */
  function initFX() {
    // 1) 给可交互卡片打标：聚光（全部）+ 3D 倾斜（主卡片）
    var tiltSel = ".hobby, .fish, .record, .journal-card, .about-card, .contact-card";
    var allSel = tiltSel + ", .prov-chip, .hero-stats, .detail-card, .map-card, .avatar, .viz-card";
    document.querySelectorAll(allSel).forEach(function (el) {
      el.classList.add("fx-card");
      if (el.matches && el.matches(tiltSel)) el.classList.add("fx-tilt");
    });

    var spot = document.getElementById("fxSpotlight");
    var cur = document.getElementById("fxCursor");
    var prog = document.getElementById("fxProgress");

    if (!fxReduce) {
      var mx = window.innerWidth / 2, my = window.innerHeight / 2, lx = mx, ly = my, raf = false;
      function renderCursor() {
        lx += (mx - lx) * 0.2; ly += (my - ly) * 0.2;
        if (cur) cur.style.transform = "translate(" + lx + "px," + ly + "px)";
        raf = false;
      }
      window.addEventListener("pointermove", function (e) {
        mx = e.clientX; my = e.clientY;
        if (spot) { spot.style.setProperty("--mx", mx + "px"); spot.style.setProperty("--my", my + "px"); }
        if (cur && !raf) { raf = true; requestAnimationFrame(renderCursor); }
        // 卡片聚光 + 倾斜（指针跟踪）
        var card = e.target.closest ? e.target.closest(".fx-card") : null;
        if (card) {
          var r = card.getBoundingClientRect();
          var px = ((e.clientX - r.left) / r.width) * 100;
          var py = ((e.clientY - r.top) / r.height) * 100;
          card.style.setProperty("--cx", px + "%");
          card.style.setProperty("--cy", py + "%");
          if (card.classList.contains("fx-tilt")) {
            // 小鱼卡片又小又密，倾斜幅度减半，避免"晃"
            var maxDeg = card.classList.contains("fish") ? 2.2 : 5;
            var rx = ((py - 50) / 50) * -maxDeg, ry = ((px - 50) / 50) * maxDeg;
            card.style.transform = "perspective(900px) rotateX(" + rx.toFixed(2) +
              "deg) rotateY(" + ry.toFixed(2) + "deg) translateY(-6px)";
          }
        }
        // 光标环在可交互元素上放大
        if (cur) {
          var hot = e.target.closest && e.target.closest("a, button, .side-link, .prov-chip, .record, .fish, .hobby, .journal-card, .tag-chip, .btn, [data-target]");
          cur.classList.toggle("hover", !!hot);
        }
      }, { passive: true });

      window.addEventListener("pointerdown", function () { if (cur) cur.classList.add("down"); });
      window.addEventListener("pointerup", function () { if (cur) cur.classList.remove("down"); });

      // 离开卡片时复位倾斜
      document.querySelectorAll(".fx-tilt").forEach(function (el) {
        el.addEventListener("mouseleave", function () { el.style.transform = ""; });
      });

      // 磁性按钮：轻微追随指针
      document.querySelectorAll(".btn").forEach(function (b) {
        b.addEventListener("pointermove", function (e) {
          var r = b.getBoundingClientRect();
          var dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
          var dy = (e.clientY - (r.top + r.height / 2)) * 0.32;
          b.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
        });
        b.addEventListener("mouseleave", function () { b.style.transform = ""; });
      });
    }

    // 滚动进度条
    function updateProgress() {
      if (!prog) return;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
    }
    window.addEventListener("scroll", updateProgress, { passive: true });
    updateProgress();
  }

  function FXpanel(target) {
    if (target === "hero") countUpHero();
  }

  function countUpHero() {
    var nums = document.querySelectorAll("#heroStats .hstat-num");
    nums.forEach(function (el) {
      var target = parseInt(el.textContent, 10);
      if (isNaN(target)) return;
      if (fxReduce) { el.textContent = target; return; }
      el.textContent = "0";
      var dur = 1100, start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target;
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- 工具 ---------------- */
  function setText(id, txt) { var el = document.getElementById(id); if (el && txt != null) el.textContent = txt; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
