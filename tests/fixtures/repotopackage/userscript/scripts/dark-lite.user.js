// ==UserScript==
// @name         Dark Lite
// @namespace    https://example.org/fixtures
// @version      0.4.1
// @description  Hand-written fixture: dims bright pages.
// @match        https://*.example.org/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @connect      api.example.org
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @require      ./lib/helper.js
// ==/UserScript==

(function () {
  'use strict';
  document.documentElement.style.filter = 'brightness(0.8)';
})();
