(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerPolicy&&(a.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?a.credentials="include":s.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function o(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const q={LEADS:"DATA NGUỒN MKT HẢO",BOOKED:"KHÁCH ĐẶT HẸN",ARRIVED:"KHÁCH ĐÃ ĐẾN"},xe="1227076939",_={STT:0,DATE:1,NAME:2,PHONE:3,SERVICE:4,SOURCE:5,LINK:6,INFO:7,STATUS:8,TIME:9,APT_DATE:10,STAFF:11,REVENUE:22};function Ee(e){const t=e.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);if(!t)throw new Error("URL Google Sheet không hợp lệ");return t[1]}async function U(e,t){var l,c;const n=encodeURIComponent(t),o=`https://docs.google.com/spreadsheets/d/${e}/gviz/tq?tqx=out:json&sheet=${n}`,s=await fetch(o);if(!s.ok)throw new Error(`Không thể tải tab "${t}"`);const i=(await s.text()).match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);if(!i)throw new Error(`Dữ liệu tab "${t}" không hợp lệ`);const r=JSON.parse(i[1]);if(r.status==="error")throw new Error(((c=(l=r.errors)==null?void 0:l[0])==null?void 0:c.message)||"Lỗi không xác định");return r.table}async function Te(e){var i,r;const t=`https://docs.google.com/spreadsheets/d/${e}/gviz/tq?tqx=out:json&gid=${xe}`,n=await fetch(t);if(!n.ok)throw new Error("Không thể tải tab Marketing");const s=(await n.text()).match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);if(!s)throw new Error("Dữ liệu tab Marketing không hợp lệ");const a=JSON.parse(s[1]);if(a.status==="error")throw new Error(((r=(i=a.errors)==null?void 0:i[0])==null?void 0:r.message)||"Lỗi không xác định");return a.table}function g(e){return!e||e.v===null||e.v===void 0?null:e.v}function Y(e){if(!e||!e.v)return null;if(typeof e.v=="string"&&e.v.startsWith("Date(")){const t=e.v.match(/Date\((\d+),\s*(\d+),\s*(\d+)/);if(t)return new Date(parseInt(t[1]),parseInt(t[2]),parseInt(t[3]))}if(e.v instanceof Date)return e.v;if(typeof e.v=="string"){const t=e.v.split(/[\s/:-]/);if(e.v.includes("/")&&t.length>=3){const o=parseInt(t[0],10),s=parseInt(t[1],10),a=parseInt(t[2],10);if(a>1900&&s<=12&&o<=31){const i=t[3]?parseInt(t[3],10):0,r=t[4]?parseInt(t[4],10):0;return new Date(a,s-1,o,i,r)}}const n=new Date(e.v);return isNaN(n.getTime())?null:n}return null}function V(e,t=!1){const n=e.rows||[],o=[];for(const s of n){const a=s.c||[],i=g(a[_.NAME]),r=g(a[_.PHONE]);if(!i&&!r)continue;const l=g(a[_.INFO]);if(l&&typeof l=="string"&&/^THÁNG\s+\d+/i.test(l)&&!i)continue;let c="";for(let m=12;m<Math.min(a.length,30);m++){const w=g(a[m]);w&&(c+=String(w).trim()+" | ")}c=c.replace(/ \| $/,"");let d=g(a[_.STATUS])||"",h=H(d);if(h==="unknown"||h==="other"){const m=c.toLowerCase();m.includes("hủy")||m.includes("không đi")||m.includes("huỷ")?d="Hủy Lịch":m.includes("dời")||m.includes("đổi ý")?d="Dời Lịch":m.includes("thuê bao")||m.includes("tắt máy")?d="Thuê Bao":m.includes("không nghe máy")||m.includes("knm")||m.includes("ko nghe")?d="Không Nghe Máy":(m.includes("không hoàn thành")||m.includes("fail"))&&(d="Không Hoàn Thành")}const v={stt:g(a[_.STT]),date:Y(a[_.DATE]),name:i?String(i).trim():"",phone:r?De(String(r)):"",service:g(a[_.SERVICE])||"",source:g(a[_.SOURCE])||"",link:g(a[_.LINK])||"",info:g(a[_.INFO])||"",status:String(d).trim(),time:g(a[_.TIME])||"",aptDate:Y(a[_.APT_DATE]),staff:g(a[_.STAFF])||"",note:c};t&&a[_.REVENUE]&&(v.revenue=g(a[_.REVENUE])||0),o.push(v)}return o}function De(e){let t=String(e).replace(/\D/g,"");return t.length===9&&(t="0"+t),t}async function $e(e){const[t,n,o]=await Promise.all([U(e,q.LEADS),U(e,q.BOOKED),U(e,q.ARRIVED)]),s=V(t),a=V(n),i=V(o,!0),r=new Set;i.forEach(c=>{c.phone&&r.add(c.phone.replace(/^0/,""))});const l=c=>{c.forEach(d=>{if(d.phone){const h=d.phone.replace(/^0/,"");r.has(h)&&(d.status="Đã Đến")}})};return l(s),l(a),{leads:s,booked:a,arrived:i}}function H(e){if(!e)return"unknown";const t=e.trim().toUpperCase();return t.includes("ĐÃ ĐẾN")?"arrived":t.includes("ĐẶT HẸN")||t.includes("ĐẶT HẸNT")?"booked":t.includes("DỜI")||t.includes("DỜI LỊCH")?"rescheduled":t.includes("HỦY")||t.includes("HUỶ")?"cancelled":t.includes("KHÔNG NGHE")||t.includes("KNM")?"no_answer":t.includes("THUÊ BAO")?"disconnected":t.includes("KHÔNG HOÀN THÀNH")?"failed":"other"}function y(e){return!e||isNaN(e)?"0":e>=1e9?(e/1e9).toFixed(1)+"B":e>=1e6?(e/1e6).toFixed(1)+"M":e>=1e3?(e/1e3).toFixed(0)+"K":e.toLocaleString("vi-VN")}function ce(e){return e?`${String(e.getDate()).padStart(2,"0")}/${String(e.getMonth()+1).padStart(2,"0")}`:"--"}function F(e){return e?`${String(e.getDate()).padStart(2,"0")}/${String(e.getMonth()+1).padStart(2,"0")}/${e.getFullYear()}`:"--"}function $(e){if(!e)return 0;if(typeof e=="number")return e;const t=String(e).replace(/[đ₫\s,.]/g,""),n=parseFloat(t);return isNaN(n)?0:n}function Se(e){const t=e.rows||[],n=[];let o=0,s=0;for(const[a,i]of t.entries()){const r=i.c||[],l=r[0];if(!l||!l.v){if(a<5&&r[1]&&r[2]){const h=$(g(r[1])),v=$(g(r[2]));(h>0||v>0)&&v>s&&(o=h||o,s=v||s)}continue}const c=String(l.v).trim();if(c.toUpperCase().includes("TỔNG")||c.toUpperCase().includes("THÁNG")||c==="")continue;const d=Y(l);d&&n.push({date:d,received:$(g(r[2]))||0,marketing_cost:$(g(r[3])),ad_management_fee:$(g(r[4])),cost:$(g(r[5])),data_nangco:Number(g(r[6]))||0,data_muichi:Number(g(r[7]))||0,data_khac:Number(g(r[8]))||0,hen_nangco:Number(g(r[9]))||0,hen_muichi:Number(g(r[10]))||0,hen_khac:Number(g(r[11]))||0,toi_nangco:Number(g(r[12]))||0,toi_muichi:Number(g(r[13]))||0,toi_khac:Number(g(r[14]))||0,revenue:$(g(r[15])),messages:Number(g(r[17]))||0})}return n.globalBalance=o,n.globalReceived=s,n}async function Ce(e){const t=await Te(e);return Se(t)}function Ie(e){if(!e)return!1;const t=new Date;return e.getDate()===t.getDate()&&e.getMonth()===t.getMonth()&&e.getFullYear()===t.getFullYear()}function Le(e){if(!e)return!1;const t=new Date,n=new Date(t),o=t.getDay(),s=o===0?6:o-1;n.setDate(t.getDate()-s),n.setHours(0,0,0,0);const a=new Date(n);return a.setDate(n.getDate()+6),a.setHours(23,59,59,999),e>=n&&e<=a}function Be(e){if(!e)return!1;const t=new Date;return e.getMonth()===t.getMonth()&&e.getFullYear()===t.getFullYear()}function Me(e){if(!e)return!1;const t=new Date;let n=t.getMonth()-1,o=t.getFullYear();return n<0&&(n=11,o--),e.getMonth()===n&&e.getFullYear()===o}function Ne(e){const t=H(e),o={booked:{class:"badge--booked",icon:"✅",label:"Đặt Hẹn"},rescheduled:{class:"badge--rescheduled",icon:"🔄",label:"Dời Lịch"},cancelled:{class:"badge--cancelled",icon:"❌",label:"Hủy Lịch"},arrived:{class:"badge--arrived",icon:"🏥",label:"Đã Đến"}}[t]||{class:"badge--booked",icon:"📋",label:e};return`<span class="badge ${o.class}">${o.icon} ${o.label}</span>`}function Ae(e){const t="0"+e.replace(/^0/,"");navigator.clipboard.writeText(t).then(()=>{var n;(n=window.showToast)==null||n.call(window,`Đã copy: ${t}`,"success")}).catch(()=>{var n;(n=window.showToast)==null||n.call(window,"Không thể copy","error")})}window.copyPhone=Ae;let I=!1;function de(e,t="today"){const n=document.getElementById("appointmentBody"),o=document.getElementById("appointmentEmpty");document.getElementById("appointmentTableWrapper");const s=document.getElementById("sortDateBtn");if(!n)return;s&&!s.hasAttribute("data-bound")&&(s.addEventListener("click",()=>{I=!I,s.innerHTML=`Ngày hẹn ${I?"↑":"↓"}`;const i=document.querySelector(".filter-tab--active");de(e,i?i.dataset.filter:"today")}),s.setAttribute("data-bound","true"),s.innerHTML=`Ngày hẹn ${I?"↑":"↓"}`);let a=e.filter(i=>{if(!i.aptDate)return!1;switch(t){case"today":return Ie(i.aptDate);case"week":return Le(i.aptDate);case"month":return Be(i.aptDate);case"lastmonth":return Me(i.aptDate);case"all":return!0;default:return!0}});if(a.sort((i,r)=>{var d,h;const l=((d=i.aptDate)==null?void 0:d.getTime())||0,c=((h=r.aptDate)==null?void 0:h.getTime())||0;return l!==c?I?l-c:c-l:I?(i.time||"").localeCompare(r.time||""):(r.time||"").localeCompare(i.time||"")}),a.length===0){n.innerHTML="",o.style.display="flex",document.querySelector(".data-table").style.display="none";return}o.style.display="none",document.querySelector(".data-table").style.display="",window.__appointmentData=a,n.innerHTML=a.map((i,r)=>`
    <tr>
      <td data-label="STT">${r+1}</td>
      <td class="td-name" data-label="Tên KH">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <span>${D(i.name)}</span>
          <button class="btn btn--icon" onclick="window.shareAppointmentItem(${r})" style="width:26px;height:26px;border:none;background:rgba(56, 189, 248, 0.1);color:var(--accent-blue);" title="Chia sẻ thông tin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
        </div>
      </td>
      <td class="td-phone" data-label="SĐT">
        <div style="display:flex; align-items:center; gap:8px;">
          <span onclick="copyPhone('${i.phone}')" title="Click để copy" style="cursor:pointer;">${fe(i.phone)}</span>
          <a href="tel:0${i.phone.replace(/^0/,"")}" title="Gọi điện" style="text-decoration:none; font-size:14px;" onclick="event.stopPropagation();">📞</a>
          <a href="https://zalo.me/0${i.phone.replace(/^0/,"")}" target="_blank" title="Chat Zalo" style="text-decoration:none; font-size:14px;" onclick="event.stopPropagation();">💙</a>
        </div>
      </td>
      <td class="td-service" data-label="Dịch vụ">${D(i.service)}</td>
      <td data-label="Giờ hẹn">${D(i.time||"--")}</td>
      <td data-label="Ngày hẹn">${ce(i.aptDate)}</td>
      <td data-label="Nhân viên">${D(i.staff)}</td>
      <td data-label="Trạng thái">${Ne(i.status)}</td>
      <td class="td-note" data-label="Ghi chú">${ue(i.note)}</td>
    </tr>
  `).join("")}function He(e,t){const n=new Date;n.setHours(0,0,0,0);const o=new Set;for(const s of t)s.phone&&o.add(s.phone.replace(/^0/,""));return e.filter(s=>{if(!s.aptDate)return!1;const a=new Date(s.aptDate);if(a.setHours(0,0,0,0),a>=n)return!1;const i=H(s.status);if(i==="cancelled"||i==="arrived")return!1;const r=s.phone.replace(/^0/,"");return!o.has(r)}).sort((s,a)=>{var i,r;return(((i=a.aptDate)==null?void 0:i.getTime())||0)-(((r=s.aptDate)==null?void 0:r.getTime())||0)})}function Fe(e){const t=document.getElementById("overdueList"),n=document.getElementById("overdueEmpty"),o=document.getElementById("overdueCount");if(!t)return;if(o.textContent=e.length,e.length===0){t.style.display="none",n.style.display="flex";return}t.style.display="flex",n.style.display="none",window.__overdueData=e;const s=new Date;t.innerHTML=e.map((a,i)=>{const r=Math.floor((s-a.aptDate)/864e5);return`
      <div class="overdue-item">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
            <div class="overdue-item__name" style="margin-bottom:0;">${D(a.name)}</div>
            <button class="btn btn--icon" onclick="window.shareOverdueItem(${i})" style="width:26px;height:26px;border:none;background:rgba(56, 189, 248, 0.1);color:var(--accent-blue);" title="Chia sẻ qua Zalo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </button>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <div class="overdue-item__phone" onclick="copyPhone('${a.phone}')" title="Click để copy" style="flex:1;">📞 ${fe(a.phone)}</div>
            <a href="tel:0${a.phone.replace(/^0/,"")}" title="Gọi điện" style="text-decoration:none; font-size:14px;">📞</a>
            <a href="https://zalo.me/0${a.phone.replace(/^0/,"")}" target="_blank" title="Chat Zalo" style="text-decoration:none; font-size:14px;">💙</a>
        </div>
        <div class="overdue-item__meta">
          <span>Hẹn: ${F(a.aptDate)}</span>
          <span class="overdue-item__days">${r} ngày trước</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${D(a.service)}</div>
        ${a.note?`<div style="font-size:12px;color:var(--text-primary);margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-subtle);word-wrap:break-word;">${ue(a.note)}</div>`:""}
      </div>
    `}).join("")}function D(e){return e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function ue(e){if(!e)return"";const t=String(e),n=t.split(`
`).map(o=>o.trim()).filter(o=>o.length>0);return n.length>1?n.map((o,s)=>`<b>[${s+1}]</b> ${D(o)}`).join("<br>"):D(t)}window.shareAppointmentItem=function(e){const t=window.__appointmentData[e];if(!t)return;const n=`📌 THÔNG TIN LỊCH HẸN
👤 Khách hàng: ${t.name}
📞 SĐT: 0${t.phone.replace(/^0/,"")}
⏰ Hẹn ngày: ${F(t.aptDate)} lúc ${t.time||"--"}
Dịch vụ: ${t.service||"Không có"}
Trạng thái: ${t.status||"Chưa xác định"}
📝 Ghi chú:
${t.note||"Không có"}
`;navigator.share?navigator.share({title:"Thông tin Lịch Hẹn",text:n}).catch(o=>{console.log("Share failed:",o),navigator.clipboard.writeText(n).then(()=>{var s;(s=window.showToast)==null||s.call(window,"Đã copy thông tin để dán vào Zalo","success")})}):navigator.clipboard.writeText(n).then(()=>{var o;(o=window.showToast)==null||o.call(window,"Đã copy thông tin để dán vào Zalo","success")})};window.shareOverdueItem=function(e){const t=window.__overdueData[e];if(!t)return;const s=`📌 KHÁCH QUÁ HẸN CHƯA ĐẾN (${Math.floor((new Date-t.aptDate)/(1e3*60*60*24))} ngày)
👤 Khách hàng: ${t.name}
📞 SĐT: 0${t.phone.replace(/^0/,"")}
⏰ Hẹn ngày: ${F(t.aptDate)}
Dịch vụ: ${t.service||"Không có"}
📝 Ghi chú:
${t.note||"Không có"}
`;navigator.share?navigator.share({title:"Thông tin Khách Quá Hẹn",text:s}).catch(a=>{console.log("Share failed:",a),navigator.clipboard.writeText(s).then(()=>{var i;(i=window.showToast)==null||i.call(window,"Đã copy thông tin để dán vào Zalo","success")})}):navigator.clipboard.writeText(s).then(()=>{var a;(a=window.showToast)==null||a.call(window,"Đã copy thông tin để dán vào Zalo","success")})};function fe(e){if(!e)return"--";const t=e.replace(/^0/,"");return t.length===9?`0${t.substring(0,3)} ${t.substring(3,6)} ${t.substring(6)}`:"0"+t}function Re(e,t,n){const o=e.length,s=t.length,a=n.length,i=n.reduce((l,c)=>l+(Number(String(c.revenue||0).replace(/[,.]/g,""))||0),0);G("kpiTotalLeadValue",o),G("kpiBookedValue",s),G("kpiArrivedValue",a);const r=document.getElementById("kpiRevenueValue");r&&(r.textContent=y(i))}function Pe(e,t,n){const o=document.getElementById("funnelChart");if(!o)return;const s=e.length||1,a=t.length,i=n.length,r=(a/s*100).toFixed(1),l=(i/s*100).toFixed(1);o.innerHTML=`
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📥 Tổng Lead</span>
        <span class="funnel-bar__value">${s}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--lead" style="width: 100%">
          <span class="funnel-bar__percent">100%</span>
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📅 Đặt Hẹn</span>
        <span class="funnel-bar__value">${a}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--booked" style="width: ${r}%">
          ${parseFloat(r)>15?`<span class="funnel-bar__percent">${r}%</span>`:""}
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">✅ Đã Đến</span>
        <span class="funnel-bar__value">${i}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--arrived" style="width: ${l}%">
          ${parseFloat(l)>15?`<span class="funnel-bar__percent">${l}%</span>`:""}
        </div>
      </div>
    </div>
    
    <div class="funnel-rate">
      <div class="funnel-rate__label">Tỷ lệ chuyển đổi tổng</div>
      <div class="funnel-rate__value">${l}%</div>
    </div>
  `,requestAnimationFrame(()=>{o.querySelectorAll(".funnel-bar__fill").forEach(c=>{const d=c.style.width;c.style.width="0%",requestAnimationFrame(()=>{c.style.width=d})})})}function Ke(e){const t=document.getElementById("revenueChart");if(!t)return;const n={};let o=0;for(const r of e){const l=Number(String(r.revenue||0).replace(/[,.]/g,""))||0;if(l<=0)continue;const c=r.service||"Khác";n[c]=(n[c]||0)+l,o+=l}const s=Object.entries(n).sort(([,r],[,l])=>l-r),a=s.length>0?s[0][1]:1,i=s.map(([r,l])=>{const c=(l/a*100).toFixed(0);return`
      <div class="revenue-item">
        <div class="revenue-item__header">
          <span class="revenue-item__label">${qe(r)}</span>
          <span class="revenue-item__value">${y(l)}</span>
        </div>
        <div class="revenue-item__bar">
          <div class="revenue-item__fill" style="width: ${c}%"></div>
        </div>
      </div>
    `}).join("");t.innerHTML=`
    ${i}
    <div class="revenue-total">
      <div class="revenue-total__label">Tổng doanh số</div>
      <div class="revenue-total__value">${y(o)}</div>
    </div>
  `,requestAnimationFrame(()=>{t.querySelectorAll(".revenue-item__fill").forEach(r=>{const l=r.style.width;r.style.width="0%",requestAnimationFrame(()=>{r.style.width=l})})})}function Oe(e){const t=document.getElementById("statusChart");if(!t)return;const n={};for(const i of e){const r=H(i.status);n[r]=(n[r]||0)+1}const o={booked:{label:"Đặt Hẹn",color:"var(--status-booked)"},arrived:{label:"Đã Đến",color:"var(--status-arrived)"},rescheduled:{label:"Dời Lịch",color:"var(--status-rescheduled)"},cancelled:{label:"Hủy Lịch",color:"var(--status-cancelled)"},no_answer:{label:"Không Nghe Máy",color:"var(--accent-purple)"},disconnected:{label:"Thuê Bao",color:"var(--text-muted)"},failed:{label:"Không Hoàn Thành",color:"var(--accent-pink)"},other:{label:"Khác",color:"var(--text-muted)"}},s=e.length||1,a=Object.entries(n).sort(([,i],[,r])=>r-i);t.innerHTML=a.map(([i,r])=>{const l=o[i]||o.other,c=(r/s*100).toFixed(0);return`
      <div class="status-item">
        <div class="status-item__dot" style="background: ${l.color}"></div>
        <span class="status-item__label">${l.label}</span>
        <div class="status-item__bar-wrap">
          <div class="status-item__bar" style="width: ${c}%; background: ${l.color}"></div>
        </div>
        <span class="status-item__count">${r}</span>
      </div>
    `}).join(""),requestAnimationFrame(()=>{t.querySelectorAll(".status-item__bar").forEach(i=>{const r=i.style.width;i.style.width="0%",requestAnimationFrame(()=>{i.style.width=r})})})}function ze(e){const t=document.getElementById("revenuePieChart");if(!t)return;window.revenuePieChartInstance&&window.revenuePieChartInstance.destroy();const n={};for(const l of e){const c=Number(String(l.revenue||0).replace(/[,.]/g,""))||0;if(c<=0)continue;const d=l.service||"Khác";n[d]=(n[d]||0)+c}const o=Object.entries(n).sort(([,l],[,c])=>c-l),s=o.slice(0,6),a=o.slice(6).reduce((l,[,c])=>l+c,0),i=s.map(l=>l[0]),r=s.map(l=>l[1]);a>0&&(i.push("Cơ sở khác"),r.push(a)),window.revenuePieChartInstance=new Chart(t,{type:"doughnut",data:{labels:i,datasets:[{data:r,backgroundColor:["#38bdf8","#34d399","#fbbf24","#f472b6","#a78bfa","#10b981","#94a3b8"],borderWidth:0,hoverOffset:4}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{position:"right",labels:{color:"#64748b",font:{family:"Inter",size:11}}},tooltip:{callbacks:{label:function(l){return" "+l.label+": "+l.raw.toLocaleString("vi-VN")+" đ"}}}},cutout:"65%"}})}function G(e,t){const n=document.getElementById(e);if(!n)return;const o=800,s=performance.now(),a=0;function i(r){const l=r-s,c=Math.min(l/o,1),d=1-Math.pow(1-c,3),h=Math.floor(a+(t-a)*d);n.textContent=h.toLocaleString("vi-VN"),c<1&&requestAnimationFrame(i)}requestAnimationFrame(i)}function qe(e){return e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):""}function ie(e,t,n,o){const s=document.getElementById(e);if(!s)return;const a=t||1,i=(n/a*100).toFixed(1),r=(o/a*100).toFixed(1);s.innerHTML=`
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📥 Tổng Data</span>
        <span class="funnel-bar__value">${t}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--lead" style="width: 100%">
          <span class="funnel-bar__percent">100%</span>
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">📅 Lịch Hẹn</span>
        <span class="funnel-bar__value">${n}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--booked" style="width: ${i}%">
          ${parseFloat(i)>15?`<span class="funnel-bar__percent">${i}%</span>`:""}
        </div>
      </div>
    </div>
    
    <div class="funnel-bar">
      <div class="funnel-bar__header">
        <span class="funnel-bar__label">✅ Khách Tới</span>
        <span class="funnel-bar__value">${o}</span>
      </div>
      <div class="funnel-bar__track">
        <div class="funnel-bar__fill funnel-bar__fill--arrived" style="width: ${r}%">
          ${parseFloat(r)>15?`<span class="funnel-bar__percent">${r}%</span>`:""}
        </div>
      </div>
    </div>
    
    <div class="funnel-rate">
      <div class="funnel-rate__label">Tỷ lệ chuyển đổi tổng</div>
      <div class="funnel-rate__value">${r}%</div>
    </div>
  `,requestAnimationFrame(()=>{s.querySelectorAll(".funnel-bar__fill").forEach(l=>{const c=l.style.width;l.style.width="0%",requestAnimationFrame(()=>{l.style.width=c})})})}function Ue(e,t,n,o,s){const a=document.getElementById("mktPieBudget");if(a){const r=t>0?e/t*100:e>0?100:0,l=Math.max(0,100-r);e===0&&t===0?a.innerHTML='<div class="pie-chart-empty">Chưa có dữ liệu</div>':a.innerHTML=`
        <div class="pie-chart-wrapper">
          <div class="pie-chart donut" style="background: conic-gradient(var(--accent-red) 0% ${r}%, var(--accent-emerald) ${r}% 100%);">
            <span class="donut-inner">${l.toFixed(1)}%<br/><small style="font-size:10px;color:var(--text-secondary)">Lợi nhuận</small></span>
          </div>
          <div class="pie-legend">
            <div class="pie-legend-item"><span class="color-box" style="background:var(--accent-red)"></span>Ngân sách (${r.toFixed(1)}%)</div>
            <div class="pie-legend-item"><span class="color-box" style="background:var(--accent-emerald)"></span>Lợi nhuận (${l.toFixed(1)}%)</div>
          </div>
        </div>
      `}const i=document.getElementById("mktPieServices");if(i){const r=n+o+s;if(r===0)i.innerHTML='<div class="pie-chart-empty">Chưa có dữ liệu</div>';else{const l=n/r*100,c=o/r*100,d=s/r*100,h=l,v=h+c;i.innerHTML=`
        <div class="pie-chart-wrapper">
          <div class="pie-chart donut" style="background: conic-gradient(var(--accent-blue) 0% ${h}%, var(--accent-purple) ${h}% ${v}%, var(--text-tertiary) ${v}% 100%);">
            <span class="donut-inner">${r}<br/><small style="font-size:10px;color:var(--text-secondary)">Tổng KH đến</small></span>
          </div>
          <div class="pie-legend">
            <div class="pie-legend-item"><span class="color-box" style="background:var(--accent-blue)"></span>Nâng Cơ (${l.toFixed(1)}%)</div>
            <div class="pie-legend-item"><span class="color-box" style="background:var(--accent-purple)"></span>Mũi Chỉ (${c.toFixed(1)}%)</div>
            <div class="pie-legend-item"><span class="color-box" style="background:var(--text-tertiary)"></span>Khác (${d.toFixed(1)}%)</div>
          </div>
        </div>
      `}}}const Ve="bsn_apps_script_url";function W(){return localStorage.getItem(Ve)||""}async function Z(e,t){const n=W();if(!n)throw new Error("Chưa cấu hình Apps Script URL. Vui lòng paste URL vào phần cài đặt.");const o=JSON.stringify({action:e,...t}),s=await fetch(n,{method:"POST",headers:{"Content-Type":"text/plain"},body:o});if(!s.ok)throw new Error(`Lỗi kết nối Apps Script: ${s.status}`);const a=await s.json();if(a.error)throw new Error(a.error);return a}async function Ge({name:e,phone:t,service:n,source:o,note:s}){return Z("addLead",{name:e,phone:t,service:n,source:o,note:s})}async function je({phone:e,tab:t,row:n,status:o}){return Z("updateStatus",{phone:e,tab:t,row:n,status:o})}async function Ye({phone:e,tab:t,row:n,note:o}){return Z("updateNote",{phone:e,tab:t,row:n,note:o})}function Qe(e,t){const n=le(e);if(!n||n.length<9)return[];const o=[],s=[{data:t.leads||[],tab:"Leads"},{data:t.booked||[],tab:"Đặt Hẹn"},{data:t.arrived||[],tab:"Đã Đến"}];for(const{data:a,tab:i}of s)for(const r of a){const l=le(r.phone);l&&l===n&&o.push({...r,_tab:i})}return o}function le(e){if(!e)return"";let t=String(e).replace(/\D/g,"");return t.length===9&&(t="0"+t),t}let M=null,C=null;function We({getData:e,onRefresh:t}){M=e,C=t,Ze(),Je(),Xe()}function Ze(){const e=document.getElementById("addLeadFab");e&&e.addEventListener("click",()=>et())}function Je(){document.querySelectorAll(".modal-overlay").forEach(o=>{o.addEventListener("click",s=>{s.target===o&&N()})}),document.querySelectorAll(".modal__close").forEach(o=>{o.addEventListener("click",N)}),document.addEventListener("keydown",o=>{o.key==="Escape"&&N()});const e=document.getElementById("addLeadForm");e&&e.addEventListener("submit",tt);const t=document.getElementById("detailStatus");t&&t.addEventListener("change",at);const n=document.getElementById("saveNoteBtn");n&&n.addEventListener("click",ot)}function Xe(){const e=document.getElementById("appointmentBody");e&&e.addEventListener("click",t=>{var r,l,c;const n=t.target.closest("tr[data-record-index]");if(!n)return;const o=parseInt(n.dataset.recordIndex),s=n.dataset.recordTab||"booked",a=M?M():null;if(!a)return;let i;s==="booked"?i=(r=a.booked)==null?void 0:r[o]:s==="arrived"?i=(l=a.arrived)==null?void 0:l[o]:i=(c=a.leads)==null?void 0:c[o],i&&nt(i,s,o)})}function et(){var t;if(!W()){E("Vui lòng nhập Apps Script URL trước","error");return}const e=document.getElementById("addLeadModal");if(e){e.classList.add("active"),(t=document.getElementById("addLeadName"))==null||t.focus();const n=document.getElementById("duplicateWarning");n&&(n.style.display="none")}}async function tt(e){var c,d,h,v,m,w;e.preventDefault();const t=(c=document.getElementById("addLeadName"))==null?void 0:c.value.trim(),n=(d=document.getElementById("addLeadPhone"))==null?void 0:d.value.trim(),o=(h=document.getElementById("addLeadService"))==null?void 0:h.value.trim(),s=(v=document.getElementById("addLeadSource"))==null?void 0:v.value.trim(),a=(m=document.getElementById("addLeadNote"))==null?void 0:m.value.trim();if(!t||!n){E("Vui lòng nhập Tên và SĐT","error");return}const i=n.replace(/\D/g,"");if(i.length<9||i.length>11){E("SĐT không hợp lệ (phải 9-11 số)","error");return}const r=M?M():null;if(r){const k=Qe(n,r);if(k.length>0){const x=document.getElementById("duplicateWarning");x&&(x.innerHTML=`⚠️ SĐT đã tồn tại: <strong>${k[0].name}</strong> (${k[0]._tab}) — Trạng thái: ${k[0].status||"N/A"}`,x.style.display="block");const b=document.getElementById("forceAddCheck");if(b&&!b.checked){E('SĐT đã tồn tại! Tick "Vẫn thêm" để tiếp tục',"error");return}}}const l=document.getElementById("addLeadSubmitBtn");l&&(l.disabled=!0,l.textContent="Đang thêm...");try{await Ge({name:t,phone:i,service:o,source:s,note:a}),E(`Đã thêm lead: ${t}`,"success"),N(),(w=document.getElementById("addLeadForm"))==null||w.reset(),C&&C()}catch(k){E(`Lỗi: ${k.message}`,"error")}finally{l&&(l.disabled=!1,l.textContent="Thêm Lead")}}let T={record:null,tab:"",row:-1};function nt(e,t,n){if(!W()){E("Vui lòng nhập Apps Script URL để chỉnh sửa","error");return}T={record:e,tab:t,row:n},document.getElementById("detailName").textContent=e.name||"--",document.getElementById("detailPhone").textContent=e.phone||"--",document.getElementById("detailService").textContent=e.service||"--",document.getElementById("detailSource").textContent=e.source||"--",document.getElementById("detailDate").textContent=e.aptDate?`${e.aptDate.getDate()}/${e.aptDate.getMonth()+1}/${e.aptDate.getFullYear()}`:e.date?`${e.date.getDate()}/${e.date.getMonth()+1}/${e.date.getFullYear()}`:"--",document.getElementById("detailStaff").textContent=e.staff||"--";const o=document.getElementById("detailStatus");o&&(o.value=e.status||"");const s=document.getElementById("detailNote");s&&(s.value=e.note||"");const a=document.getElementById("detailModal");a&&a.classList.add("active")}async function at(){var t;const e=(t=document.getElementById("detailStatus"))==null?void 0:t.value;if(!(!e||!T.record))try{await je({phone:T.record.phone,tab:T.tab,row:T.row,status:e}),E(`Trạng thái → ${e}`,"success"),C&&C()}catch(n){E(`Lỗi: ${n.message}`,"error")}}async function ot(){var n;const e=(n=document.getElementById("detailNote"))==null?void 0:n.value.trim();if(!T.record)return;const t=document.getElementById("saveNoteBtn");t&&(t.disabled=!0,t.textContent="Đang lưu...");try{await Ye({phone:T.record.phone,tab:T.tab,row:T.row,note:e}),E("Đã lưu ghi chú","success"),C&&C()}catch(o){E(`Lỗi: ${o.message}`,"error")}finally{t&&(t.disabled=!1,t.textContent="Lưu ghi chú")}}function N(){document.querySelectorAll(".modal-overlay").forEach(e=>e.classList.remove("active"))}function E(e,t="info"){const n=document.getElementById("toastContainer");if(!n)return;const o=document.createElement("div");o.className=`toast toast--${t}`,o.textContent=e,n.appendChild(o),setTimeout(()=>{o.style.animation="toastOut 0.3s ease-in forwards",setTimeout(()=>o.remove(),300)},3e3)}let p={sheetId:null,data:null,marketingData:null,currentFilter:"today",customStart:null,customEnd:null,searchQuery:"",autoRefreshInterval:null,autoRefreshMs:3600*1e3};const f={};function rt(){f.refreshBtn=document.getElementById("refreshBtn"),f.lastRefresh=document.getElementById("lastRefresh"),f.autoRefreshToggle=document.getElementById("autoRefreshToggle"),f.loadingOverlay=document.getElementById("loadingOverlay"),f.welcomeScreen=document.getElementById("welcomeScreen"),f.dashboard=document.getElementById("dashboard"),f.marketing=document.getElementById("marketing"),f.toastContainer=document.getElementById("toastContainer"),f.globalSearch=document.getElementById("globalSearch"),f.customDatePicker=document.getElementById("customDatePicker"),f.dateStart=document.getElementById("dateStart"),f.dateEnd=document.getElementById("dateEnd"),f.applyCustomDateBtn=document.getElementById("applyCustomDateBtn")}window.showToast=function(e,t="info"){const n=document.createElement("div");n.className=`toast toast--${t}`,n.textContent=e,f.toastContainer.appendChild(n),setTimeout(()=>{n.style.animation="toastOut 0.3s ease-out forwards",setTimeout(()=>n.remove(),300)},3e3)};function st(){f.loadingOverlay.classList.add("active"),f.refreshBtn.classList.add("refreshing")}function it(){f.loadingOverlay.classList.remove("active"),f.refreshBtn.classList.remove("refreshing")}async function lt(){let e="";if(f.dashboard?e="https://docs.google.com/spreadsheets/d/19Q1Fy1bvnElYhGCCLdDzC4TRzIJQn73lk7LpEN7fX2Q/edit?usp=sharing":f.marketing&&(e="https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/edit?gid=1227076939#gid=1227076939"),!!e)try{p.sheetId=Ee(e),localStorage.setItem("bsn_sheet_url",e),await R(),showToast("Kết nối thành công! 🎉","success")}catch(t){showToast(t.message,"error"),console.error("Connect error:",t)}}async function R(){if(p.sheetId){st();try{const e=document.querySelector(".filter-tabs .filter-tab--active");if(e&&(p.currentFilter=e.dataset.filter||"today"),f.welcomeScreen.style.display="none",f.dashboard&&(f.dashboard.style.display="flex"),f.marketing&&(f.marketing.style.display="flex"),f.dashboard&&(p.data=await $e(p.sheetId),A()),f.marketing)try{p.marketingData=await Ce(p.sheetId),Q()}catch(n){console.error("Marketing Load error:",n),showToast("Không tải được dữ liệu Marketing","error")}const t=new Date;f.lastRefresh.textContent=`${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`}catch(e){showToast(`Lỗi tải dữ liệu: ${e.message}`,"error"),console.error("Load error:",e)}finally{it()}}}function ct(e,t){return!e||!t?!1:e.getDate()===t.getDate()&&e.getMonth()===t.getMonth()&&e.getFullYear()===t.getFullYear()}function dt(e){if(!e)return!1;const t=new Date;return t.setHours(23,59,59,999),e>t}function ut(e){if(!e)return!1;const t=new Date,n=new Date(t),o=t.getDay(),s=o===0?6:o-1;n.setDate(t.getDate()-s),n.setHours(0,0,0,0);const a=new Date(n);return a.setDate(n.getDate()+6),a.setHours(23,59,59,999),e>=n&&e<=a}function ft(e){if(!e)return!1;const t=new Date;return e.getMonth()===t.getMonth()&&e.getFullYear()===t.getFullYear()}function ht(e){if(!e)return!1;const t=new Date;let n=t.getMonth()-1,o=t.getFullYear();return n<0&&(n=11,o--),e.getMonth()===n&&e.getFullYear()===o}function S(e,t,n){return e.filter(o=>{const s=o[t];if(!s)return!1;switch(n){case"today":return ct(s,new Date);case"week":return ut(s);case"month":return ft(s);case"lastmonth":return ht(s);case"upcoming":return dt(s);case"all":return!0;case"custom":const a=p.customStart?new Date(p.customStart):null,i=p.customEnd?new Date(p.customEnd):null;return a&&a.setHours(0,0,0,0),i&&i.setHours(23,59,59,999),a&&i?s>=a&&s<=i:a?s>=a:i?s<=i:!0;default:return!0}})}function j(e,t){if(!t)return e;const n=t.toLowerCase();return e.filter(o=>{const s=o.name&&o.name.toLowerCase().includes(n),a=o.phone&&o.phone.replace(/^0/,"").includes(n.replace(/^0/,""));return s||a})}function A(){if(!p.data)return;const e=p.currentFilter;let t=S(p.data.leads,"date",e),n=S(p.data.booked,"aptDate",e),o=S(p.data.arrived,"aptDate",e);const s=p.searchQuery;t=j(t,s),n=j(n,s),o=j(o,s),Re(t,n,o),de(n,"all");const a=He(p.data.booked,p.data.arrived);Fe(a),Pe(t,n,o),Ke(o),Oe(t),ze(o)}function Q(){if(!p.marketingData)return;const e=p.currentFilter;let t=S(p.marketingData,"date",e);const n=new Date;n.setHours(23,59,59,999),t=t.filter(u=>u.date&&u.date<=n).sort((u,B)=>B.date.getTime()-u.date.getTime());let o=0,s=0,a=0,i=0,r=0,l=0,c=0,d=0,h=0,v=0,m=0,w=0,k=0,x=0,b="";for(const u of t){o+=u.cost,s+=u.marketing_cost||0,a+=u.ad_management_fee||0,i+=u.revenue,r+=u.messages||0,l+=u.received||0,c+=u.data_nangco,d+=u.hen_nangco,h+=u.toi_nangco,v+=u.data_muichi,m+=u.hen_muichi,w+=u.toi_muichi,k+=u.data_khac||0,x+=u.toi_khac||0;const B=y(u.cost),ve=y(u.revenue),ye=u.messages&&u.messages>0?y(u.cost/u.messages):"0",be=`Mkt: ${y(u.marketing_cost||0)}<br>QL: ${y(u.ad_management_fee||0)}`,z=(u.data_nangco||0)+(u.data_muichi||0)+(u.data_khac||0),we=(u.hen_nangco||0)+(u.hen_muichi||0)+(u.hen_khac||0),_e=(u.toi_nangco||0)+(u.toi_muichi||0)+(u.toi_khac||0),ke=z>0?y(u.cost/z):"0";b+=`
            <tr>
                <td class="td-name" data-label="Ngày">${F(u.date)}</td>
                <td style="color:var(--accent-red); font-weight:600" data-label="Chi phí">
                    <div>${B}</div>
                    <div style="font-size:11px; font-weight:normal; line-height:1.2; margin-top:2px;">${be}</div>
                </td>
                <td style="color:var(--accent-emerald); font-weight:600" data-label="Doanh thu">${ve}</td>
                <td style="font-weight:600; color:var(--accent-amber);" data-label="Tin nhắn">${u.messages||0}</td>
                <td data-label="DATA">${z}</td>
                <td data-label="HẸN">${we}</td>
                <td data-label="TỚI">${_e}</td>
                <td style="color:var(--accent-blue)" data-label="Giá 1 Tin">${ye}</td>
                <td style="color:var(--accent-purple)" data-label="Giá 1 Data">${ke}</td>
            </tr>
        `}const ge=i>0?(o/i*100).toFixed(2):0,J=h+w+t.reduce((u,B)=>u+B.toi_khac,0),me=J>0?o/J:0;L(document.getElementById("mktTổngChiPhí"),0,o,800,y);const X=document.getElementById("mktGlobalReceived");X&&L(X,0,l,800,y);const ee=document.getElementById("mktGlobalBalance");if(ee){const u=l-o;L(ee,0,u,800,y)}const P=document.getElementById("mktKpiReceived"),K=document.getElementById("mktKpiBalance");P&&K&&(e==="month"||e==="lastmonth"||e==="all"?(P.style.display="flex",K.style.display="flex"):(P.style.display="none",K.style.display="none"));const te=document.getElementById("mktCostBreakdown");te&&(te.textContent=`Ads: ${y(s)} - Phí QL: ${y(a)}`);const ne=document.getElementById("mktTổngDoanhSố");ne&&L(ne,0,i,800,y);const ae=document.getElementById("mktTổngTinNhắn");ae&&L(ae,0,r,800,u=>u.toLocaleString("vi-VN"));const oe=document.getElementById("mktCpmess");oe&&(oe.textContent=r>0?`Cost/Mess: ${y(o/r)}`:"0");const O=c+v+k,re=document.getElementById("mktTổngData");re&&L(re,0,O,800,u=>u.toLocaleString("vi-VN"));const se=document.getElementById("mktCpData");se&&(se.textContent=O>0?`Cost/Data: ${y(o/O)}`:"0"),document.getElementById("mktTỷLệChiPhí").textContent=ge+"%",document.getElementById("mktTỷLệTới").textContent=y(me),ie("mktFunnelNangCo",c,d,h),ie("mktFunnelMuiChi",v,m,w),Ue(o,i,h,w,x),pt(t),gt(p.marketingData),mt(p.marketingData),document.getElementById("mktTableBody").innerHTML=b}function pt(e){const t=document.getElementById("mktTrendChart");if(!t||(window.mktTrendChartInstance&&window.mktTrendChartInstance.destroy(),!e||e.length===0))return;const n=[...e].reverse(),o=n.map(r=>ce(r.date)),s=n.map(r=>r.cost/1e6),a=n.map(r=>(r.data_nangco||0)+(r.data_muichi||0)+(r.data_khac||0)),i=n.map(r=>(r.toi_nangco||0)+(r.toi_muichi||0)+(r.toi_khac||0));window.mktTrendChartInstance=new Chart(t,{type:"line",data:{labels:o,datasets:[{label:"Chi phí (Triệu)",data:s,borderColor:"#f43f5e",backgroundColor:"rgba(244, 63, 94, 0.1)",yAxisID:"y",tension:.4,fill:!0},{label:"Số Data",data:a,borderColor:"#3b82f6",backgroundColor:"rgba(59, 130, 246, 0.1)",yAxisID:"y1",tension:.4},{label:"Khách Tới",data:i,borderColor:"#10b981",backgroundColor:"rgba(16, 185, 129, 0.1)",yAxisID:"y1",tension:.4}]},options:{responsive:!0,maintainAspectRatio:!1,interaction:{mode:"index",intersect:!1},plugins:{legend:{position:"bottom"}},scales:{x:{grid:{display:!1}},y:{type:"linear",display:!0,position:"left",title:{display:!1,text:"Chi phí (Tr)"},beginAtZero:!0},y1:{type:"linear",display:!0,position:"right",title:{display:!1,text:"Số lượng"},grid:{drawOnChartArea:!1},beginAtZero:!0}}}})}function gt(e){const t=document.getElementById("momComparison");if(!t)return;if(!e||e.length===0){t.innerHTML='<div style="text-align:center;color:var(--text-muted);">Không có đủ dữ liệu</div>';return}const n=S(e,"date","month"),o=S(e,"date","lastmonth"),s=d=>{let h=0,v=0,m=0,w=0,k=0;for(const b of d)h+=b.revenue||0,v+=b.cost||0,m+=b.messages||0,w+=(b.data_nangco||0)+(b.data_muichi||0)+(b.data_khac||0),k+=(b.toi_nangco||0)+(b.toi_muichi||0)+(b.toi_khac||0);const x=w>0?v/w:0;return{rev:h,cost:v,msg:m,data:w,arrived:k,cpd:x}},a=s(n),i=s(o),r=(d,h,v)=>{if(h===0)return{pct:0,str:"--",cls:"neutral"};const m=d-h,w=m/h*100,k=Math.abs(w).toFixed(1);let x="neutral",b="";if(m>0)b="▲",x=v?"good":"bad";else if(m<0)b="▼",x=v?"bad":"good";else return{pct:0,str:"-",cls:"neutral"};return{pct:w,str:`${b} ${k}%`,cls:x}},l=[{label:"Chi phí MKT",c:a.cost,p:i.cost,fmt:y,goodUp:!1},{label:"Doanh số",c:a.rev,p:i.rev,fmt:y,goodUp:!0},{label:"Tin nhắn",c:a.msg,p:i.msg,fmt:d=>d.toLocaleString("vi-VN"),goodUp:!0},{label:"Tổng Data",c:a.data,p:i.data,fmt:d=>d.toLocaleString("vi-VN"),goodUp:!0},{label:"Khách Tới",c:a.arrived,p:i.arrived,fmt:d=>d.toLocaleString("vi-VN"),goodUp:!0},{label:"Giá/Data",c:a.cpd,p:i.cpd,fmt:y,goodUp:!1}];let c='<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">';for(const d of l){const h=r(d.c,d.p,d.goodUp),v=h.cls==="good"?"color:var(--accent-emerald)":h.cls==="bad"?"color:var(--accent-red)":"color:var(--text-muted)";c+=`
            <div style="background:var(--bg-secondary); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:4px;">${d.label}</div>
                <div style="font-size:16px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">${d.fmt(d.c)}</div>
                <div style="font-size:12px; font-weight:600; ${v}">${h.str}</div>
            </div>
        `}c+="</div>",t.innerHTML=c}function mt(e){const t=document.getElementById("mktPeriodAnalysis");if(!t)return;const n=S(e,"date","month");if(!n||n.length===0){t.innerHTML='<div style="text-align:center;color:var(--text-muted);">Không có đủ dữ liệu</div>';return}const o={dau_thang:{label:"Đầu tháng (1-10)",data:[]},giua_thang:{label:"Giữa tháng (11-20)",data:[]},cuoi_thang:{label:"Cuối tháng (21+)",data:[]}};for(const i of n){const r=i.date.getDate();r<=10?o.dau_thang.data.push(i):r<=20?o.giua_thang.data.push(i):o.cuoi_thang.data.push(i)}const s=i=>{let r=0,l=0,c=0;for(const h of i)r+=h.cost||0,c+=h.messages||0,l+=(h.data_nangco||0)+(h.data_muichi||0)+(h.data_khac||0);const d=i.length||1;return{avgCost:r/d,avgData:(l/d).toFixed(1),cpd:l>0?r/l:0}};let a='<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">';for(const i of["dau_thang","giua_thang","cuoi_thang"]){const r=o[i],l=s(r.data);a+=`
            <div style="background:var(--bg-secondary); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
                <div style="font-size:12px; color:var(--text-primary); font-weight:700; margin-bottom:12px; border-bottom:1px solid var(--border-subtle); padding-bottom:6px;">${r.label}</div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:var(--text-muted);">Chi phí/ngày:</span>
                    <span style="font-size:12px; font-weight:600;">${y(l.avgCost)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                    <span style="font-size:11px; color:var(--text-muted);">Data/ngày:</span>
                    <span style="font-size:12px; font-weight:600;">${l.avgData}</span>
                </div>
                 <div style="display:flex; justify-content:space-between;">
                    <span style="font-size:11px; color:var(--text-muted);">Giá 1 Data:</span>
                    <span style="font-size:12px; font-weight:700; color:var(--accent-purple);">${y(l.cpd)}</span>
                </div>
            </div>
        `}a+="</div>",t.innerHTML=a}function L(e,t,n,o,s=a=>a){if(!e)return;let a=null;const i=n<t,r=l=>{a||(a=l);const c=Math.min((l-a)/o,1),d=i?Math.ceil(t-c*(t-n)):Math.floor(c*(n-t)+t);e.textContent=s(d),c<1&&window.requestAnimationFrame(r)};window.requestAnimationFrame(r)}function he(){pe(),p.autoRefreshInterval=setInterval(()=>{R()},p.autoRefreshMs)}function pe(){p.autoRefreshInterval&&(clearInterval(p.autoRefreshInterval),p.autoRefreshInterval=null)}function vt(){var e,t,n,o,s;(e=f.refreshBtn)==null||e.addEventListener("click",()=>{p.sheetId?R():showToast("Chưa kết nối Google Sheet","error")}),(t=f.autoRefreshToggle)==null||t.addEventListener("change",a=>{a.target.checked?(he(),showToast("Auto-refresh: BẬT (mỗi 1 tiếng)","info")):(pe(),showToast("Auto-refresh: TẮT","info"))}),(n=document.getElementById("filterTabs"))==null||n.addEventListener("click",a=>{const i=a.target.closest(".filter-tab");if(i){document.querySelectorAll(".filter-tab").forEach(l=>l.classList.remove("filter-tab--active")),i.classList.add("filter-tab--active");const r=i.dataset.filter;f.customDatePicker&&(f.customDatePicker.style.display=r==="custom"?"flex":"none"),p.currentFilter=r,f.dashboard&&A(),f.marketing&&Q()}}),(o=f.globalSearch)==null||o.addEventListener("input",a=>{p.searchQuery=a.target.value.trim(),f.dashboard&&A()}),(s=f.applyCustomDateBtn)==null||s.addEventListener("click",()=>{if(!f.dateStart.value&&!f.dateEnd.value){showToast("Vui lòng chọn ngày","error");return}p.customStart=f.dateStart.value,p.customEnd=f.dateEnd.value,f.dashboard&&A(),f.marketing&&Q(),showToast("Đã áp dụng bộ lọc ngày","success")})}function yt(){rt(),vt(),We({getData:()=>p.data,onRefresh:()=>{p.sheetId&&R()}}),document.body.classList.add("light-theme"),lt(),f.autoRefreshToggle.checked&&he()}document.addEventListener("DOMContentLoaded",yt);
