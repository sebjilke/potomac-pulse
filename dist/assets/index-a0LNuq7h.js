(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))o(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const i of r.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function o(a){if(a.ep)return;a.ep=!0;const r=n(a);fetch(a.href,r)}})();const H={id:"01646500"},St="potomac_learning_v24",Et="potomac_cached_data",Kt=360*60*1e3,Ct="potomac_por_history",Ae=4320*60*1e3,xt="potomac_gf_history",ze=1440*60*1e3,Je="potomac_shadow_models",de="/api/sync",Yt=30,ee={"01646500":{name:"Little Falls",lat:38.9498,lon:-77.1278,area:11560,pctLF:100,baseHrs:0,branch:"target"},"01638500":{name:"Point of Rocks",lat:39.2726,lon:-77.5405,area:9651,pctLF:83.5,baseHrs:26,branch:"mainstem"},"01618000":{name:"Shepherdstown",lat:39.4309,lon:-77.8033,area:5955,pctLF:51.5,baseHrs:50,branch:"mainstem"},"01613000":{name:"Hancock",lat:39.6987,lon:-78.1789,area:4073,pctLF:35.2,baseHrs:120,branch:"mainstem"},"01610000":{name:"Paw Paw",lat:39.532,lon:-78.4578,area:3109,pctLF:26.9,baseHrs:141,branch:"mainstem"},"01603000":{name:"Cumberland",lat:39.6218,lon:-78.7622,area:877,pctLF:7.6,baseHrs:181,branch:"northBranch"},"01595500":{name:"Kitzmiller",lat:39.3892,lon:-79.1817,area:247,pctLF:2.1,baseHrs:190,branch:"northBranch"},"01608500":{name:"Springfield",lat:39.4454,lon:-78.6545,area:1486,pctLF:12.7,baseHrs:176,branch:"southBranch"},"01606500":{name:"Petersburg",lat:38.9926,lon:-79.1239,area:642,pctLF:5.6,baseHrs:187,branch:"southBranch"},"01604500":{name:"Franklin",lat:38.6428,lon:-79.3306,area:179,pctLF:1.5,baseHrs:200,branch:"southBranch"},"01636500":{name:"Millville",lat:39.2743,lon:-77.785,area:3041,pctLF:26.3,baseHrs:38,branch:"shenandoah"},"01631000":{name:"Front Royal",lat:38.914,lon:-78.2117,area:1642,pctLF:14.2,baseHrs:64,branch:"shenandoah"},"01643000":{name:"Monocacy",lat:39.4143,lon:-77.408,area:817,pctLF:7.1,baseHrs:14,branch:"belowPtR"},"01644000":{name:"Goose Creek",lat:39.0559,lon:-77.5191,area:332,pctLF:3,baseHrs:10,branch:"belowPtR"},"01644280":{name:"Broad Run",lat:39.0464,lon:-77.4324,area:76,pctLF:.7,baseHrs:8,branch:"belowPtR"},"01645000":{name:"Seneca Creek",lat:39.1273,lon:-77.3386,area:101,pctLF:.9,baseHrs:5,branch:"belowPtR"},"01611500":{name:"Cacapon",lat:39.5832,lon:-78.3011,area:675,pctLF:5.8,baseHrs:128,branch:"tribs"},"01614500":{name:"Conococheague",lat:39.651,lon:-77.9239,area:494,pctLF:4.9,baseHrs:112,branch:"tribs"},"01619500":{name:"Antietam",lat:39.4487,lon:-77.7389,area:281,pctLF:2.4,baseHrs:53,branch:"tribs"}},we={id:"GF_VIRTUAL",name:"Great Falls",lat:38.9985,lon:-77.2519},Xt={id:"01644148"},W={coef:126,exp:2.46,coldCoef:160,coldExp:2.36,coldMaxTemp:10,rSquared:.91,medianErrorPct:6.3,minStage:2.5,maxStage:20},ot=48,Zt={"0-3000":{rising:{q05:-1039,q95:280},steady:{q05:-467,q95:440},falling:{q05:-875,q95:560},all:{q05:-489,q95:440}},"3000-6000":{rising:{q05:-2451,q95:431},steady:{q05:-1230,q95:251},falling:{q05:-2497,q95:254},all:{q05:-1399,q95:254}},"6000-12000":{rising:{q05:-4560,q95:1174},steady:{q05:-2377,q95:-159},falling:{q05:-5041,q95:-77},all:{q05:-2786,q95:-128}},"12000-25000":{rising:{q05:-7695,q95:3921},steady:{q05:-4003,q95:-450},falling:{q05:-9093,q95:-540},all:{q05:-4588,q95:-146}},"25000-50000":{rising:{q05:-12368,q95:7884},steady:{q05:-7709,q95:-707},falling:{q05:-15543,q95:-1861},all:{q05:-8824,q95:976}},"50000+":{rising:{q05:-17648,q95:34116},steady:{q05:-13163,q95:12622},falling:{q05:-16344,q95:-1048},all:{q05:-14377,q95:17848}}},he={mainstem:{name:"Mainstem",color:"#2563eb",ids:["01638500","01618000","01613000","01610000"]},northBranch:{name:"North Branch",color:"#0891b2",ids:["01603000","01595500"]},southBranch:{name:"South Branch",color:"#7c3aed",ids:["01608500","01606500","01604500"]},shenandoah:{name:"Shenandoah",color:"#c026d3",ids:["01636500","01631000"]},belowPtR:{name:"Below Pt Rocks ⚠️",color:"#dc2626",warn:!0,ids:["01643000","01644000","01644280","01645000"]},tribs:{name:"Tributaries",color:"#059669",ids:["01611500","01614500","01619500"]}},ce={"01648000":{name:"Rock Creek",class:"II-III+(V)",runnable:400,awId:2587,area:62,estimated:!1},"01650500":{name:"NW Branch Anacostia",class:"I-III(V+)",runnable:200,awId:706,area:21,estimated:!1},"01646000":{name:"Difficult Run",class:"III-IV(V+)",runnable:200,awId:1930,area:58,estimated:!0},"01650800":{name:"Sligo Creek",class:"~II",runnable:200,awId:null,area:6.5,estimated:!1,microRun:!0}},en=4139,tn=-.5963,nn=4940,on=25.8,an=19.4,kt=6.5,sn=.03,rn=1800*1e3,cn=7200*1e3,ln=7200*1e3,at=[6,12,24,48],st={"01646500":"BRKM2","01638500":"PORM2","01618000":"SHEW2","01613000":"HNKM2","01610000":"PAWW2","01603000":"CBEM2","01595500":"KITM2","01608500":"SPRW2","01606500":"PETW2","01636500":"MILW2","01631000":"FROV2","01643000":"FDKM2","01644000":"LEEV2","01645000":"DAWM2","01611500":"GCPW2","01614500":"FAVM2","01619500":"SACM2"};function dn(e){return e<3e3?"0-3000":e<6e3?"3000-6000":e<12e3?"6000-12000":e<25e3?"12000-25000":e<5e4?"25000-50000":"50000+"}function te(e){return e<600?2.4+e/600*.06:e<1300?2.46+(e-600)/700*.23:e<2e3?2.69+(e-1300)/700*.14:e<2600?2.83+(e-2e3)/600*.13:e<3200?2.96+(e-2600)/600*.13:e<3600?3.09+(e-3200)/400*.07:e<4200?3.16+(e-3600)/600*.07:e<5e3?3.23+(e-4200)/800*.12:e<5700?3.35+(e-5e3)/700*.11:e<7500?3.46+(e-5700)/1800*.21:e<1e4?3.67+(e-7500)/2500*.28:e<13e3?3.95+(e-1e4)/3e3*.34:e<28e3?4.29+(e-13e3)/15e3*1.21:e<5e4?5.5+(e-28e3)/22e3*1.29:e<8e4?6.79+(e-5e4)/3e4*1.57:e<15e4?8.36+(e-8e4)/7e4*2.57:10.93+(e-15e4)/1e5*2.5}function Rt(e){if(e<1e3)return 0;const t=.4,n=Math.log(1e4);return t/(1+Math.exp(-5*(Math.log(e)-n)))}function fn(e){return e<2e3?"Extreme Low":e<3500?"Low":e<4500?"Below Normal":e<6e3?"Normal":e<1e4?"Above Normal":e<17e3?"Elevated":e<27e3?"High":e<5e4?"Very High":e<8e4?"Minor Flood":"Major Flood"}function Qe(e){const t=Math.max(e,1e3),n=en*Math.pow(t,tn),o=n/on,a=fn(t);return{flow:t,mult:o,cond:a,travelHrs:n}}let R=[],Z=[],ne={lfFeedback:{correctionFactor:0,lastPredictedLF:null,lastPredictionTime:null,alpha:.4},onlineRegression:{weights:null,learningRate:.001,nFeatures:9,trainCount:0},kalman:{x:null,P:null,Q_base:1e-4,initialized:!1}},A={lfFeedback:{cfs:null,stage:null,label:"LF Feedback"},onlineRegression:{cfs:null,stage:null,label:"Online Regression"},kalman:{cfs:null,stage:null,label:"Kalman Filter"}},Ne="loading",pe=null,It=!1,Ke=!0,He=null,Re={rising:{multiplier:1.08,count:0,sumError:0},falling:{multiplier:.92,count:0,sumError:0},steady:{multiplier:1,count:0,sumError:0}},X={current:null,history:[],correlation:null},se=null,_e={},m=null,U=null,Ie=!1,Lt=0,me=[],Pt=0,ge=null,Tt=null,$t=null,be=null,h={},le={},Le=!1,D=null,At=!1,Oe=null,Fe=null;function Se(e){R=e}function Pe(e){Z=e}function un(e){ne=e}function gn(e){A=e}function xe(e){Ne=e}function ke(e){pe=e}function rt(e){It=e}function mn(e){Ke=e}function hn(e){He=e}function pn(e){se=e}function yn(e){m=e}function Me(e){U=e}function vn(e){Ie=e}function wn(e){Lt=e}function bn(e){Pt=e}function Fn(e){ge=e}function Sn(e){Tt=e}function En(e){$t=e}function Cn(e){be=e}function xn(e){h=e}function kn(e){Le=e}function it(e){D=e}function ct(e){At=e}function lt(e){Oe=e}function Bt(e){Fe=e}function Rn(){return mn(!0),console.log("☁️ Cloud sync enabled via serverless function"),!0}async function In(){Oe&&clearTimeout(Oe);const e=setTimeout(async()=>{if(!At){ct(!0),ye("syncing");try{const t={startDate:D.startDate,totalObs:D.totalObs},n=[];for(const[r,i]of Object.entries(D.observations)){const s=i.slice(-10);for(const c of s)c.timestamp>(He||0)&&n.push({gauge_id:r,data:c})}const o=await fetch(de,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({metadata:t,corrections:D.corrections,observations:n,lastSyncTime:He})});if(!o.ok)throw new Error(`HTTP ${o.status}`);const a=await o.json();hn(Date.now()),ye("synced"),console.log(`☁️ Synced to cloud (${a.savedCount} items)`)}catch(t){console.log("Cloud sync error:",t),ye("error")}ct(!1),lt(null)}},3e4);lt(e)}function ye(e){const t=document.getElementById("syncStatus");if(!t)return;const n={synced:{icon:"☁️",color:"#4ade80",title:"Cloud synced"},syncing:{icon:"☁️",color:"#fbbf24",title:"Syncing..."},error:{icon:"⚠️",color:"#f87171",title:"Sync error"},local:{icon:"💾",color:"#64748b",title:"Local only"}},o=n[e]||n.local;t.textContent=o.icon,t.style.color=o.color,t.title=o.title}async function Ln(){let e=Pn();if(Ke)try{const t=await Tn();t&&(e=$n(e,t),console.log("☁️ Loaded and merged cloud learning data"),ye("synced"))}catch(t){console.log("Cloud load failed, using local:",t),ye("error")}return e}function Pn(){try{const e=localStorage.getItem(St);if(e){const t=JSON.parse(e);if(t.observations&&t.startDate)return t}}catch(e){console.log("Local learning data reset:",e)}return Ye()}async function Tn(){try{const e=await fetch(de,{method:"GET",headers:{"Content-Type":"application/json"}});if(!e.ok)throw new Error(`HTTP ${e.status}`);return await e.json()}catch(e){return console.log("Cloud learning load error:",e),null}}function $n(e,t){if(!t)return e;const n=Ye();n.startDate=new Date(e.startDate)<new Date(t.startDate)?e.startDate:t.startDate,n.corrections={...e.corrections,...t.corrections};const o=new Set([...Object.keys(e.observations),...Object.keys(t.observations)]);for(const a of o){const r=e.observations[a]||[],i=t.observations[a]||[],s=[...r,...i],c=new Set;n.observations[a]=s.filter(l=>{const d=l.timestamp||l.created_at;return c.has(d)?!1:(c.add(d),!0)}).slice(-500)}return n.totalObs=Math.max(e.totalObs,t.totalObs),n}function Ye(){return{startDate:new Date().toISOString(),observations:{},corrections:{},totalObs:0}}async function An(){try{localStorage.setItem(St,JSON.stringify(D))}catch(e){console.log("Failed to save local learning:",e)}Ke&&In()}function Bn(){if(!Le||!D||!h[H.id])return;const e=Date.now(),t=h[H.id].q,n=h[H.id].h,o=D.observations[H.id]||[],a=o[o.length-1]?.q||t,r=t>a*1.1;for(const[c,l]of Object.entries(ee)){if(c===H.id)continue;const d=h[c];if(!d||!d.q||!d.h||d.iceAffected||d.estimated)continue;D.observations[c]||(D.observations[c]=[]);const g=D.observations[c],f=g[g.length-1];if(f&&e-f.timestamp<36e5)continue;const w=f&&d.q>f.q*1.15;g.push({timestamp:e,q:d.q,h:d.h,lfQ:t,lfH:n,predictedHrs:d.travelHrs,rising:w,lfRising:r}),g.length>500&&g.shift(),D.totalObs++}D.observations[H.id]||(D.observations[H.id]=[]);const i=D.observations[H.id],s=i[i.length-1];(!s||e-s.timestamp>=36e5)&&(i.push({timestamp:e,q:t,h:n}),i.length>500&&i.shift()),Mn(),An()}function Mn(){const e=D.observations[H.id]||[];if(!(e.length<10))for(const[t,n]of Object.entries(D.observations)){if(t===H.id||n.length<Yt||!ee[t])continue;const a=n.filter(s=>s.rising);if(a.length<3)continue;let r=0,i=0;for(const s of a){s.timestamp+s.predictedHrs*36e5;const c=s.timestamp+s.predictedHrs*18e5,l=s.timestamp+s.predictedHrs*54e5,d=e.find(g=>g.timestamp>c&&g.timestamp<l&&g.q>s.lfQ*1.08);if(d){const f=(d.timestamp-s.timestamp)/36e5/s.predictedHrs;f>.3&&f<3&&(r+=f,i++)}}if(i>=2){const s=r/i,c=Math.min(i/10,1);D.corrections[t]=s*c+1*(1-c)}}}function Dn(e){return D&&D.corrections[e]||1}async function Gn(e,t){const n=[`https://api.water.noaa.gov/nwps/v1/gauges/${t}/stageflow`,`https://api.water.noaa.gov/nwps/v1/gauges/${t.toLowerCase()}/stageflow`,`https://api.water.noaa.gov/nwps/v1/gauges/${t}/stageflow/forecast`,`https://api.water.noaa.gov/nwps/v1/gauges/${t.toLowerCase()}/stageflow/forecast`];for(const o of n)try{const a=await ve(o,5e3);if(a.ok){const r=await a.text();try{const i=JSON.parse(r),s=Hn(i,e,t);if(s)return console.log(`✓ NWS forecast for ${e}`),{usgsId:e,forecast:s}}catch{}}}catch{}return null}async function Nn(){console.log("=== Fetching NWS forecasts (parallel) ===");const e=Object.entries(st).map(([o,a])=>Gn(o,a).catch(()=>null)),t=await Promise.all(e);let n=0;for(const o of t){if(!o)continue;const{usgsId:a,forecast:r}=o;if(h[a]&&(n++,h[a].forecast=r,r.forecast24||r.forecast48)){const i=h[a].q,s=r.forecast48||r.forecast24;let c="stable",l=0;i&&s&&i>0&&(l=(s-i)/i,l>.02?c="up":l<-.02&&(c="down")),h[a].trend={direction:c,rate:l,source:"NWS",forecast24:r.forecast24,forecast48:r.forecast48}}}console.log(`=== NWS forecasts: ${n}/${Object.keys(st).length} gauges ===`)}function Hn(e,t,n){try{console.log(`=== Parsing NWS for ${n} (${t}) ===`);let o=1;(e?.secondaryUnits||e?.forecast?.secondaryUnits)==="kcfs"&&(o=1e3,console.log("Flow units: kcfs, multiplier: 1000"));let r=null;const i=[e?.forecast?.data,e?.data,e?.forecast,e?.data?.forecast?.data,e?.data?.forecast,e?.stageflow?.forecast?.data,e?.stageflow?.forecast];for(const f of i)if(Array.isArray(f)&&f.length>0){r=f;break}if(!r||r.length===0)return console.log(`No forecast array found for ${n}`),null;console.log(`Found ${r.length} forecast points, flowMultiplier=${o}`);const s=Date.now();let c=null,l=null,d=null,g=null;for(const f of r){let w=f.validTime||f.time||f.dateTime||f.valid||f.timestamp;if(!w)continue;const y=new Date(w).getTime();if(isNaN(y))continue;const v=(y-s)/36e5;if(v<0||v>72)continue;const u=parseFloat(f.secondary);if(isNaN(u)||u<=0)continue;const b=u*o;if(v>=18&&v<=30&&!c&&(c=b,d=y,console.log(`24h forecast: ${u} kcfs = ${b} cfs at ${v.toFixed(1)}h`)),v>=42&&v<=54&&!l&&(l=b,g=y,console.log(`48h forecast: ${u} kcfs = ${b} cfs at ${v.toFixed(1)}h`)),c&&l)break}if(!c||!l)for(const f of r){let w=f.validTime||f.time||f.dateTime||f.valid||f.timestamp;if(!w)continue;const y=new Date(w).getTime();if(isNaN(y))continue;const v=(y-s)/36e5;if(v<0||v>96)continue;const u=parseFloat(f.secondary);if(isNaN(u)||u<=0)continue;const b=u*o;if(!c&&v>=12&&v<=36&&(c=b,d=y),!l&&v>=36&&v<=72&&(l=b,g=y),c&&l)break}return!c&&!l?(console.log(`No valid cfs forecast data for ${n}`),null):(console.log(`SUCCESS: ${n} -> 24h=${c} cfs, 48h=${l} cfs`),{forecast24:c,forecast48:l,time24:d,time48:g,source:"NWS",data:r})}catch(o){return console.log("Error parsing NWS for",n,":",o.message),null}}let qe=null,We=null;function _n(e){qe=e}function On(e){We=e}function qn(){try{const e=localStorage.getItem(Ct);if(e){let t=JSON.parse(e);const n=Date.now()-Ae;t=t.filter(o=>o.timestamp>n),Se(t),console.log(`📊 Loaded ${R.length} PoR history entries from localStorage`)}}catch(e){console.warn("Failed to load PoR history:",e),Se([])}Wn()}async function Wn(){try{const e=await fetch(de+"?endpoint=por-history");if(!e.ok)return;const n=(await e.json()).readings||[];if(n.length===0)return;const o=Date.now()-Ae,a=300*1e3,r=n.filter(c=>c.timestamp>o),i=R.length;let s=0;for(const c of r)R.some(d=>Math.abs(d.timestamp-c.timestamp)<a)||(R.push({timestamp:c.timestamp,cfs:c.cfs,stage:c.stage||null}),s++);s>0&&(R.sort((c,l)=>c.timestamp-l.timestamp),Se(R.filter(c=>c.timestamp>o)),Mt(),console.log(`📊 Merged ${s} server PoR history entries, total: ${R.length}`),Ie&&i<4&&R.length>=4&&(console.log(`📊 PoR history expanded from ${i} to ${R.length} entries — re-running GF estimation`),qe&&qe()))}catch(e){console.warn("Failed to fetch server PoR history (non-fatal):",e)}}function Mt(){try{localStorage.setItem(Ct,JSON.stringify(R))}catch(e){console.warn("Failed to save PoR history:",e)}}function Un(e,t){if(!e||e<=0)return;const n=Date.now();if(R.find(r=>n-r.timestamp<600*1e3))return;R.push({timestamp:n,cfs:e,stage:t||null});const a=n-Ae;Se(R.filter(r=>r.timestamp>a)),Mt(),console.log(`📊 Recorded PoR: ${e} cfs, history has ${R.length} entries`)}function jn(){try{const e=localStorage.getItem(xt);if(e){let t=JSON.parse(e);const n=Date.now()-ze;t=t.filter(o=>o.timestamp>n),Pe(t),console.log(`📈 Loaded ${Z.length} GF history entries from localStorage`)}}catch(e){console.warn("Failed to load GF history:",e),Pe([])}Vn()}async function Vn(){try{const e=await fetch(de+"?endpoint=gf-history");if(!e.ok)return;const n=(await e.json()).readings||[];if(n.length===0)return;const o=Date.now()-ze,a=300*1e3,r=n.filter(s=>s.timestamp>o);let i=0;for(const s of r)Z.some(l=>Math.abs(l.timestamp-s.timestamp)<a)||(Z.push({timestamp:s.timestamp,cfs:s.cfs,stage:s.stage}),i++);i>0&&(Z.sort((s,c)=>s.timestamp-c.timestamp),Pe(Z.filter(s=>s.timestamp>o)),Dt(),console.log(`📈 Merged ${i} server GF history entries, total: ${Z.length}`),m&&We&&We(m))}catch(e){console.warn("Failed to fetch server GF history (non-fatal):",e)}}function Dt(){try{localStorage.setItem(xt,JSON.stringify(Z))}catch(e){console.warn("Failed to save GF history:",e)}}function zn(e,t){if(!e||e<=0)return;const n=Date.now();if(Z.find(r=>n-r.timestamp<600*1e3))return;Z.push({timestamp:n,cfs:e,stage:t||null});const a=n-ze;Pe(Z.filter(r=>r.timestamp>a)),Dt(),console.log(`📈 Recorded GF estimate: ${e} cfs, history has ${Z.length} entries`)}function dt(e,t=null){let n=an*e;if(t&&t.flowState==="rising"&&t.ratePerHour>0){const o=Math.min(.3,t.ratePerHour*.02),a=n*(1-o);return console.log(`⚡ Wave celerity: ${n.toFixed(1)}h → ${a.toFixed(1)}h (${(o*100).toFixed(0)}% faster, +${t.ratePerHour.toFixed(1)}%/hr rise)`),a}return n}function Jn(e,t=null){let n=kt*e;if(t&&t.flowState==="rising"&&t.ratePerHour>0){const o=Math.min(.3,t.ratePerHour*.02);return n*(1-o)}return n}function Gt(){const e=h["01638500"],t=h["01646500"],n=X.current;return!!(e?.iceAffected||t?.iceAffected||!n)}function Qn(e,t){if(!U?.correctionBins)return 0;const n=U.correctionBins[e];if(!n)return 0;const o=n[t]||n.steady;return!o||o.count<5?0:o.emaMeanError!==void 0?o.emaMeanError:o.meanError||0}function Kn(e,t){const n=Zt[e];if(!n)return null;const o=n[t]||n.all;let a=null,r=0;if(U?.correctionBins){const i=U.correctionBins[e];if(i){const s=i[t]||i.steady;if(s&&s.count>=5){const c=s.meanError||0,l=s.sumErrorSq/s.count-c*c;a=Math.sqrt(Math.max(0,l)),r=s.count}}}return{q05:o.q05,q95:o.q95,stdDev:a,count:r}}function Yn(e){if(R.length===0)return console.log(`📊 getPoRFromHoursAgo(${e.toFixed(1)}h): No history available`),null;const t=Date.now()-e*60*60*1e3;let n=null,o=1/0;for(const c of R){const l=Math.abs(c.timestamp-t);l<o&&(o=l,n=c)}if(n&&o<3600*1e3)return{cfs:n.cfs,stage:n.stage,actualHoursAgo:(Date.now()-n.timestamp)/(3600*1e3),timestamp:n.timestamp};const a=R[0],r=R[R.length-1],i=(Date.now()-a.timestamp)/(3600*1e3),s=(Date.now()-r.timestamp)/(3600*1e3);return console.log(`📊 getPoRFromHoursAgo(${e.toFixed(1)}h): History spans ${s.toFixed(1)}h to ${i.toFixed(1)}h ago (${R.length} entries)`),null}function Xe(){if(R.length<4)return null;const t=Date.now()-7200*1e3;let n=null;for(const w of R)w.timestamp<=t&&(n=w);if(!n)return null;const o=R[R.length-1],a=o.cfs,r=n.cfs,i=a-r,s=i/r*100,c=(o.timestamp-n.timestamp)/(3600*1e3),l=s/c,d=Math.abs(i),g=Math.max(100,a*.02);let f="steady";return d>=g&&(f=i>0?"rising":"falling"),{ratePerHour:l,ratePercent:s,changeCFS:i,flowState:f,currentCFS:a,pastCFS:r,hoursDiff:c}}function Xn(e,t){if(!e)return"steady";const n=(e.rate||0)*100,o=Math.abs(n*(t||5e3)/100),i=Math.max(100,(t||5e3)*2/100);if(o>=i){if(n>0)return"rising";if(n<0)return"falling"}return"steady"}function Zn(){const e=h["01638500"],t=h["01643000"],n=h["01644000"],o=h["01644280"],a=h["01645000"],r=h[H.id];if(!r?.q||!e?.q&&!e?.iceAffected)return null;if(e?.iceAffected||r?.iceAffected){const k=$e();if(k&&k.cfs>0){const O=te(k.cfs);return console.log(`🧊❄️ PoR ice-affected → using EF-only estimate: ${k.cfs} cfs (${O.toFixed(2)} ft)`),{cfs:k.cfs,stage:O,flowState:Te()||"steady",confidence:"low",useTimeShifted:!1,timeShiftedHoursAgo:null,useEfEnsemble:!1,efOnly:!0,forecastCFS:k.cfs,forecastStage:O,inputs:{porCFS:null,porEstimateCFS:null,historicPorCFS:null,monocacyCFS:null,monocacyActual:!1,gooseCFS:null,gooseActual:!1,travelPoRtoGF:null,travelGFtoLF:null,correction:0,flowBin:null,waveCelerity:null},uncertaintyRange:null,efEstimate:k,validationCountdown:null}}return console.log("🧊 GF prediction skipped: critical gauge ice-affected, no EF data"),null}Un(e.q,e.h);let i=h._mult?.mult||1;const s=Xe(),c=t?.q||r.q*.071,l=n?.q||r.q*sn,d=o?.q||r.q*.0066,g=a?.q||r.q*.0087;let f=dt(i,s),w=null,y,v=!1,u=null;for(let k=0;k<3;k++){const O=f,q=Yn(O);if(!q)break;w=q;const N=Qe(w.cfs).mult,oe=dt(N,s);if(Math.abs(oe-f)<1){console.log(`📊 Travel time converged in ${k+1} iterations: ${f.toFixed(1)}h`);break}console.log(`📊 Iteration ${k+1}: ${O.toFixed(1)}h ago → ${w.cfs} cfs → new travel time ${oe.toFixed(1)}h`),f=oe,i=N}const b=Jn(i,s);let I=null;if(w){y=w.cfs+c+l+d+g,v=!0,u=w.actualHoursAgo;const k=e.q,O=w.cfs,q=k/O,N=(q-1)*100;if(Math.abs(N)>5){const oe=Math.min(1,(u||0)/Math.max(1,f)),re=Math.min(.5,Math.sqrt(oe)),p=1+(q-1)*re,ae=y;y=Math.round(y*p),I={rawRatio:q,appliedRatio:p,decayFactor:re,rawEstimate:ae,correctedCFS:y,porNow:k,porThen:O},console.log(`📊 PoR-delta correction: PoR changed ${N>0?"+":""}${N.toFixed(1)}% since time-shifted reading. Decay factor: ${(re*100).toFixed(0)}%. Estimate: ${ae} → ${y} cfs`)}}else y=e.q+c+l+d+g;const E=s&&s.flowState?s.flowState:Xn(e.trend,e.q);s&&s.flowState?console.log(`📊 Flow state: ${E} (observed, ${s.changeCFS>0?"+":""}${Math.round(s.changeCFS)} cfs over ${s.hoursDiff.toFixed(1)}h)`):console.log(`📊 Flow state: ${E} (NWS fallback, porHistory has ${R.length} entries)`);const T=dn(y),G=Qn(T,E),C=Kn(T,E),x=y-G,$=$e();let _=!1,J=null;if($&&$.cfs>0){const k=Rt(x),O=Math.abs($.cfs-x)/x;if(O>.5)console.log(`⚠️ Skipping EF ensemble: ${Math.round(O*100)}% discrepancy (EF: ${$.cfs} vs PoR: ${Math.round(x)})`),y=x;else{const q=1-k;y=Math.round(q*x+k*$.cfs),_=!0,J=k,console.log(`🔀 Ensemble: ${(q*100).toFixed(0)}% PoR (${Math.round(x)}) + ${(k*100).toFixed(0)}% EF (${$.cfs}) = ${y} cfs`)}}else y=x;let fe=!1;const F=1.2;if(r?.q>0){const k=r.q*F;y>k&&(console.log(`🔒 LF ceiling: ${Math.round(y)} cfs → ${Math.round(k)} cfs (120% of LF ${Math.round(r.q)})`),y=Math.round(k),fe=!0)}const j=te(y);let B=null;if(C){const k=(C.q95-C.q05)/2,O=Math.max(0,Math.round(y-k)),q=Math.round(y+k);B={lowCFS:O,highCFS:q,lowStage:te(O),highStage:te(q),q05:C.q05,q95:C.q95,stdDevCFS:C.stdDev?Math.round(C.stdDev):null,observations:C.count}}let S="medium";const M=!!(t?.q&&n?.q);M&&v&&(S="high"),M&&!v&&(S="medium"),!M&&!v&&(S="low"),_&&S==="medium"&&(S="high");const P=Te();let Q=null;P&&(Q=P===E||P==="steady"&&E==="steady",!Q&&S==="high"?(S="medium",console.log(`⚠️ EF trend (${P}) disagrees with GF estimate (${E})`)):Q&&S==="medium"&&M&&(S="high"));const K=e.q+c+l+d+g;return{cfs:Math.round(y),stage:j,flowState:E,confidence:S,useTimeShifted:v,timeShiftedHoursAgo:u,useEfEnsemble:_,efWeight:J,forecastCFS:Math.round(K),forecastStage:te(K),inputs:{porCFS:Math.round(e.q),porEstimateCFS:Math.round(x),historicPorCFS:w?Math.round(w.cfs):null,monocacyCFS:Math.round(c),monocacyActual:!!t?.q,gooseCFS:Math.round(l),gooseActual:!!n?.q,broadRunCFS:Math.round(d),broadRunActual:!!o?.q,senecaCFS:Math.round(g),senecaActual:!!a?.q,travelPoRtoGF:f,travelGFtoLF:b,correction:G,flowBin:T,waveCelerity:s?{applied:s.flowState==="rising"&&s.ratePerHour>0,ratePerHour:s.ratePerHour,reductionPct:s.flowState==="rising"?Math.min(30,s.ratePerHour*2):0}:null,porDeltaCorrection:I,ceilingApplied:fe},uncertaintyRange:B,efEstimate:$,validationCountdown:b}}async function eo(){const e=`https://waterservices.usgs.gov/nwis/iv/?sites=${Xt.id}&parameterCd=00065&period=P1D&format=json`;try{const t=await ve(e,5e3);if(!t.ok)return;const n=await t.json();if(!n?.value?.timeSeries?.[0]?.values?.[0]?.value)return;const o=n.value.timeSeries[0].values[0].value;if(!o.length)return;const a=o[o.length-1],r=parseFloat(a.value),i=new Date(a.dateTime).getTime();if(r>0&&r<100){X.current={stage:r,timestamp:i};const s=X.history[X.history.length-1];(!s||s.timestamp!==i)&&(X.history.push({stage:r,timestamp:i}),X.history.length>ot&&(X.history=X.history.slice(-ot))),console.log(`📍 Edwards Ferry: ${r.toFixed(2)} ft`)}}catch(t){console.warn("Edwards Ferry fetch failed:",t)}}async function to(){const e="https://waterservices.usgs.gov/nwis/iv/?sites=01638500&parameterCd=00010&period=P1D&format=json";try{const t=await ve(e,5e3);if(!t.ok)return;const n=await t.json();if(!n?.value?.timeSeries?.[0]?.values?.[0]?.value?.length)return;const o=n.value.timeSeries[0].values[0].value,a=o[o.length-1],r=parseFloat(a.value);if(r>=-5&&r<=40){pn(r);const i=r<=W.coldMaxTemp;console.log(`🌡️ Water temp: ${r.toFixed(1)}°C (${(r*9/5+32).toFixed(0)}°F) — using ${i?"COLD":"default"} EF model`)}}catch(t){console.warn("Water temp fetch failed:",t)}}function Te(){const e=X.history;if(e.length<4)return null;const t=e[e.length-1].stage,n=e[Math.max(0,e.length-5)].stage,a=(t-n)/n*100;return a>2?"rising":a<-2?"falling":"steady"}function $e(){const e=X;if(!e.current?.stage)return null;const t=e.current.stage;if(t<W.minStage||t>W.maxStage)return null;let n,o,a;se!==null&&se<=W.coldMaxTemp?(n=W.coldCoef,o=W.coldExp,a="cold"):(n=W.coef,o=W.exp,a=se!==null?"default":"default-no-temp");let r=n*Math.pow(t,o);const i=Te(),s=Re[i]||{multiplier:1,count:0},c=s.multiplier;return r*=c,r<500||r>5e5?null:{cfs:Math.round(r),stage:t,model:"power-law",modelType:a,waterTempC:se,coef:n,exp:o,rSquared:W.rSquared,medianErrorPct:W.medianErrorPct,efTrend:i,hysteresisMultiplier:c,hysteresisCount:s.count,correlationCount:16971}}function no(){try{const e=localStorage.getItem("potomac_ef_hysteresis");if(e){const t=JSON.parse(e);for(const n of["rising","falling","steady"])t[n]&&(Re[n]={...Re[n],...t[n]});console.log("📊 EF hysteresis loaded:",Re)}}catch(e){console.warn("Failed to load EF hysteresis:",e)}}function oo(e){if(!e||e<=0)return null;const t=h[H.id];if(!t?.q)return null;const n=ne.lfFeedback,o=t.q;if(n.lastPredictedLF!==null&&n.lastPredictionTime!==null){const r=(Date.now()-n.lastPredictionTime)/36e5;if(r>=4&&r<=12){const i=(o-n.lastPredictedLF)/n.lastPredictedLF,s=Math.max(-.3,Math.min(.3,i));n.correctionFactor=n.alpha*s+(1-n.alpha)*n.correctionFactor,n.lastPredictedLF=null,n.lastPredictionTime=null,console.log(`🏇 LF Feedback: discrepancy=${(s*100).toFixed(1)}%, correction=${(n.correctionFactor*100).toFixed(1)}%`)}}const a=Math.round(e*(1+n.correctionFactor));return n.lastPredictedLF===null&&(n.lastPredictedLF=a,n.lastPredictionTime=Date.now()),a<=0?null:{cfs:a,stage:te(a)}}function ao(e){if(!e||e<=0)return null;const t=h[H.id];if(!t?.q)return null;const n=h["01638500"];if(!n?.q)return null;const o=ne.onlineRegression;o.weights||(o.weights=new Array(o.nFeatures).fill(0),o.weights[0]=0,o.weights[1]=1,o.weights[2]=0,o.weights[3]=0,o.weights[4]=0,o.weights[5]=0,o.weights[6]=0,o.weights[7]=0,o.weights[8]=0);const a=n.q,r=Xe(),i=r?r.ratePerHour/10:0,s=$e(),c=s?s.cfs/1e4:0,l=h["01643000"],d=h["01644000"],g=h["01644280"],f=h["01645000"],w=((l?.q||0)+(d?.q||0)+(g?.q||0)+(f?.q||0))/1e3,y=t.q/1e4,v=new Date().getHours()+new Date().getMinutes()/60,u=Math.sin(2*Math.PI*v/24),b=Math.cos(2*Math.PI*v/24),I=(e-t.q)/Math.max(1,t.q),E=[1,a/1e4,i,c,w,y,u,b,I];let T=0;for(let _=0;_<o.nFeatures;_++)T+=o.weights[_]*E[_];T*=1e4;const G=t.q/1e4,C=T/1e4,x=G-C;if(Math.abs(x)>.001){const _=o.learningRate/(1+o.trainCount*1e-4);for(let J=0;J<o.nFeatures;J++)o.weights[J]+=_*x*E[J];o.trainCount++}const $=Math.round(Math.max(0,T));return $<=0?null:{cfs:$,stage:te($)}}function so(e){if(!e||e<=0)return null;const t=h[H.id];if(!t?.q)return null;const n=ne.kalman;n.initialized||(n.x=e,n.P=(e*.1)**2,n.initialized=!0,console.log(`🏇 Kalman: initialized at ${e} cfs, P=${n.P.toFixed(0)}`));const o=n.x,a=e-o,r=o+.7*a,i=Xe(),c=i&&i.flowState==="rising"?4:1,l=n.Q_base*r**2*c;let d=n.P+l,g=r,f=d;const w=t.q,y=(w*.02)**2;let v=f/(f+y);g=g+v*(w-g),f=(1-v)*f;const u=h["01638500"];if(u?.q){const T=u.q/.835,G=(T*.05)**2;v=f/(f+G),g=g+v*(T-g),f=(1-v)*f}const b=$e();if(b&&b.cfs>0){const E=(b.cfs*.1)**2;v=f/(f+E),g=g+v*(b.cfs-g),f=(1-v)*f}n.x=g,n.P=f;const I=Math.round(Math.max(0,g));return I<=0?null:{cfs:I,stage:te(I)}}function ro(){try{const e=localStorage.getItem(Je);if(e){const t=JSON.parse(e);t.lfFeedback&&Object.assign(ne.lfFeedback,t.lfFeedback),t.onlineRegression&&Object.assign(ne.onlineRegression,t.onlineRegression),t.kalman&&Object.assign(ne.kalman,t.kalman),console.log("🏇 Shadow model state loaded from localStorage")}}catch(e){console.warn("Failed to load shadow model state:",e)}}function io(){try{localStorage.setItem(Je,JSON.stringify(ne))}catch(e){console.warn("Failed to save shadow model state:",e)}}function co(e){if(!e?.cfs)return;const t=e.cfs;try{const n=performance.now();try{const a=oo(t);A.lfFeedback.cfs=a?.cfs||null,A.lfFeedback.stage=a?.stage||null}catch(a){console.warn("🏇 LF Feedback failed:",a),A.lfFeedback.cfs=null}try{const a=ao(t);A.onlineRegression.cfs=a?.cfs||null,A.onlineRegression.stage=a?.stage||null}catch(a){console.warn("🏇 Online Regression failed:",a),A.onlineRegression.cfs=null}try{const a=so(t);A.kalman.cfs=a?.cfs||null,A.kalman.stage=a?.stage||null}catch(a){console.warn("🏇 Kalman failed:",a),A.kalman.cfs=null}const o=performance.now()-n;console.log(`🏇 Shadow models: LF=${A.lfFeedback.cfs}, Reg=${A.onlineRegression.cfs}, Kal=${A.kalman.cfs} (${o.toFixed(1)}ms)`),io()}catch(n){console.error("🏇 Shadow models wrapper failed:",n)}}let Ee=null,Ce=null,Ue=null;function lo(e){Ee=e}function fo(e){Ce=e}function uo(e){Ue=e}async function Ze(){const e={correctionBins:{},pendingPredictions:[],metadata:{totalValidations:0,totalPredictions:0,avgErrorPercent:null},efCorrelation:null};try{const t=await fetch(de+"?endpoint=gf");t.ok?(Me(await t.json()),console.log("🌊 GF learning data loaded:",U.metadata),U.efCorrelation?.slope&&(X.correlation=U.efCorrelation,console.log(`📍 EF correlation loaded: CFS = ${U.efCorrelation.slope.toFixed(0)} × stage + ${U.efCorrelation.intercept.toFixed(0)}`))):(console.warn("GF learning API returned:",t.status),Me(e))}catch(t){console.warn("Failed to load GF learning data:",t),Me(e)}vn(!0)}async function go(e){if(Gt()){console.log("🧊 Prediction storage skipped: critical gauge ice-affected");return}const t=Date.now();if(t-Lt<rn){mo();return}if(!e?.cfs)return;const n=e.inputs.flowBin,o=cn/(3600*1e3),a=Math.max(e.validationCountdown,o),r=new Date(t+a*60*60*1e3).toISOString(),i=X.current?.stage||null,s=Te(),c={timestamp:new Date().toISOString(),predictedCFS:e.cfs,porCFS:e.inputs.historicPorCFS||e.inputs.porCFS,monocacyCFS:e.inputs.monocacyCFS,gooseCFS:e.inputs.gooseCFS,flowBin:n,flowState:e.flowState,travelTimeGFtoLF:a,validationDue:r,efStage:i,efTrend:s,shadowModels:{lfFeedback:A.lfFeedback.cfs,onlineRegression:A.onlineRegression.cfs,kalman:A.kalman.cfs}};await Nt(c)?(wn(t),console.log("🌊 GF prediction stored for validation")):me.length<5&&(me.push({data:c,retries:0}),console.warn("🌊 GF prediction queued for retry"))}async function Nt(e){try{return(await fetch(de+"?endpoint=gf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"storePrediction",prediction:e})})).ok}catch(t){return console.warn("Failed to store GF prediction:",t),!1}}async function mo(){if(me.length===0)return;const e=me[0];await Nt(e.data)?(me.shift(),console.log("🌊 GF prediction retry succeeded")):(e.retries++,e.retries>=3&&(me.shift(),console.warn("🌊 GF prediction retry failed, giving up")))}async function ho(e){if(Gt()){console.log("🧊 Forecast storage skipped: critical gauge ice-affected");return}const t=Date.now();if(t-Pt<ln)return;const n=e.filter(o=>!o.isCurrent&&o.isDisplayPeriod&&o.source&&o.source.startsWith("NWS"));if(n.length===0){console.log("📈 Forecast storage skipped: no NWS-based forecasts");return}try{(await fetch(de+"?endpoint=gf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"storeForecastPredictions",forecasts:n.map(a=>({horizon:parseInt(a.label.replace("+","").replace("h","")),targetTime:a.time.toISOString(),predictedCFS:a.cfs,predictedStage:a.stage,source:a.source,createdAt:new Date().toISOString(),nwsLfRawCFS:a.nwsLfRawCFS||null,nwsLfBiasCorrectedCFS:a.nwsLfBiasCorrectedCFS||null,persistenceCFS:a.persistenceCFS||null}))})})).ok&&(bn(t),console.log(`📈 Stored ${n.length} forecast predictions for accuracy tracking`))}catch(o){console.warn("Failed to store forecast predictions:",o)}}async function po(){try{const e=await fetch(de+"?endpoint=forecast-accuracy");e.ok&&(Fn(await e.json()),Ue&&Ue())}catch(e){console.warn("Failed to load forecast accuracy:",e)}}async function yo(){}async function vo(){if(!confirm(`Reset all GF flow-bin corrections?

This clears System 2 (server-side) learning.
Gauge corrections (System 1) will be preserved.

This cannot be undone.`))return;const e=prompt("Enter admin PIN to confirm reset:");if(e)try{const n=await(await fetch("/.netlify/functions/sync-learning?endpoint=gf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resetGFLearning",pin:e})})).json();n.success?(alert(`GF learning data reset.

Flow-bin corrections cleared.
New observations will start accumulating with proper flow state classification.`),await Ze(),Ee&&Ee(),Ce&&Ce()):alert("Reset failed: "+(n.error||"Unknown error"))}catch(t){console.error("Reset error:",t),alert("Reset failed: "+t.message)}}async function wo(){if(!confirm(`Reset low-flow bins AND accuracy stats?

This clears:
• 0-3k and 3k-6k cfs correction bins
• Validation count and accuracy %

Higher flow bins (6k+) preserved.
Accuracy will rebuild from fresh validations.

Use this after winter ice conditions.`))return;const e=prompt("Enter admin PIN to confirm reset:");if(e)try{const n=await(await fetch("/.netlify/functions/sync-learning?endpoint=gf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resetLowFlowBins",pin:e})})).json();n.success?(alert(`Ice cleanup complete!

Cleared:
• ${n.deletedCount} low-flow bins (0-3k, 3k-6k cfs)
• Validation count and accuracy metrics

Higher flow bins preserved.
Accuracy will rebuild from fresh validations.

v24 anomaly detection will prevent future contamination.`),await Ze(),Ee&&Ee(),Ce&&Ce()):alert("Reset failed: "+(n.error||"Unknown error"))}catch(t){console.error("Reset error:",t),alert("Reset failed: "+t.message)}}function ft(e){const t=e.getHours(),n=t>=12?"pm":"am",o=t%12||12;return`${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][e.getDay()]} ${o}${n}`}function bo(){return Tt}function Fo(){return $t}function So(e,t,n,o=[]){const a=document.getElementById("gf-forecast-graph");if(!a)return;const i=a.parentElement.clientWidth-20,s=120,c={top:15,right:10,bottom:25,left:35},l=i-c.left-c.right,d=s-c.top-c.bottom,g=-24,f=48,w=f-g,y=new Date,v=[];for(const p of o)v.push({hrs:p.hrs,time:p.time,cfs:p.cfs,stage:p.stage,isHistory:!0});const u=e.map(p=>({hrs:p.isCurrent?0:parseInt(p.label.replace("+","").replace("h","")),cfs:p.cfs,stage:p.stage}));for(let p=0;p<=48;p+=2){const ae=new Date(y.getTime()+p*60*60*1e3),z=u.filter(ie=>ie.hrs<=p).pop(),V=u.find(ie=>ie.hrs>=p);let Y,ue;if(z&&V&&z!==V){const ie=(p-z.hrs)/(V.hrs-z.hrs);Y=z.cfs+ie*(V.cfs-z.cfs),ue=z.stage+ie*(V.stage-z.stage)}else z?(Y=z.cfs,ue=z.stage):V?(Y=V.cfs,ue=V.stage):(Y=t,ue=te(Y));v.push({hrs:p,time:ae,cfs:Math.round(Y),stage:ue,isHistory:!1})}Sn(v);const b=v.map(p=>p.stage),I=Math.floor(Math.min(...b)*2)/2-.5,E=Math.ceil(Math.max(...b)*2)/2+.5,T=E-I||1,G=c.top+d,C=p=>c.left+(p-g)/w*l,x=p=>c.top+(1-(p-I)/T)*d;En({xScale:C,yScale:x,padding:c,graphHeight:d});const $=v.filter(p=>p.isHistory),_=v.filter(p=>!p.isHistory),J=_.map(p=>`${C(p.hrs)},${x(p.stage)}`),fe=J.length>0?`M ${J.join(" L ")}`:"";let F="";_.length>0&&(F=`M ${C(0)},${x(_[0].stage)} L ${J.join(" L ")} L ${C(48)},${G} L ${C(0)},${G} Z`);let j="",B="",S="";{const p=$.map(V=>`${C(V.hrs)},${x(V.stage)}`);j=`M ${p.join(" L ")}`;const ae=$[0].hrs,z=$[$.length-1].hrs;B=`M ${C(ae)},${x($[0].stage)} L ${p.join(" L ")} L ${C(z)},${G} L ${C(ae)},${G} Z`,S=$.map(V=>`<circle cx="${C(V.hrs)}" cy="${x(V.stage)}" r="2" fill="#60a5fa" opacity="0.7"/>`).join("")}const M=[],P=T>3?1:.5;for(let p=Math.ceil(I/P)*P;p<=E;p+=P)M.push(p);const Q=l<280;let K;K=Q?[{hrs:-12,label:"-12h"},{hrs:0,label:"Now"},{hrs:12,label:"+12h"},{hrs:24,label:"+24h"},{hrs:48,label:"+48h"}]:[{hrs:-24,label:"-24h"},{hrs:-12,label:"-12h"},{hrs:0,label:"Now"},{hrs:12,label:"+12h"},{hrs:24,label:"+24h"},{hrs:36,label:"+36h"},{hrs:48,label:"+48h"}];const k=K.map(p=>p.hrs);let O="";{const p=C(0);O=`
            <line x1="${p}" y1="${c.top}" x2="${p}" y2="${G}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>
        `}a.setAttribute("width",i),a.setAttribute("height",s),a.innerHTML=`
        <!-- Gradient definitions -->
        <defs>
            <linearGradient id="graphGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#4ade80" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="histGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/>
            </linearGradient>
        </defs>

        <!-- Grid lines -->
        ${M.map(p=>`<line x1="${c.left}" y1="${x(p)}" x2="${i-c.right}" y2="${x(p)}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join("")}
        ${k.map(p=>`<line x1="${C(p)}" y1="${c.top}" x2="${C(p)}" y2="${G}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join("")}

        <!-- History area fill (dimmer blue) -->
        ${B?`<path d="${B}" fill="url(#histGradient)" opacity="0.3"/>`:""}

        <!-- Forecast area fill (green) -->
        ${F?`<path d="${F}" fill="url(#graphGradient)" opacity="0.3"/>`:""}

        <!-- History line (solid blue) -->
        ${j?`<path d="${j}" fill="none" stroke="#60a5fa" stroke-width="2"/>`:""}

        <!-- History data dots -->
        ${S}

        <!-- Forecast line (green) -->
        ${fe?`<path d="${fe}" fill="none" stroke="#4ade80" stroke-width="2"/>`:""}

        <!-- NOW divider line -->
        ${O}

        <!-- Current point marker (at junction of history and forecast) -->
        ${_.length>0?`<circle cx="${C(0)}" cy="${x(_[0].stage)}" r="4" fill="#4ade80" stroke="#0f172a" stroke-width="2"/>`:""}

        <!-- Y-axis labels -->
        ${M.map(p=>`<text x="${c.left-5}" y="${x(p)+3}" fill="#94a3b8" font-size="9" text-anchor="end">${p.toFixed(2)}</text>`).join("")}

        <!-- X-axis labels -->
        ${K.map(p=>`<text x="${C(p.hrs)}" y="${s-5}" fill="${p.hrs===0?"#f59e0b":"#94a3b8"}" font-size="9" text-anchor="middle" font-weight="${p.hrs===0?"600":"normal"}">${p.label}</text>`).join("")}

        <!-- Y-axis title -->
        <text x="10" y="${c.top+d/2}" fill="#4ade80" font-size="9" text-anchor="middle" transform="rotate(-90, 10, ${c.top+d/2})">ft</text>

        <!-- Invisible hover area -->
        <rect id="gf-graph-hover" x="${c.left}" y="${c.top}" width="${l}" height="${d}" fill="transparent"/>

        <!-- Selected period marker (hidden by default) -->
        <g id="gf-graph-marker" style="display:none;">
            <line id="gf-marker-line" x1="0" y1="${c.top}" x2="0" y2="${G}" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4,2"/>
            <circle id="gf-marker-dot" cx="0" cy="0" r="6" fill="#60a5fa" stroke="#0f172a" stroke-width="2"/>
        </g>
    `;const q=document.getElementById("gf-graph-hover"),N=document.getElementById("gf-graph-tooltip");function oe(p){const ae=a.getBoundingClientRect(),z=(p.touches?p.touches[0].clientX:p.clientX)-ae.left,V=Math.max(g,Math.min(f,(z-c.left)/l*w+g)),Y=v.reduce((tt,nt)=>Math.abs(nt.hrs-V)<Math.abs(tt.hrs-V)?nt:tt),ue=Y.isHistory?`${ft(Y.time)} (observed)`:ft(Y.time);document.getElementById("gf-tooltip-time").textContent=ue,document.getElementById("gf-tooltip-stage").textContent=Y.stage.toFixed(2),document.getElementById("gf-tooltip-cfs").textContent=Y.cfs.toLocaleString();const ie=Math.min(i-100,Math.max(10,C(Y.hrs)-40)),Qt=Math.max(5,x(Y.stage)-55);N.style.left=ie+"px",N.style.top=Qt+"px",N.style.display="block"}function re(){N.style.display="none"}q.onmousemove=oe,q.ontouchmove=oe,q.onmouseleave=re,q.ontouchend=re}function ut(){if(!U?.metadata)return;const e=U.metadata,t=document.getElementById("gf-val-last"),n=document.getElementById("learn-val-last"),o=U.pendingPredictions?.length||0;let a="";if(o>0&&(a+=o+" pending | "),e.totalValidations>0){const r=e.avgErrorPercent?e.avgErrorPercent.toFixed(1):"--",i=e.lastValidation?new Date(e.lastValidation).toLocaleString():"--";a+=e.totalValidations+" validated | Avg err: "+r+"% | Last: "+i}else a+="No validations yet - collecting data";t&&(t.textContent=a),n&&(n.textContent=a),Eo(e,o),Be()}function Eo(e,t){const n=document.getElementById("healthLastRun"),o=document.getElementById("healthConsecutive"),a=document.getElementById("healthMissed"),r=document.getElementById("healthPending"),i=document.getElementById("healthExplain");if(!n)return;if(e.lastPrediction){const d=new Date(e.lastPrediction),g=((Date.now()-d)/(3600*1e3)).toFixed(1);n.textContent=`${g}h ago`,n.style.color=g<=3?"#4ade80":g<=6?"#fbbf24":"#ef4444"}else n.textContent="Never",n.style.color="#ef4444";const s=e.consecutiveRuns||0;o.textContent=s,o.style.color=s>=10?"#4ade80":s>=3?"#fbbf24":"#ef4444";const c=e.missedRuns||0;a.textContent=c,a.style.color=c===0?"#4ade80":c<=5?"#fbbf24":"#ef4444",r.textContent=t,r.style.color=t<=1?"#4ade80":t<=3?"#fbbf24":"#ef4444";let l="";s>=10?l="✅ Scheduled function running reliably (every 2h)":s>=3?l="⚠️ Function running but had recent gaps":s===0?l="❌ Function may not be running - check Netlify logs":l="ℹ️ Monitoring function execution...",i.textContent=l}function Be(){const e=document.getElementById("gfBinStats");if(!e)return;if(e.textContent="",!U?.correctionBins){const s=document.createElement("p");s.style.color="#64748b",s.textContent="No bin data available",e.appendChild(s);return}const t=U.correctionBins,n=document.createElement("table");n.style.width="100%",n.style.fontSize="0.5rem";const o=document.createElement("tr");["Flow Bin","Rising","Steady","Falling"].forEach(s=>{const c=document.createElement("th");c.textContent=s,o.appendChild(c)}),n.appendChild(o);const a=["0-3000","3000-6000","6000-12000","12000-25000","25000-50000","50000+"],r=s=>s>=5?"#4ade80":s>0?"#fbbf24":"#64748b";for(const s of a){const c=t[s]||{},l=c.rising?.count||0,d=c.steady?.count||0,g=c.falling?.count||0,f=document.createElement("tr"),w=document.createElement("td");w.textContent=s,f.appendChild(w),[l,d,g].forEach(y=>{const v=document.createElement("td");v.textContent=y,v.style.color=r(y),f.appendChild(v)}),n.appendChild(f)}e.appendChild(n);const i=U.metadata||{};if(i.resetAt){const s=document.createElement("p");s.style.marginTop="8px",s.style.color="#a78bfa",s.textContent="Reset: "+new Date(i.resetAt).toLocaleDateString()+" ("+(i.resetReason||"manual")+")",e.appendChild(s)}}function Co(){kn(!Le);const e=document.getElementById("learnBtn");e&&e.classList.toggle("active",Le)}function xo(){const e=h["01646500"],t=h["01638500"],n=h["01643000"],o=h["01644000"],a=X.current;if(!document.getElementById("dash-lf-cfs"))return;if(document.getElementById("dash-lf-cfs").textContent=e?.q?Math.round(e.q).toLocaleString():"--",document.getElementById("dash-lf-stage").textContent=e?.h?`${e.h.toFixed(2)} ft`:"-- ft",m?(document.getElementById("dash-gf-cfs").textContent=m.cfs.toLocaleString(),document.getElementById("dash-gf-stage").textContent=`${m.stage.toFixed(2)} ft`):(document.getElementById("dash-gf-cfs").textContent="--",document.getElementById("dash-gf-cfs").style.color=t?.iceAffected?"#60a5fa":"#4ade80",document.getElementById("dash-gf-stage").textContent=t?.iceAffected?"❄️ ice":"-- ft"),document.getElementById("dash-por-cfs").textContent=t?.q?Math.round(t.q).toLocaleString():"--",t?.iceAffected){document.getElementById("dash-por-cfs").style.color="#60a5fa";const s=t.lastValidTime?((Date.now()-t.lastValidTime)/(1440*60*1e3)).toFixed(1):"?";document.getElementById("dash-por-status").textContent=`❄️ ${s}d old`,document.getElementById("dash-por-status").style.color="#60a5fa"}else document.getElementById("dash-por-cfs").style.color="#60a5fa",document.getElementById("dash-por-status").textContent=t?.trend||"--",document.getElementById("dash-por-status").style.color="#94a3b8";document.getElementById("dash-ef-stage").textContent=a?.stage?`${a.stage.toFixed(2)} ft`:"--",document.getElementById("dash-mono-cfs").textContent=n?.q?Math.round(n.q).toLocaleString():"--",n?.iceAffected&&(document.getElementById("dash-mono-cfs").style.color="#60a5fa"),document.getElementById("dash-goose-cfs").textContent=o?.q?Math.round(o.q).toLocaleString():"--";const r=h._mult;if(document.getElementById("dash-travel").textContent=r?.travelHrs?`~${Math.round(r.travelHrs)}h`:"--",U?.metadata){const s=U.metadata,c=s.validValidations||s.totalValidations-(s.hardFlaggedValidations||s.flaggedValidations||0);document.getElementById("dash-gf-validations").textContent=`${c} valid / ${s.totalValidations||0} total`,document.getElementById("dash-gf-error").textContent=s.avgErrorPercent?`${s.avgErrorPercent.toFixed(0)}%`:"--";const l=s.hardFlaggedValidations||s.flaggedValidations||0,d=s.softFlaggedValidations||0;document.getElementById("dash-flagged").textContent=`${l} hard / ${d} soft`,document.getElementById("dash-runs").textContent=s.consecutiveRuns||"--"}const i=[];for(const[s,c]of Object.entries(h))c?.iceAffected&&ee[s]&&i.push(ee[s].name);i.length>0?(document.getElementById("dash-ice-row").style.display="block",document.getElementById("dash-ice-list").textContent=i.join(", ")):document.getElementById("dash-ice-row").style.display="none",pe&&(document.getElementById("dash-last-fetch").textContent=new Date(pe).toLocaleTimeString())}function Ht(){if(!D)return;xo();const e=Object.keys(D.corrections).length;document.getElementById("learnTotal").textContent=D.totalObs.toLocaleString();const t=new Date(D.startDate),n=Math.floor((Date.now()-t)/864e5);document.getElementById("learnSince").textContent=n>0?`${n} days ago`:"Today",document.getElementById("learnAccuracy").textContent=e===0?"Waiting for rise events...":e<5?`Calibrating (${e} gauges)`:"Model calibrated",document.getElementById("learnGauges").textContent=`${e} / ${Object.keys(ee).length-1}`;const o=document.getElementById("correctionList");o.textContent="";const a=Object.entries(D.corrections);if(a.length===0){const r=document.createElement("p");r.style.color="#64748b",r.style.fontSize="0.6rem",r.textContent="Corrections calculated after detecting rise events at gauges and matching arrivals at Little Falls",o.appendChild(r)}else for(const[r,i]of a){const s=ee[r],l=(D.observations[r]||[]).filter(v=>v.rising).length,d=((i-1)*100).toFixed(1),g=i>=1?"+":"",f=document.createElement("div");f.className="correction-item";const w=document.createElement("span");w.className="gauge-name",w.textContent=s?.name||r;const y=document.createElement("span");y.className="factor",y.textContent=i.toFixed(3)+"× ("+g+d+"%) • "+l+" rises",f.appendChild(w),f.appendChild(y),o.appendChild(f)}et()}function et(){const e=document.getElementById("shadow-prod-cfs");if(!e)return;m?.cfs&&(e.textContent=m.cfs.toLocaleString(),document.getElementById("shadow-prod-stage").textContent=(m.stage||0).toFixed(2)+" ft");const t=m?.cfs||0;function n(i){if(!i||!t)return"--";const s=i-t,c=(s/t*100).toFixed(1),l=s>=0?"+":"";return`${l}${s.toLocaleString()} cfs (${l}${c}%)`}A.lfFeedback.cfs!==null&&(document.getElementById("shadow-lf-cfs").textContent=A.lfFeedback.cfs.toLocaleString(),document.getElementById("shadow-lf-stage").textContent=(A.lfFeedback.stage||0).toFixed(2)+" ft",document.getElementById("shadow-lf-delta").textContent=n(A.lfFeedback.cfs)),A.onlineRegression.cfs!==null&&(document.getElementById("shadow-reg-cfs").textContent=A.onlineRegression.cfs.toLocaleString(),document.getElementById("shadow-reg-stage").textContent=(A.onlineRegression.stage||0).toFixed(2)+" ft",document.getElementById("shadow-reg-delta").textContent=n(A.onlineRegression.cfs)),A.kalman.cfs!==null&&(document.getElementById("shadow-kal-cfs").textContent=A.kalman.cfs.toLocaleString(),document.getElementById("shadow-kal-stage").textContent=(A.kalman.stage||0).toFixed(2)+" ft",document.getElementById("shadow-kal-delta").textContent=n(A.kalman.cfs));const o=ne.lfFeedback;document.getElementById("shadow-diag-lf").textContent=`Correction: ${(o.correctionFactor*100).toFixed(1)}% | α: ${o.alpha} | Pending: ${o.lastPredictedLF?o.lastPredictedLF.toLocaleString()+" cfs":"none"}`;const a=ne.onlineRegression;if(a.weights){const i=a.weights.map(s=>s.toFixed(3)).join(", ");document.getElementById("shadow-diag-reg").textContent=`W: [${i}] | Train: ${a.trainCount} | LR: ${(a.learningRate/(1+a.trainCount*1e-4)).toFixed(6)}`}const r=ne.kalman;r.initialized&&(document.getElementById("shadow-diag-kal").textContent=`State: ${Math.round(r.x).toLocaleString()} cfs | P: ${Math.round(Math.sqrt(r.P)).toLocaleString()} cfs (1σ) | Q_base: ${r.Q_base}`)}function ko(){confirm("Reset all shadow models? Learned state (Kalman covariance, regression weights, LF feedback) will be lost.")&&(un({lfFeedback:{correctionFactor:0,lastPredictedLF:null,lastPredictionTime:null,alpha:.4},onlineRegression:{weights:null,learningRate:.001,nFeatures:9,trainCount:0},kalman:{x:null,P:null,Q_base:1e-4,initialized:!1}}),gn({lfFeedback:{cfs:null,stage:null,label:"LF Feedback"},onlineRegression:{cfs:null,stage:null,label:"Online Regression"},kalman:{cfs:null,stage:null,label:"Kalman Filter"}}),localStorage.removeItem(Je),et(),console.log("🏇 Shadow models reset"))}let je=null;function Ro(e){je=e}function _t(){if(!document.getElementById("gf-cfs"))return;const e=X.current!==null;if(!Ie||!e){document.getElementById("gf-cfs").textContent="...",document.getElementById("gf-stage").textContent="...",document.getElementById("gf-trend").textContent="",document.getElementById("gf-data-source").textContent=Ie?"Loading EF data...":"Loading corrections...",document.getElementById("gf-confidence").textContent="",document.getElementById("gf-ci-range").style.display="none",document.getElementById("gf-forecast-cfs").textContent="--",document.getElementById("gf-forecast-stage").textContent="--",document.getElementById("gf-forecast-hrs").textContent="--";return}if(yn(Zn()),!m){const u=h["01638500"],b=h["01646500"],I=u?.iceAffected||b?.iceAffected;if(document.getElementById("gf-cfs").textContent="--",document.getElementById("gf-stage").textContent="--",I){document.getElementById("gf-estimate-label").textContent="UNAVAILABLE",document.getElementById("gf-estimate-label").style.color="#60a5fa";const E=document.getElementById("gf-trend");E.textContent="❄️ Ice conditions",E.style.color="#60a5fa",document.getElementById("gf-data-source").textContent="Critical gauges ice-affected — estimate suspended"}else document.getElementById("gf-trend").textContent="Waiting for data...",document.getElementById("gf-data-source").textContent="Waiting for data...";document.getElementById("gf-confidence").textContent="Confidence: --",document.getElementById("gf-ci-range").style.display="none",document.getElementById("gf-forecast-cfs").textContent="--",document.getElementById("gf-forecast-stage").textContent="--",document.getElementById("gf-forecast-hrs").textContent="--";return}zn(m.cfs,m.stage),co(m),et(),document.getElementById("gf-cfs").textContent=m.cfs.toLocaleString();const t=document.getElementById("gf-stage");if(t.textContent=m.stage.toFixed(2),m.efOnly){document.getElementById("gf-estimate-label").textContent="❄️ EF-ONLY ESTIMATE",document.getElementById("gf-estimate-label").style.color="#60a5fa",document.getElementById("gf-data-source").textContent="PoR ice-affected — using Edwards Ferry model (R²="+W.rSquared+")";const u=document.getElementById("gf-trend"),b=m.flowState==="rising"?"▲":m.flowState==="falling"?"▼":"●";u.textContent=b+" "+m.flowState.toUpperCase()+" (EF trend)",u.style.color="#60a5fa",document.getElementById("gf-confidence").textContent="Confidence: LOW (EF only)",document.getElementById("gf-forecast-cfs").textContent="--",document.getElementById("gf-forecast-stage").textContent="--",document.getElementById("gf-forecast-hrs").textContent="--",document.getElementById("gf-input-por").textContent="❄️ ice-affected",document.getElementById("gf-input-monocacy").textContent="N/A",document.getElementById("gf-input-goose").textContent="N/A",document.getElementById("gf-input-broadrun").textContent="N/A",document.getElementById("gf-input-seneca").textContent="N/A",document.getElementById("gf-input-travel").textContent="N/A",document.getElementById("gf-input-travel-gf-lf").textContent="N/A",document.getElementById("gf-input-flowbin").textContent="N/A — EF only",document.getElementById("gf-input-correction").textContent="N/A — EF only",document.getElementById("gf-input-uncertainty").textContent="N/A — EF only",document.getElementById("gf-ef-crosscheck").style.display="none",document.getElementById("gf-ci-range").style.display="none";return}if(m.useTimeShifted)if(document.getElementById("gf-estimate-label").textContent="ESTIMATED NOW",document.getElementById("gf-estimate-label").style.color="#4ade80",m.useEfEnsemble&&m.efWeight){const u=Math.round((1-m.efWeight)*100),b=Math.round(m.efWeight*100),I=m.inputs?.porDeltaCorrection,E=I?` [Δ-corrected ${((I.rawRatio-1)*100).toFixed(0)}%]`:"";document.getElementById("gf-data-source").textContent=`${u}% PoR (${m.timeShiftedHoursAgo.toFixed(0)}h ago)${E} + ${b}% EF → LF in ~${m.inputs.travelGFtoLF.toFixed(1)} hrs`}else document.getElementById("gf-data-source").textContent=`PoR from ${m.timeShiftedHoursAgo.toFixed(1)} hrs ago → arrives at LF in ~${m.inputs.travelGFtoLF.toFixed(1)} hrs`;else document.getElementById("gf-estimate-label").textContent="FORECAST (no history yet)",document.getElementById("gf-estimate-label").style.color="#fbbf24",document.getElementById("gf-data-source").textContent=`Using current PoR (need ${m.inputs.travelPoRtoGF.toFixed(0)}+ hrs of history)`;const n={rising:"▲ RISING",falling:"▼ FALLING",steady:"● STEADY"},o={rising:"#ef4444",falling:"#22c55e",steady:"#64748b"},a=document.getElementById("gf-trend");a.textContent=n[m.flowState],a.style.color=o[m.flowState];const r={high:"#4ade80",medium:"#fbbf24",low:"#f87171"},i=document.getElementById("gf-confidence");i.textContent="Confidence: "+m.confidence.toUpperCase(),i.style.color=r[m.confidence],document.getElementById("gf-forecast-cfs").textContent=m.forecastCFS.toLocaleString(),document.getElementById("gf-forecast-stage").textContent=m.forecastStage.toFixed(2),document.getElementById("gf-forecast-hrs").textContent=m.inputs.travelPoRtoGF.toFixed(1),document.getElementById("gf-forecast-arrival").textContent=zt(m.inputs.travelPoRtoGF);const s=document.getElementById("gf-input-por");m.inputs.historicPorCFS?s.textContent=m.inputs.historicPorCFS.toLocaleString()+" cfs ("+m.timeShiftedHoursAgo.toFixed(1)+"h ago)":s.textContent=m.inputs.porCFS.toLocaleString()+" cfs (current)",document.getElementById("gf-input-monocacy").textContent=(m.inputs.monocacyActual?"+ ":"~+ ")+m.inputs.monocacyCFS.toLocaleString()+" cfs",document.getElementById("gf-input-goose").textContent=(m.inputs.gooseActual?"+ ":"~+ ")+m.inputs.gooseCFS.toLocaleString()+" cfs",document.getElementById("gf-input-broadrun").textContent=(m.inputs.broadRunActual?"+ ":"~+ ")+m.inputs.broadRunCFS.toLocaleString()+" cfs",document.getElementById("gf-input-seneca").textContent=(m.inputs.senecaActual?"+ ":"~+ ")+m.inputs.senecaCFS.toLocaleString()+" cfs",document.getElementById("gf-input-travel").textContent=m.inputs.travelPoRtoGF.toFixed(1)+" hrs",document.getElementById("gf-input-travel-gf-lf").textContent=m.inputs.travelGFtoLF.toFixed(1)+" hrs";const l=U?.correctionBins?.[m.inputs.flowBin]?.[m.flowState]?.count||0;document.getElementById("gf-input-flowbin").textContent=m.inputs.flowBin+(l>0?` (${l} obs)`:""),document.getElementById("gf-input-correction").textContent=m.inputs.correction===0?"none yet":(m.inputs.correction>0?"-":"+")+Math.abs(Math.round(m.inputs.correction))+" cfs",m.uncertaintyRange?document.getElementById("gf-input-uncertainty").textContent=`${m.uncertaintyRange.lowCFS.toLocaleString()} – ${m.uncertaintyRange.highCFS.toLocaleString()} cfs`:document.getElementById("gf-input-uncertainty").textContent="--";const d=document.getElementById("gf-ef-crosscheck"),g=document.getElementById("gf-ef-estimate");if(m.efEstimate&&m.efEstimate.correlationCount>=10){const u=m.efEstimate,b=te(u.cfs),I=u.cfs-m.cfs,E=Math.abs(I/m.cfs*100);let T="✓",G="#4ade80";E>15&&(T="⚠",G="#f59e0b"),E>25&&(T="✗",G="#ef4444"),g.textContent=u.cfs.toLocaleString()+" cfs / "+b.toFixed(1)+" ft "+T,g.style.color=G,d.style.display="block"}else d.style.display="none";const f=m.validationCountdown.toFixed(1)+" hrs";document.getElementById("gf-val-countdown").textContent=f;const w=document.getElementById("learn-val-countdown");w&&(w.textContent=f);const y=document.getElementById("gf-popup-cfs"),v=document.getElementById("gf-popup-stage");y&&(y.textContent=m.cfs.toLocaleString()+" cfs"),v&&(v.textContent=m.stage.toFixed(2)+" ft"),Ot(m),Promise.all([go(m),yo()]).catch(u=>console.warn("GF learning error:",u)),je&&je()}function Ot(e){const t=document.getElementById("gf-forecast-periods");if(!t||!e)return;const n=[],o=new Date,a=e.cfs,r=h["01638500"],i=h["01644148"],s=r?.forecast,c=i?.forecast,l=s?.data?.length>0,d=c?.data?.length>0,g=l;n.push({label:"Now",time:o,cfs:a,stage:e.stage,isCurrent:!0,source:"estimate"});const f=[6,12,18,24,30,36,42,48],w=[6,12,24,48];if(g){const u=s.data.map(F=>{const B=(new Date(F.validTime)-o)/(1e3*60*60),S=(F.secondary||0)*1e3;return{hoursAhead:B,cfs:S}}),b=d?c.data.map(F=>({hoursAhead:(new Date(F.validTime)-o)/(1e3*60*60),stage:F.primary})):[],I=(F,j,B="cfs")=>{const S=F.filter(P=>P.hoursAhead<=j).pop(),M=F.find(P=>P.hoursAhead>=j);if(S&&M&&S!==M){const P=(j-S.hoursAhead)/(M.hoursAhead-S.hoursAhead);return S[B]+P*(M[B]-S[B])}return M?M[B]:S?S[B]:null},E=r?.q||a,T=h["01646500"],G=T?.forecast,C=G?.data?.length>0,x=T?.q||a,$=C?G.data.map(F=>{const B=(new Date(F.validTime)-o)/(1e3*60*60),S=(F.secondary||0)*1e3;return{hoursAhead:B,cfs:S,stage:F.primary}}):[];let _=0;if(C&&$.length>0){const F=I($,0)||$[0]?.cfs;F&&x&&(_=x-F,console.log(`LF bias correction: observed=${x.toFixed(0)} cfs, forecast=${F.toFixed(0)} cfs, offset=${_.toFixed(0)} cfs`))}const J=kt*Qe(a).mult,fe=F=>{const j=F+J;let B=null;if(C&&$.length>0){const P=$.filter(K=>K.hoursAhead<=j).pop(),Q=$.find(K=>K.hoursAhead>=j);if(P&&Q&&P!==Q){const K=(j-P.hoursAhead)/(Q.hoursAhead-P.hoursAhead);B=P.cfs+K*(Q.cfs-P.cfs)}else Q?B=Q.cfs:P&&(B=P.cfs)}if(B!==null)return Math.max(0,B+_);const S=u.filter(P=>P.hoursAhead<=F).pop(),M=u.find(P=>P.hoursAhead>=F);if(S&&M&&S!==M){const P=(F-S.hoursAhead)/(M.hoursAhead-S.hoursAhead);return S.cfs+P*(M.cfs-S.cfs)}return M?M.cfs:S?S.cfs:E};console.log(`GF forecast: LF-constrained (GF→LF ~${J.toFixed(1)}h) with additive bias correction`);for(const F of f){const j=new Date(o.getTime()+F*60*60*1e3);let B=fe(F),S=null;if(d){const N=I(b,F,"stage");if(N&&N>=W.minStage&&N<=W.maxStage){const oe=se!==null&&se<=W.coldMaxTemp?W.coldCoef:W.coef,re=se!==null&&se<=W.coldMaxTemp?W.coldExp:W.exp;S=oe*Math.pow(N,re)}}let M;if(S!==null){const N=Rt(B);M=(1-N)*B+N*S}else M=B;const P=te(M),Q="NWS"+(S!==null?"+EF":""),K=w.includes(F);let k=null,O=null;if(C&&$.length>0){const N=I($,F);N&&N>0&&(k=Math.round(N),O=Math.round(N+_))}const q=Math.round(x);n.push({label:`+${F}h`,time:j,cfs:Math.round(M),stage:P,isCurrent:!1,source:Q,isDisplayPeriod:K,nwsLfRawCFS:k,nwsLfBiasCorrectedCFS:O,persistenceCFS:q})}n.filter(F=>!F.isCurrent).forEach(F=>{console.log(`  ${F.label}: ${F.cfs} cfs / ${F.stage.toFixed(2)} ft${F.isDisplayPeriod?" (display)":""}`)})}else{const u=e.forecastCFS,b=e.inputs?.travelPoRtoGF||8.5,E=(u-a)/b;for(const T of f){const G=new Date(o.getTime()+T*60*60*1e3),C=Math.max(.3,1-T/72),x=Math.max(0,a+E*T*C),$=te(x);n.push({label:`+${T}h`,time:G,cfs:Math.round(x),stage:$,isCurrent:!1,source:"extrapolated",isDisplayPeriod:w.includes(T)})}console.log("48h forecast: NWS unavailable, using linear extrapolation")}const y=n.filter(u=>u.isCurrent||u.isDisplayPeriod);t.innerHTML=y.map(u=>{const b=u.isCurrent?"Now":qt(u.time),I=u.cfs>a?"▲":u.cfs<a?"▼":"●",E=u.cfs>a?"#ef4444":u.cfs<a?"#22c55e":"#94a3b8",T=u.isCurrent?0:parseInt(u.label.replace("+","").replace("h",""));let G="";return u.source&&!u.isCurrent&&(G=` <span style="color:#60a5fa;font-size:0.5rem;" title="NWS upstream forecast (arrival time varies with flow)">${u.source}</span>`),`
            <div class="forecast-period${u.isCurrent?" current":""}" data-hrs="${T}" data-stage="${u.stage.toFixed(2)}" data-cfs="${u.cfs}" style="cursor:pointer;">
                <div class="fp-time">${u.label}${G}<br><span style="font-size:0.5rem;">${b}</span></div>
                <div class="fp-stage">${u.stage.toFixed(2)} ft</div>
                <div class="fp-cfs">${u.cfs.toLocaleString()} cfs</div>
                ${u.isCurrent?"":`<div class="fp-trend" style="color:${E}">${I}</div>`}
            </div>
        `}).join("");const v=Z.map(u=>({hrs:-((Date.now()-u.timestamp)/36e5),cfs:u.cfs,stage:u.stage,time:new Date(u.timestamp),isHistory:!0})).sort((u,b)=>u.hrs-b.hrs);v.length>0&&v.push({hrs:0,cfs:a,stage:e.stage,time:new Date,isHistory:!0}),So(n,a,g,v),ho(n).catch(u=>console.warn("Forecast storage error:",u)),document.querySelectorAll(".forecast-period").forEach(u=>{u.onclick=function(){document.querySelectorAll(".forecast-period").forEach(I=>I.classList.remove("selected")),u.classList.add("selected");const b=parseInt(u.dataset.hrs);Io(b)}})}function qt(e){const t=e.getHours(),n=t>=12?"pm":"am",o=t%12||12;return`${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][e.getDay()]} ${o}${n}`}function Io(e){const t=document.getElementById("gf-graph-marker"),n=document.getElementById("gf-marker-line"),o=document.getElementById("gf-marker-dot"),a=document.getElementById("gf-graph-tooltip"),r=bo(),i=Fo();if(!t||!i?.xScale||!r||r.length===0)return;const s=r.find(w=>w.hrs===e)||r.reduce((w,y)=>Math.abs(y.hrs-e)<Math.abs(w.hrs-e)?y:w),c=i.xScale(s.hrs),l=i.yScale(s.stage);n.setAttribute("x1",c),n.setAttribute("x2",c),o.setAttribute("cx",c),o.setAttribute("cy",l),t.style.display="block",document.getElementById("gf-tooltip-time").textContent=qt(s.time),document.getElementById("gf-tooltip-stage").textContent=s.stage.toFixed(2),document.getElementById("gf-tooltip-cfs").textContent=s.cfs.toLocaleString();const d=document.getElementById("gf-graph-container"),g=Math.min(d.clientWidth-110,Math.max(10,c-40)),f=Math.max(5,l-55);a.style.left=g+"px",a.style.top=f+"px",a.style.display="block"}function Lo(){const e=document.getElementById("forecast-accuracy");if(!e||!ge?.horizons){e&&(e.style.display="none");return}const t=Object.values(ge.horizons).reduce((r,i)=>r+(i.validations||0),0);if(t<10){e.style.display="none";return}e.style.display="block";let o=`<span style="color:#64748b;">Forecast accuracy:</span> ${at.map(r=>{const i=ge.horizons[r]||{validations:0,avgErrorPercent:null};if(i.validations<3||i.avgErrorPercent===null)return`<span style="color:#64748b;">+${r}h: --</span>`;const s=100-i.avgErrorPercent;return`<span style="color:${s>=90?"#4ade80":s>=80?"#fbbf24":"#f87171"};">+${r}h: ${s.toFixed(0)}%</span>`}).join(" • ")} <span style="color:#475569;">(${t} validations)</span>`;if(Object.values(ge.horizons).reduce((r,i)=>r+(i.nwsRawValidations||0),0)>=10){const r=at.map(i=>{const s=ge.horizons[i]||{},c=s.validations>=3&&s.avgErrorPercent!==null?100-s.avgErrorPercent:null,l=s.nwsRawValidations>=3&&s.nwsRawAvgErrorPercent!==null?100-s.nwsRawAvgErrorPercent:null;if(c===null||l===null)return`<span style="color:#64748b;">+${i}h: --</span>`;const d=c-l,g=d>=0?"+":"",f=d>0?"#4ade80":d<-1?"#f87171":"#fbbf24",w=`Our model: ${c.toFixed(0)}% vs NWS: ${l.toFixed(0)}%`;return`<span style="color:${f};" title="${w}">+${i}h: ${g}${d.toFixed(0)}%</span>`}).join(" • ");o+=`<br><span style="color:#64748b;" title="Our model predicts Great Falls; NWS predicts Little Falls directly">vs NWS LF forecast:</span> ${r}`}e.innerHTML=o}const Po=[{name:"Potomac Mainstem",color:"#2563eb",weight:3,coords:[[39.62,-78.76],[39.53,-78.46],[39.697,-78.182],[39.626,-78.017],[39.606,-78.011],[39.608,-77.969],[39.45,-77.82],[39.323,-77.73],[39.273,-77.541],[39.224,-77.452],[39.154,-77.52],[39.103,-77.474],[39.071,-77.341],[39.018,-77.245],[38.998,-77.252],[38.975,-77.228],[38.962,-77.197],[38.955,-77.16],[38.95,-77.128]]},{name:"North Branch",color:"#0891b2",weight:2,coords:[[39.394,-79.182],[39.445,-79.111],[39.479,-79.065],[39.62,-78.76]]},{name:"South Branch",color:"#7c3aed",weight:2,coords:[[38.6428,-79.3306],[38.755,-79.26],[38.86,-79.195],[38.9926,-79.1239],[39.12,-78.98],[39.28,-78.78],[39.45,-78.65],[39.53,-78.46]]},{name:"Shenandoah",color:"#c026d3",weight:2,coords:[[38.914,-78.211],[38.983,-78.101],[39.063,-78.03],[39.134,-77.962],[39.2,-77.87],[39.282,-77.789],[39.31,-77.756],[39.323,-77.73]]},{name:"Monocacy",color:"#dc2626",weight:1.5,coords:[[39.403,-77.366],[39.224,-77.452]]},{name:"Cacapon",color:"#059669",weight:1.5,coords:[[39.582,-78.305],[39.53,-78.46]]},{name:"Conococheague",color:"#059669",weight:1.5,coords:[[39.651,-77.9239],[39.6,-77.92]]},{name:"Antietam",color:"#f59e0b",weight:1.5,coords:[[39.45,-77.73],[39.45,-77.82]]},{name:"Goose Creek",color:"#10b981",weight:1.5,coords:[[39.0559,-77.5191],[39.103,-77.474]]},{name:"Seneca Creek",color:"#6366f1",weight:1.5,coords:[[39.128,-77.336],[39.071,-77.341]]}];function To(e){const t=ee[e];t&&be&&(be.setView([t.lat,t.lon],10),le[e]&&le[e].openPopup())}function gt(){const e=L.map("map").setView([39.2,-77.8],8);Cn(e),L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{maxZoom:19,attribution:"© OpenStreetMap © CARTO"}).addTo(e);for(const o of Po)L.polyline(o.coords,{color:o.color,weight:o.weight,opacity:.7}).addTo(e);for(const[o,a]of Object.entries(ee)){const r=Object.entries(he).find(([l,d])=>d.ids?.includes(o))?.[0]||"target",i=r==="target"?"#f97316":he[r]?.color||"#60a5fa",s=o===H.id?12:8,c=L.divIcon({className:"",html:`<div style="width:${s}px;height:${s}px;background:${i};border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,iconSize:[s,s],iconAnchor:[s/2,s/2]});le[o]=L.marker([a.lat,a.lon],{icon:c}).addTo(e),le[o].bindPopup(Ut(o,a,i,r))}le[H.id].setZIndexOffset(1e3);const t=L.divIcon({className:"",html:'<div style="width:10px;height:10px;background:#06b6d4;border-radius:50%;border:2px dashed white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>',iconSize:[10,10],iconAnchor:[5,5]});le[we.id]=L.marker([we.lat,we.lon],{icon:t}).addTo(e),le[we.id].bindPopup(`
        <div style="min-width:180px;">
            <div style="font-weight:600;color:#06b6d4;border-bottom:2px solid #06b6d4;padding-bottom:4px;margin-bottom:6px;">
                🌊 ${we.name}
            </div>
            <div style="font-size:0.7rem;color:#64748b;margin-bottom:8px;">
                <em>Estimated (No USGS gauge)</em>
            </div>
            <div id="gf-popup-values" style="font-size:0.85rem;">
                <span style="color:#60a5fa;font-weight:600;" id="gf-popup-cfs">-- cfs</span>
                <span style="color:#64748b;margin:0 5px;">|</span>
                <span style="color:#4ade80;font-weight:600;" id="gf-popup-stage">-- ft</span>
            </div>
            <div style="font-size:0.65rem;color:#94a3b8;margin-top:6px;">
                Ensemble blend: PoR + EF models
            </div>
        </div>
    `);const n=L.control({position:"bottomleft"});n.onAdd=function(){const o=L.DomUtil.create("div","map-legend");return o.innerHTML=`
            <div class="map-legend-title">Legend</div>
            <div class="map-legend-item">
                <div class="map-legend-dot target" style="background:#f97316;"></div>
                <span>Little Falls (Target)</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-dot" style="background:#06b6d4;border:1px dashed #fff;"></div>
                <span>Great Falls (Est.)</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#2563eb;"></div>
                <span>Mainstem</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#0891b2;"></div>
                <span>North Branch</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#7c3aed;"></div>
                <span>South Branch</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#c026d3;"></div>
                <span>Shenandoah</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#dc2626;"></div>
                <span>Below Pt Rocks</span>
            </div>
            <div class="map-legend-item">
                <div class="map-legend-line" style="background:#059669;"></div>
                <span>Tributaries</span>
            </div>
        `,o},n.addTo(e)}function Wt(e){const t=document.getElementById("mapToggleBtn");document.body.classList.remove("show-map"),t&&(t.setAttribute("aria-pressed","false"),t.classList.remove("active"))}function $o(){const e=document.getElementById("mapToggleBtn"),t=document.body.classList.toggle("show-map");e.setAttribute("aria-pressed",t),e.classList.toggle("active",t),be&&t&&be.invalidateSize()}function mt(){let e=`<div class="gauge-header">
        <div></div>
        <div>Gauge</div>
        <div style="text-align:right;">Trend</div>
        <div style="text-align:right;">Basin</div>
        <div style="text-align:right;">CFS</div>
        <div style="text-align:right;">Hrs→LF</div>
    </div>`;for(const[t,n]of Object.entries(he)){const o=t==="mainstem"?"open":"",a=n.ids.map(r=>{const i=ee[r];return`<div class="gauge" id="gauge-${r}" onclick="panTo('${r}')">
                <div class="gauge-dot" style="background:${n.color}"></div>
                <div class="gauge-nm">${i.name}</div>
                <div class="gauge-trend" id="trend-${r}"></div>
                <div class="gauge-pct" id="pct-${r}">${i.pctLF}%</div>
                <div class="gauge-q" id="q-${r}">--</div>
                <div class="gauge-t" id="t-${r}">--</div>
            </div>`}).join("");e+=`<div class="branch ${o}" id="b-${t}">
            <div class="branch-hd" onclick="document.getElementById('b-${t}').classList.toggle('open')">
                <div class="branch-clr" style="background:${n.color}"></div>
                <div class="branch-nm">${n.name}</div>
                <div class="branch-arr">▼</div>
            </div>
            <div class="branch-list">${a}</div>
        </div>`}document.getElementById("branches").innerHTML=e,window.panTo=To}function ht(){const e=h[H.id];document.getElementById("lfQ").textContent=e?.q?Math.round(e.q).toLocaleString():"--",document.getElementById("lfH").textContent=e?.h?e.h.toFixed(2):"--",bt(document.getElementById("lfTrend"),e?.trend);const t=h._mult;if(t){const n=Math.round(t.travelHrs);document.getElementById("multVal").textContent=`~${n} hrs`}for(const n of Object.values(he))for(const o of n.ids){const a=h[o],r=document.getElementById(`q-${o}`),i=document.getElementById(`t-${o}`),s=document.getElementById(`trend-${o}`);if(r){r.textContent=a?.q?Math.round(a.q).toLocaleString():"n/a";const c=a?.iceAffected===!0,l=a?.estimated===!0&&!c;if(r.classList.toggle("estimated",l),r.classList.toggle("ice-affected",c),c)if(a.iceLongTerm)r.title="Ice-affected >2 days: estimated from drainage ratio";else{const d=a.lastValidTime?((Date.now()-a.lastValidTime)/864e5).toFixed(1):"?";r.title=`Ice-affected: last valid reading ${d} days ago`}else l?r.title="Estimated from drainage area ratio (gauge data unavailable)":r.title=""}i&&(a?.travelHrs?(i.textContent=Vt(a.travelHrs),i.title=`Arrives: ${zt(a.travelHrs)}`):(i.textContent="--",i.title="")),s&&bt(s,a?.trend,!0)}for(const[n,o]of Object.entries(le)){const a=ee[n],r=h[n];if(!a||!r)continue;const i=Object.entries(he).find(([c,l])=>l.ids?.includes(n))?.[0],s=he[i]?.color||"#60a5fa";o.bindPopup(Ut(n,a,s,i))}_t()}function Ut(e,t,n,o){const a=h[e]||{},r=e===H.id;let i="";a.iceAffected?i=' <span style="color:#7dd3fc;font-size:0.65rem;">❄️</span>':a.estimated&&(i=' <span style="color:#fbbf24;font-size:0.65rem;">(est*)</span>');let s=`<div class="pop-nm" style="color:${n}">${t.name}</div>
        <div class="pop-area">${t.area?.toLocaleString()} sq mi${t.pctLF?" • "+t.pctLF+"% of LF basin":""}</div>
        <div class="pop-row">
            <div class="pop-cell"><div class="pop-val blue">${a.q?Math.round(a.q).toLocaleString():"n/a"}${i}</div><div class="pop-lbl">cfs</div></div>
            <div class="pop-cell"><div class="pop-val green">${a.h?a.h.toFixed(2):"n/a"}</div><div class="pop-lbl">ft stage</div></div>
        </div>`;const c=Jt(a.trend),l=c?`<span style="color:${c.color};font-weight:bold;">${c.icon}</span>`:"";if(s+=`<div class="pop-trend">
        <div class="pop-trend-title">📈 48-Hour Trend ${l}</div>
        ${qo(a.trend,a.q)}
    </div>`,!r&&a.travelHrs){s+=`<div class="pop-row">
            <div class="pop-cell"><div class="pop-val yellow">${Vt(a.travelHrs)}</div><div class="pop-lbl">travel time</div></div>
            <div class="pop-cell"><div class="pop-val purple">${t.pctLF}%</div><div class="pop-lbl">of LF drainage</div></div>
        </div>
        <div class="pop-arr"><b>Arrival:</b> ${a.arrival?.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>`,s+=`<div class="pop-note">Calculation: ${t.baseHrs}h × ${a.mult?.toFixed(2)||"1.00"} mult`,a.correction&&a.correction!==1&&(s+=` × ${a.correction.toFixed(3)} learned`),s+="</div>";const d=D?.observations[e]?.length||0;d>0&&(s+=`<div class="pop-learn">🧠 ${d} observations recorded</div>`),o==="belowPtR"&&(s+='<div class="pop-warn">⚠️ Below Point of Rocks — can raise LF before upstream signal</div>')}if(a.iceAffected)if(a.iceLongTerm)s+='<div class="pop-warn" style="color:#7dd3fc;">❄️ Ice-affected >2 days: estimated from drainage ratio</div>';else{const d=a.lastValidTime?((Date.now()-a.lastValidTime)/864e5).toFixed(1):"?";s+=`<div class="pop-warn" style="color:#7dd3fc;">❄️ Ice-affected: showing last valid reading from ${d} days ago</div>`}else a.estimated&&(s+='<div class="pop-warn" style="color:#fbbf24;">* Estimated from drainage area ratio — gauge data unavailable (ice/malfunction)</div>');return s}function pt(){let e="";for(const[t,n]of Object.entries(ce)){const o=n.awId?`<a href="https://www.americanwhitewater.org/content/River/detail/id/${n.awId}" target="_blank" rel="noopener" aria-label="View ${n.name} on American Whitewater" style="color:#60a5fa;text-decoration:none;" title="American Whitewater">🔗 AW</a>`:"",a=n.estimated?' <span title="Threshold is estimated" style="color:#f59e0b;cursor:help;">⚠</span>':"",r=n.microRun?' <span style="font-size:0.5rem;color:#94a3b8;background:rgba(148,163,184,0.15);padding:1px 4px;border-radius:3px;">micro-run</span>':"";e+=`<div class="creek-card" id="creek-${t}" style="${n.estimated?"border-style:dashed;":""}">
            <div class="creek-top">
                <div class="creek-dot" id="creek-dot-${t}"></div>
                <div class="creek-name">${n.name}${r}${a}</div>
                <div class="creek-cfs" id="creek-cfs-${t}">--</div>
                <div class="creek-trend" id="creek-trend-${t}"></div>
            </div>
            <div class="creek-meta">
                <span>Class ${n.class}</span>
                <span id="creek-lastran-${t}"></span>
                <span>USGS ${t}</span>
                ${o}
            </div>
            <div class="creek-status" id="creek-status-${t}"></div>
        </div>`}document.getElementById("creeks-list").innerHTML=e}function Ao(){const e=Object.entries(ce);let t=0;const n=[];for(const[s,c]of e){const l=_e[s],d=document.getElementById(`creek-dot-${s}`),g=document.getElementById(`creek-cfs-${s}`),f=document.getElementById(`creek-trend-${s}`),w=document.getElementById(`creek-status-${s}`),y=document.getElementById(`creek-lastran-${s}`),v=document.getElementById(`creek-${s}`);if(d){if(l){const u=l.running;u&&t++,n.push({id:s,running:u,q:l.q}),d.style.background=u?"#4ade80":"#64748b",g.textContent=`${Math.round(l.q)} cfs`,g.style.color=u?"#4ade80":"#94a3b8";const b={rising:"↑",falling:"↓",steady:"→"},I={rising:"#4ade80",falling:"#f87171",steady:"#94a3b8"},E={rising:"Flow rising",falling:"Flow falling",steady:"Flow steady"};f.textContent=b[l.trend]||"→",f.style.color=I[l.trend]||"#94a3b8",f.title=E[l.trend]||"Flow steady",u?(w.textContent=`Running! (≥${c.runnable} cfs)`,w.style.color="#4ade80"):(w.textContent=`Needs ≥${c.runnable} cfs${c.microRun?" (micro-run)":""}`,w.style.color="#94a3b8"),v.style.borderColor=u?"#4ade80":"#334155"}else d.style.background="#475569",g.textContent="❓ No data",g.style.color="#94a3b8",f.textContent="",w.textContent="Gauge offline or no response",w.style.color="#94a3b8",v.style.borderColor="#334155",n.push({id:s,running:!1,q:-1});try{const u=localStorage.getItem(`creek_lastran_${s}`);if(u){const b=new Date(u),E=Math.round((new Date-b)/864e5);l?.running?y.textContent="Last ran: now":E===0?y.textContent="Last ran: today":E===1?y.textContent="Last ran: yesterday":y.textContent=`Last ran: ${E}d ago`}else y.textContent="Last ran: unknown"}catch{y.textContent=""}}}n.sort((s,c)=>s.running&&!c.running?-1:!s.running&&c.running?1:c.q-s.q);const o=document.getElementById("creeks-list");for(const s of n){const c=document.getElementById(`creek-${s.id}`);c&&o.appendChild(c)}const a=document.getElementById("creeks-status"),r=e.length;if(t>0)a.innerHTML=`<div class="creeks-banner running">🟢 CREEKS ARE RUNNING — ${t} of ${r} runnable</div>`;else{let s="";try{let c=null,l=null;for(const[d]of e){const g=localStorage.getItem(`creek_lastran_${d}`);g&&(!c||g>c)&&(c=g,l=d)}if(c&&l){const d=Math.round((new Date-new Date(c))/864e5);s=` — Last activity: ${ce[l].name}, ${d===0?"today":d===1?"yesterday":d+"d ago"}`}}catch{}a.innerHTML=`<div class="creeks-banner quiet">⚫ Nothing running${s}</div>`}const i=document.querySelector('.tab[data-tab="creeks"]');i&&i.classList.toggle("has-running",t>0)}function yt(e){if(!e||typeof e!="object")return console.error("USGS validation: Response is not an object"),!1;if(!e.value)return console.error('USGS validation: Missing "value" property'),!1;if(!Array.isArray(e.value.timeSeries))return console.error('USGS validation: "value.timeSeries" is not an array'),!1;for(let t=0;t<e.value.timeSeries.length;t++){const n=e.value.timeSeries[t];if(!n.sourceInfo?.siteCode?.[0]?.value)return console.error(`USGS validation: timeSeries[${t}] missing sourceInfo.siteCode`),!1;if(!n.variable?.variableCode?.[0]?.value)return console.error(`USGS validation: timeSeries[${t}] missing variable.variableCode`),!1}return!0}async function ve(e,t=5e3){const n=new AbortController,o=setTimeout(()=>n.abort(),t);try{const a=await fetch(e,{signal:n.signal});return clearTimeout(o),a}catch(a){throw clearTimeout(o),a.name==="AbortError"?new Error(`Request timed out after ${t}ms`):a}}function vt(e){try{const t={timestamp:Date.now(),data:e};localStorage.setItem(Et,JSON.stringify(t)),console.log("💾 Saved data to cache")}catch(t){console.log("Cache save failed:",t)}}function Bo(){try{const e=localStorage.getItem(Et);if(!e)return null;const{timestamp:t,data:n}=JSON.parse(e),o=Date.now()-t,a=o>Kt;return a&&console.log("💾 Cache is stale (>6 hours old)"),console.log(`💾 Using cached data (${Math.round(o/6e4)} min old)`),{data:n,timestamp:t,age:o,stale:a}}catch(e){return console.log("Cache load failed:",e),null}}function Mo(){const e=h[H.id]?.q||nn,t=Qe(e);h._mult=t;for(const[n,o]of Object.entries(ee)){if(n===H.id)continue;const a=h[n];if(!a)continue;let r=o.baseHrs*t.mult;const i=Dn(n);r*=i,a.travelHrs=r,a.baseHrs=o.baseHrs,a.mult=t.mult,a.correction=i,a.arrival=new Date(Date.now()+r*36e5),a.pctLF=o.pctLF}Bn()}function Do(e){if(xn({}),!e?.value?.timeSeries)return;let t=null;for(const n of e.value.timeSeries){const o=n.sourceInfo.siteCode[0].value,a=n.variable.variableCode[0].value,r=n.values[0]?.value;if(h[o]||(h[o]={}),o==="01638500"&&a==="00060"&&r?.length&&(t=r),r?.length){const i=r[r.length-1],s=parseFloat(i.value),c=i.qualifiers||[],l=s<=-999999||c.includes("Ice");if(s>0&&s<9999999)a==="00060"&&(h[o].q=s),a==="00065"&&(h[o].h=s);else if(l&&a==="00060"){let d=!1;for(let g=r.length-2;g>=0;g--){const f=parseFloat(r[g].value);if(f>0&&f<9999999){h[o].q=f,h[o].iceAffected=!0,h[o].lastValidTime=new Date(r[g].dateTime).getTime(),console.log(`🧊 ${o}: Ice-flagged, using last valid: ${f} cfs from ${r[g].dateTime}`),d=!0;break}}d||(h[o].iceAffected=!0,h[o].iceLongTerm=!0,console.log(`🧊 ${o}: Ice-flagged for >2 days, no valid readings in window`))}}}t&&Go(t),No(),Mo()}function Go(e){if(!e?.length)return;const t=new Set(R.map(o=>Math.floor(o.timestamp/6e5)));let n=0;for(const o of e){const a=new Date(o.dateTime).getTime(),r=Math.floor(a/6e5);if(t.has(r))continue;const i=parseFloat(o.value);!i||i<=0||i>5e5||(R.push({timestamp:a,cfs:i,stage:null}),t.add(r),n++)}if(n>0){R.sort((a,r)=>a.timestamp-r.timestamp);const o=Date.now()-Ae;Se(R.filter(a=>a.timestamp>o));try{localStorage.setItem("potomac_por_history",JSON.stringify(R))}catch{}console.log(`📊 Backfilled ${n} PoR history entries from USGS, total: ${R.length}`)}}function No(){const e=h[H.id]?.q;h["01638500"]?.q;const t=h["01638500"]?.h;for(const[n,o]of Object.entries(ee))n!==H.id&&(h[n]||(h[n]={}),!h[n].q&&e&&(h[n].q=Math.round(e*(o.area/11560)),h[n].estimated=!0),!h[n].h&&t&&(h[n].h=t,h[n].estimated=!0))}async function Ho(){const t=`https://waterservices.usgs.gov/nwis/iv/?sites=${Object.keys(ce).join(",")}&parameterCd=00060&period=P1D&format=json`;try{const n=await ve(t,5e3);if(!n.ok)return;const o=await n.json();if(!o?.value?.timeSeries)return;for(const a of o.value.timeSeries){const r=a.sourceInfo?.siteCode?.[0]?.value;if(!r||!ce[r]||a.variable?.variableCode?.[0]?.value!=="00060")continue;const s=a.values?.[0]?.value;if(!s?.length)continue;const c=s[s.length-1],l=parseFloat(c.value);if(isNaN(l)||l<0)continue;let d="steady";if(s.length>=8){const g=parseFloat(s[Math.max(0,s.length-9)].value);if(!isNaN(g)&&g>0){const f=(l-g)/g*100;f>10?d="rising":f<-10&&(d="falling")}}if(_e[r]={q:l,trend:d,time:new Date(c.dateTime),running:l>=ce[r].runnable},l>=ce[r].runnable)try{localStorage.setItem(`creek_lastran_${r}`,new Date().toISOString())}catch{}}console.log(`🏞️ Creek data: ${Object.keys(_e).length}/${Object.keys(ce).length} gauges loaded`)}catch(n){console.warn("Creek data fetch failed:",n)}}const _o=["https://api.allorigins.win/raw?url=","https://corsproxy.io/?"];async function Ve(){if(!It){rt(!0);try{De("loading");const t=`https://waterservices.usgs.gov/nwis/iv/?sites=${Object.keys(ee).join(",")}&parameterCd=00060,00065&period=P7D&format=json`;async function n(){try{let r=await ve(t,1e4);if(r.ok){const i=await r.json();if(yt(i))return vt(i),ke(Date.now()),xe("live"),i;console.log("USGS response validation failed, trying proxies...")}}catch(r){console.log("Direct USGS fetch failed:",r.message||r)}for(const r of _o)try{let i=await ve(r+encodeURIComponent(t),5e3);if(i.ok){const s=await i.json();if(yt(s))return vt(s),ke(Date.now()),xe("live"),s;console.log(`Proxy ${r} returned invalid USGS response`)}}catch(i){console.log("Proxy fetch failed:",i)}const a=Bo();return a?(ke(a.timestamp),xe(a.stale?"stale":"cached"),a.data):null}const[o]=await Promise.all([n(),eo(),to(),Ho()]);if(!o){console.log("⚠️ No data available - no cache exists"),ke(null),xe("unavailable"),De("error"),ht();return}Do(o);try{await Promise.race([Nn(),new Promise(a=>setTimeout(a,4e3))])}catch(a){console.warn("NWS forecast fetch error:",a)}De(Ne==="live"?"ok":Ne==="stale"?"stale":"cached"),ht(),Ht(),Ao()}finally{rt(!1)}}}function De(e){const t=document.getElementById("dot"),n=document.getElementById("status"),o=document.getElementById("refreshBtn");o&&(e==="loading"?(o.disabled=!0,o.classList.add("loading")):(o.disabled=!1,o.classList.remove("loading"))),e==="loading"?(t.className="dot loading",t.title="Fetching data from USGS...",n.textContent="Fetching data..."):e==="ok"?(t.className="dot",t.title="Live - Connected to USGS",n.textContent="Live",jt()):e==="cached"?(t.className="dot cached",t.title="Cached - Using stored data",n.textContent="Cached"):e==="stale"?(t.className="dot error",t.title="Offline - Using old cached data",n.textContent="Offline",wt("Network unavailable. Showing cached data.")):e==="error"&&(t.className="dot error",t.title="No data available",n.textContent="No Data",wt("Unable to connect to USGS. Check your connection.")),Oo()}function wt(e){const t=document.getElementById("error-banner");e&&(document.getElementById("error-banner-text").textContent=e),t.style.display="flex",Fe&&clearTimeout(Fe),Bt(setTimeout(jt,1e4))}function jt(){document.getElementById("error-banner").style.display="none",Fe&&(clearTimeout(Fe),Bt(null))}function Oo(){const e=document.getElementById("lastUpdate");if(!e)return;if(!pe){e.textContent="No data",e.className="last-update stale",e.title="Unable to fetch data";return}const t=Date.now()-pe,n=Math.floor(t/6e4),o=Math.floor(t/36e5);let a,r;n<2?(a="Updated just now",r="fresh"):n<60?(a=`Updated ${n}m ago`,r=n<30?"fresh":"recent"):o<6?(a=`Updated ${o}h ago`,r="old"):(a=`Updated ${o}h+ ago`,r="stale"),e.textContent=a,e.className=`last-update ${r}`,e.title=`Last updated: ${new Date(pe).toLocaleString()}`}function Vt(e){return e<1?Math.round(e*60)+"m":e<48?Math.round(e)+"h":(e/24).toFixed(1)+"d"}function zt(e){if(!e||e<=0)return"";const t=new Date(Date.now()+e*36e5),n=new Date,o=new Date(n);o.setDate(o.getDate()+1);const a=t.toLocaleTimeString("en-US",{hour:"numeric",hour12:!0}).toLowerCase();return t.toDateString()===n.toDateString()?`Today ${a}`:t.toDateString()===o.toDateString()?`Tomorrow ${a}`:`${t.toLocaleDateString("en-US",{weekday:"short"})} ${a}`}function Jt(e,t=!1){if(!e||e.source!=="NWS")return null;let n,o;switch(e.direction){case"up":n="↑",o="#f59e0b";break;case"down":n="↓",o="#3b82f6";break;default:n="→",o="#6b7280"}let a="";if(t&&e.rate!==void 0&&e.rate!==0){const r=Math.round(e.rate*100);a=" "+(r>0?"+":"")+r+"%"}return{icon:n,color:o,magnitude:a}}function bt(e,t,n=!1){if(!e)return;const o=Jt(t,n);if(!o){e.textContent="",e.style.color="";return}e.textContent=o.icon+o.magnitude,e.style.color=o.color,e.style.fontWeight="bold"}function qo(e,t){if(!e||e.source!=="NWS")return'<span style="color:#94a3b8;">n/a</span>';let n='<b style="color:#60a5fa;">NWS Forecast</b><br>';return e.forecast24?n+=`24h: ${Math.round(e.forecast24).toLocaleString()} cfs<br>`:n+="24h: n/a<br>",e.forecast48?n+=`48h: ${Math.round(e.forecast48).toLocaleString()} cfs`:n+="48h: n/a",n}function Ge(e){const t=document.querySelectorAll(".tab"),n=document.querySelectorAll(".tab-content");t.forEach(o=>{o.classList.remove("active"),o.setAttribute("aria-selected","false"),o.setAttribute("tabindex","-1")}),n.forEach(o=>o.classList.remove("active")),e.classList.add("active"),e.setAttribute("aria-selected","true"),e.setAttribute("tabindex","0"),document.getElementById("tab-"+e.dataset.tab).classList.add("active"),Wt(e.dataset.tab)}function Wo(){document.querySelectorAll(".tab").forEach(e=>{e.addEventListener("click",()=>Ge(e))}),document.querySelector(".tabs")?.addEventListener("keydown",e=>{const t=Array.from(document.querySelectorAll(".tab")),n=t.indexOf(document.activeElement);if(n===-1)return;let o;switch(e.key){case"ArrowRight":o=t[(n+1)%t.length];break;case"ArrowLeft":o=t[(n-1+t.length)%t.length];break;case"Home":o=t[0];break;case"End":o=t[t.length-1];break;case"Enter":case" ":e.preventDefault(),Ge(t[n]);return;default:return}e.preventDefault(),o.focus(),Ge(o)}),Wt()}const Uo="e97776493f213d50b346f81e3f93a78aad1fd0f19c051a38bd8f88b43e46e5b5";async function jo(e){const n=new TextEncoder().encode(e),o=await crypto.subtle.digest("SHA-256",n);return Array.from(new Uint8Array(o)).map(r=>r.toString(16).padStart(2,"0")).join("")}async function Ft(){const e=document.getElementById("learnPIN").value;await jo(e)===Uo?(document.getElementById("learnLocked").style.display="none",document.getElementById("learnUnlocked").style.display="block",document.getElementById("pinError").style.display="none",document.getElementById("learnTab").textContent="🧠 Learning",sessionStorage.setItem("learnUnlocked","true"),Be()):(document.getElementById("pinError").style.display="block",document.getElementById("learnPIN").value="")}function Vo(){document.getElementById("learnLocked").style.display="block",document.getElementById("learnUnlocked").style.display="none",document.getElementById("learnTab").textContent="🔒 Learning",document.getElementById("learnPIN").value="",sessionStorage.removeItem("learnUnlocked")}function zo(){sessionStorage.getItem("learnUnlocked")==="true"&&(document.getElementById("learnLocked").style.display="none",document.getElementById("learnUnlocked").style.display="block",document.getElementById("learnTab").textContent="🧠 Learning",Be()),document.getElementById("learnPIN")?.addEventListener("keypress",e=>{e.key==="Enter"&&Ft()}),window.checkLearnAccess=Ft,window.lockLearning=Vo}const Jo=`# Potomac Pulse — Technical Appendix


**Version:** 34.5 | **Date:** February 2026

This document provides full methodological transparency for the Potomac Pulse prediction system. It is intended for scientists, hydrologists, and technically curious users who want to understand exactly how the model works.

---

## 1. Introduction

Potomac Pulse is a real-time web application that estimates water conditions at Great Falls on the Potomac River, where no USGS gauge exists. It combines data from multiple upstream gauges using an ensemble model, validates predictions against a downstream gauge, and learns correction factors over time.

**Core approach:**
1. Look up what Point of Rocks was reading when today's Great Falls water passed through (~19-33 hours ago)
2. Add tributary contributions (Monocacy, Goose Creek, Broad Run, Seneca Creek) at their confluence points
3. Blend with a nearby stage-only gauge (Edwards Ferry) using flow-dependent weights
4. Validate every prediction ~6 hours later when water reaches Little Falls
5. Learn correction factors by flow regime and flow state

---

## 2. Study Area & Gauge Network

### 2.1 Basin Overview

The Potomac River at Little Falls (USGS 01646500) drains 11,560 mi². Point of Rocks, 41 river miles upstream, captures 83.5% of this drainage. The remaining 16.5% enters between Point of Rocks and Little Falls via tributaries and ungauged streams.

### 2.2 Gauge Inventory

| Gauge | USGS ID | Parameters | Drainage (mi²) | % of LF Basin | Travel to LF | Role |
|-------|---------|------------|----------------|---------------|--------------|------|
| Little Falls | 01646500 | Q, H | 11,560 | 100% | — | Validation target |
| Point of Rocks | 01638500 | Q, H, T | 9,651 | 83.5% | ~26 hrs | Primary predictor |
| Edwards Ferry | 01644148 | H only | 11,130 | 96.3% | ~4 hrs | Ensemble cross-check |
| Monocacy River | 01643000 | Q, H | 817 | 7.1% | ~14 hrs | Tributary addition |
| Goose Creek | 01644000 | Q, H | 332 | 3.0% | ~10 hrs | Tributary addition |
| Broad Run | 01644280 | Q, H | 76 | 0.66% | ~8 hrs | Tributary addition |
| Seneca Creek | 01645000 | Q, H | 101 | 0.87% | ~5 hrs | Tributary addition (enters below GF) |
| Hancock | 01613000 | Q, H | 4,073 | 35.2% | ~120 hrs | Upstream early warning |
| Cumberland | 01603000 | Q, H | 877 | 7.6% | ~180 hrs | Upstream early warning |

*Q = discharge (param 00060), H = gage height (param 00065), T = water temperature (param 00010). Travel times at median flow (~5,000 cfs) with ×0.80 empirical correction.*

### 2.3 Data Availability & Missing Data Handling

When a gauge returns invalid data (USGS sentinel value -999999), discharge is estimated using drainage area ratio:

\\\`\\\`\\\`
Estimated_CFS = LF_CFS × (gauge_drainage_area / 11,560)
\\\`\\\`\\\`

Estimated values are displayed in italics with a yellow asterisk. Common causes: ice at measurement site, gauge malfunction, communication outage.

### 2.4 Below Point of Rocks

16.5% of Little Falls' drainage enters below Point of Rocks:
- Monocacy: 7.1% (gauged)
- Goose Creek: 3.0% (gauged)
- Broad Run: 0.66% (gauged, v31.0)
- Seneca Creek: 0.87% (gauged, enters below GF — included in estimate, absorbed by LF validation per v34.0)
- Ungauged streams: ~4.9% (~570 mi²)

Local storms in ungauged areas can raise Little Falls independently of Point of Rocks.

---

## 3. Travel Time Model

### 3.1 Theoretical Basis

The travel time model derives from USGS Circular 438 (Searcy & Davis, 1961), which measured mean water velocity vs. discharge at Point of Rocks and Little Falls using dye-tracer studies:

\\\`\\\`\\\`
V_avg = 0.0116 × Q^0.5963   (R² = 0.99)
\\\`\\\`\\\`

Converting velocity to travel time over the 41-mile PoR→LF reach:

\\\`\\\`\\\`
T_original = 5174 × Q^(-0.5963)
\\\`\\\`\\\`

### 3.2 Empirical Correction (×0.80)

Cross-correlation analysis of modern USGS instantaneous data (6 months of 15-minute readings plus 2 years of daily data, January 2026) showed observed travel times are approximately 20% faster than Searcy's 1961 measurements. We apply a conservative 0.80 multiplier:

\\\`\\\`\\\`
T = 4139 × Q^(-0.5963)
\\\`\\\`\\\`

Where T = travel time in hours, Q = Little Falls discharge in cfs.

**Correction evidence:**
- Rising limb analysis: peak PoR→LF correlation at 24 hours (r = 0.958)
- Empirical power-law fit: T = 2438 × Q^(-0.5491), R² = 0.908
- Conservative approach: preserve Searcy's physically-derived exponent (-0.5963), adjust coefficient only
- Likely cause: changed channel conditions (sediment, vegetation, cross-section geometry) over 60+ years

### 3.3 Travel Time by Flow Regime

| LF Flow (cfs) | Searcy (1961) | Corrected (×0.80) | PoR → GF (75%) | GF → LF (25%) |
|---------------|---------------|-------------------|----------------|----------------|
| 1,200 | 55 hrs | 44 hrs | ~33 hrs | ~11 hrs |
| 2,000 | 44 hrs | 35 hrs | ~26 hrs | ~9 hrs |
| 5,000 | 32 hrs | 26 hrs | ~19 hrs | ~6.5 hrs |
| 15,000 | 18 hrs | 14 hrs | ~11 hrs | ~3.6 hrs |
| 50,000 | 9 hrs | 7 hrs | ~5.5 hrs | ~1.8 hrs |

The PoR→GF segment accounts for 75% of total travel time (slower pooled sections above the falls), while GF→LF accounts for 25% (faster flow through the gorge).

### 3.4 Upstream Gauge Extensions

For gauges upstream of Point of Rocks, baseline travel times are from Searcy Table 2, adjusted with the same 0.80 multiplier and scaled by the same flow-dependent function.

| Gauge | Baseline (median flow) | Uncertainty |
|-------|------------------------|-------------|
| Point of Rocks | 26 hrs | ±10% |
| Shepherdstown | 50 hrs | ±15% |
| Hancock | 120 hrs (~5 days) | ±15-20% |
| Cumberland | 181 hrs (~7.5 days) | ±15-20% |

**Limitation:** The Searcy power law was calibrated specifically for the PoR→LF reach. Upstream reaches have different channel characteristics. Upstream travel times are best used for "pulse is coming" awareness rather than precise arrival timing.

### 3.5 Iterative Convergence Algorithm

Travel time depends on flow, but we look up *historical* flow — creating a circular dependency.

**Problem:** Current flow = 1,200 cfs → travel time ~33h → look up PoR from 33h ago → find 1,900 cfs → but 1,900 cfs travels in ~25h, so that water already passed.

**Solution:** Iterate until convergence (within 1 hour):
1. Start with current flow → calculate travel time
2. Look up historical PoR from that many hours ago
3. Recalculate travel time based on that historical flow
4. Repeat until stable

Typically converges in 2-3 iterations.

### 3.6 Wave Celerity Adjustment

During rising flood events, the wave front travels faster than bulk water velocity (Fread, 1973). The pressure signal propagates faster than the water itself.

**Implementation:**
- Compute rate of rise from PoR history (% change per hour)
- Reduce travel time: 2% reduction per 1%/hr rise rate
- Maximum reduction: 30% (physics limit)
- Applied only during confirmed "rising" conditions

| Rise Rate | Travel Time Reduction | 19h Baseline → |
|-----------|----------------------|----------------|
| +2.5%/hr | 5% | 18.1h |
| +5%/hr | 10% | 17.1h |
| +10%/hr | 20% | 15.2h |
| +15%/hr+ | 30% (max) | 13.3h |

### 3.7 Planned Validation

Cross-correlation analysis for upstream segment travel times is planned:
- Cumberland → Hancock (North Branch)
- Hancock → Point of Rocks (Mainstem)

Preliminary observation (Jan 12-15, 2026): Hancock peaked at 2,300 cfs on Jan 13 13:00; PoR peaked at 3,520 cfs on Jan 14 22:45 — approximately 34 hours lag.

---

## 4. Edwards Ferry Stage-Discharge Model

### 4.1 Gauge Description

Edwards Ferry (USGS 01644148) is a stage-only gauge located ~2-3 miles upstream of Great Falls, draining 96.3% of the Little Falls basin (11,130 mi²). It provides gage height but no discharge. Its proximity to Great Falls makes it valuable for estimation, but the lack of discharge data requires a stage-discharge model.

### 4.2 Power-Law Calibration

We analyzed **5,220 deduplicated daily observations** from 2011-2026 using USGS daily value data:

1. Paired EF daily mean gage height with LF daily mean discharge
2. Excluded ice-flagged periods (USGS qualifier "e" or "Ice")
3. Excluded EF stage < 2.0 ft (below reliable measurement range)
4. Deduplicated by date (USGS returns two time series for this gauge; averaged)
5. Fit power-law: \\\`LF_cfs = a × EF_stage^b\\\` (physically appropriate for open-channel hydraulics)

**Important distinction: gauge accuracy vs. predictive accuracy.** All EF stage readings have been verified against the USGS API (7/7 spot-checks exact match). The gauge is accurate. However, a single stage reading at one location is a limited *predictor* of discharge at a downstream point — especially at low flows, where local channel geometry, vegetation, and dam operations dominate the stage-discharge relationship. This is why the ensemble weight is flow-dependent (§5.4).

### 4.3 Default Model

\\\`\\\`\\\`
LF_cfs = 126 × EF_stage^2.46
\\\`\\\`\\\`

| Metric | Value |
|--------|-------|
| R² | 0.94 |
| Median error | 6.3% |
| RMSE | 3,391 cfs |
| Exponent | 2.46 |
| Observations | 5,220 (2011-2026, deduplicated) |

The exponent (2.46) is consistent with typical channel geometry power-law exponents (2.0-3.0) for natural rivers.

### 4.4 Cold-Water Model

Analysis of 3,354 observations (2021-2026) with concurrent water temperature data revealed temperature-dependent coefficients. Cold water has higher density and viscosity, altering the stage-discharge relationship.

| Condition | Formula | When Applied |
|-----------|---------|--------------|
| **Cold** | \\\`LF_cfs = 160 × EF_stage^2.36\\\` | Water temp ≤ 10°C (50°F) |
| **Default** | \\\`LF_cfs = 126 × EF_stage^2.46\\\` | Water temp > 10°C or unavailable |

The cold-water model improves winter RMSE by **10.9%**. A full three-regime model (cold/moderate/warm) was tested but degraded warm-season accuracy by 18.1%. The cold-only approach captures the largest improvement without negative side effects.

### 4.6a 117k Hourly Validation (2026-02-19)

Both models were re-estimated on **117,704 hourly observations** (2011–2026) with autocorrelation diagnostics. As expected for hourly data, residuals show extreme autocorrelation (Durbin-Watson = 0.007 for default, 0.065 for cold; ACF lag-1 = 0.997 and 0.968 respectively). All Ljung-Box tests reject at p ≈ 0. However, autocorrelation inflates precision but does **not** bias OLS estimates — confirmed by:

1. **Newey-West HAC**: v29.0 values fall within corrected confidence intervals
2. **Subsampling (every 24h)**: n=4,905 → coef=128.0, exp=2.453 (virtually identical)
3. **Subsampling (every 168h)**: n=701 → coef=132.1, exp=2.432 (within normal sampling variation)

| Source | Default coef | Default exp | Cold coef | Cold exp |
|--------|:---:|:---:|:---:|:---:|
| v29.0 (5,220 daily) | 126 | 2.46 | 160 | 2.36 |
| 117k hourly OLS | 127.8 | 2.454 | 166.4 | 2.341 |
| 117k 24h subsample | 128.0 | 2.453 | 167.0 | 2.342 |

Changes are <5% coef and <0.05 exponent → **not material**. v29.0 parameters validated. GLS Cochrane-Orcutt was attempted but fails due to near-unit-root process (rho ≈ 0.997). Cross-language verified: Python and R exact match on all estimates.

See \\\`analysis/refit_powerlaw_hourly.py/.R\\\`, audit: \\\`analysis/powerlaw_refit_audit.md\\\`.

### 4.5 Temperature Data Source

Water temperature is fetched from Point of Rocks (USGS 01638500, parameter 00010). When temperature data is unavailable, the system falls back to the default model.

### 4.6 Updating the Model

To regenerate with more data:
\\\`\\\`\\\`
GET /.netlify/functions/build-ef-correlation-advanced?months=12
\\\`\\\`\\\`
Update the \\\`EF_MODEL\\\` constants in index.html and scheduled-update.js with the recommended values.

---

## 5. Great Falls Estimation

### 5.1 Problem Statement

No USGS gauge exists at Great Falls. The estimation combines upstream gauge readings with the Edwards Ferry stage-discharge model.

### 5.2 Estimation Formula

\\\`\\\`\\\`
GF_estimated = PoR(t - T_converged) + Monocacy + Goose Creek + Broad Run + Seneca Creek - Correction
\\\`\\\`\\\`

Where:
- PoR(t - T_converged) = Point of Rocks reading from T hours ago (T = converged travel time, §3.5)
- Monocacy = current Monocacy discharge (joins 6 mi below PoR)
- Goose Creek = current Goose Creek discharge (joins 12 mi below PoR)
- Broad Run = current Broad Run discharge (0.66% of LF, joins between Goose Creek and EF)
- Seneca Creek = current Seneca Creek discharge (0.87% of LF, joins below EF, above GF)
- Correction = learned correction factor for current flow bin and flow state (§6)

### 5.3 Ensemble Blending

The final estimate blends two independent models:

\\\`\\\`\\\`
GF_final = (1 - w) × GF_PoR_model + w × GF_EF_model
\\\`\\\`\\\`

Where w = EF weight (flow-dependent, see §5.4), GF_PoR_model = time-shifted PoR + tributaries, GF_EF_model = Edwards Ferry power-law estimate.

This ensemble reduces variance by combining a spatially distant but data-rich gauge (PoR, 20 mi) with a nearby but data-limited gauge (EF, 2 mi).

### 5.4 Flow-Dependent Weighting (Logistic Ramp, v30.0)

A **7-approach horse race** on 117,704 hourly observations (2011–2026) with Leave-One-Year-Out cross-validation (14 folds) identified a smooth logistic ramp as optimal. The EF gauge is accurate (USGS-verified), but its **predictive value** depends on flow regime — the logistic function captures this relationship continuously:

\\\`\\\`\\\`
ef_weight = W_MAX / (1 + exp(-K × (ln(flow) - ln(MIDPOINT))))
         = 0.40  / (1 + exp(-5.0 × (ln(flow) - ln(10000))))
\\\`\\\`\\\`

| Flow Level | EF Weight | PoR Weight |
|------------|:---------:|:----------:|
| 1,000 cfs | ~0.0% | ~100% |
| 3,000 cfs | 1.8% | 98.2% |
| 5,000 cfs | 3.5% | 96.5% |
| 10,000 cfs | 20.0% | 80.0% |
| 20,000 cfs | 36.5% | 63.5% |
| 50,000 cfs | 39.8% | 60.2% |

**Horse race results** (OOS RMSE on 115,213 observations across 14 CV folds):

| Approach | OOS RMSE | Skill Score | vs Baseline |
|----------|:--------:|:-----------:|:-----------:|
| EF-Dominant (logistic) — **winner** | **1,907** | **+0.090** | **−4.6%** |
| PoR Ratio Scaler | 1,950 | +0.048 | −2.4% |
| Tributary Addback | 1,975 | +0.025 | −1.2% |
| Combined Ratio+Tribs | 1,987 | +0.012 | −0.6% |
| Baseline (flat 35% step) | 1,999 | (ref) | — |
| EF Power-Law Refit | 2,003 | −0.004 | +0.2% |
| Log-Linear Regression | 2,006 | −0.007 | +0.3% |

The logistic ramp improves on the v29.0 flat 35% step by eliminating the hard 3k cfs cutoff and allowing EF influence to increase gradually with flow. At low flows, EF weight is near zero (avoiding the negative-skill regime). At high flows, it asymptotes at 40% — matching the previous optimal ceiling. The smooth sigmoid requires no arbitrary bin boundaries.

**Cross-language verified**: Blind Python + R subagents agree on winner (RMSE within 7 cfs). Independent auditor confirmed methodology is sound. See \\\`analysis/horserace_v2_python.py\\\`, \\\`analysis/horserace_v2_R.R\\\`, audit: \\\`analysis/horserace_v2_audit.md\\\`.

### 5.4.1 PoR-Delta Staleness Correction (v25.0)

When the river is rising or falling, the time-shifted PoR reading (19-26h old) comes from a different flow regime and systematically misestimates current GF conditions. The PoR-delta correction scales the time-shifted estimate by the proportion of change observed at Point of Rocks since that reading:

\\\`\\\`\\\`
IF |PoR_change%| > 5%:
    ratio = PoR_now / PoR_then
    decay = min(0.50, sqrt(staleness / travel_time))
    corrected = estimate × (1 + (ratio - 1) × decay)
\\\`\\\`\\\`

The **decay factor** accounts for wave travel: if the time-shifted reading is 16h old and PoR→GF travel is 19h, the change at PoR has only partially reached GF. The sqrt ramp gives ~50% correction at 25% elapsed. The 0.50 cap (v28.0, lowered from 0.75) prevents overcorrection on rises — cross-verified on 42,837 hourly pairs.

**Backtest results** (5,220 days, 2011-2026): PoR-delta correction reduced Rising RMSE by 17.8% (6,117→5,027 cfs) and Overall RMSE by 25.6% (3,981→2,963 cfs) with near-zero rising bias (+87 cfs vs baseline -2,286 cfs). It outperformed both EF weight boosting and the combined approach. See \\\`analysis/backtest_approaches.py\\\`.

### 5.4.2 Gradient Weight Optimization (v27.0)

The v26.0 step function (10%/10%/20%/70% at hard cutoffs) was replaced with a smooth piecewise-linear gradient, optimized via **coordinate descent** on 5,208 consecutive-day pairs (2011-2026). The optimization used lag-1 actual discharge as a PoR proxy and minimized RMSE of the blended ensemble: \\\`GF = (1-w) × yesterday + w × (126 × EF^2.46)\\\`.

**Methodology**:
1. Seven anchor points at [0, 3k, 6k, 10k, 15k, 25k, 50k] cfs
2. Coarse pass: sweep w = 0.00–0.80 in 0.05 steps at each anchor (5 passes)
3. Fine pass: refine ±0.05 in 0.01 steps at each anchor (3 passes)
4. Monotonicity enforced: weights must be non-decreasing with flow
5. Rounded to 1 decimal place

**Results**:
- Overall RMSE: **3,858 cfs** (gradient) vs **5,203 cfs** (step) = **-25.8% improvement**
- The gradient's smooth ramp through mid-flows (3-10k cfs) captures signal the step function missed
- Maximum EF weight settled at 40% (not 70%) — the gradient eliminates the need for aggressive high-flow weighting by properly weighting the transition zone
- Cross-language verified: Python and R independently produce identical optimal weights at all 7 anchors

**RMSE by flow regime**:

| Regime | N pairs | Step RMSE | Gradient RMSE | Change |
|--------|--------:|----------:|--------------:|-------:|
| < 3k | 3,407 | 155 | 155 | 0 |
| 3-6k | 901 | 710 | 584 | -126 |
| 6-10k | 355 | 1,357 | 1,101 | -256 |
| 10-15k | 206 | 2,157 | 1,901 | -256 |
| 15-25k | 179 | 5,597 | 5,433 | -164 |
| 25-50k | 120 | 15,722 | 15,722 | 0 |
| > 50k | 40 | 37,839 | 37,839 | 0 |

See \\\`analysis/optimize_gradient_weights.py\\\` (Python) and \\\`analysis/optimize_gradient_weights.R\\\` (R).

### 5.4.3 Soft LF Ceiling + Decay Cap Optimization (v28.0)

The GF estimate is capped at **120% of LF actual discharge**, and the PoR-delta decay cap is set to **0.50**. On rising rivers, GF legitimately exceeds LF (the flood wave arrives at Great Falls before Little Falls), but the PoR-delta correction + EF blend can overshoot by 200%+. The 120% ceiling limits extreme overshoots while preserving the legitimate rising signal.

**Why 120% instead of 110%?** Historical analysis of 42,837 hourly pairs shows the 110% ceiling triggered 5,780 times and created a -476 cfs systematic under-prediction bias during rising events. The 120% ceiling triggers ~2,777 times and achieves near-zero rising bias (-29 cfs), allowing real rising dynamics to pass through while still catching model overshoots.

**Grid search**: 25 configurations (5 decay caps × 5 ceiling ratios) tested on two independent datasets:

| Dataset | N pairs | Period | PoR method |
|---------|--------:|--------|------------|
| Daily | 5,208 | 2011-2026 | Lag-1 proxy (yesterday's LF) |
| Hourly | 42,837 | 2021-2026 | Travel-time-shifted (Searcy power law) |

**Selected config** (decay=0.50, ceil=120%): chosen for near-zero rising bias, prioritizing accuracy during rising events.

| Config | Hourly Rising RMSE | Hourly Rising Bias | Ceiling Triggers |
|--------|----------:|:----------:|:----------:|
| decay=0.50, ceil=120% (selected) | 3,387 | **-29** | ~2,777 |
| decay=0.50, ceil=110% | 2,542 | -476 | 5,780 |
| decay=0.50, no ceiling (baseline) | 6,294 | +887 | 0 |

The selected config prioritizes unbiased rising estimates (bias ≈ zero) over minimum RMSE. A tool used to assess rising river conditions must not systematically under-predict. Cross-language verified in Python and R (all 50 metrics match within 0.5 cfs).

See \\\`analysis/backtest_comprehensive.py\\\` (Python) and \\\`analysis/backtest_comprehensive_R.R\\\` (R).

**117k Hourly Validation (2026-02-19):** Re-tested on 117,704 hourly observations (2011–2026). With hourly staleness ≈ 1hr/20hr = 0.05, the decay factor is ≈ 0.22 regardless of cap — the decay cap is essentially irrelevant for hourly data. Current config validated. See \\\`analysis/backtest_117k.py/.R\\\`, audit: \\\`analysis/backtest_117k_audit.md\\\`.

### 5.4.4 Hourly Gradient Weight Re-Optimization (v29.0, superseded by v30.0)

*Historical context: The v29.0 flat 35% step function served as the baseline for the v30.0 horse race. The logistic ramp (§5.4) now replaces this.*

The v27.0 graduated ramp (0%→10%→40%) was optimized on daily data using lag-1 actual discharge as a PoR proxy. Re-optimization on **42,838 hourly observations** (2021-2026) with **actual travel-time-shifted PoR** (Searcy power law) found that a simple flat 35% weight above 3k cfs is optimal.

**Why hourly data produced different results:**
1. **8× more observations** (42,838 vs 5,208) reduces overfitting risk
2. **Real PoR proxy**: Travel-time-shifted PoR readings (not lag-1 daily) match the production model
3. **Intra-day dynamics**: Captures rapid event transitions that daily averages smooth over

**Optimization methodology:**
1. Seven anchor points at [0, 3k, 6k, 10k, 15k, 25k, 50k] cfs
2. Zero initialization (avoids warm-start bias — audit of v1 found binding constraints when initialized from current weights)
3. W_MAX = 0.80, forward-only monotonicity
4. Coarse pass: 0.00–0.80 in 0.05 steps (5 sweeps), fine pass: ±0.05 in 0.01 steps (3 sweeps)
5. Two-decimal precision

**Results (simultaneous blind Python + R subagents):**

| Config | Overall RMSE | vs Daily-Optimized |
|--------|:----------:|:----------:|
| Flat 35% (v29.0) | **1,676** | **-4.6%** |
| Flat 40% (v1 hourly) | 1,702 | -3.1% |
| Graduated 0→10→40% (v27.0 daily) | 1,757 | baseline |

**Cross-validation** (leave-one-year-out, 2021-2025): 4/6 years improve, 2 neutral. Average improvement: -36.4 cfs RMSE. No year shows significant degradation, confirming the result generalizes.

**Cross-language verification**: Python and R exact match (0.0000 weight difference, 0.0 cfs RMSE difference).

See \\\`analysis/optimize_gradient_weights_hourly_v2.py\\\` (Python) and \\\`analysis/optimize_gradient_weights_hourly_v2_verify.R\\\` (R).

**117k Hourly Validation (2026-02-19):** Re-optimized on 117,704 hourly observations (2011–2026). The graduated ramp [0.04, 0.15, 0.35×5] is 0.70 cfs WORSE overall than flat 35%. Cross-validation (leave-one-year-out, 2012–2025): only 2/14 years improve, mean 1.8% worse out-of-sample. Flat 35% confirmed optimal. See \\\`analysis/optimize_gradient_weights_117k.py/.R\\\`, audit: \\\`analysis/gradient_weights_117k_audit.md\\\`.

### 5.5 EF Discrepancy Check

When EF estimate differs from PoR estimate by more than 50%, the system skips ensemble blending and uses PoR-only. This guards against ice-affected EF readings, backwater conditions, or gauge malfunctions that would corrupt the ensemble.

### 5.6 Hysteresis Correction

At the same stage, a rising river carries more flow than a falling river (Fread 1973, Henderson 1966). The system learns adaptive multipliers:

- Starting values: **+8% rising, -8% falling** (literature-informed)
- Updated via EMA (α = 0.2) from validation errors
- Separate multipliers for rising, falling, and steady conditions
- Clamped to ±20% range (0.8 to 1.2)
- Stored in browser localStorage, persists across sessions

### 5.7 Confidence Indicator

Reflects **data quality**, not prediction accuracy:

| Level | Conditions |
|-------|------------|
| HIGH | Tributary data available AND time-shifted PoR history AND EF trend agrees |
| MEDIUM | Missing time-shifted data OR EF trend disagrees |
| LOW | Missing tributary data OR no PoR trend data |

Downgrades: EF trend conflict, insufficient history for time-shifting, tributary gauges offline.

### 5.8 Uncertainty Display (v29.1: Empirical 90% CI)

The app displays a calibrated 90% confidence interval based on empirical error quantiles:

\\\`\\\`\\\`
90% CI: 2,900 – 3,500 cfs
\\\`\\\`\\\`

**Methodology:** Prediction errors (blended estimate − actual LF discharge) were analyzed across 117,704 hourly observations (2011–2026) in 18 bins (6 flow levels × 3 flow states). Errors are non-normal in all bins (Shapiro-Wilk p &lt; 0.01, kurtosis up to 18.3, asymmetry ratios up to 42:1). Gaussian ±1.645σ would mis-specify uncertainty by up to 745%.

**CI formula:** \\\`[estimate + q05(bin), estimate + q95(bin)]\\\` where q05/q95 are the 5th/95th percentiles of the error distribution for the relevant flow bin and flow state.

**Verification:** 3-layer protocol — simultaneous blind Python + R subagents + independent auditor. See \\\`analysis/error_distribution_audit.md\\\`.

---

## 6. Learning & Validation System

### 6.1 Prediction-Validation Cycle

Each Great Falls estimate is validated ~6-7 hours later when water reaches Little Falls:

1. Store prediction with timestamp, flow bin, and flow state
2. When water arrives at LF, calculate what GF actually was
3. Compute error: (predicted - actual) / actual
4. Update correction factor using EMA (§6.3)

### 6.2 Correction Bins

Corrections are learned separately for 18 bins (6 flow levels × 3 flow states):
- **Flow bins:** <3k, 3-6k, 6-12k, 12-25k, 25-50k, >50k cfs
- **Flow states:** rising, falling, steady

### 6.3 EMA Smoothing

Correction factors update via exponential moving average:
\\\`\\\`\\\`
new_correction = α × latest_error + (1 - α) × old_correction
\\\`\\\`\\\`
With α = 0.3, weighting recent observations more heavily while maintaining stability.

### 6.4 Outlier Filtering

Errors >3 standard deviations from the bin mean are discarded. This prevents bad data (gauge malfunction, ice) from corrupting learned corrections.

### 6.5 Flow State Classification

The threshold scales with flow magnitude:
\\\`\\\`\\\`
threshold = max(100 cfs, 0.02 × current_flow)
\\\`\\\`\\\`

| Flow Level | Threshold | Effective % |
|------------|-----------|-------------|
| 2,000 cfs | 100 cfs | 5.0% |
| 5,000 cfs | 100 cfs | 2.0% |
| 10,000 cfs | 200 cfs | 2.0% |
| 50,000 cfs | 1,000 cfs | 2.0% |

Flow state is determined from observed PoR rate (2-hour lookback on stored PoR history, v32.0). On cold start (fewer than 4 PoR readings), falls back to NWS forecast direction.

Separate corrections per flow state account for momentum effects (rising water moves faster) and hysteresis (falling water drains slower).

### 6.6 Background Scheduler

A serverless function executes every 2 hours:
1. Fetch USGS data for all gauges
2. Store PoR history to cloud database (48-hour window)
3. Validate pending predictions against actual LF readings
4. Update correction bins with new error data
5. Clean up stale predictions (>48 hours → expired)
6. Make new prediction and store for future validation

The model improves continuously, even when no browsers are open.

### 6.7 Health Monitoring

- **Consecutive runs:** Streak of successful 2-hour executions
- **Missed runs:** Count of skipped cycles (gap > 3 hours)
- **Stale cleanup:** Predictions >48 hours marked expired, not validated
- **Admin reset:** Clears flow-bin corrections while preserving health statistics

### 6.8 Historical Accuracy Tracking

\\\`\\\`\\\`
Accuracy = 100% - mean_absolute_error_%
\\\`\\\`\\\`

Color coding: 🟢 ≥95% (excellent), 🟡 90-95% (good), 🔴 <90% (needs refinement).

---

## 7. Ice & Anomaly Detection

### 7.1 ADVM Physics

USGS Little Falls uses an Acoustic Doppler Velocity Meter (ADVM). Frazil ice — small crystals suspended in supercooled water — scatters and absorbs the acoustic signal, causing artificially low velocity readings even when stage (pressure transducer) remains accurate. This produces CFS readings far below actual discharge.

### 7.2 Two-Tier Scoring System (v33.0)

The system uses sensor fusion with two flag tiers. USGS ice flags are a separate upstream system — anomaly detection only runs when USGS says data is clean.

**Hard Flags** — physical data corruption → skip learning AND accuracy:

| Check | Signal | Threshold | Hard Score |
|-------|--------|-----------|------------|
| Stage-Discharge | LF stage vs ADVM velocity contradict | >35% discrepancy | +2 |
| Low Flow Sanity | Low CFS with elevated stage (classic ice) | <1,500 cfs @ >2.45 ft | +2 |
| Statistical Outlier | Error exceeds 3σ from bin mean | z-score > 3 | +2 |

**Soft Flags** — model disagreement → INCLUDE in learning (EMA clamped) AND accuracy:

| Check | Signal | Threshold | Soft Score |
|-------|--------|-----------|------------|
| EF Cross-Check | EF predicts higher flow than LF reports | >25% discrepancy | +2 |
| Large Error | Prediction error exceeds reasonable bounds | >50% error | +1 |

**Flag determination:** \\\`isHardFlagged = hardScore ≥ 2\\\`, \\\`isSoftFlagged = !isHardFlagged && softScore ≥ 2\\\`.

### 7.3 Learning Protection

**Hard flag (score ≥ 2):**
- Validation is recorded (for analysis) but skips learning AND accuracy
- Record is marked "hard_flagged" — the LF reading itself is corrupted

**Soft flag (score ≥ 2, no hard flag):**
- INCLUDED in learning and accuracy — the model is probably wrong, not the data
- EMA contribution clamped at ±2σ from bin mean (prevents single large-error obs from spiking correction)
- Running sums (count, sumError, sumErrorSq) use raw values; only EMA uses clamped value
- Record is marked "soft_flagged"

**Scientific basis:**
- Stage (pressure transducer): unaffected by ice crystals
- ADVM (velocity): biased low by ice scattering
- Edwards Ferry (stage-only): provides independent check unaffected by ADVM interference
- Check 1 (EF discrepancy) alone is equally consistent with model error as with ice — hence soft flag

### 7.4 Trend Validation

If Edwards Ferry trend (rising/falling) disagrees with PoR trend, confidence is reduced. This detects local conditions differing from upstream.

### 7.5 Example Detection

\\\`\\\`\\\`
Example 1 — HARD flag (ice):
LF reports:  1,120 cfs @ 2.60 ft stage
Expected:    ~2,000 cfs (from stage rating curve)
→ hardScore: 2 (stage-discharge 79%) + 2 (low flow @ high stage) = 4
→ HARD FLAGGED: Skip learning + accuracy

Example 2 — SOFT flag (model error):
LF reports:  8,500 cfs @ 3.10 ft stage
EF estimate: 11,200 cfs (from 3.50 ft stage)
→ softScore: 2 (EF 32% discrepancy)
→ SOFT FLAGGED: Included in learning (EMA clamped) + accuracy
\\\`\\\`\\\`

---

## 8. 48-Hour Forecast

### 8.1 Why a Different Method is Needed

The current GF estimate looks backward: "What PoR reading from ~20-40 hours ago has arrived at GF now?" For forecasting, at low flow (~1,000 cfs, travel time ~40h):
- +6h forecast needs PoR from 34 hours *ago* (historical, not forecast)
- +48h forecast needs PoR from 8 hours *ago* (still historical)

The forecast would show flat conditions even when a rise is imminent.

### 8.2 LF-Constrained Approach

Great Falls is between Point of Rocks and Little Falls. If NWS predicts LF will rise, GF must rise first. We exploit this constraint:

1. Get NWS Little Falls forecast (BRKM2)
2. Shift backward by GF→LF travel time (~6-12h depending on flow)

\\\`\\\`\\\`
GF_forecast(t) ≈ LF_forecast(t + T_GF_LF)
\\\`\\\`\\\`

### 8.3 Additive Bias Correction

NWS forecasts exhibit systematic bias. We apply an additive correction:

\\\`\\\`\\\`
offset = observed_LF_now - forecast_LF_at_now
corrected_forecast = raw_forecast + offset
\\\`\\\`\\\`

**Why additive, not multiplicative:** Preserves the forecast's predicted *change* in flow (physics of the rise). Percentage-based correction would over-correct at high flows and under-correct at low flows because river hydraulics are non-linear.

**Example:**
- Observed LF: 1,020 cfs | Forecast at now: 1,300 cfs → offset: -280 cfs
- NWS predicts 3,400 cfs at +6h → corrected: 3,120 cfs

The offset recalculates every 15 minutes and automatically shrinks as NWS updates their model runs.

### 8.4 Calculation & Display Intervals

- **Calculation:** 6, 12, 18, 24, 30, 36, 42, 48 hours (8 points for smooth interpolation)
- **Display:** 6, 12, 24, 48 hours (shown as forecast cards)

### 8.5 Ensemble Blending for Forecasts

When EF forecast data is available, forecast values are blended using the same flow-dependent weighting as the current estimate (§5.4). Otherwise, the LF-derived forecast is used alone.

### 8.6 Fallback Behavior

When NWS forecast is unavailable, the system uses linear extrapolation from recent trends.

---

## 9. Limitations & Uncertainties

### 9.1 Model Limitations

| Factor | Impact | Notes |
|--------|--------|-------|
| Steady-state assumption | High during floods | Rapid flood waves travel faster than predicted (mitigated by wave celerity adjustment, §3.6) |
| Single flow multiplier | ±10-20% for upstream | Same scaling applied to all reaches, though channel characteristics vary |
| Ungauged tributaries | ~5.5% unmonitored | Local storms in ungauged areas can cause unexpected rises |
| 0.80 travel time correction | Needs validation | Empirical correction based on limited modern data; spring validation planned |

### 9.2 Great Falls Estimation Uncertainties

| Factor | Impact |
|--------|--------|
| Tributary timing | Monocacy/Goose/Broad Run/Seneca readings are current, not time-shifted to confluence arrival |
| Water withdrawals | Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water (Seneca) divert ~400–700 cfs above the falls. Already absorbed by LF-calibrated model; no correction needed. |
| EF dam influence | At <3,000 cfs, dam operations cause ±33% EF bias (mitigated by flow-dependent weighting) |
| Temperature data gaps | When PoR temp unavailable, cold-water model cannot activate |

The learning system corrects for systematic errors over time.

---

## 10. Data Sources & Acknowledgments

This application relies entirely on public data from U.S. government agencies.

### 10.1 Real-Time Streamflow Data
- **Source:** U.S. Geological Survey (USGS) National Water Information System (NWIS)
- **API:** USGS Water Services REST API (https://waterservices.usgs.gov)
- **Parameters:** Discharge (00060), Gage height (00065), Water temperature (00010)
- **Update frequency:** 15-minute intervals

### 10.2 River Forecasts
- **Source:** National Weather Service (NWS) / NOAA
- **Service:** National Water Prediction Service (NWPS)
- **API:** https://api.water.noaa.gov/nwps/v1/
- **Forecast point:** BRKM2 (Little Falls / Brookmont)

### 10.3 Historical & Reference Data
- Travel time model: USGS Circular 438 (Searcy & Davis, 1961)
- Validation data: USGS Water-Supply Paper 2257 (Taylor et al., 1985)
- Drainage areas: USGS StreamStats and gauge metadata

### 10.4 Disclaimer
This application is not affiliated with, endorsed by, or connected to the USGS, NWS, NOAA, or any government agency. Data is provided "as-is" from public APIs. For official river information and flood warnings, consult https://water.weather.gov.

---

## 11. References

1. Searcy, J.K. and Davis, L.C., Jr. (1961). "Time of Travel of Water in the Potomac River, Cumberland to Washington." *USGS Circular 438.* U.S. Geological Survey.

2. Taylor, K.R., James, R.W., and Helinsky, B.M. (1985). "Traveltime and Dispersion in the Potomac River, Cumberland, Maryland, to Washington, D.C." *USGS Water-Supply Paper 2257.*

3. Fread, D.L. (1973). "Technique for Implicit Dynamic Routing in Rivers with Tributaries." *Water Resources Research,* 9(4), 918-926.

4. Henderson, F.M. (1966). *Open Channel Flow.* Macmillan.

5. MWCOG (1984). "Potomac River Hydraulic Survey." Metropolitan Washington Council of Governments.

6. ICPRB (2002). "Source Water Assessment for the Potomac River, Chapter 3: Hydrology." Interstate Commission on the Potomac River Basin.

7. USGS (ongoing). National Water Information System: Web Interface. https://waterdata.usgs.gov/nwis

8. NWS (ongoing). National Water Prediction Service. https://water.weather.gov

---

## 12. License & Copyright

© 2026 Gordon Shumway. All rights reserved.

Licensed under **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

You may share and adapt this material for non-commercial purposes with attribution. Full license: https://creativecommons.org/licenses/by-nc/4.0/

---

## Versioning Scheme

Starting with v25.0, Potomac Pulse uses **MAJOR.MINOR** versioning:

- **MAJOR** (v25 → v26): Changes to the core GF estimation logic — model recalibration, new estimation approach, architectural changes that alter outputs for the same inputs.
- **MINOR** (.0 → .1): Bug fixes, UI changes, new features/tabs, documentation updates, display changes — anything that does not alter the core estimation output.

Earlier versions (v16–v24.x) used an ad-hoc scheme where major integers marked large features and dot releases marked incremental changes within a development sprint.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v34.5 | 2026-02-26 | All Gauges UIX improvements: sticky column headers, consistent CSS grid layout, row separators, trend column font fix, responsive mobile breakpoint. Documentation sync across Tech Appendix, README, and How It Works tab. Deleted redundant Model History table (§4.6). |
| v34.4 | 2026-02-26 | Security hardening: remove hardcoded admin PIN fallback (env-only), lock down CORS to production origin with env var override for deploy previews. |
| v34.3 | 2026-02-26 | Extract shared server module (netlify/functions/shared/model.js): deduplicate getSupabase(), GF_FLOW_BINS, getFlowBin(), estimateLFFlowFromStage() across scheduled-update.js and sync-learning.js. |
| v34.2 | 2026-02-26 | Client-side cleanup: collapsible estimation inputs (details/summary), null-check guards for updateGreatFallsUI() and dashboard, fix stale Tech Appendix version string, improve water temperature variable documentation. |
| v34.1 | 2026-02-26 | Fix 90% CI display centering (halfWidth formula) and Learning tab bin data race condition (defer render until after fetch completes). |
| v34.0 | 2026-02-26 | Fix EMA learning system. Three structural flaws in nowcast validation: (1) Seneca noise — was subtracting noisy 1% Seneca estimate from LF to approximate GF, adding ±50-200 cfs noise; now validates against raw LF, correction naturally absorbs Seneca + ungauged area signal. (2) Timing jitter — was accepting validations with unbounded delay (0-48h); now capped at 2.5h after validationDue, rejecting stale validations where flow conditions changed too much. (3) Race condition — both client (every 30min) and server (every 2h) independently updated correction bins, metadata, and EF correlation; now server-only. Client checkGFValidations() disabled. EF hysteresis learning freezes at converged values (minor: ±8% on EF component weighted 0-40%). Originally proposed switching to +6h forecast-based learning, but two independent auditors (coding + hydrology) identified critical domain mismatch: forecast uses NWS inputs, nowcast uses observed gauge data — learning from NWS-contaminated errors would inject forecast bias into clean estimates. Revised approach fixes the nowcast path instead. |
| v33.1 | 2026-02-23 | 24h stored GF history on forecast graph. Stores actual estimateGreatFalls() output in localStorage (mirroring porHistory pattern) instead of simplified PoR-only re-estimation. Fixes low baseline and visible jump at NOW junction caused by model mismatch (history was missing ~12% tributary flows, EF blending, flow-state corrections, LF ceiling). Graph extended from [-12h, 48h] to [-24h, 48h]. Cold-start fallback to computeGFHistoryFromPoR(). Display-only. |
| v33.0 | 2026-02-21 | Two-tier anomaly flagging. Many of the ~60 flagged observations were likely legitimate estimation errors, not ice — USGS ice flags are a separate upstream system. Hard flags (Checks 2, 3, 5: stage-discharge contradiction, low-flow+high-stage, 3σ outlier) skip learning AND accuracy. Soft flags (Checks 1, 4: EF discrepancy, large error) are INCLUDED in learning with EMA clamped at ±2σ from bin mean, and INCLUDED in accuracy. Three-tier gauge_id: hard_flagged, soft_flagged, validated. EF threshold standardized to 0.25 (was 0.30 in sync-learning.js). Check 3 score standardized to +2 (was +1 in sync-learning.js). Independent auditor reviewed: accepted EMA clamping (R1), STATISTICAL_OUTLIER as hard (R2), three-tier DB (R3), Tech Appendix update (R5). |
| v32.3 | 2026-02-21 | Fix accuracy metric inflated by flagged observations. The accuracy formula (100 − avgErrorPercent) included all observations in the denominator, including ~60 ice-flagged ones with 15–30% errors. These were correctly excluded from learning (correction bins) but incorrectly included in the accuracy metric. Fix: only non-flagged observations contribute to sumAbsErrorPercent and avgErrorPercent. New validValidations counter tracks clean observations. Dashboard shows "N valid / M total" split. Both sync-learning.js and scheduled-update.js fixed. |
| v32.2 | 2026-02-21 | Fix missing estimation inputs in EF-only (ice) mode. The EF-only early return in updateGreatFallsUI() skipped the inputs section (lines 2743-2804), leaving correction, 90% CI, flow bin, tributaries, and travel times at HTML defaults (all dashes). Now populates with "N/A — EF only" for PoR-based fields and "❄️ ice-affected" for PoR. Display-only fix. |
| v32.1 | 2026-02-21 | Forecast graph history extended from 6h to 12h: leverages existing 72h porHistory backfill. Junction gap fix: removed bridge from history line to forecast NOW point — the two models (PoR-only history vs full ensemble forecast) produce different values, so bridging created a visible jump. History line now ends naturally at last observed data point. X-axis labels updated (-12h, -6h). Display-only. |
| v32.0 | 2026-02-21 | Flow state classification fix: use observed PoR rate (2-hour lookback from porHistory) instead of NWS 48-hour forecast for rising/falling/steady detection. Matches server-side getFlowState() which already uses observed data. Fixes bug where display showed "STEADY" during actual rising events (NWS forecast flat or unavailable). Falls back to NWS on cold start (porHistory < 4 entries). Affects correction bin lookups and empirical CI selection. |
| v31.3 | 2026-02-20 | 6-hour history on forecast graph: extends graph from [0, 48h] to [-6h, 48h] by retroactively computing GF estimates from existing PoR history in localStorage. Blue history line with data dots, amber NOW divider, responsive x-axis labels. Tooltip shows "(observed)" for history points. No new localStorage — reuses porHistory backfill. Display-only. |
| v31.2 | 2026-02-20 | Aqueduct withdrawal investigation: Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water (Seneca) divert ~400–700 cfs above the falls. 3-agent investigation (2 researchers + independent auditor) confirmed withdrawals already absorbed by LF-calibrated model. Systematic errors are 2–7× larger than total withdrawals and scale proportionally — driven by ungauged area, not withdrawals. Documentation-only update. |
| v31.1 | 2026-02-20 | New "Creeks" tab showing rain-dependent whitewater runs near DC: Rock Creek (01648000, ≥400 cfs), NW Branch Anacostia (01650500, ≥200 cfs), Difficult Run (01646000, ≥200 cfs), Sligo Creek (01650800, ≥200 cfs). Binary green-light model with localStorage "last ran" tracking. Separate USGS fetch (P1D, discharge only). Display-only — no estimation logic change. |
| v31.0 | 2026-02-20 | Add Broad Run (01644280, 76 mi², 0.66% of LF) and Seneca Creek (01645000, 101 mi², 0.87% of LF) to GF estimation model. Both tributaries enter between Point of Rocks and Great Falls. Closes ~1,100 cfs of the PoR-to-LF tributary gap. Catoctin Creek (01638480) excluded after independent auditor identified it enters 0.3 mi above PoR gauge (already captured in PoR reading). |
| v30.0 | 2026-02-20 | Logistic EF weight ramp (0%→40%, midpoint 10k cfs, k=5.0) replaces flat 35% step function. Winner of 7-approach horse race on 117,704 hourly obs with Leave-One-Year-Out CV (14 folds). OOS RMSE 1,907 cfs (−4.6% vs v29.0 baseline). Smooth sigmoid eliminates hard 3k cfs cutoff. 3-layer verified (blind Python + R + independent auditor). |
| v29.1 | 2026-02-19 | Empirical 90% CI replaces ±1σ uncertainty display. Per-bin error quantiles (q05/q95) validated on 117,704 hourly observations. Errors are non-normal (kurtosis up to 18.3, asymmetry up to 42:1). Gaussian ±1.645σ would mis-specify by up to 745%. 3-layer verified (Python + R + auditor). |
| v29.0 | 2026-02-19 | Flat 35% EF weight above 3k cfs replaces graduated ramp (0%→10%→40%). Re-optimized on 42,838 hourly observations (2021-2026) with travel-time-shifted PoR. Overall RMSE -4.6% (1,676 vs 1,757 cfs). Simultaneous blind Python + R subagents + independent auditor. |
| v28.1 | 2026-02-19 | Parallel data loading: fetch USGS + EF + temp + NWS simultaneously. Single UI render after all data arrives (eliminates intermediate partial display). NWS fetches parallelized across 15 gauges (was sequential). 8s NWS timeout prevents stalling. |
| v28.0 | 2026-02-19 | Soft LF ceiling (120%) + decay cap (0.50). Grid search: 25 configs on daily (5,208 pairs) + hourly (42,837 pairs, travel-time-shifted PoR). 120% ceiling selected over 110% to avoid systematic under-prediction on rises (-29 cfs bias vs -476 cfs). Cross-verified Python + R. |
| v27.0 | 2026-02-19 | Step-function EF weights replaced with piecewise-linear gradient (0%→40% across 7 anchor points). Coordinate descent optimization on 5,208 consecutive-day pairs. Cross-language verified (Python + R). Overall RMSE -25.8% vs step function. Smooth ramp through mid-flows eliminates hard cutoffs. |
| v26.0 | 2026-02-19 | High-flow EF weight increased from 50% to 70% at >15k cfs. Cross-language optimization (Python + R) showed 22% RMSE improvement. EF beats persistence (RMSE ratio 0.52) with genuine predictive power, but PoR still needed (residual ACF=0.67, errors 5× larger during rapid changes). |
| v25.0 | 2026-02-18 | PoR-delta staleness correction (backtest winner: -18% Rising RMSE, -26% Overall RMSE). Removed EF weight boost (backtest showed it worsened accuracy). Clarified EF gauge accuracy vs. predictive accuracy. New MAJOR.MINOR versioning scheme. |
| v24.16 | 2026-02-18 | Data verification: Deduplicated primary dataset (10,434→5,220 obs). Recalibrated EF model (126×EF^2.46), cold-water model (160×EF^2.36), and flow weights (10-50%). Cross-validated in Python + R. |
| v24.15 | 2026-02-11 | Flow-dependent ensemble weighting: EF weight varies by flow regime based on skill/correlation optimization. |
| v24.14 | 2026-02-11 | Cold-water EF model when water temp ≤10°C. Improves winter RMSE. |
| v24.13 | 2026-02-10 | EF model recalibration from 15 years of USGS daily data. |
| v24.12 | 2026-02-10 | Phase 2 UX: Mobile sidebar, network error banner, map toggle, accessibility fixes. |
| v24.11 | 2026-02-10 | Phase 1 Security: XSS fix, USGS validation, fetch timeouts, PIN to env var, memory leak fix. |
| v24.10 | 2026-02-03 | EF-only fallback when PoR ice-affected, learning suspension, admin dashboard. |
| v24.9 | 2026-01-25 | Iterative travel time convergence for correct time-shifting at variable flows. |
| v24.8 | 2026-01-26 | EF discrepancy check (>50% → skip ensemble). Extended PoR history to 72h. |
| v24.7 | 2026-01-25 | 48h forecast accuracy tracking by horizon (6h, 12h, 24h, 48h). |
| v24.6 | 2026-01-25 | 48h forecast with LF-constrained approach and additive bias correction. |
| v24.5 | 2026-01-25 | LF-constrained forecast: GF rises before LF, shift forecast backward. |
| v24.4 | 2026-01-25 | Initial 48h forecast using NWS PoR forecast with ensemble model. |
| v24.3 | 2026-01-25 | Tighter ice detection thresholds. Reset corrupted low-flow bins. |
| v24.2 | 2026-01-24 | Ice-affected gauge display with ❄️ indicator. |
| v24.1 | 2026-01-24 | Multi-signal ice detection: EF cross-check, stage-discharge, large error, outlier checks. |
| v24.0 | 2026-01-24 | Ice/anomaly detection via sensor fusion. Learning protection when score ≥ 2. |
| v23 | 2026-01-24 | Wave celerity adjustment: up to 30% travel time reduction during rising floods. |
| v22 | 2026-01-23 | Flow-scaled thresholds. Learnable EF hysteresis (±8% starting, EMA α=0.2). |
| v21 | 2026-01-23 | Learning system overhaul: 2h schedule, stale cleanup, health monitoring. |
| v20 | 2026-01-17 | Empirical travel time correction (×0.80) from cross-correlation analysis. |
| v19 | 2026-01-17 | Edwards Ferry ensemble model. Background learning system. |
| v18 | 2026-01-10 | Hysteresis detection, flow-binned corrections. |
| v17 | 2025-12-15 | All Gauges tab with upstream travel time predictions. |
| v16 | 2025-12-01 | Initial public release with PoR-based GF estimation. |

---

*Generated by Potomac Pulse v34.5 — All Gauges UIX improvements. All parameters validated on 117,704 hourly observations (2011–2026)*
`;function Qo(){const e=new Blob([Jo],{type:"text/markdown"}),t=URL.createObjectURL(e),n=document.createElement("a");n.href=t,n.download="Potomac_Pulse_Technical_Appendix.md",document.body.appendChild(n),n.click(),document.body.removeChild(n),URL.revokeObjectURL(t)}function Ko(){const e=document.getElementById("about-btn"),t=document.getElementById("about-tooltip");e?.addEventListener("click",o=>{o.stopPropagation(),t.style.display=t.style.display==="none"?"block":"none"}),document.addEventListener("click",o=>{!t?.contains(o.target)&&o.target!==e&&(t.style.display="none")});const n=document.getElementById("toby-egg");if(n){const o=n.textContent;let a=!1;n.addEventListener("mouseenter",()=>{a||(n.textContent="Toby Woby is working on it...",n.style.color="#fbbf24")}),n.addEventListener("mouseleave",()=>{a||(n.textContent=o,n.style.color="")}),n.addEventListener("dblclick",()=>{a=!0,n.textContent="🐕 Toby Woby is STILL working on it",n.style.color="#fbbf24",n.title="Legend has it, Toby has been 'working on it' since 2019..."})}}async function Yo(){try{lo(ut),fo(Be),uo(Lo),_n(_t),On(Ot),Ro(ut),window.toggleMap=$o,window.toggleLearning=Co,window.resetShadowModels=ko,window.resetGFLearning=vo,window.resetLowFlowBins=wo,window.downloadTechAppendix=Qo,Rn(),ye("syncing"),qn(),jn(),ro(),no();const e=await Ln();it(e),await Ze(),po().catch(t=>console.warn("Forecast accuracy load error:",t)),gt(),mt(),pt(),Wo(),zo(),Ko(),Ht(),await Ve()}catch(e){console.error("Init error:",e),it(Ye()),gt(),mt(),pt(),Ve()}}Yo().catch(e=>console.error("Init failed:",e));setInterval(Ve,9e5);console.log("Potomac Pulse main.js loaded");
