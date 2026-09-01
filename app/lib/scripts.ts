import type { PredefinedScript } from "../types/script";

/**
 * The 3 hardcoded scripts injected into <head>. Payloads copied verbatim
 * into extensions/script-injector/blocks/app-embed-head.liquid -- do not
 * hand-edit the `code` values (they are minified/obfuscated on purpose).
 *
 * script_1 (Audit) and script_2 (Defer) contain Liquid-templated
 * substitution points, replaced at render time in the liquid file only:
 *   - script_1: `__APP_ENDPOINT__` -> `{{ shop.url }}/audit-submit` style
 *     absolute URL built from SHOPIFY_APP_URL; `__AUDIT_COMPLETE__` ->
 *     `{{ config.audit_complete.value | json }}`.
 *   - script_2: `__DEFER_LIST__` -> the audited `config.audit_defer_array`
 *     list when present, else DEFAULT_DEFER_LIST below.
 * The placeholders are kept literal here since this file is the source of
 * truth for the code and isn't itself rendered through Liquid.
 */

/** Hardcoded fallback defer/blocklist, used when no audit has run yet. */
export const DEFAULT_DEFER_LIST: string[] = [
  "clarity",
  "noibu",
  "collect-core.js",
  "collect-recording.js",
  "collect-webvitals.js",
  "loader.js",
  "shop-items-tabs.js",
  "shop-items-options.js",
  "lo.js",
  "iadvize.js",
  "bugsnag.min.js",
  "notification.js",
  "MiniBadgeNotification.chunk.js",
  "full-mode-notification-handler.chunk.js",
  "light-mode.chunk.js",
  "registerRecordTransaction.chunk.js",
  "wishlist-product-icon-inject.js",
  "wishlist-product-icon.js",
  "wishlist-pdp-icon.js",
  "wishlist-header.js",
  "wishlist-cart.js",
  "wishlist-dy-icon.js",
  "product-preview-popup.js",
  "product-media-magnifier.js",
  "drop-a-hint.js",
  "live.js",
  "loop_widget.js",
  "loop_snippets",
  "live-tv-products.js",
  "live-tv-cart.js",
  "live-tv-wishlist.js",
  "live-tv-video-vip.js",
  "send-message-to-host.js",
  "secure-shield-drawer.js",
  "free-gift-cart-attributes.js",
  "product-media-variant-filter.js",
  "GDPRMiddleware.chunk.js",
  "upsellit",
  "agkn.com",
  "usbrowserspeed",
  "magefan",
  "pepperjam.com",
  "attn.tv",
  "nudgify.com",
  "clientcdn.pushengage.com",
  "fbevents.js",
  "signals",
  "bat.bing.com",
  "liadm.com",
  "d-code.liadm.com",
  "criteo.com",
  "impactcdn.com",
  "smartdevicesales.com",
  "safeopt.com",
  "rpsdata.com",
  "intelligems.io",
  "mm-uxrv.com",
  "mpio.io",
  "openai.com",
  "klaviyo.com",
  "s.pinimg.com",
  "ct.pinterest.com",
  "northbeam.io",
  "j.northbeam.io",
  "capi-automation.s3.us-east-2.amazonaws.com",
  "cdn.nytrng.com",
  "newsletter-email.js",
  "newsletter-sms.js",
  "recently-viewed-products.js",
  "account-login-actions.js",
  "performance.js",
  "unbxd-search.js",
  "quick-view.js",
  "quick-view-multi-option.js",
  "connect.facebook.net",
  "action.dstillery.com",
  "custom-pagination.js",
  "drag-zoom-wrapper.js",
  "enhanced-brand-content.js",
  "klaviyo-events.js",
  "zoom-dialog.js",
  "secure-shield.js",
  "budget-pay.js",
  "budget-pay-ui.js",
  "budget-pay-selector.js",
  "app-embed.js",
  "ra-cart.js",
  "storefront-banner.js",
  "storefront-b1cdb70.js",
  "shopify-perf-kit-3.7.0.min.js",
  "preloads.js",
  "update.js",
  "standard-actions.js",
  "vip-config.js",
  "portable-wallets.en.js",
  "shopify-xr.en.js",
  "load_feature-1bd60354.js",
  "origin_trials-5059b83f.js",
  "shop_events_listener-4e26a9ce.js",
  "results-list.js",
  "wishlist.js",
  "wishlist-dy-inject.js",
  "paginated-list.js",
  "paginated-list-aspect-ratio.js",
];

