/**
 * Popup audit (runs inside the storefront audit script, same IIFE).
 *
 * Finds every popup that is open at measurement time, was open earlier and has
 * since closed, or opens later (a MutationObserver is armed before page scripts
 * run), and stores stable selectors under `shopAuditPopups_v1`. The runner merges
 * them into the hide list, which the storefront script applies as
 * `html:not(.interacted) :is(...){display:none!important}`, so no popup is shown
 * until the visitor's first interaction.
 *
 * Written in plain ES5 with no backticks and no dollar-brace sequences because it
 * is interpolated into the AUDIT_SCRIPT template literal below.
 */
export const POPUP_AUDIT_JS = String.raw`var POP_KEY='shopAuditPopups_v1',POP_CAP=30;
var POP_WORDS=['popup','pop-up','modal','lightbox','newsletter','subscribe','cookie','consent','gdpr','klaviyo','privy','justuno','optinmonster','omnisend','exit-intent','welcome-mat','age-gate'];
var POP_KW=/(pop-?up|modal|lightbox|newsletter|subscribe|cookie|consent|gdpr|ccpa|cc-window|cc-banner|onetrust|cookiebot|klaviyo|privy|justuno|optinmonster|omnisend|exit-?intent|welcome-?mat|age-?gate)/i;
var POP_TXT=/(cookie|consent|gdpr|accept all|we use (cookies|tracking)|privacy (preferences|settings|policy))/i;
var POP_STATE=/^(is-|has-|js-|open|opened|opening|active|show|shown|visible|hidden|hide|in$|fade|animate|animated|loaded|ready|enter|leave|closing|closed|transition)|(--|__|-)(open|opened|active|visible|show|shown)$/i;
var popFound={},popQ=[],popQT=0,popMO=null,popQry=null;
function popTxtCls(el){var c='';try{c=typeof el.className==='string'?el.className:((el.className&&el.className.baseVal)||'')}catch(_){}return c+' '+(el.id||'')}
function popIsSem(el){var t=el.tagName.toLowerCase(),r=el.getAttribute('role')||'';return t==='dialog'||r==='dialog'||r==='alertdialog'||el.getAttribute('aria-modal')==='true'||el.hasAttribute('popover')}
function popSkip(el){if(!el||el.nodeType!==1)return true;var t=el.tagName.toLowerCase();if(['html','body','head','main','header','footer','nav','script','style','link','meta','noscript','template','svg','path','br','hr'].indexOf(t)!==-1)return true;if(el.id&&el.id.indexOf('pp-')===0)return true;var r=el.getAttribute('role');if(r==='banner'||r==='navigation'||r==='main')return true;try{if(el.querySelector('main,[role="main"],header,[role="banner"]'))return true;if(el.closest('header,nav,[role="banner"],[role="navigation"]'))return true}catch(_){}return false}
function popKind(el){if(popSkip(el))return'';var cs;try{cs=getComputedStyle(el)}catch(_){return''}if(popIsSem(el))return'dialog';var kw=POP_KW.test(popTxtCls(el)),pos=cs.position,z=parseInt(cs.zIndex,10);if(isNaN(z))z=0;if(pos==='fixed'){if(kw)return'fixed-keyword';if(cs.display==='none'||cs.visibility==='hidden')return'';var r=el.getBoundingClientRect(),vw=innerWidth||1,vh=innerHeight||1;if(!r.width||!r.height)return'';var area=(r.width*r.height)/(vw*vh),wide=r.width>=vw*0.6,topBar=r.top<=2&&r.height<vh*0.3;if(wide&&r.height<vh*0.5&&POP_TXT.test((el.textContent||'').slice(0,600)))return'fixed-banner';if(area>=0.2&&!topBar&&z>=10)return'fixed-overlay'}if(pos==='absolute'&&kw&&z>=100)return'abs-keyword';return''}
function popOk(el){if(popSkip(el))return false;if(popKind(el))return true;if(!el.getClientRects().length&&(popIsSem(el)||POP_KW.test(popTxtCls(el))))return true;return false}
function popSelSafe(sel){try{var m=document.querySelectorAll(sel);if(!m.length||m.length>8)return false;for(var i=0;i<m.length;i++)if(!popOk(m[i]))return false;return true}catch(_){return false}}
function popCands(el){var c=[],id=el.id;if(id&&!isDynamicToken(id))c.push('#'+esc(id));var cl=Array.prototype.filter.call(el.classList||[],function(x){return!isDynamicToken(x)&&!POP_STATE.test(x)});if(cl.length){c.push('.'+cl.slice(0,3).map(esc).join('.'));if(cl.length>1)cl.slice(0,3).forEach(function(x){if(POP_KW.test(x))c.push('.'+esc(x))})}var t=el.tagName.toLowerCase(),r=el.getAttribute('role');if(t==='dialog')c.push('dialog');if(r==='dialog'||r==='alertdialog')c.push(t+'[role="'+r+'"]');if(el.getAttribute('aria-modal')==='true')c.push(t+'[aria-modal="true"]');return c}
function popSelFor(el){var cur=el,hop=0;while(cur&&cur.nodeType===1&&cur!==document.body&&hop<3){if(hop===0||popOk(cur)){var cs=popCands(cur);for(var i=0;i<cs.length;i++)if(popSelSafe(cs[i]))return cs[i]}cur=cur.parentElement;hop++}return''}
function popRecord(el){if(!el||el.nodeType!==1||!popKind(el))return;var s=popSelFor(el);if(s&&(popFound[s]||Object.keys(popFound).length<POP_CAP))popFound[s]=1}
function popQuery(){if(!popQry)popQry='dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],[popover],'+POP_WORDS.map(function(w){return'[class*="'+w+'" i],[id*="'+w+'" i]'}).join(',');return popQry}
function popScan(root){root=root||document;try{if(root.nodeType===1)popRecord(root);var n=root.querySelectorAll(popQuery());for(var i=0;i<n.length&&i<1500;i++)popRecord(n[i]);var all=root.querySelectorAll('*'),lim=root===document?6000:800;for(var j=0;j<all.length&&j<lim;j++){var e=all[j];if(e.offsetParent===null&&e.getClientRects&&e.getClientRects().length)popRecord(e)}}catch(_){}}
function popLite(el){popRecord(el);try{var n=el.querySelectorAll(popQuery());for(var i=0;i<n.length&&i<60;i++)popRecord(n[i])}catch(_){}}
function popFlush(){popQT=0;var q=popQ.filter(function(e,i,a){return a.indexOf(e)===i}).slice(0,80);popQ=[];q.forEach(function(e){if(e.isConnected)popScan(e)});if(q.length)setTimeout(function(){q.forEach(function(e){if(e.isConnected)popScan(e)})},900)}
function popQueue(el){if(popQ.length<400)popQ.push(el);if(!popQT)popQT=setTimeout(popFlush,150)}
function popStart(){if(popMO||typeof MutationObserver==='undefined')return;try{popMO=new MutationObserver(function(ms){var budget=300;for(var i=0;i<ms.length&&budget>0;i++){var m=ms[i];if(m.type==='childList'){for(var k=0;k<m.addedNodes.length&&budget>0;k++){var n=m.addedNodes[k];if(n.nodeType===1){budget--;popLite(n);popQueue(n)}}}else if(m.target&&m.target.nodeType===1&&(popIsSem(m.target)||POP_KW.test(popTxtCls(m.target)))){budget--;popRecord(m.target);popQueue(m.target)}}});popMO.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','open','hidden','aria-hidden','aria-modal','data-open','data-state']})}catch(_){popMO=null}}
function popPersist(){popFlush();popScan(document);var cur={};loadJSON(POP_KEY,[]).forEach(function(x){cur[x]=1});Object.keys(popFound).forEach(function(x){cur[x]=1});var arr=Object.keys(cur).slice(0,POP_CAP);saveJSON(POP_KEY,arr);return arr}
function popClip(arr){return arr.length?String.fromCharCode(10,10)+"var popups=document.querySelectorAll('"+arr.join(',')+"');":''}
function popSafeOnPage(sel){try{var m=document.querySelectorAll(sel);if(m.length>8)return false;for(var i=0;i<m.length;i++)if(!popOk(m[i]))return false;return true}catch(_){return false}}`;
