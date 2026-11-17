/* ═══════════════════════════════════════════════════════
   AuditCore — Phase 1 Prototype · app.js
   Audit screen: polling, rendering, all modal flows
═══════════════════════════════════════════════════════ */
'use strict';

let _run        = null;
let _filter     = 'all';
let _expandedId = null;
let _pollTimer  = null;
let _startedAt  = null;

const PIPELINE_LABELS = ['','Policy & Gate Resolved','Evidence Retrieved from Connectors',
  'Deterministic Checks','AI-Assisted Checks','Human Review & Overrides','Gate Readiness Decision'];
const PIPELINE_SUBS   = ['','Comviva checklist pinned to run','SharePoint · agents auto-collected evidence',
  'Rules engine — criteria vs. evidence · no AI','Scope/Traceability Agent · semantic evaluation',
  'Awaiting reviewer decisions','Authorised reviewer sign-off'];

document.addEventListener('DOMContentLoaded', () => {
  _pollTimer = setInterval(fetchRun, 2000);
  fetchRun();
});

async function fetchRun() {
  try {
    const r = await fetch(`/api/audit/${RUN_ID}`);
    if (!r.ok) return;
    _run = await r.json();
    if (!_startedAt && _run.started_at) _startedAt = new Date(_run.started_at);
    renderAll(_run);
    if (_run.completed && _run.gate_decision) {
      clearInterval(_pollTimer); _pollTimer = null;
    }
  } catch(e) { console.error(e); }
}

function renderAll(run) {
  renderSummary(run.summary);
  renderGateStatus(run.gate_status);
  renderTopbar(run);
  renderPipeline(run.pipeline_step, run.gate_decision);
  renderAgents(run.agents, run.pipeline_step);
  renderConnector(run.pipeline_step);
  renderControls(run.controls);
  renderOverrideBanner(run);
  renderEvidenceLog(run.controls);
  renderOverridesTab(run.controls);
  renderAuditLog(run.audit_log);
  renderGateDecisionDisplay(run.gate_decision);
  updateDuration();
}

/* ── Summary ─────────────────────────────────────────── */
function renderSummary(s) {
  if (!s) return;
  ['total','pass','fail','needs_review','unable_to_verify','pending','waived'].forEach(k => {
    const el = document.getElementById('sum-' + k.replace('_','').replace('needs','review').replace('unable','unable').replace('toverify',''));
    // map key names to element IDs
  });
  set('sum-total',   s.total);
  set('sum-pass',    s.pass);
  set('sum-fail',    s.fail);
  set('sum-review',  s.needs_review);
  set('sum-unable',  s.unable_to_verify);
  set('sum-pending', s.pending);
  set('sum-waived',  s.waived);
}

function renderGateStatus(gs) {
  const el = document.getElementById('ctx-gate-status');
  if (el) el.innerHTML = gateBadge(gs);
}

function renderTopbar(run) {
  const pill = document.getElementById('topbar-pill');
  const txt  = document.getElementById('topbar-text');
  if (!pill||!txt) return;
  if (run.gate_decision) {
    const d = run.gate_decision.decision;
    pill.className = 'topbar-pill ' + (d==='approve'?'pill-pass':d==='reject'?'pill-fail':'pill-review');
    txt.textContent = 'Gate ' + d.charAt(0).toUpperCase()+d.slice(1)+'d';
  } else if (run.completed) {
    pill.className = 'topbar-pill pill-review';
    txt.innerHTML  = '<span class="dot amber"></span> Awaiting Reviewer';
  } else {
    pill.className = 'topbar-pill';
    txt.innerHTML  = '<span class="pulse"></span> Agents running…';
  }
}

