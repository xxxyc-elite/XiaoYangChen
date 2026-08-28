/* =====================================================================
   肖阳晨的个人网站 — Service Worker
   策略：
     · 页面 / 样式 / 脚本：网络优先，离线回退缓存（改完 data.js 立刻生效）
     · 图片与字体：缓存优先（体积大、几乎不变）
     · 跨域请求（Esri 地形瓦片等）：直接放行，不进缓存，避免撑爆配额
   变更缓存内容后，把 VERSION 往上加一即可让旧缓存失效。
   ===================================================================== */
var VERSION = "xyc-v1";

// 首屏关键资源：安装时预缓存，保证离线可开
var SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/data.js",
  "./js/marked.min.js",
  "./favicon.svg",
  "./favicon-64.png",
  "./apple-touch-icon.png",
  "./assets/bg-hero.webp",
  "./assets/bg-hero.jpg",
  "./assets/avatar.webp",
  "./assets/avatar.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      // 逐个添加，单个失败不影响整体安装
      return Promise.all(
        SHELL.map(function (u) {
          return c.add(u).catch(function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) { return k === VERSION ? null : caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function isAsset(pathname) {
  return /\.(?:webp|jpe?g|png|gif|svg|ttf|woff2?)$/i.test(pathname);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // 跨域（地图瓦片）放行

  // 图片 / 字体：缓存优先
  if (isAsset(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // 页面 / 样式 / 脚本：网络优先，离线回退
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return caches.match(req);
      })
  );
});
