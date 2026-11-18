/* ═══════════════════════════════════════════════════════════
   AuditCore · app.js
   Jira-faithful audit screen — polling, all renders, modals
═══════════════════════════════════════════════════════════ */
'use strict';

let _run        = null;
let _filter     = 'all';
let _expandedId = null;
let _pollTimer  = null;
let _startedAt  = null;

const PIPELINE = [
  { n:1, label:'Policy & Gate Resolved',           sub:'Comviva checklist pinned to run' },
  { n:2, label:'Evidence Retrieved',               sub:'SharePoint · agents auto-collected' },
  { n:3, label:'Deterministic Checks',             sub:'Rules engine — no AI' },
  { n:4, label:'AI-Assisted Checks',               sub:'Scope / Traceability Agent' },
  { n:5, label:'Human Review & Overrides',         sub:'Awaiting reviewer decisions' },
  { n:6, label:'Gate Readiness Decision',          sub:'Authorised reviewer sign-off' },
];

const AGENT_ICONS = {
  'Evidence Agent':             '🔍',
  'Checklist Agent':            '✅',
  'Scope / Traceability Agent': '🗺',
  'Compliance Evaluator':       '⚖️',
  'Review Agent':               '🧠',
  'Test & Quality Agent':       '🧪',
};

/* ── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  _pollTimer = setInterval(fetchRun, 2000);
  fetchRun();
});

/* ── Polling ───────────────────────────────────────────── */
async function fetchRun() {
  try {
    const r = await fetch(`/api/audit/${RUN_ID}`);
    if (!r.ok) return;
    _run = await r.json();
    if (!_startedAt && _run.started_at) _startedAt = new Date(_run.started_at);
    renderAll(_run);
    if (_run.completed && _run.gate_decision) { clearInterval(_pollTimer); _pollTimer = null; }
  } catch(e) { console.error(e); }
}