const SCRIPT_1_TEMPLATE =
  "!function(){'use strict';\nvar APP_ENDPOINT=\"__APP_ENDPOINT__\";\nvar AUDIT_COMPLETE=__AUDIT_COMPLETE__;\nvar DONE_KEY='shopAuditDone_v2',STATE_KEY='shopAuditState_v2',P_KEY='shopAuditP_v2',VIS_KEY='shopAuditVisible_v2',OFF_KEY='shopAuditOff_v2';\nvar WAIT_MS=6000,SIZE=80;\nvar EXCLUDED_HOSTS={};EXCLUDED_HOSTS[location.hostname]=1;EXCLUDED_HOSTS['cdn.shopify.com']=1;EXCLUDED_HOSTS['shop.app']=1;EXCLUDED_HOSTS['checkout.shopify.com']=1;EXCLUDED_HOSTS['cdn.shopifycloud.com']=1;\nvar EXCLUDED_KEYWORDS=['www.','storefront','chunk'];\nfunction esc(s){return window.CSS&&CSS.escape?CSS.escape(s):String(s).replace(/[^a-zA-Z0-9_-]/g,'\\\\$&')}\nfunction isThirdPartyHost(h){try{var x=String(h).toLowerCase();if(!x)return!1;if(EXCLUDED_HOSTS[x])return!1;if(x.endsWith('.'+location.hostname))return!1;return!0}catch(_){return!1}}\nfunction passesPFilter(s){var a=String(s).toLowerCase(),b=a.replace(/\\.js$/i,''),c=(b.match(/\\d/g)||[]).length;if(/^\\d+$/.test(b)||c>5)return!1;if(EXCLUDED_KEYWORDS.some(function(k){return a.indexOf(k)!==-1}))return!1;return!0}\nfunction isDynamicToken(t){var s=String(t).toLowerCase();if(!s)return!0;if(/^\\d+$/.test(s))return!0;if((s.match(/\\d/g)||[]).length>5)return!0;if(/^[a-f0-9]{8,}$/i.test(s))return!0;if(s.indexOf('shopify-')!==-1||s.indexOf('section-')!==-1||s.indexOf('block-')!==-1)return!0;if(s.length>40)return!0;if(/[a-z0-9]{20,}/i.test(s))return!0;return!1}\nfunction isMajor(el){if(el.nodeType!==1)return!1;var tag=el.tagName.toLowerCase();if(['html','body','head','script','style','link','meta','noscript','template','svg','path','br','hr'].indexOf(tag)!==-1)return!1;if(!el.className&&!el.id)return!1;var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')return!1;var r=el.getBoundingClientRect();if(r.width<SIZE&&r.height<SIZE)return!1;return!0}\nfunction isVisible(el){var r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}\nfunction getStableSelectors(el){var out=[];if(el.id&&!isDynamicToken(el.id))out.push('#'+esc(el.id));var classes=Array.prototype.filter.call(el.classList,function(c){return!isDynamicToken(c)});if(classes.length)out.push('.'+classes.slice(0,4).map(esc).join('.'));return out}\nfunction auditP(){var srcSet={};document.querySelectorAll('script[src]').forEach(function(s){var src=s.getAttribute('src')||s.src;if(src)srcSet[src]=1});try{performance.getEntriesByType('resource').forEach(function(e){if(e.initiatorType==='script'||/\\.js(\\?|$)/i.test(e.name))srcSet[e.name]=1})}catch(_){}var candidates={};Object.keys(srcSet).forEach(function(src){try{var u=new URL(src,location.href);if(u.protocol!=='http:'&&u.protocol!=='https:')return;u.hash='';u.search='';var p=u.pathname.split('/').filter(Boolean),b=p.pop();if(b)candidates[decodeURIComponent(b)]=1;var h=u.hostname.toLowerCase();if(isThirdPartyHost(h))candidates[h]=1}catch(_){}});var res=[];Object.keys(candidates).forEach(function(c){var x=String(c).trim();if(x&&passesPFilter(x))res.push(x)});return res}\nfunction auditSelectors(){var all=Array.prototype.filter.call(document.querySelectorAll('*'),isMajor),visEls=[],offEls=[];all.forEach(function(el){if(isVisible(el))visEls.push(el);else offEls.push(el)});var visible={},off={};function record(sel,isVis){if(isVis)visible[sel]=1;else off[sel]=1}var structuralMatched=new Set();all.forEach(function(container){if(!container.children||container.children.length<4)return;var containerSels=getStableSelectors(container);if(!containerSels.length)return;var children=Array.prototype.slice.call(container.children);var start=-1;for(var i=3;i<children.length;i++){if(offEls.indexOf(children[i])!==-1){start=i;break}}if(start===-1)return;var allOff=true;for(var j=start;j<children.length;j++){if(offEls.indexOf(children[j])===-1){allOff=false;break}}if(!allOff)return;var sel=containerSels[0]+' > :nth-child(n+'+(start+1)+')';var matching=document.querySelectorAll(sel);var anyVis=false;matching.forEach(function(m){if(visEls.indexOf(m)!==-1)anyVis=true});if(anyVis)return;record(sel,false);matching.forEach(function(m){structuralMatched.add(m)})});offEls.forEach(function(el){if(structuralMatched.has(el))return;var sels=getStableSelectors(el);if(sels.length){sels.forEach(function(s){record(s,false)});return}var anc=el.parentElement;while(anc&&anc!==document.body){var ancSels=getStableSelectors(anc);if(ancSels.length&&offEls.indexOf(anc)!==-1){ancSels.forEach(function(s){record(s,false)});break}anc=anc.parentElement}});return{visible:visible,off:off}}\nfunction loadJSON(k,f){try{var v=JSON.parse(localStorage.getItem(k));return v===null||v===undefined?f:v}catch(_){return f}}\nfunction saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}}\nfunction clearAll(){[DONE_KEY,STATE_KEY,P_KEY,VIS_KEY,OFF_KEY].forEach(function(k){try{localStorage.removeItem(k)}catch(_){}})}\nfunction isAuditDone(){\n  try{\n    if(AUDIT_COMPLETE!==true&&localStorage.getItem(DONE_KEY)==='1'){clearAll();return!1}\n    return AUDIT_COMPLETE===true||localStorage.getItem(DONE_KEY)==='1'\n  }catch(_){return AUDIT_COMPLETE===true}\n}\nfunction detectType(pathname){var p=String(pathname||'/').replace(/\\/+$/,'');if(p===''||p==='/')return'home';if(/^\\/collections\\/[^\\/?#]+$/.test(p)&&!/\\/collections\\/all$/.test(p))return'plp';if(/^\\/products\\/[^\\/?#]+$/.test(p))return'pdp';return null}\nfunction findFirstPath(hrefFragment,pathTest){var links=document.querySelectorAll('a[href*=\"'+hrefFragment+'\"]');for(var i=0;i<links.length;i++){try{var u=new URL(links[i].getAttribute('href'),location.href);if(u.hostname!==location.hostname)continue;if(pathTest(u.pathname))return u.pathname}catch(_){}}return null}\nfunction mergeAudit(){var p=auditP(),sel=auditSelectors();var Pset={};loadJSON(P_KEY,[]).forEach(function(x){Pset[x]=1});var visSet={};loadJSON(VIS_KEY,[]).forEach(function(x){visSet[x]=1});var offSet={};loadJSON(OFF_KEY,[]).forEach(function(x){offSet[x]=1});Object.keys(offSet).forEach(function(s){try{document.querySelectorAll(s).forEach(function(m){if(isMajor(m)&&isVisible(m))visSet[s]=1})}catch(_){}});p.forEach(function(x){Pset[x]=1});Object.keys(sel.visible).forEach(function(k){visSet[k]=1});Object.keys(sel.off).forEach(function(k){offSet[k]=1});saveJSON(P_KEY,Object.keys(Pset));saveJSON(VIS_KEY,Object.keys(visSet));saveJSON(OFF_KEY,Object.keys(offSet))}\nfunction submitResults(){var Pset={};loadJSON(P_KEY,[]).forEach(function(x){Pset[x]=1});var visSet={};loadJSON(VIS_KEY,[]).forEach(function(x){visSet[x]=1});var offSet={};loadJSON(OFF_KEY,[]).forEach(function(x){offSet[x]=1});var finalP=Object.keys(Pset).sort();var finalSelectors=Object.keys(offSet).filter(function(s){return!visSet[s]}).sort();\n  fetch(APP_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deferArray:finalP,hideSelectors:finalSelectors})}).then(function(res){if(res&&res.ok){try{localStorage.setItem(DONE_KEY,'1')}catch(_){}try{localStorage.removeItem(STATE_KEY)}catch(_){}}}).catch(function(){})\n}\nfunction advance(state){saveJSON(STATE_KEY,state);if(state.step==='plp'&&state.plpPath){location.href=state.plpPath}else if(state.step==='pdp'&&state.pdpPath){location.href=state.pdpPath}else{state.step='submit';saveJSON(STATE_KEY,state);submitResults()}}\nfunction run(){\n  if(isAuditDone())return;\n  var type=detectType(location.pathname);\n  var state=loadJSON(STATE_KEY,null);\n  if(!state){\n    if(type!=='home'){location.replace('/');return}\n    state={step:'home',plpPath:null,pdpPath:null};saveJSON(STATE_KEY,state)\n  }\n  if(state.step==='home'){\n    if(type!=='home'){location.replace('/');return}\n    setTimeout(function(){\n      mergeAudit();\n      state.plpPath=findFirstPath('/collections/',function(p){return/^\\/collections\\/[^\\/?#]+$/.test(p)&&!/\\/collections\\/all$/.test(p)});\n      state.pdpPath=findFirstPath('/products/',function(p){return/^\\/products\\/[^\\/?#]+$/.test(p)});\n      state.step=state.plpPath?'plp':(state.pdpPath?'pdp':'submit');\n      advance(state)\n    },WAIT_MS);\n    return\n  }\n  if(state.step==='plp'){\n    if(type!=='plp'){if(state.plpPath){location.href=state.plpPath;return}state.step=state.pdpPath?'pdp':'submit';advance(state);return}\n    setTimeout(function(){mergeAudit();state.step=state.pdpPath?'pdp':'submit';advance(state)},WAIT_MS);\n    return\n  }\n  if(state.step==='pdp'){\n    if(type!=='pdp'){if(state.pdpPath){location.href=state.pdpPath;return}state.step='submit';advance(state);return}\n    setTimeout(function(){mergeAudit();state.step='submit';advance(state)},WAIT_MS);\n    return\n  }\n  submitResults()\n}\nif(document.readyState==='loading')window.addEventListener('DOMContentLoaded',run);else run()\n}();";