/* ── Pipeline ─────────────────────────────────────────── */
function renderPipeline(step, gd) {
  const el = document.getElementById('pipeline');
  if (!el) return;
  let html = '';
  for (let i=1; i<=6; i++) {
    const done   = i < step || (i===6 && gd);
    const active = i === step && !gd;
    const cls    = done?'done':active?'active':'wait';
    const badge  = done
      ? `<span class="badge pass" style="flex-shrink:0;font-size:11px;"><span class="dot green"></span> Done</span>`
      : active
        ? `<span class="badge inprog" style="flex-shrink:0;font-size:11px;"><span class="dot amber"></span> Active</span>`
        : `<span class="badge unable" style="flex-shrink:0;font-size:11px;"><span class="dot gray"></span> Waiting</span>`;
    html += `<div class="pipeline-step">
      <div class="ps-spine">
        <div class="ps-num ${cls}">${i}</div>
        ${i<6?`<div class="ps-line ${done?'done-line':''}"></div>`:''}
      </div>
      <div class="ps-content">
        <div class="ps-label">${PIPELINE_LABELS[i]}</div>
        <div class="ps-sub">${PIPELINE_SUBS[i]}</div>
      </div>${badge}
    </div>`;
  }
  el.innerHTML = html;
}

/* ── Agents ───────────────────────────────────────────── */
const AGENT_ICONS = {
  'Evidence Agent':'🔍','Checklist Agent':'✅',
  'Scope / Traceability Agent':'🗺','Compliance Evaluator':'⚖️',
  'Review Agent':'🧠','Test & Quality Agent':'🧪'
};
function renderAgents(agents, step) {
  const el = document.getElementById('agent-list');
  if (!el||!agents) return;
  el.innerHTML = agents.map(a => {
    if (a.phase===2) return `
      <div class="agent-step" style="opacity:.5;">
        <div class="agent-ico gray" style="border:1px dashed #c084fc;">${AGENT_ICONS[a.name]||'🤖'}</div>
        <div class="agent-info">
          <div class="agent-name" style="color:var(--text-muted);">${a.name} <span class="phase2-tag">Phase 2</span></div>
          <div class="agent-task">${a.task}</div>
          <div class="progress-bar"><div class="fill" style="width:0%"></div></div>
        </div>
        <span class="badge na" style="flex-shrink:0;">Phase 2</span>
      </div>`;
    const pct = a.progress||(a.status==='done'?100:a.status==='running'?60:0);
    return `<div class="agent-step">
      <div class="agent-ico ${a.color||'blue'}">${AGENT_ICONS[a.name]||'🤖'}</div>
      <div class="agent-info">
        <div class="agent-name">${a.name}</div>
        <div class="agent-task">${a.task}</div>
        <div class="agent-meta">${a.meta||''}</div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      </div>${agentBadge(a.status)}
    </div>`;
  }).join('');
}
function agentBadge(s) {
  return ({done:`<span class="badge pass" style="flex-shrink:0;"><span class="dot green"></span> Done</span>`,
    running:`<span class="badge inprog" style="flex-shrink:0;"><span class="dot amber"></span> Running</span>`,
    review:`<span class="badge review" style="flex-shrink:0;"><span class="dot amber"></span> Review</span>`,
    waiting:`<span class="badge unable" style="flex-shrink:0;"><span class="dot gray"></span> Waiting</span>`})[s]
    || `<span class="badge na" style="flex-shrink:0;">${s}</span>`;
}

/* ── Connector ────────────────────────────────────────── */
function renderConnector(step) {
  const st = document.getElementById('conn-sp-status');
  const ct = document.getElementById('conn-sp-count');
  if (!st) return;
  if (step >= 2) {
    st.className   = 'conn-status ok';
    st.innerHTML   = '<span class="dot green"></span> Connected';
    if (ct) ct.textContent = '10 artifacts retrieved · Microsoft Graph · read-only';
  }
}

/* ── Override Banner ──────────────────────────────────── */
function renderOverrideBanner(run) {
  const banner = document.getElementById('override-banner');
  const txt    = document.getElementById('override-banner-text');
  if (!banner||!txt||!run.completed) { if(banner) banner.style.display='none'; return; }
  const fails   = (run.controls||[]).filter(c=>c.status==='fail');
  const reviews = (run.controls||[]).filter(c=>c.status==='needs_review'&&!c.waiver);
  if (!fails.length&&!reviews.length) { banner.style.display='none'; return; }
  let parts=[];
  if (fails.length)   parts.push(`<strong>${fails.length} control${fails.length>1?'s':''} failed</strong> against checklist acceptance criteria.`);
  if (reviews.length) parts.push(`<strong>${reviews.length} control${reviews.length>1?'s':''} need human review</strong> — AI confidence below threshold.`);
  txt.innerHTML = parts.join(' ') + `
    <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span style="background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;padding:2px 10px;border-radius:6px;font-size:11.5px;font-weight:600;">Confirm Fail</span>
      <span style="background:#f5f3ff;border:1px solid #c4b5fd;color:#7c3aed;padding:2px 10px;border-radius:6px;font-size:11.5px;font-weight:600;">Record Waiver</span>
      <span style="color:#6b7280;font-size:11px;">— Waiver requires rationale · approver · expiry. Not a Pass.</span>
    </div>`;
  banner.style.display = 'flex';
}