/* ── Master render ─────────────────────────────────────── */
function renderAll(run) {
  renderSummary(run.summary);
  renderGateStatus(run.gate_status);
  renderTopbarStatus(run);
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

/* ── Summary cards ─────────────────────────────────────── */
function renderSummary(s) {
  if (!s) return;
  set('sum-total',   s.total);
  set('sum-pass',    s.pass);
  set('sum-fail',    s.fail);
  set('sum-review',  s.needs_review);
  set('sum-unable',  s.unable_to_verify);
  set('sum-pending', s.pending);
  set('sum-waived',  s.waived);
}

/* ── Gate status (context strip) ───────────────────────── */
function renderGateStatus(gs) {
  const el = document.getElementById('ctx-gate-status');
  if (el) el.innerHTML = gateLozenge(gs);
}

/* ── Topbar status pill ─────────────────────────────────── */
function renderTopbarStatus(run) {
  const pill = document.getElementById('run-status-pill');
  const txt  = document.getElementById('run-status-text');
  if (!pill || !txt) return;
  if (run.gate_decision) {
    const d = run.gate_decision.decision;
    pill.className = 'status-pill ' + (d === 'approve' ? 'passed' : d === 'reject' ? 'failed' : 'review');
    txt.textContent = 'Gate ' + d.charAt(0).toUpperCase() + d.slice(1) + 'd';
  } else if (run.completed) {
    pill.className = 'status-pill review';
    txt.textContent = 'Awaiting Reviewer';
  } else {
    pill.className = 'status-pill running';
    txt.innerHTML  = '<span class="pulse"></span> Running';
  }
}

/* ── Pipeline ───────────────────────────────────────────── */
function renderPipeline(step, gd) {
  const el = document.getElementById('pipeline');
  if (!el) return;
  el.innerHTML = PIPELINE.map(({ n, label, sub }) => {
    const done   = n < step || (n === 6 && gd);
    const active = n === step && !gd;
    const cls    = done ? 'done' : active ? 'active' : 'wait';
    const badge  = done
      ? `<span class="lz lz-done">Done</span>`
      : active
        ? `<span class="lz lz-inprogress">Active</span>`
        : `<span class="lz lz-default">Waiting</span>`;
    const lineClass = n < 6 ? (done ? 'ps-line done-line' : 'ps-line') : '';
    return `<div class="pipeline-step">
      <div class="ps-spine">
        <div class="ps-num ${cls}">${n}</div>
        ${n < 6 ? `<div class="${lineClass}"></div>` : ''}
      </div>
      <div class="ps-content">
        <div class="ps-label">${label}</div>
        <div class="ps-sub">${sub}</div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

/* ── Agents ─────────────────────────────────────────────── */
function renderAgents(agents, step) {
  const el = document.getElementById('agent-list');
  if (!el || !agents) return;
  el.innerHTML = agents.map(a => {
    if (a.phase === 2) return `
      <div class="agent-step" style="opacity:.45;">
        <div class="agent-ico gray">${AGENT_ICONS[a.name] || '🤖'}</div>
        <div class="agent-info">
          <div class="agent-name" style="color:var(--n400);">${a.name} <span class="phase2-tag">Phase 2</span></div>
          <div class="agent-task">${a.task}</div>
          <div class="progress-bar"><div class="fill" style="width:0%"></div></div>
        </div>
        <span class="lz lz-default">Phase 2</span>
      </div>`;
    const pct  = a.progress || (a.status === 'done' ? 100 : a.status === 'running' ? 60 : 0);
    const badge = a.status === 'done'    ? `<span class="lz lz-done">Done</span>`
                : a.status === 'running' ? `<span class="lz lz-inprogress">Running</span>`
                : a.status === 'review'  ? `<span class="lz lz-review">Review</span>`
                :                          `<span class="lz lz-default">Waiting</span>`;
    return `<div class="agent-step">
      <div class="agent-ico ${a.color || 'blue'}">${AGENT_ICONS[a.name] || '🤖'}</div>
      <div class="agent-info">
        <div class="agent-name">${a.name}</div>
        <div class="agent-task">${a.task}</div>
        <div class="agent-meta">${a.meta || ''}</div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

/* ── Connector ──────────────────────────────────────────── */
function renderConnector(step) {
  const st = document.getElementById('conn-sp-status');
  const ct = document.getElementById('conn-sp-count');
  if (!st || step < 2) return;
  st.className   = 'conn-status ok';
  st.innerHTML   = '<span class="dot green"></span> Connected';
  if (ct) ct.textContent = '10 artifacts retrieved · Microsoft Graph · read-only';
}

/* ── Override banner ────────────────────────────────────── */
function renderOverrideBanner(run) {
  const banner = document.getElementById('override-banner');
  const txt    = document.getElementById('override-banner-text');
  if (!banner || !txt || !run.completed) { if (banner) banner.style.display = 'none'; return; }
  const fails   = (run.controls || []).filter(c => c.status === 'fail');
  const reviews = (run.controls || []).filter(c => c.status === 'needs_review' && !c.waiver);
  if (!fails.length && !reviews.length) { banner.style.display = 'none'; return; }
  const parts = [];
  if (fails.length)   parts.push(`<strong>${fails.length} control${fails.length > 1 ? 's' : ''} failed</strong> acceptance criteria. See resolution guidance in each row below.`);
  if (reviews.length) parts.push(`<strong>${reviews.length} control${reviews.length > 1 ? 's' : ''} need human review</strong> — AI confidence below threshold.`);
  txt.innerHTML = parts.join(' ') + ` Waivers require rationale, approver and expiry — a waiver is not a Pass.`;
  banner.style.display = 'flex';
}

/* ══════════════════════════════════════════════════════════
   CONTROLS TABLE — main rendering function
══════════════════════════════════════════════════════════ */
function renderControls(controls) {
  const tbody = document.getElementById('controls-tbody');
  if (!tbody || !controls) return;
  const q = (document.getElementById('search-input')?.value || '').toLowerCase();
  const filtered = controls.filter(c => {
    if (_filter !== 'all' && c.status !== _filter) return false;
    if (q) {
      const hay = [c.id, c.requirement, c.description, c.acceptance_criteria,
                   c.rationale, c.evidence_file, c.evidence_src, c.agent,
                   c.detailed_reason].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--n400);">No controls match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const expanded = _expandedId === c.id;
    const ev = c.evidence_file
      ? `<a class="evidence-link" href="#" onclick="return false;">📄 ${c.evidence_file}</a>
         <div class="evidence-src">${c.evidence_src || ''}</div>`
      : `<span style="color:var(--n400);font-size:12px;">${c.evidence_src || 'No document found'}</span>`;

    const tags = [
      `<span class="ctrl-tag ${c.severity}">${c.severity.toUpperCase()}</span>`,
      c.check_type === 'ai-assisted' ? `<span class="ctrl-tag ai" style="margin-left:4px;">AI</span>` : '',
      c.assigned_owner ? `<div style="font-size:11px;color:var(--blue-bold);margin-top:3px;">👤 ${c.assigned_owner}</div>` : '',
      c.waiver         ? `<div style="font-size:11px;color:var(--purple-text);margin-top:2px;">🔖 Waived · ${c.waiver.approver}</div>` : '',
      c.carried_from   ? `<div style="font-size:10px;color:var(--n400);margin-top:2px;">↩ Carried from parent</div>` : '',
    ].join('');

    // Resolution indicator on fail/review rows
    const hasResolution = c.resolution_url || c.detailed_reason || c.resolution_steps;
    const resolutionTag = (c.status === 'fail' || c.status === 'needs_review') && hasResolution
      ? `<div style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--blue-bold);margin-top:3px;cursor:pointer;" onclick="toggleExpand('${c.id}')">
           <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1a4 4 0 100 8A4 4 0 005 1zm.5 6H4.5V4.5h1V7zm0-3H4.5v-1h1v1z"/></svg>
           View resolution guide
         </div>` : '';

    let rows = `<tr class="${expanded ? 'expanded-parent' : ''}" id="row-${c.id}">
      <td><span class="ctrl-id">${c.id}</span></td>
      <td>
        <div class="ctrl-req">${c.requirement}</div>
        <div class="ctrl-desc">${c.description || ''}</div>
        ${tags}
        ${resolutionTag}
      </td>
      <td><div class="criteria-cell">${c.acceptance_criteria || '—'}</div></td>
      <td>${ev}</td>
      <td>${ctrlBadge(c.status)}</td>
      <td class="timestamp">${c.checked_at || (c.status === 'pending' ? '…' : '—')}</td>
      <td><div class="row-actions">${buildRowActions(c)}</div></td>
    </tr>`;

    if (expanded) rows += buildFindingDetail(c);
    return rows;
  }).join('');
}

function buildRowActions(c) {
  let b = `<button class="btn btn-ghost btn-sm" title="Expand detail" onclick="toggleExpand('${c.id}')">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2a4 4 0 100 8A4 4 0 006 2zm.5 5.5h-1v-3h1v3zm0-4h-1v-1h1v1z"/></svg>
  </button>`;
  if (c.status === 'fail' || c.status === 'needs_review') {
    b += `<button class="btn btn-ghost btn-sm" title="Record waiver" onclick="openWaiverModal('${c.id}')">🔖</button>`;
    b += `<button class="btn btn-ghost btn-sm" title="Confirm failure" onclick="openFailModal('${c.id}')">✕</button>`;
    b += `<button class="btn btn-ghost btn-sm" title="Edit resolution info" onclick="openResolutionModal('${c.id}')">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M8.5 1.5l2 2L3 11H1V9L8.5 1.5zM9.5 2.5L10 3l-7 7H2v-1l7.5-7z"/></svg>
    </button>`;
  }
  if (!c.assigned_owner) b += `<button class="btn btn-ghost btn-sm" title="Assign owner" onclick="openAssignModal('${c.id}')">👤</button>`;
  return b;
}

/* ── Finding detail (expanded row) ─────────────────────── */
function buildFindingDetail(c) {
  const isFailed  = c.status === 'fail' || c.status === 'needs_review';
  const hasRes    = c.resolution_url || c.detailed_reason || (c.resolution_steps && c.resolution_steps.length);

  /* Criteria box — always shown */
  const criteriaBox = `
    <div style="background:var(--n10);border:1px solid var(--n40);border-left:3px solid var(--green-bold);border-radius:var(--r);padding:12px 16px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:var(--n400);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Acceptance Criteria (customer-defined)</div>
      <div style="font-size:13px;color:var(--n800);">${c.acceptance_criteria || '—'}</div>
    </div>`;

  /* Agent verdict */
  const verdictBox = c.finding_detail ? `
    <div class="fd-grid" style="margin-bottom:12px;">
      <span class="fd-key">Agent verdict</span><span class="fd-val">${c.finding_detail}</span>
      <span class="fd-key">Evidence</span><span class="fd-val">${c.evidence_file ? `${c.evidence_file} · ${c.evidence_src}` : c.evidence_src || '—'}</span>
      <span class="fd-key">Check type</span><span class="fd-val">${c.check_type}</span>
    </div>` : '';

  /* Excerpt — monospace diff box */
  const excerptBox = c.finding_excerpt ? `
    <div class="excerpt-box">${c.finding_excerpt.replace(/\n/g,'<br>')}</div>` : '';

  /* Waiver info */
  const waiverBox = c.waiver ? `
    <div style="background:var(--purple-subtle);border:1px solid var(--purple-bold)33;border-radius:var(--r);padding:12px 16px;margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;color:var(--purple-text);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">🔖 Waiver Recorded</div>
      <div class="fd-grid">
        <span class="fd-key">Rationale</span><span class="fd-val">${c.waiver.rationale}</span>
        <span class="fd-key">Approver</span><span class="fd-val">${c.waiver.approver}</span>
        <span class="fd-key">Expiry</span><span class="fd-val">${c.waiver.expiry}</span>
        <span class="fd-key">Recorded</span><span class="fd-val">${c.waiver.recorded_at}</span>
      </div>
    </div>` : '';

  /* ─── RESOLUTION PANEL (the new feature) ─── */
  let resolutionPanel = '';
  if (isFailed && hasRes) {
    const urlRow = c.resolution_url ? `
      <div class="resolution-url-row">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--blue-bold)" style="flex-shrink:0;"><path d="M9.5 1.5L12 4l-5.5 5.5-2.5-2.5L9.5 1.5zm-7 7L5 11l-3.5.5L2 8.5z"/></svg>
        <strong style="font-size:12px;color:var(--n500);white-space:nowrap;">Resolution Guide:</strong>
        <a href="${c.resolution_url}" target="_blank" rel="noopener">${c.resolution_url}</a>
      </div>` : '';

    const reasonBox = c.detailed_reason ? `
      <div class="resolution-reason">${c.detailed_reason.replace(/\n\n/g,'</p><p style="margin-top:8px;">').replace(/\n/g,'<br>')}</div>` : '';

    const stepsHtml = (c.resolution_steps && c.resolution_steps.length) ? `
      <div style="font-size:12px;font-weight:700;color:var(--n500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">How to resolve</div>
      <div class="resolution-steps">
        ${c.resolution_steps.map(s => `<div class="resolution-step">${s}</div>`).join('')}
      </div>` : '';

    resolutionPanel = `
      <div class="resolution-panel">
        <div class="resolution-panel-header">
          <div class="resolution-panel-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1a6 6 0 100 12A6 6 0 007 1zm.5 9h-1V6.5h1V10zm0-5h-1v-1h1v1z"/></svg>
            Failure Detail &amp; Resolution
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openResolutionModal('${c.id}')" title="Edit resolution info">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M8.5 1.5l2 2L3 11H1V9L8.5 1.5z"/></svg>
            Edit
          </button>
        </div>
        <div class="resolution-panel-body">
          ${urlRow}
          ${reasonBox}
          ${stepsHtml}
        </div>
      </div>`;
  } else if (isFailed) {
    /* No resolution info yet — prompt reviewer to add it */
    resolutionPanel = `
      <div style="border:1px dashed var(--n40);border-radius:var(--r);padding:12px 16px;margin-top:8px;text-align:center;">
        <div style="font-size:13px;color:var(--n400);margin-bottom:8px;">No resolution guidance added yet.</div>
        <button class="btn btn-secondary btn-sm" onclick="openResolutionModal('${c.id}')">
          + Add Resolution URL &amp; Explanation
        </button>
      </div>`;
  }

  return `<tr id="detail-${c.id}"><td colspan="7" style="padding:0;">
    <div class="finding-detail">
      <div class="fd-header">
        <span style="font-size:16px;">${c.status === 'fail' ? '❌' : c.status === 'needs_review' ? '👁' : '🔍'}</span>
        <span class="fd-title">${c.id} — ${c.requirement}</span>
        <span style="margin-left:auto;">${ctrlBadge(c.status)}</span>
      </div>
      ${criteriaBox}
      ${verdictBox}
      ${excerptBox}
      ${waiverBox}
      ${resolutionPanel}
      <div class="fd-actions" style="margin-top:12px;">
        <button class="btn btn-secondary btn-sm" onclick="sendToReview('${c.id}')">📤 Send to Review</button>
        <button class="btn btn-secondary btn-sm" onclick="openAssignModal('${c.id}')">👤 Assign Owner</button>
        <button class="btn btn-waiver btn-sm"    onclick="openWaiverModal('${c.id}')">🔖 Record Waiver</button>
        <button class="btn btn-danger btn-sm"    onclick="openFailModal('${c.id}')">✕ Confirm Fail</button>
        <button class="btn btn-secondary btn-sm" onclick="openResolutionModal('${c.id}')">🔗 Edit Resolution</button>
      </div>
    </div>
  </td></tr>`;
}

function toggleExpand(id) {
  _expandedId = _expandedId === id ? null : id;
  if (_run) renderControls(_run.controls);
}

/* ── Evidence Log tab ───────────────────────────────────── */
function renderEvidenceLog(controls) {
  const el = document.getElementById('evidence-log-content');
  if (!el || !controls) return;
  const done = controls.filter(c => c.evidence_file && c.status !== 'pending');
  if (!done.length) { el.innerHTML = '<p style="color:var(--n400);font-size:13px;">Agents retrieving evidence…</p>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Control</th><th>Document Retrieved</th><th>Source</th><th>Acceptance Criteria</th><th>Verdict</th><th>Time</th></tr></thead>
    <tbody>${done.map(c => `<tr>
      <td><span class="ctrl-id">${c.id}</span></td>
      <td><a class="evidence-link" href="#" onclick="return false;">📄 ${c.evidence_file}</a></td>
      <td style="font-size:11px;color:var(--n400);">${c.evidence_src || ''}</td>
      <td style="font-size:11px;color:var(--n500);max-width:160px;">${c.acceptance_criteria || ''}</td>
      <td>${ctrlBadge(c.status)}</td>
      <td class="timestamp">${c.checked_at || '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ── Waivers tab ────────────────────────────────────────── */
function renderOverridesTab(controls) {
  const el = document.getElementById('overrides-content');
  if (!el || !controls) return;
  const waivers   = controls.filter(c => c.waiver);
  const confirmed = controls.filter(c => c.confirmed_fail_reason);
  if (!waivers.length && !confirmed.length) { el.innerHTML = '<p style="color:var(--n400);font-size:13px;">No waivers or confirmed failures yet.</p>'; return; }
  let html = '';
  if (waivers.length) {
    html += `<div style="font-size:13px;font-weight:700;color:var(--n800);margin-bottom:12px;">Waivers (${waivers.length})</div>`;
    html += waivers.map(c => `
      <div style="border:1px solid var(--n40);border-left:3px solid var(--purple-bold);border-radius:var(--r);padding:14px;margin-bottom:10px;background:var(--purple-subtle);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span class="ctrl-id">${c.id}</span>
          <span style="font-weight:600;font-size:13px;">${c.requirement}</span>
          <span class="lz lz-waived" style="margin-left:auto;">Waived</span>
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
    html += `<div style="font-size:13px;font-weight:700;color:var(--n800);margin:16px 0 10px;">Confirmed Failures (${confirmed.length})</div>`;
    html += confirmed.map(c => `
      <div style="border:1px solid var(--n40);border-left:3px solid var(--red-bold);border-radius:var(--r);padding:14px;margin-bottom:10px;background:var(--red-subtle);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="ctrl-id">${c.id}</span>
          <span style="font-weight:600;font-size:13px;">${c.requirement}</span>
          <span class="lz lz-fail" style="margin-left:auto;">Confirmed Fail</span>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--n500);">${c.confirmed_fail_reason}</div>
      </div>`).join('');
  }
  el.innerHTML = html;
}

/* ── Audit log tab ──────────────────────────────────────── */
function renderAuditLog(log) {
  const el = document.getElementById('audit-log-content');
  if (!el) return;
  if (!log || !log.length) { el.innerHTML = '<p style="color:var(--n400);font-size:13px;">Audit log empty.</p>'; return; }
  el.innerHTML = `<div style="font-family:var(--mono);font-size:12px;line-height:1.9;">
    ${log.map(e => `<div style="border-bottom:1px solid var(--n20);padding:3px 0;color:var(--n800);">${e}</div>`).join('')}
  </div>`;
}

/* ── Gate decision display (bottom of report panel) ─────── */
function renderGateDecisionDisplay(gd) {
  const el = document.getElementById('gate-decision-display');
  if (!el) return;
  if (!gd) { el.style.display = 'none'; return; }
  const color = gd.decision === 'approve' ? 'var(--green-text)' : gd.decision === 'reject' ? 'var(--red-text)' : 'var(--yellow-text)';
  el.style.display = 'block';
  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:6px;">Gate Decision: ${gd.decision.toUpperCase()}</div>
    <div class="fd-grid" style="font-size:12px;">
      <span class="fd-key">Reviewer</span><span class="fd-val">${gd.reviewer}</span>
      <span class="fd-key">Notes</span><span class="fd-val">${gd.notes || '—'}</span>
      <span class="fd-key">Recorded</span><span class="fd-val">${gd.recorded_at}</span>
    </div>`;
}

/* ── Duration ───────────────────────────────────────────── */
function updateDuration() {
  const el = document.getElementById('rf-duration');
  if (!el || !_startedAt) return;
  const s = Math.floor((Date.now() - _startedAt.getTime()) / 1000);
  el.innerHTML = `Duration: <strong>${Math.floor(s/60)}m ${s%60}s</strong>`;
}

/* ── Filter + search ────────────────────────────────────── */
function setFilter(f, el) {
  _filter = f;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  if (_run) renderControls(_run.controls);
}
function applyFilter() { if (_run) renderControls(_run.controls); }

/* ── Tabs ───────────────────────────────────────────────── */
function switchTab(name, el) {
  ['controls','evidence','overrides','history'].forEach(t => {
    const tab = document.getElementById(`tab-${t}`);
    if (tab) tab.style.display = t === name ? '' : 'none';
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

/* ════════════════════════════════════════════════════════
   MODALS
════════════════════════════════════════════════════════ */

/* Waiver */
function openWaiverModal(id) {
  const c = getCtrl(id); if (!c) return;
  document.getElementById('waiver-ctrl-id').value = id;
  document.getElementById('waiver-ctrl-label').textContent = `${id} — ${c.requirement}`;
  ['waiver-rationale','waiver-approver','waiver-expiry'].forEach(x => { const el = document.getElementById(x); if(el) el.value=''; });
  hideEl('waiver-error');
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
  else showErr('waiver-error', r.error || 'Failed');
}

/* Confirm Fail */
function openFailModal(id) {
  const c = getCtrl(id); if (!c) return;
  document.getElementById('fail-ctrl-id').value = id;
  document.getElementById('fail-ctrl-label').textContent = `${id} — ${c.requirement}`;
  document.getElementById('fail-reason').value = '';
  openModal('fail-modal');
}
async function submitFail() {
  const id = document.getElementById('fail-ctrl-id').value;
  const reason = document.getElementById('fail-reason').value.trim() || 'Confirmed failure by reviewer.';
  const r = await post(`/api/audit/${RUN_ID}/confirm_fail`,{control_id:id,reason});
  if (r.ok) { closeModal('fail-modal'); showToast(`✕ ${id} confirmed as Fail`); fetchRun(); }
  else alert(r.error || 'Failed');
}

/* Assign owner */
function openAssignModal(id) {
  const c = getCtrl(id); if (!c) return;
  document.getElementById('assign-ctrl-id').value = id;
  document.getElementById('assign-ctrl-label').textContent = `${id} — ${c.requirement}`;
  document.getElementById('assign-owner').value = c.assigned_owner || '';
  openModal('assign-modal');
}
async function submitAssign() {
  const id    = document.getElementById('assign-ctrl-id').value;
  const owner = document.getElementById('assign-owner').value.trim();
  if (!owner) { alert('Owner name required'); return; }
  const r = await post(`/api/audit/${RUN_ID}/assign_owner`,{control_id:id,owner});
  if (r.ok) { closeModal('assign-modal'); showToast(`👤 ${id} assigned to ${owner}`); fetchRun(); }
  else alert(r.error||'Failed');
}

/* Send to review */
async function sendToReview(id) {
  const r = await post(`/api/audit/${RUN_ID}/review`,{control_id:id,reason:'Sent to human review from audit screen'});
  if (r.ok) { showToast(`📤 ${id} sent to review queue`); fetchRun(); }
  else alert(r.error||'Failed');
}

/* ─── Resolution modal (new feature) ─── */
function openResolutionModal(id) {
  const c = getCtrl(id); if (!c) return;
  document.getElementById('res-ctrl-id').value = id;
  document.getElementById('res-ctrl-label').textContent = `${id} — ${c.requirement}`;
  document.getElementById('res-reason').value = c.detailed_reason || '';
  document.getElementById('res-url').value    = c.resolution_url   || '';
  hideEl('res-error');
  openModal('resolution-modal');
}
async function submitResolution() {
  const id     = document.getElementById('res-ctrl-id').value;
  const reason = document.getElementById('res-reason').value.trim();
  const url    = document.getElementById('res-url').value.trim();
  if (!reason) { showErr('res-error','Detailed failure reason is required.'); return; }
  const r = await post(`/api/audit/${RUN_ID}/resolution`,{control_id:id,detailed_reason:reason,resolution_url:url});
  if (r.ok) {
    // Update local state so re-render shows new data immediately
    const ctrl = getCtrl(id);
    if (ctrl) { ctrl.detailed_reason = reason; ctrl.resolution_url = url || ctrl.resolution_url; }
    closeModal('resolution-modal');
    showToast('🔗 Resolution info saved');
    fetchRun();
  } else showErr('res-error', r.error||'Failed');
}

/* Re-audit */
function openReauditModal() {
  if (!_run) return;
  document.getElementById('reaudit-reason').value = '';
  hideEl('reaudit-error');
  const list     = document.getElementById('reaudit-controls-list');
  const eligible = (_run.controls||[]).filter(c => c.status !== 'pending' && c.status !== 'waived');
  list.innerHTML = eligible.length
    ? eligible.map(c => `
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 4px;border-radius:var(--r);" class="ctrl-check-row">
          <input type="checkbox" value="${c.id}" style="width:14px;height:14px;cursor:pointer;accent-color:var(--blue-bold);"/>
          <span class="ctrl-id">${c.id}</span>
          <span style="font-size:13px;">${c.requirement}</span>
          <span style="margin-left:auto;">${ctrlBadge(c.status)}</span>
        </label>`).join('')
    : '<p style="color:var(--n400);font-size:13px;">No completed controls available yet.</p>';
  openModal('reaudit-modal');
}
async function submitReaudit() {
  const reason  = document.getElementById('reaudit-reason').value.trim();
  const checked = [...document.querySelectorAll('#reaudit-controls-list input:checked')].map(cb => cb.value);
  if (!reason)         { showErr('reaudit-error','Reason required'); return; }
  if (!checked.length) { showErr('reaudit-error','Select at least one control'); return; }
  const r = await post(`/api/audit/${RUN_ID}/reaudit`,{control_ids:checked,reason});
  if (r.ok) { closeModal('reaudit-modal'); showToast('Re-audit run created…'); setTimeout(()=>window.location.href=`/audit/${r.new_run_id}`,1200); }
  else showErr('reaudit-error', r.error||'Failed');
}

/* Gate decision */
function openGateDecisionModal() {
  document.querySelectorAll('input[name=gate-dec]').forEach(r => r.checked = false);
  ['gate-reviewer','gate-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  hideEl('gate-error');
  openModal('gate-modal');
}
async function submitGateDecision() {
  const decision  = document.querySelector('input[name=gate-dec]:checked')?.value;
  const reviewer  = document.getElementById('gate-reviewer').value.trim();
  const notes     = document.getElementById('gate-notes').value.trim();
  if (!decision)  { showErr('gate-error','Select a decision'); return; }
  if (!reviewer)  { showErr('gate-error','Reviewer name required'); return; }
  const r = await post(`/api/audit/${RUN_ID}/gate_decision`,{decision,reviewer,notes});
  if (r.ok) { closeModal('gate-modal'); showToast(`Gate decision: ${decision.toUpperCase()}`); fetchRun(); }
  else showErr('gate-error', r.error||'Failed');
}

/* Export */
function exportReport() { window.location.href = `/api/audit/${RUN_ID}/export`; }

/* ════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════ */
function getCtrl(id) { return _run?.controls?.find(c => c.id === id); }

function ctrlBadge(status) {
  return ({
    pass:             `<span class="lz lz-done">Pass</span>`,
    fail:             `<span class="lz lz-fail">Fail</span>`,
    needs_review:     `<span class="lz lz-review">Needs Review</span>`,
    unable_to_verify: `<span class="lz lz-unable">Unable to Verify</span>`,
    pending:          `<span class="lz lz-default">Pending</span>`,
    waived:           `<span class="lz lz-waived">Waived</span>`,
  })[status] || `<span class="lz lz-default">${status}</span>`;
}

function gateLozenge(gs) {
  return ({
    pass:         `<span class="lz lz-done">Pass</span>`,
    fail:         `<span class="lz lz-fail">Fail</span>`,
    needs_review: `<span class="lz lz-review">Needs Review</span>`,
    in_progress:  `<span class="lz lz-inprogress">In Progress</span>`,
  })[gs] || `<span class="lz lz-inprogress">In Progress</span>`;
}

async function post(url, body) {
  try {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    return await r.json();
  } catch(e) { return { error: e.message }; }
}

function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function closeModalOnOverlay(e, id) { if (e.target === document.getElementById(id)) closeModal(id); }
function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function showErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } }

function showToast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.style.display = 'block'; t.classList.add('toast-show');
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.style.display = 'none', 300); }, ms);
}
