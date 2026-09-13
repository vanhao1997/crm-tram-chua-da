export function buildAggregatePayload(model = {}, crm = {}) {
  const safe = v => v == null || Number.isFinite(Number(v)) ? v : null;
  const activePhase = (model.phases || []).find(p => p.phase === model.currentPhase) || model.phases?.[0] || {};
  const current = activePhase.current || model.current || {};
  const eff = current.efficiency || {};
  const historical = activePhase.baseline || model.historical || {};
  const daily = (model.phases || []).flatMap(p => (p.days || []).map(d => ({
    date: d.dateKey || null, phase: p.phase || null,
    ads: safe(d.marketing_cost), managementFee: safe(d.ad_management_fee), totalCost: safe(d.cost),
    revenue: safe(d.revenue), data: safe(d.dataTotal), booked: safe(d.bookedTotal), arrived: safe(d.arrivedTotal),
    completeness: d.dataCompleteness?.complete ?? null,
    issues: (d.dataCompleteness?.issues || []).map(i => i.code || i.message).slice(0, 8)
  })));
  const issues = model.recommendation?.issues || [];`n  const aggregateCrm = ["leads","booked","arrived"].reduce((out, key) => { const rows = Array.isArray(crm?.[key]) ? crm[key] : []; out[key] = { count: rows.length, byService: rows.reduce((m, r) => { const service = String(r.service || "Khong xac dinh").trim(); m[service] = (m[service] || 0) + 1; return m; }, {}) }; return out; }, {});
  return { period: { monthKey: model.monthKey || null, cutoffDate: model.cutoffKey || null, phase: model.currentPhase || null },
    current: { ads:safe(current.ads), managementFee:safe(current.managementFee), totalCost:safe(current.cost), revenue:safe(current.revenue), roas:safe(eff.roas), costPerData:safe(eff.costPerData), costPerArrived:safe(eff.costPerArrived), data:safe(current.data), booked:safe(current.booked), arrived:safe(current.arrived), bookingRate:safe(eff.bookingRate), arrivalRate:safe(eff.arrivalRate), completeDays:safe(current.completeDays), expectedDays:safe(current.expectedDays) },
    historical: { sampleMonths: historical.months || 0, phaseBaselines: (model.phases || []).map(p => ({ phase: p.phase, roasMedian: safe(p.baseline?.roasMedian), costPerArrivedMedian: safe(p.baseline?.cpaMedian), bookingRateMedian: safe(p.baseline?.bookingRateMedian), arrivalRateMedian: safe(p.baseline?.arrivalRateMedian), dailyAdsMedian: safe(p.baseline?.dailyAdsMedian) })) }, daily: daily.slice(0, 62),
    crm: aggregateCrm,`n    guardrails: { deterministicAction: model.recommendation?.action || 'insufficient_data', stale: Boolean(model.stale), historicalSamples: historical.months || 0, criticalWarnings: issues.filter(i => i?.severity === 'critical').length },
    budgetRule:{ maxAdjustmentPercent:10, cutoffRule:'D-2' } };
}
export function initAiMarketingPanel({ modelProvider, crmProvider, targetId='aiMarketingSignals' } = {}) {
  const root=document.getElementById(targetId); if(!root) return;
  let busy=false;
  const key=()=>`bsn-ai:${location.pathname}:${modelProvider?.()?.monthKey||'current'}`;
  const render=(state='empty', data=null, error='')=>{ root.innerHTML=`<div class="ai-signals__head"><div><p class="eyebrow">AI MARKETING SIGNALS</p><h2 class="panel-title">Phân tích tín hiệu Marketing</h2><p class="panel-subtitle">AI chỉ đọc số liệu tổng hợp, không thay đổi ngân sách.</p></div><button class="btn btn--secondary" data-ai-run ${busy?'disabled':''}>${busy?'Đang phân tích…':'Phân tích kỳ này'}</button></div>${state==='error'?`<p class="ai-state ai-state--error">${error}</p>`:state==='empty'?'<p class="ai-state">Chưa phân tích kỳ này.</p>':`<div class="ai-result"><div class="ai-result__summary"><strong>${data.summary||'—'}</strong><span class="decision-badge decision-badge--${data.action||'insufficient_data'}">${({increase:'Tăng 10%',decrease:'Giảm 10%',hold:'Giữ nguyên',insufficient_data:'Chưa đủ dữ liệu'})[data.action]||'Chưa đủ dữ liệu'}</span></div><p>Độ tin cậy: ${data.confidence||'—'} · ${data.sourcePeriod||''}</p><ul>${(data.signals||[]).map(s=>`<li><strong>${s.title||'Tín hiệu'}</strong><br>${(s.evidence||[]).join(' · ')}<br><small>${s.impact||''}</small></li>`).join('')}</ul>${(data.nextSteps||[]).length?`<div class="ai-next-steps"><b>Next steps</b><ol>${data.nextSteps.map(s=>`<li><strong>${s.action||s.title||'Việc cần làm'}</strong>${s.owner?` · ${s.owner}`:''}<br><small>${s.reason||s.deadline||''}</small></li>`).join('')}</ol></div>`:''}${data.checksBeforeChange?.length?`<p><b>Cần kiểm tra:</b> ${data.checksBeforeChange.join(' · ')}</p>`:''}</div>`}<button class="ai-clear" data-ai-clear ${data?'':'hidden'}>Xóa phân tích phiên này</button>`; root.querySelector('[data-ai-run]')?.addEventListener('click', run); root.querySelector('[data-ai-clear]')?.addEventListener('click',()=>{sessionStorage.removeItem(key()); render();});};
  async function run(){ if(busy)return; busy=true; render('empty'); try { const payload=buildAggregatePayload(modelProvider?.()||{}, crmProvider?.()||{}); const res=await fetch('/api/marketing/ai-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({periodKey:payload.period.monthKey,payload})}); if(!res.ok) throw new Error((await res.json().catch(()=>({}))).error||'Không thể phân tích AI'); const out=await res.json(); sessionStorage.setItem(key(),JSON.stringify(out.analysis)); render('result',out.analysis); } catch(e){render('error',null,e.message);} finally{busy=false;} }
  try { const cached=sessionStorage.getItem(key()); render(cached?'result':'empty',cached?JSON.parse(cached):null); } catch { render(); }
}
