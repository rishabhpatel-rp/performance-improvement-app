/**
 * Script Injector - lightweight loader (~2KB min, zero deps).
 * Loads scripts in priority order, supports async/defer, fails gracefully.
 * Exposed as window.ScriptInjector.
 */
(function (window, document) {
  'use strict';

  var queue = [];
  var loaded = {};

  function log() {
    if (window.__scriptInjectorDebug) {
      console.log.apply(console, ['[ScriptInjector]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function loadOne(config) {
    if (!config || !config.id || loaded[config.id]) return;
    loaded[config.id] = true;

    var el = document.createElement('script');
    el.setAttribute('data-script-id', config.id);
    if (config.nonce) el.nonce = config.nonce;

    if (config.src) {
      el.src = config.src;
      if (config.async) el.async = true;
      if (config.defer) el.defer = true;
      el.onerror = function () {
        log('failed to load', config.id);
      };
    } else if (config.code) {
      el.text = config.code;
    } else {
      return;
    }

    el.onload = function () {
      log('loaded', config.id);
      if (typeof config.onLoad === 'function') {
        try {
          config.onLoad();
        } catch (e) {
          log('onLoad error', config.id, e);
        }
      }
    };

    var target = config.target === 'body_start'
      ? document.body.firstChild
        ? document.body
        : document.body
      : document.head || document.body;

    try {
      if (config.target === 'body_end') {
        document.body.appendChild(el);
      } else if (config.target === 'body_start' && document.body.firstChild) {
        document.body.insertBefore(el, document.body.firstChild);
      } else {
        target.appendChild(el);
      }
    } catch (e) {
      log('failed to inject', config.id, e);
    }
  }

  function flush() {
    queue
      .slice()
      .sort(function (a, b) {
        return (b.priority || 0) - (a.priority || 0);
      })
      .forEach(loadOne);
    queue = [];
  }

  function load(scriptConfig) {
    if (!scriptConfig) return;
    queue.push(scriptConfig);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      flush();
    } else {
      document.addEventListener('DOMContentLoaded', flush, { once: true });
    }
  }

  window.ScriptInjector = window.ScriptInjector || { load: load };
})(window, document);