const SCRIPT_2_TEMPLATE =
  '!function(){"use strict";var doc=document,docEl=doc.documentElement,classList=docEl.classList;var _iw=window.innerWidth,_sk=atob("ZHMtYm90LXdwbS1ndG0="),_st=null;try{_st=localStorage.getItem(_sk);}catch(_e){}var shouldBlockWpmGtm=false;if(_st===atob("MQ==")){shouldBlockWpmGtm=true;}else if(_st===atob("MA==")){shouldBlockWpmGtm=false;}else{var _b=new RegExp(atob("R1RtZXRyaXg="),"i").test(navigator.userAgent)||(navigator.platform===atob("TGludXggeDg2XzY0")&&0x546===_iw&&0x320===screen.width&&0x258===screen.height)||(0x19c===_iw&&0x337===screen.height);if(_b){shouldBlockWpmGtm=true;try{localStorage.setItem(_sk,atob("MQ=="));}catch(_e){}}else{shouldBlockWpmGtm=false;try{localStorage.setItem(_sk,atob("MA=="));}catch(_e){}}}var P=__DEFER_LIST__;if(shouldBlockWpmGtm){var _pt=(location.pathname.split("/")[1]||"").toLowerCase();P.push("wpm");if(_pt==="index"){P.push("trekkie");}if(_pt==="products"){P.push("pubnub");}if(_pt==="collections"){P.push("auto","callout","section","cart");}}var R=P.length?new RegExp(P.map(function(p){return p.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&");}).join("|")):null,H=function(){return classList.contains("interacted");},S=Element.prototype.setAttribute,A=Element.prototype.appendChild,I=Element.prototype.insertBefore,C=Node.prototype.replaceChild;function B(s){if(!H()&&s&&"SCRIPT"===s.tagName){var t=s.src||s.getAttribute("src")||"";if(t&&R&&R.test(t)){s.hasAttribute("data-type")||s.setAttribute("data-type",s.getAttribute("type")||"");s.type="text/plain";s.removeAttribute("src");s._ps=t;}}}Element.prototype.appendChild=function(e){return e&&"SCRIPT"===e.tagName&&B(e),A.call(this,e);};Element.prototype.insertBefore=function(e,t){return e&&"SCRIPT"===e.tagName&&B(e),I.call(this,e,t);};Node.prototype.replaceChild=function(e,t){return e&&"SCRIPT"===e.tagName&&B(e),C.call(this,e,t);};Element.prototype.setAttribute=function(e,t){if("SCRIPT"===this.tagName){if("src"===e){var r=String(t||"");if(r&&R&&R.test(r))return this._ps=r,this.type="text/plain",void this.removeAttribute("src");}if("type"===e&&this.hasAttribute("data-type"))return;}return S.call(this,e,t);};window.__dsq&&(window.__dsq.forEach(function(e){"s"===e.t?((t=String(e.v||""))&&R&&R.test(t)&&(e.e._ps=t,e.e.type="text/plain",e.e.removeAttribute("src"))):B(e.e);var t;}),window.__dsq=null);window.__dsmo&&(window.__dsmo.disconnect(),window.__dsmo=null);doc.querySelectorAll("script").forEach(B);var O=new MutationObserver(function(t){if(H())O.disconnect();else for(var e=0;e<t.length;e++)for(var r=t[e].addedNodes,s=0;s<r.length;s++){var n=r[s];if(1===n.nodeType&&("SCRIPT"===n.tagName&&B(n),n.querySelectorAll))for(var a=n.querySelectorAll("script"),i=0;i<a.length;i++)B(a[i]);}});O.observe(docEl,{childList:true,subtree:true});function releaseGatedScripts(){O.disconnect();doc.querySelectorAll(\'script[type="text/plain"]\').forEach(function(e){if(e._ps){var t=doc.createElement("script");for(var r=0;r<e.attributes.length;r++){var s=e.attributes[r];"type"!==s.name&&"src"!==s.name&&S.call(t,s.name,s.value);}var n=e.getAttribute("data-type")||"";n&&S.call(t,"type",n);S.call(t,"src",e._ps);A.call(doc.head,t);e.remove();}});}doc.addEventListener("site:interacted",releaseGatedScripts,{once:true});H()&&releaseGatedScripts();!function(){var attr="data-ig",unwrapped=false;function wrap(el){if(el.isConnected&&(!el.closest||!el.closest("template"))){var parent=el.parentNode;if(parent){var tpl=doc.createElement("template");tpl.setAttribute(attr,"1");parent.replaceChild(tpl,el);tpl.content.appendChild(el);}}}function scanAndWrap(){if(unwrapped)return;var els=doc.querySelectorAll(\'.tanzanite-section,.two-column-container,.card-gallery-default__ratings,.shopify-pc__banner__dialog,.menu-drawer__inner,.card-gallery-default__slide:not(.card-gallery-default__slide--active),.facets__filters-wrapper accordion-custom:nth-child(n+6), .pdp-trust-builder, .ratings-reviews-section, .ui-test-section, .social-responsibility-sec\');for(var i=0;i<els.length;i++)wrap(els[i]);}function unwrapAll(){var t;while((t=doc.querySelectorAll("template["+attr+"]")).length){for(var i=0;i<t.length;i++){var tpl=t[i],child=tpl.content.firstElementChild;if(tpl.parentNode){child?tpl.parentNode.replaceChild(child,tpl):tpl.parentNode.removeChild(tpl);}}}}if(H()){unwrapped=true;}else{scanAndWrap();var contentObserver=new MutationObserver(scanAndWrap);contentObserver.observe(docEl,{childList:true,subtree:true});doc.addEventListener("site:interacted",function(){if(unwrapped)return;unwrapped=true;contentObserver.disconnect();unwrapAll();},{once:true});}}();}();';

export const PREDEFINED_SCRIPTS: PredefinedScript[] = [
  {
    id: "script_1",
    name: "Audit Script",
    type: "script",
    code: SCRIPT_1_TEMPLATE,
    defaultEnabled: false,
  },
  {
    id: "script_2",
    name: "Defer Script",
    type: "script",
    code: SCRIPT_2_TEMPLATE,
    defaultEnabled: false,
  },
  {
    id: "script_3",
    name: "Hide CSS",
    type: "style",
    code: "",
    defaultEnabled: false,
  },
];

export function getPredefinedScript(
  id: PredefinedScript["id"],
): PredefinedScript | undefined {
  return PREDEFINED_SCRIPTS.find((s) => s.id === id);
}