/* ── Controls Table ───────────────────────────────────── */
function renderControls(controls) {
  const tbody = document.getElementById('controls-tbody');
  if (!tbody||!controls) return;
  const q = (document.getElementById('search-input')?.value||'').toLowerCase();
  const filtered = controls.filter(c => {
    if (_filter!=='all' && c.status!==_filter) return false;
    if (q) {
      const hay = [c.id,c.requirement,c.description,c.acceptance_criteria,
                   c.rationale,c.evidence_file,c.evidence_src,c.agent].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">No controls match the current filter.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(c => {
    const expanded = _expandedId===c.id;
    const ev = c.evidence_file
      ? `<a class="evidence-link" href="#" onclick="return false;">📄 ${c.evidence_file}</a>
         <div class="evidence-src">${c.evidence_src||''}</div>`
      : `<span style="color:var(--text-muted);font-size:12px;">${c.evidence_src||'No document found'}</span>`;

    const tags = [
      `<span class="ctrl-tag ${c.severity}">${c.severity.toUpperCase()}</span>`,
      c.check_type==='ai-assisted'?`<span class="ctrl-tag ai" style="margin-left:4px;">AI-Assisted</span>`:'',
      c.assigned_owner?`<div style="font-size:10.5px;color:var(--accent);margin-top:3px;">👤 ${c.assigned_owner}</div>`:'',
      c.waiver?`<div style="font-size:10.5px;color:#7c3aed;margin-top:2px;">🔖 Waived by ${c.waiver.approver}</div>`:'',
      c.carried_from?`<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">↩ Carried from parent run</div>`:'',
    ].join('');

    let rows = `<tr class="${expanded?'expanded-parent':''}" id="row-${c.id}">
      <td><span class="ctrl-id">${c.id}</span></td>
      <td>
        <div class="ctrl-req">${c.requirement}</div>
        <div class="ctrl-desc">${c.description||''}</div>
        ${tags}
      </td>
      <td>
        <div class="criteria-cell">${c.acceptance_criteria||'—'}</div>
      </td>
      <td>${ev}</td>
      <td>${ctrlBadge(c.status)}</td>
      <td class="timestamp">${c.checked_at||(c.status==='pending'?'…':'—')}</td>
      <td><div class="row-actions">${buildActions(c)}</div></td>
    </tr>`;

    if (expanded) rows += buildFindingDetail(c);
    return rows;
  }).join('');
}

function buildActions(c) {
  let b = `<button class="btn btn-ghost btn-sm" title="Expand" onclick="toggleExpand('${c.id}')">🔍</button>`;
  if (c.status==='fail'||c.status==='needs_review') {
    b += `<button class="btn btn-ghost btn-sm" title="Waiver" onclick="openWaiverModal('${c.id}')">🔖</button>`;
    b += `<button class="btn btn-ghost btn-sm" title="Confirm Fail" onclick="openFailModal('${c.id}')">❌</button>`;
    b += `<button class="btn btn-ghost btn-sm" title="Send to review" onclick="sendToReview('${c.id}')">📤</button>`;
  }
  if (!c.assigned_owner) b += `<button class="btn btn-ghost btn-sm" title="Assign" onclick="openAssignModal('${c.id}')">👤</button>`;
  return b;
}

function buildFindingDetail(c) {
  const excerptHtml = c.finding_excerpt
    ? `<div class="excerpt-box">${c.finding_excerpt.replace(/\n/g,'<br>')}</div>` : '';
  const criteriaHtml = `
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:7px;padding:10px 14px;font-size:12px;margin-bottom:12px;">
      <strong style="color:#166534;">Acceptance Criteria (customer-defined):</strong><br/>
      <span style="color:#374151;">${c.acceptance_criteria||'—'}</span>
    </div>`;
  const waiverHtml = c.waiver ? `
    <div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:12px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:#7c3aed;margin-bottom:6px;">🔖 Waiver Recorded</div>
      <div class="fd-grid">
        <span class="fd-key">Rationale</span><span class="fd-val">${c.waiver.rationale}</span>
        <span class="fd-key">Approver</span><span class="fd-val">${c.waiver.approver}</span>
        <span class="fd-key">Expiry</span><span class="fd-val">${c.waiver.expiry}</span>
        <span class="fd-key">Recorded</span><span class="fd-val">${c.waiver.recorded_at}</span>
      </div>
    </div>` : '';
  return `<tr id="detail-${c.id}"><td colspan="7" style="padding:0;">
    <div class="finding-detail">
      <div class="fd-header">
        <span style="font-size:16px;">🔍</span>
        <span class="fd-title">Finding Detail — ${c.id}</span>
        <span style="margin-left:auto;">${ctrlBadge(c.status)}</span>
      </div>
      ${criteriaHtml}
      <div class="fd-grid">
        <span class="fd-key">Agent verdict</span><span class="fd-val">${c.finding_detail||c.rationale||'—'}</span>
        <span class="fd-key">Evidence</span><span class="fd-val">${c.evidence_file?`${c.evidence_file} · ${c.evidence_src}`:c.evidence_src||'—'}</span>
        <span class="fd-key">Check type</span><span class="fd-val">${c.check_type}</span>
        <span class="fd-key">Source system</span><span class="fd-val">${c.source_hint||'SharePoint'}</span>
      </div>
      ${excerptHtml}${waiverHtml}
      <div class="fd-actions">
        <button class="btn btn-secondary btn-sm" onclick="sendToReview('${c.id}')">📤 Send to Human Review</button>
        <button class="btn btn-secondary btn-sm" onclick="openAssignModal('${c.id}')">👤 Assign Owner</button>
        <button class="btn btn-sm btn-waiver" onclick="openWaiverModal('${c.id}')">🔖 Record Waiver</button>
        <button class="btn btn-danger btn-sm"  onclick="openFailModal('${c.id}')">❌ Confirm Fail</button>
      </div>
    </div>
  </td></tr>`;
}

function toggleExpand(id) {
  _expandedId = _expandedId===id ? null : id;
  if (_run) renderControls(_run.controls);
}

/* ── Evidence Log ─────────────────────────────────────── */
function renderEvidenceLog(controls) {
  const el = document.getElementById('evidence-log-content');
  if (!el||!controls) return;
  const done = controls.filter(c=>c.evidence_file&&c.status!=='pending');
  if (!done.length) { el.innerHTML='<p style="color:var(--text-muted);font-size:13px;">Agents retrieving evidence…</p>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Control</th><th>Document Retrieved</th><th>Source</th><th>Acceptance Criteria</th><th>Verdict</th><th>Checked</th></tr></thead>
    <tbody>${done.map(c=>`<tr>
      <td><span class="ctrl-id">${c.id}</span></td>
      <td><a class="evidence-link" href="#" onclick="return false;">📄 ${c.evidence_file}</a></td>
      <td style="font-size:11px;color:var(--text-muted);">${c.evidence_src||''}</td>
      <td style="font-size:11.5px;color:var(--text-muted);max-width:180px;">${c.acceptance_criteria||''}</td>
      <td>${ctrlBadge(c.status)}</td>
      <td class="timestamp">${c.checked_at||'—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ── Overrides Tab ────────────────────────────────────── */
function renderOverridesTab(controls) {
  const el = document.getElementById('overrides-content');
  if (!el||!controls) return;
  const waivers   = controls.filter(c=>c.waiver);
  const confirmed = controls.filter(c=>c.confirmed_fail_reason);
  if (!waivers.length&&!confirmed.length) { el.innerHTML='<p style="color:var(--text-muted);font-size:13px;">No waivers or confirmed failures yet.</p>'; return; }
  let html='';
  if (waivers.length) {
    html+=`<h4 style="font-size:13px;font-weight:600;margin-bottom:10px;">Waivers (${waivers.length})</h4>`;
    html+=waivers.map(c=>`<div style="border:1px solid #c4b5fd;border-radius:8px;padding:14px;margin-bottom:10px;background:#faf5ff;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span class="ctrl-id">${c.id}</span>
        <span style="font-weight:600;font-size:13px;">${c.requirement}</span>
        <span class="badge waived" style="margin-left:auto;">🔖 Waived</span>
      </div>
      <div class="fd-grid">
        <span class="fd-key">Rationale</span><span class="fd-val">${c.waiver.rationale}</span>
        <span class="fd-key">Approver</span><span class="fd-val">${c.waiver.approver}</span>
        <span class="fd-key">Expiry</span><span class="fd-val">${c.waiver.expiry}</span>
        <span class="fd-key">Recorded</span><span class="fd-val">${c.waiver.recorded_at}</span>
      </div>
    </div>`).join('');
  }
  if (confirmed.length) {
    html+=`<h4 style="font-size:13px;font-weight:600;margin:16px 0 10px;">Confirmed Failures (${confirmed.length})</h4>`;
    html+=confirmed.map(c=>`<div style="border:1px solid #fca5a5;border-radius:8px;padding:14px;margin-bottom:10px;background:#fff5f5;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="ctrl-id">${c.id}</span>
        <span style="font-weight:600;font-size:13px;">${c.requirement}</span>
        <span class="badge fail" style="margin-left:auto;">❌ Confirmed</span>
      </div>
      <div style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">${c.confirmed_fail_reason}</div>
    </div>`).join('');
  }
  el.innerHTML=html;
}

/* ── Audit Log ────────────────────────────────────────── */
function renderAuditLog(log) {
  const el = document.getElementById('audit-log-content');
  if (!el) return;
  if (!log||!log.length) { el.innerHTML='<p style="color:var(--text-muted);font-size:13px;">Audit log empty.</p>'; return; }
  el.innerHTML=`<div style="font-family:monospace;font-size:12px;line-height:2;">
    ${log.map(e=>`<div style="border-bottom:1px solid var(--border);padding:3px 0;">${e}</div>`).join('')}
  </div>`;
}

/* ── Gate Decision display ────────────────────────────── */
function renderGateDecisionDisplay(gd) {
  const el = document.getElementById('gate-decision-display');
  if (!el) return;
  if (!gd) { el.style.display='none'; return; }
  const color = gd.decision==='approve'?'var(--pass)':gd.decision==='reject'?'var(--fail)':'var(--warn)';
  el.style.display='block';
  el.innerHTML=`<div style="font-size:13px;font-weight:700;color:${color};margin-bottom:8px;">
    Gate Decision: ${gd.decision.toUpperCase()}</div>
    <div class="fd-grid">
      <span class="fd-key">Reviewer</span><span class="fd-val">${gd.reviewer}</span>
      <span class="fd-key">Notes</span><span class="fd-val">${gd.notes||'—'}</span>
      <span class="fd-key">Recorded</span><span class="fd-val">${gd.recorded_at}</span>
    </div>`;
}

/* ── Duration ─────────────────────────────────────────── */
function updateDuration() {
  const el = document.getElementById('rf-duration');
  if (!el||!_startedAt) return;
  const s = Math.floor((Date.now()-_startedAt.getTime())/1000);
  el.innerHTML=`Duration: <strong>${Math.floor(s/60)}m ${s%60}s</strong>`;
}

/* ── Filters & Tabs ───────────────────────────────────── */
function setFilter(f, el) {
  _filter = f;
  document.querySelectorAll('.filter-pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  if (_run) renderControls(_run.controls);
}
function applyFilter() { if (_run) renderControls(_run.controls); }
function switchTab(name, el) {
  ['controls','evidence','overrides','history'].forEach(t=>{
    const tab=document.getElementById(`tab-${t}`);
    if (tab) tab.style.display = t===name?'':'none';
  });
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}

/* ── Waiver ───────────────────────────────────────────── */
function openWaiverModal(id) {
  const c=getCtrl(id); if(!c) return;
  document.getElementById('waiver-ctrl-id').value  = id;
  document.getElementById('waiver-ctrl-label').textContent = `${id} — ${c.requirement}`;
  ['waiver-rationale','waiver-approver','waiver-expiry'].forEach(x=>document.getElementById(x).value='');
  document.getElementById('waiver-error').style.display='none';
  openModal('waiver-modal');
}
async function submitWaiver() {
  const id  = document.getElementById('waiver-ctrl-id').value;
  const rat = document.getElementById('waiver-rationale').value.trim();
  const app = document.getElementById('waiver-approver').value.trim();
  const exp = document.getElementById('waiver-expiry').value;
  if (!rat||!app||!exp) { showErr('waiver-error','All three fields are required.'); return; }
  const r = await post(`/api/audit/${RUN_ID}/waiver`,{control_id:id,rationale:rat,approver:app,expiry:exp});
  if (r.ok) { closeModal('waiver-modal'); showToast(`🔖 Waiver recorded for ${id}`); fetchRun(); }
  else showErr('waiver-error', r.error||'Failed');
}

/* ── Fail ─────────────────────────────────────────────── */
function openFailModal(id) {
  const c=getCtrl(id); if(!c) return;
  document.getElementById('fail-ctrl-id').value = id;
  document.getElementById('fail-ctrl-label').textContent = `${id} — ${c.requirement}`;
  document.getElementById('fail-reason').value = '';
  openModal('fail-modal');
}
async function submitFail() {
  const id=document.getElementById('fail-ctrl-id').value;
  const reason=document.getElementById('fail-reason').value.trim()||'Confirmed failure by reviewer.';
  const r=await post(`/api/audit/${RUN_ID}/confirm_fail`,{control_id:id,reason});
  if(r.ok){closeModal('fail-modal');showToast(`❌ ${id} confirmed as Fail`);fetchRun();}
  else alert(r.error||'Failed');
}

/* ── Assign ───────────────────────────────────────────── */
function openAssignModal(id) {
  const c=getCtrl(id); if(!c) return;
  document.getElementById('assign-ctrl-id').value=id;
  document.getElementById('assign-ctrl-label').textContent=`${id} — ${c.requirement}`;
  document.getElementById('assign-owner').value=c.assigned_owner||'';
  openModal('assign-modal');
}
async function submitAssign() {
  const id=document.getElementById('assign-ctrl-id').value;
  const owner=document.getElementById('assign-owner').value.trim();
  if(!owner){alert('Owner name required');return;}
  const r=await post(`/api/audit/${RUN_ID}/assign_owner`,{control_id:id,owner});
  if(r.ok){closeModal('assign-modal');showToast(`👤 ${id} assigned to ${owner}`);fetchRun();}
  else alert(r.error||'Failed');
}

/* ── Send to Review ───────────────────────────────────── */
async function sendToReview(id) {
  const r=await post(`/api/audit/${RUN_ID}/review`,{control_id:id,reason:'Sent to human review from audit screen'});
  if(r.ok){showToast(`📤 ${id} sent to review queue`);fetchRun();}
  else alert(r.error||'Failed');
}

/* ── Re-Audit ─────────────────────────────────────────── */
function openReauditModal() {
  if(!_run) return;
  document.getElementById('reaudit-reason').value='';
  document.getElementById('reaudit-error').style.display='none';
  const list=document.getElementById('reaudit-controls-list');
  const eligible=(_run.controls||[]).filter(c=>c.status!=='pending'&&c.status!=='waived');
  list.innerHTML = eligible.length
    ? eligible.map(c=>`<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 4px;border-radius:6px;" class="ctrl-check-row">
        <input type="checkbox" value="${c.id}" style="width:15px;height:15px;cursor:pointer;"/>
        <span class="ctrl-id">${c.id}</span>
        <span style="font-size:13px;">${c.requirement}</span>
        <span style="margin-left:auto;">${ctrlBadge(c.status)}</span>
      </label>`).join('')
    : '<p style="color:var(--text-muted);font-size:13px;">No completed controls available yet.</p>';
  openModal('reaudit-modal');
}
async function submitReaudit() {
  const reason=document.getElementById('reaudit-reason').value.trim();
  const checked=[...document.querySelectorAll('#reaudit-controls-list input:checked')].map(cb=>cb.value);
  if(!reason){showErr('reaudit-error','Reason required');return;}
  if(!checked.length){showErr('reaudit-error','Select at least one control');return;}
  const r=await post(`/api/audit/${RUN_ID}/reaudit`,{control_ids:checked,reason});
  if(r.ok){closeModal('reaudit-modal');showToast('🔁 Re-audit run created…');setTimeout(()=>window.location.href=`/audit/${r.new_run_id}`,1200);}
  else showErr('reaudit-error',r.error||'Failed');
}

/* ── Gate Decision ────────────────────────────────────── */
function openGateDecisionModal() {
  document.querySelectorAll('input[name=gate-dec]').forEach(r=>r.checked=false);
  document.getElementById('gate-reviewer').value='';
  document.getElementById('gate-notes').value='';
  document.getElementById('gate-error').style.display='none';
  openModal('gate-modal');
}
async function submitGateDecision() {
  const decision=document.querySelector('input[name=gate-dec]:checked')?.value;
  const reviewer=document.getElementById('gate-reviewer').value.trim();
  const notes=document.getElementById('gate-notes').value.trim();
  if(!decision){showErr('gate-error','Select a decision');return;}
  if(!reviewer){showErr('gate-error','Reviewer name required');return;}
  const r=await post(`/api/audit/${RUN_ID}/gate_decision`,{decision,reviewer,notes});
  if(r.ok){closeModal('gate-modal');showToast(`✍️ Gate decision: ${decision.toUpperCase()}`);fetchRun();}
  else showErr('gate-error',r.error||'Failed');
}

/* ── Export ───────────────────────────────────────────── */
function exportReport() { window.location.href=`/api/audit/${RUN_ID}/export`; }

/* ── Shared Helpers ───────────────────────────────────── */
function getCtrl(id) { return _run?.controls?.find(c=>c.id===id); }

function ctrlBadge(s) {
  return ({
    pass:             `<span class="badge pass"><span class="dot green"></span> Pass</span>`,
    fail:             `<span class="badge fail"><span class="dot red"></span> Fail</span>`,
    needs_review:     `<span class="badge review"><span class="dot amber"></span> Needs Review</span>`,
    unable_to_verify: `<span class="badge unable"><span class="dot gray"></span> Unable to Verify</span>`,
    pending:          `<span class="badge inprog"><span class="dot amber"></span> Pending</span>`,
    waived:           `<span class="badge waived"><span class="dot violet"></span> Waived</span>`,
  })[s] || `<span class="badge na">${s}</span>`;
}
function gateBadge(gs) {
  return ({
    pass:         `<span class="badge pass"><span class="dot green"></span> Pass</span>`,
    fail:         `<span class="badge fail"><span class="dot red"></span> Fail</span>`,
    needs_review: `<span class="badge review"><span class="dot amber"></span> Needs Review</span>`,
    in_progress:  `<span class="badge inprog"><span class="dot amber"></span> In Progress</span>`,
  })[gs] || `<span class="badge inprog"><span class="dot amber"></span> In Progress</span>`;
}
async function post(url, body) {
  try {
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return await r.json();
  } catch(e) { return {error:e.message}; }
}
function set(id,val) { const el=document.getElementById(id); if(el) el.textContent=val??'—'; }
function openModal(id)  { document.getElementById(id).style.display='flex'; }
function closeModal(id) { document.getElementById(id).style.display='none'; }
function closeModalOnOverlay(e,id) { if(e.target===document.getElementById(id)) closeModal(id); }
function showErr(id,msg) { const el=document.getElementById(id); if(el){el.textContent=msg;el.style.display='block';} }
function showToast(msg,ms=3000) {
  const t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.style.display='block'; t.classList.add('toast-show');
  setTimeout(()=>{t.classList.remove('toast-show');setTimeout(()=>t.style.display='none',300);},ms);
}
