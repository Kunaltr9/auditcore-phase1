"""
AI-Driven Audit & Compliance — Phase 1 Prototype
3R Infotech · Comviva

FLOW:
  1. Customer defines checklist controls + compliance policies → approves a version
  2. Customer selects project + gate → starts audit
  3. Agents automatically retrieve evidence from connected systems (SharePoint Phase 1,
     Jira/Confluence/Dataverse Phase 2)
  4. Agents evaluate each control against retrieved evidence
  5. Compliance Evaluator scores: Pass / Fail / Needs Review / Unable to Verify
  6. Human reviewer acts on findings → Gate decision recorded
"""

import uuid, time, threading, copy
from datetime import datetime, timezone
from flask import Flask, jsonify, request, render_template, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ─────────────────────────────────────────────────────────
# IN-MEMORY STORE
# ─────────────────────────────────────────────────────────
PROJECTS     = {}   # pin  -> project
CHECKLISTS   = {}   # checklist_id -> checklist (customer-defined controls + policies)
RUNS         = {}   # run_id -> audit run

# ─────────────────────────────────────────────────────────
# SEED PROJECTS
# ─────────────────────────────────────────────────────────
SEED_PROJECTS = [
    {"pin":"PIN-2024-0047","name":"Comviva MobileMoney Platform Upgrade",
     "type":"New Implementation","lifecycle":"v1.2",
     "delivery_owner":"Rajesh Kumar","business_unit":"Digital Financial Services",
     "applicable_gates":["G1","G2","G3","G4","G5"]},
    {"pin":"PIN-2024-0051","name":"Comviva CRM Integration — APAC",
     "type":"Enhancement","lifecycle":"v1.1",
     "delivery_owner":"Priya Sharma","business_unit":"Customer Platforms",
     "applicable_gates":["G2","G3","G4","G5"]},
    {"pin":"PIN-2024-0063","name":"Comviva Analytics Modernisation",
     "type":"Migration","lifecycle":"v1.2",
     "delivery_owner":"Amit Patel","business_unit":"Data & AI",
     "applicable_gates":["G1","G2","G3","G4","G5","G6"]},
]
for p in SEED_PROJECTS:
    PROJECTS[p["pin"]] = p

# ─────────────────────────────────────────────────────────
# DEFAULT CHECKLIST TEMPLATE (customer can edit / replace)
# Controls define WHAT to check — agents decide HOW by
# querying connected systems automatically.
# ─────────────────────────────────────────────────────────
DEFAULT_CONTROLS = [
    {"id":"G1-C01","requirement":"RFP / RFQ document present",
     "description":"Original tender document must be retrievable from the document repository",
     "acceptance_criteria":"Document exists, metadata complete, version ≥ 1",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C02","requirement":"Customer brief attached",
     "description":"Project brief confirming scope context linked to project PIN",
     "acceptance_criteria":"Brief linked to PIN, modified within last 90 days",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C03","requirement":"Approved response template used",
     "description":"Comviva-approved proposal template must be base document",
     "acceptance_criteria":"Template headers match TPL-G1-current, all sections present",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C04","requirement":"Capability matrix completed",
     "description":"All RFP capabilities mapped to vendor response",
     "acceptance_criteria":"No empty mandatory cells, all capability rows populated",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C05","requirement":"Assumptions log documented",
     "description":"All proposal assumptions captured with owner and impact classification",
     "acceptance_criteria":"Each assumption has owner, impact level, and date",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C06","requirement":"Compliance questionnaire submitted",
     "description":"Security and compliance declaration signed by authorised signatory",
     "acceptance_criteria":"PDF signed, date within submission window, signatory authorised",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C07","requirement":"Requirement-to-proposal traceability map",
     "description":"Every RFP requirement maps to a proposal section with citation",
     "acceptance_criteria":"100% of requirements mapped, each with source clause and destination",
     "severity":"mandatory","check_type":"ai-assisted","source_hint":"SharePoint"},
    {"id":"G1-C08","requirement":"Draft proposal reviewed and approved",
     "description":"Approval from authorised Comviva reviewer recorded in document system",
     "acceptance_criteria":"approval_status = Approved AND approver_id present",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C09","requirement":"Exceptions and deviations register",
     "description":"All policy exceptions listed with reason, owner and approval",
     "acceptance_criteria":"Register document exists for this PIN with at least 0 entries",
     "severity":"mandatory","check_type":"deterministic","source_hint":"SharePoint"},
    {"id":"G1-C10","requirement":"Proposal covers all mandatory sections",
     "description":"Semantic coverage assessment — all required sections substantively addressed",
     "acceptance_criteria":"AI confidence ≥ 80% coverage on all mandatory section headings",
     "severity":"mandatory","check_type":"ai-assisted","source_hint":"SharePoint"},
    {"id":"G1-C11","requirement":"High-impact assumptions approved or escalated",
     "description":"Assumptions rated HIGH impact must have owner and approval date",
     "acceptance_criteria":"Zero HIGH-impact assumptions without owner and approval date",
     "severity":"advisory","check_type":"ai-assisted","source_hint":"SharePoint"},
    {"id":"G1-C12","requirement":"Project registered in Comviva project registry",
     "description":"Project must exist in Dataverse project registry with matching PIN",
     "acceptance_criteria":"Dataverse record found, PIN match, status = Active",
     "severity":"mandatory","check_type":"deterministic","source_hint":"Dataverse"},
]

DEFAULT_POLICIES = [
    {"id":"POL-01","name":"Mandatory control failure blocks gate",
     "rule":"If any mandatory control = Fail and no approved Waiver, gate cannot Pass"},
    {"id":"POL-02","name":"Waiver requires rationale, approver and expiry",
     "rule":"A Waiver must record: rationale, authorised approver name, expiry/review date"},
    {"id":"POL-03","name":"AI-only pass not permitted",
     "rule":"AI findings alone cannot produce a Pass; deterministic check or human approval required"},
    {"id":"POL-04","name":"Unable to Verify is not a Fail",
     "rule":"Connector unavailability returns Unable to Verify, not Fail; manual check required"},
    {"id":"POL-05","name":"Gate decision requires human approval",
     "rule":"Agents cannot approve gate readiness; an authorised reviewer must record the decision"},
    {"id":"POL-06","name":"Every result must have evidence reference",
     "rule":"Each control result must cite source system, document ID/link, version and timestamp"},
]

# Seed a default approved checklist  — called after helpers are defined
def _seed_checklist():
    cid = "CL-G1-DEFAULT"
    CHECKLISTS[cid] = {
        "checklist_id": cid,
        "gate": "G1",
        "name": "G1 — RFP to Solution Proposal (Default)",
        "version": "v2.4.1",
        "approved": True,
        "approved_by": "Comviva QA",
        "approved_at": "12 Oct 2026",
        "controls": copy.deepcopy(DEFAULT_CONTROLS),
        "policies": copy.deepcopy(DEFAULT_POLICIES),
        "created_at": "seeded",
    }
    return cid

# ─────────────────────────────────────────────────────────
# CONNECTOR SIMULATION
# Simulates what agents retrieve from connected systems.
# In production these are real API calls to SharePoint,
# Jira, Confluence, Dataverse etc.
# ─────────────────────────────────────────────────────────
CONNECTOR_EVIDENCE = {
    "G1-C01": {"found":True,  "file":"Comviva_RFP_v3.pdf",          "src":"SharePoint · SP-4421 · v3",    "meta":"approval_status=Approved, version=3, modified=05 Oct 2026"},
    "G1-C02": {"found":True,  "file":"ProjectBrief_Comviva.docx",    "src":"SharePoint · SP-4422 · v1",    "meta":"linked_pin=PIN-2024-0047, modified=05 Oct 2026"},
    "G1-C03": {"found":True,  "file":"Proposal_Draft_v2.docx",       "src":"SharePoint · SP-4450 · v2",    "meta":"template_id=TPL-G1-2026, sections=all_present"},
    "G1-C04": {"found":True,  "file":"CapabilityMatrix_v1.xlsx",     "src":"SharePoint · SP-4451",          "meta":"rows=42, empty_mandatory=0"},
    "G1-C05": {"found":True,  "file":"Assumptions_Register.docx",    "src":"SharePoint · SP-4455",          "meta":"assumptions=14, unowned_high=3"},
    "G1-C06": {"found":True,  "file":"ComplianceQ_Signed.pdf",       "src":"SharePoint · SP-4460",          "meta":"signed=true, signatory=authorised, date=within_window"},
    "G1-C07": {"found":True,  "file":"ReqMapping_RFP_Proposal.xlsx", "src":"SharePoint · SP-4462",          "meta":"requirements=38, mapped=38, coverage=100%"},
    "G1-C08": {"found":True,  "file":"Proposal_Draft_v2.docx",       "src":"SharePoint · SP-4450",          "meta":"approval_status=Draft, approver_id=null"},
    "G1-C09": {"found":False, "file":None,                           "src":"SharePoint · project library",  "meta":"search=exceptions_register, matches=0"},
    "G1-C10": {"found":True,  "file":"Proposal_Draft_v2.docx",       "src":"SharePoint · SP-4450",          "meta":"section_4.2=ambiguous, ai_confidence=61%"},
    "G1-C11": {"found":True,  "file":"Assumptions_Register.docx",    "src":"SharePoint · SP-4455",          "meta":"high_impact_unowned=3 (A-07,A-11,A-13)"},
    "G1-C12": {"found":False, "file":None,                           "src":"Dataverse",                     "meta":"connector=not_configured_phase1"},
}

def _evaluate_control(ctrl, evidence):
    """
    Agents evaluate the customer-defined acceptance criteria
    against the evidence retrieved from connected systems.
    Returns (status, rationale, finding_detail, excerpt)
    """
    cid  = ctrl["id"]
    crit = ctrl["acceptance_criteria"]
    ev   = evidence.get(cid, {})

    if cid == "G1-C12":
        return ("unable_to_verify",
                "Dataverse connector is not configured in the Phase 1 pilot. Manual verification required. Not treated as a failure.",
                f"Acceptance criteria: {crit}\nConnector status: Phase 2 — not configured in pilot.",
                "Connector: Dataverse\nStatus: Not configured (Phase 1 pilot)\nAction: Manual check required or re-run after Phase 2 connector enabled.")

    if not ev.get("found"):
        return ("fail",
                f"Evidence Agent searched {ev.get('src','repository')} — 0 matching documents found for this PIN.",
                f"Acceptance criteria: {crit}\nSearch result: {ev.get('meta','')}",
                f"Expected: document matching control {cid}\nFound: 0 documents\nSource: {ev.get('src','')}")

    meta = ev.get("meta","")

    if cid == "G1-C08":
        return ("fail",
                "Approval metadata field is empty. No approver signature block detected. Acceptance criteria requires approval_status=Approved AND approver_id present.",
                f"Acceptance criteria: {crit}\nEvidence metadata: {meta}",
                'Expected: approval_status = "Approved"  AND  approver_id != null\nFound:    approval_status = "Draft"      AND  approver_id = null')

    if cid == "G1-C10":
        return ("needs_review",
                "AI semantic check: section 4.2 Pricing Model detected but structured pricing table absent. AI confidence 61% — below the 80% threshold defined in acceptance criteria. Routed to human reviewer.",
                f"Acceptance criteria: {crit}\nEvidence metadata: {meta}",
                'Section 4.2 "Pricing Model": narrative text detected, structured table not found.\nRequired: unit pricing, volume tiers, payment schedule, currency.\nAI confidence: 61% (threshold: 80%)')

    if cid == "G1-C11":
        return ("needs_review",
                "3 of 14 HIGH-impact assumptions (A-07, A-11, A-13) have no owner or approval date. Acceptance criteria requires zero unowned HIGH-impact assumptions.",
                f"Acceptance criteria: {crit}\nEvidence metadata: {meta}",
                "A-07: Integration dependency on third-party API — owner: unassigned\nA-11: Go-live date fixed before UAT completion — owner: unassigned\nA-13: Regulatory approval assumed — owner: unassigned")

    return ("pass",
            f"Evidence found and acceptance criteria satisfied. {meta}",
            None, None)

# ─────────────────────────────────────────────────────────
# BACKGROUND AUDIT RUNNER
# Simulates: Policy resolve → Evidence retrieval → 
# Deterministic checks → AI-assisted checks → Evaluation
# ─────────────────────────────────────────────────────────
def _run_audit(run_id):
    run = RUNS[run_id]
    checklist = CHECKLISTS[run["checklist_id"]]
    controls  = run["controls"]

    # ── Step 1: Policy & Gate resolve (2s) ──────────────
    run["pipeline_step"] = 1
    run["log"].append(_log_entry("Audit orchestrator started. Policy resolver loading checklist."))
    time.sleep(2)
    run["log"].append(_log_entry(f"Checklist {checklist['name']} version {checklist['version']} pinned to run {run_id}."))
    run["pipeline_step"] = 2

    # ── Step 2: Evidence retrieval (connector scan) ─────
    run["agents"]["evidence"]["status"] = "running"
    run["log"].append(_log_entry("Evidence Agent connecting to SharePoint via Microsoft Graph (read-only)."))
    time.sleep(3)

    artifacts = 0
    for ctrl in controls:
        ev = CONNECTOR_EVIDENCE.get(ctrl["id"], {})
        if ev.get("found"):
            ctrl["evidence_file"] = ev.get("file")
            ctrl["evidence_src"]  = ev.get("src")
            artifacts += 1
        else:
            ctrl["evidence_file"] = None
            ctrl["evidence_src"]  = ev.get("src","")
        time.sleep(0.4)

    connector_note = "1 connector not configured (Dataverse · Phase 2)"
    run["agents"]["evidence"]["status"] = "done"
    run["agents"]["evidence"]["meta"]   = f"{artifacts} artifacts retrieved · {connector_note}"
    run["log"].append(_log_entry(f"Evidence Agent: {artifacts} artifacts retrieved. {connector_note}."))
    run["pipeline_step"] = 3

    # ── Step 3: Deterministic checks ────────────────────
    run["agents"]["checklist"]["status"] = "running"
    run["log"].append(_log_entry("Checklist Agent starting deterministic checks (presence, metadata, approval fields)."))
    det_ctrls = [c for c in controls if c["check_type"] == "deterministic"]
    p=f=0
    for ctrl in det_ctrls:
        time.sleep(1.2)
        status, rationale, detail, excerpt = _evaluate_control(ctrl, CONNECTOR_EVIDENCE)
        ctrl["status"]         = status
        ctrl["rationale"]      = rationale
        ctrl["finding_detail"] = detail
        ctrl["finding_excerpt"]= excerpt
        ctrl["checked_at"]     = _now_short()
        ctrl["evaluated_against"] = ctrl["acceptance_criteria"]
        if status == "pass": p += 1
        elif status == "fail": f += 1
        run["summary"] = _summary(controls)
        run["log"].append(_log_entry(f"{ctrl['id']}: {status.upper()} — {rationale[:80]}"))

    run["agents"]["checklist"]["status"] = "done"
    run["agents"]["checklist"]["meta"]   = f"{p} pass · {f} fail · deterministic rules only"
    run["pipeline_step"] = 4

    # ── Step 4: AI-assisted checks (parallel) ───────────
    run["agents"]["traceability"]["status"] = "running"
    run["log"].append(_log_entry("Scope/Traceability Agent starting AI-assisted checks (requirement mapping, semantic coverage)."))
    ai_ctrls = [c for c in controls if c["check_type"] == "ai-assisted"]
    for ctrl in ai_ctrls:
        time.sleep(2)
        status, rationale, detail, excerpt = _evaluate_control(ctrl, CONNECTOR_EVIDENCE)
        ctrl["status"]         = status
        ctrl["rationale"]      = rationale
        ctrl["finding_detail"] = detail
        ctrl["finding_excerpt"]= excerpt
        ctrl["checked_at"]     = _now_short()
        ctrl["evaluated_against"] = ctrl["acceptance_criteria"]
        run["summary"] = _summary(controls)
        run["log"].append(_log_entry(f"{ctrl['id']}: {status.upper()} (AI-assisted) — {rationale[:80]}"))

    run["agents"]["traceability"]["status"] = "review" if any(c["status"]=="needs_review" for c in ai_ctrls) else "done"
    run["agents"]["traceability"]["meta"]   = f"{sum(1 for c in ai_ctrls if c['status']=='needs_review')} items → human review queue"

    # ── Step 5: Compliance Evaluator ────────────────────
    run["agents"]["evaluator"]["status"] = "running"
    run["log"].append(_log_entry("Compliance Evaluator applying Comviva acceptance criteria to all findings."))
    time.sleep(1.5)

    s = run["summary"]
    gstatus = _gate_status(s)
    run["gate_status"] = gstatus
    run["agents"]["evaluator"]["status"] = "running"
    run["agents"]["evaluator"]["meta"]   = "Awaiting reviewer decisions" if gstatus != "pass" else "Gate clear"
    run["agents"]["evaluator"]["progress"] = 65 if gstatus != "pass" else 100

    run["pipeline_step"] = 5
    run["completed"]     = True
    run["log"].append(_log_entry(f"Compliance Evaluator complete. Gate status: {gstatus.upper()}. {s['fail']} fail, {s['needs_review']} needs review, {s['waived']} waived."))

# ─────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────
def _now():
    return datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")

def _now_short():
    return datetime.now(timezone.utc).strftime("%H:%M")

def _log_entry(msg):
    return f"[{_now()}] {msg}"

def _summary(controls):
    s = {"pass":0,"fail":0,"needs_review":0,"unable_to_verify":0,"pending":0,"waived":0,"na":0,"total":len(controls)}
    for c in controls:
        st = c.get("status","pending")
        if st in s: s[st] += 1
    return s

def _gate_status(s):
    if s["fail"] > 0:    return "fail"
    if s["needs_review"] > 0 or s["unable_to_verify"] > 0: return "needs_review"
    if s["pending"] > 0: return "in_progress"
    return "pass"

def _new_run_id(pin, gate):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    short = pin.split("-")[-1]
    base  = f"AUD-{today}-{gate}-{short}"
    if base not in RUNS: return base
    return base + "-" + uuid.uuid4().hex[:4]

# Seed default checklist now that helpers are available
DEFAULT_CL_ID = _seed_checklist()

def _build_run(pin, gate, checklist_id, parent_run_id=None, reaudit_controls=None):
    run_id  = _new_run_id(pin, gate)
    proj    = PROJECTS[pin]
    cl      = CHECKLISTS[checklist_id]

    controls = copy.deepcopy(cl["controls"])
    for c in controls:
        c["status"]          = "pending"
        c["checked_at"]      = ""
        c["evidence_file"]   = None
        c["evidence_src"]    = ""
        c["rationale"]       = ""
        c["finding_detail"]  = None
        c["finding_excerpt"] = None
        c["evaluated_against"] = None

    if reaudit_controls and parent_run_id:
        parent = RUNS[parent_run_id]
        for c in controls:
            if c["id"] not in reaudit_controls:
                pc = next((x for x in parent["controls"] if x["id"]==c["id"]), None)
                if pc:
                    for k in ["status","checked_at","evidence_file","evidence_src",
                              "rationale","finding_detail","finding_excerpt","evaluated_against"]:
                        c[k] = pc.get(k)
                    c["carried_from"] = parent_run_id

    run = {
        "run_id":       run_id,
        "pin":          pin,
        "gate":         gate,
        "checklist_id": checklist_id,
        "project_name": proj["name"],
        "project_type": proj["type"],
        "lifecycle":    proj["lifecycle"],
        "policy_version":  cl["version"],
        "policy_approved": cl["approved_at"],
        "ai_model":     "Amazon Bedrock · Claude 3.5 Sonnet",
        "prompt_version":"prompt-v1.2",
        "controls":     controls,
        "agents": {
            "evidence":    {"name":"Evidence Agent",            "task":"Auto-retrieve evidence from SharePoint (read-only)",         "color":"blue",   "phase":1,"status":"waiting","meta":"Queued","progress":0},
            "checklist":   {"name":"Checklist Agent",           "task":"Evaluate deterministic controls against retrieved evidence", "color":"green",  "phase":1,"status":"waiting","meta":"Queued","progress":0},
            "traceability":{"name":"Scope / Traceability Agent","task":"AI-assisted: requirement mapping & semantic coverage",      "color":"purple", "phase":1,"status":"waiting","meta":"Queued","progress":0},
            "evaluator":   {"name":"Compliance Evaluator",      "task":"Apply checklist acceptance criteria · rules engine only",   "color":"amber",  "phase":1,"status":"waiting","meta":"Queued","progress":0},
            "review":      {"name":"Review Agent",              "task":"Review-comment & revision analysis",                        "color":"gray",   "phase":2,"status":"phase2", "meta":"Phase 2","progress":0},
            "testquality": {"name":"Test & Quality Agent",      "task":"Test results, coverage & quality gate checks",              "color":"gray",   "phase":2,"status":"phase2", "meta":"Phase 2","progress":0},
        },
        "pipeline_step":  0,
        "gate_status":    "in_progress",
        "summary":        _summary(controls),
        "started_at":     _now(),
        "completed":      False,
        "log":            [_log_entry(f"Audit run {run_id} created for {pin} · {gate} · checklist {cl['version']}")],
        "parent_run_id":  parent_run_id,
        "is_reaudit":     parent_run_id is not None,
        "reaudit_controls": reaudit_controls or [],
        "reviewer_queue": [],
        "gate_decision":  None,
    }
    RUNS[run_id] = run
    threading.Thread(target=_run_audit, args=(run_id,), daemon=True).start()
    return run_id

# ─────────────────────────────────────────────────────────
# PAGES
# ─────────────────────────────────────────────────────────
@app.route("/")
def page_index():
    return render_template("index.html",
        projects=list(PROJECTS.values()),
        checklists=list(CHECKLISTS.values()))

@app.route("/setup")
def page_setup():
    cl = CHECKLISTS.get(DEFAULT_CL_ID)
    return render_template("setup.html", checklist=cl)

@app.route("/audit/<run_id>")
def page_audit(run_id):
    if run_id not in RUNS: abort(404)
    return render_template("audit.html", run=RUNS[run_id], run_id=run_id)

@app.route("/connectors")
def page_connectors():
    return render_template("connectors.html")

@app.route("/reports")
def page_reports():
    runs = sorted(RUNS.values(), key=lambda r: r.get("started_at",""), reverse=True)
    return render_template("reports.html", runs=list(runs), run_count=len(runs))

@app.route("/settings")
def page_settings():
    cl = CHECKLISTS.get(DEFAULT_CL_ID)
    return render_template("settings.html", checklist=cl, projects=list(PROJECTS.values()))

@app.route("/projects")
def page_projects():
    runs = sorted(RUNS.values(), key=lambda r: r.get("started_at",""), reverse=True)
    return render_template("projects.html", projects=list(PROJECTS.values()), runs=list(runs))

# ─────────────────────────────────────────────────────────
# CHECKLIST API
# ─────────────────────────────────────────────────────────
@app.route("/api/checklist", methods=["GET"])
def api_get_checklists():
    return jsonify(list(CHECKLISTS.values()))

@app.route("/api/checklist/<cid>", methods=["GET"])
def api_get_checklist(cid):
    if cid not in CHECKLISTS: return jsonify({"error":"Not found"}), 404
    return jsonify(CHECKLISTS[cid])

@app.route("/api/checklist", methods=["POST"])
def api_save_checklist():
    """Customer saves/updates checklist controls and policies."""
    data = request.get_json(force=True)
    cid  = data.get("checklist_id", "CL-G1-" + uuid.uuid4().hex[:6].upper())
    name = data.get("name","").strip()
    controls = data.get("controls", [])
    policies = data.get("policies", [])
    if not name:    return jsonify({"error":"Checklist name required"}), 400
    if not controls: return jsonify({"error":"At least one control required"}), 400

    # Validate each control has required fields
    for c in controls:
        for f in ["id","requirement","acceptance_criteria","severity","check_type"]:
            if not c.get(f):
                return jsonify({"error":f"Control missing required field: {f}"}), 400

    existing = CHECKLISTS.get(cid, {})
    # Bump version
    old_ver = existing.get("version","v0.0.0")
    try:
        parts = old_ver.lstrip("v").split(".")
        new_ver = "v" + ".".join(parts[:-1] + [str(int(parts[-1])+1)])
    except:
        new_ver = "v1.0"

    CHECKLISTS[cid] = {
        "checklist_id": cid,
        "gate":         data.get("gate","G1"),
        "name":         name,
        "version":      new_ver,
        "approved":     False,
        "approved_by":  None,
        "approved_at":  None,
        "controls":     controls,
        "policies":     policies,
        "created_at":   _now(),
    }
    return jsonify({"ok":True,"checklist_id":cid,"version":new_ver}), 201

@app.route("/api/checklist/<cid>/approve", methods=["POST"])
def api_approve_checklist(cid):
    """Customer approves the checklist version for use in audits."""
    if cid not in CHECKLISTS: return jsonify({"error":"Not found"}), 404
    data = request.get_json(force=True)
    approver = data.get("approver","").strip()
    if not approver: return jsonify({"error":"Approver name required"}), 400
    cl = CHECKLISTS[cid]
    cl["approved"]    = True
    cl["approved_by"] = approver
    cl["approved_at"] = _now()
    return jsonify({"ok":True,"version":cl["version"],"approved_at":cl["approved_at"]})

@app.route("/api/checklist/<cid>/control", methods=["POST"])
def api_add_control(cid):
    """Add a single control to an existing checklist."""
    if cid not in CHECKLISTS: return jsonify({"error":"Not found"}), 404
    ctrl = request.get_json(force=True)
    for f in ["id","requirement","acceptance_criteria","severity","check_type"]:
        if not ctrl.get(f): return jsonify({"error":f"Missing field: {f}"}), 400
    CHECKLISTS[cid]["controls"].append(ctrl)
    CHECKLISTS[cid]["approved"] = False  # requires re-approval after edit
    return jsonify({"ok":True,"total_controls":len(CHECKLISTS[cid]["controls"])})

@app.route("/api/checklist/<cid>/control/<ctrl_id>", methods=["DELETE"])
def api_delete_control(cid, ctrl_id):
    if cid not in CHECKLISTS: return jsonify({"error":"Not found"}), 404
    cl = CHECKLISTS[cid]
    cl["controls"] = [c for c in cl["controls"] if c["id"] != ctrl_id]
    cl["approved"] = False
    return jsonify({"ok":True})

# ─────────────────────────────────────────────────────────
# AUDIT API
# ─────────────────────────────────────────────────────────
@app.route("/api/audit/start", methods=["POST"])
def api_start_audit():
    data = request.get_json(force=True)
    pin  = data.get("pin","")
    gate = data.get("gate","G1")
    cid  = data.get("checklist_id", DEFAULT_CL_ID)
    if pin not in PROJECTS:
        return jsonify({"error":"Unknown project PIN"}), 400
    if cid not in CHECKLISTS:
        return jsonify({"error":"Checklist not found"}), 400
    cl = CHECKLISTS[cid]
    if not cl.get("approved"):
        return jsonify({"error":"Checklist must be approved before starting an audit"}), 400
    run_id = _build_run(pin, gate, cid)
    return jsonify({"run_id":run_id,"redirect":f"/audit/{run_id}"}), 201

@app.route("/api/audit/<run_id>", methods=["GET"])
def api_audit_status(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    run = RUNS[run_id]
    # Safe copy — strip internal sim fields
    safe_controls = [{k:v for k,v in c.items() if k not in ("sim_status",)} for c in run["controls"]]
    return jsonify({**{k:v for k,v in run.items() if k not in ("controls","agents","log")},
                    "controls": safe_controls,
                    "agents":   list(run["agents"].values()),
                    "audit_log": run["log"]})

@app.route("/api/audit/<run_id>/review", methods=["POST"])
def api_review(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d   = request.get_json(force=True)
    cid = d.get("control_id"); reason = d.get("reason","Sent to review")
    run = RUNS[run_id]
    ctrl = next((c for c in run["controls"] if c["id"]==cid), None)
    if not ctrl: return jsonify({"error":"Control not found"}), 404
    ctrl["status"] = "needs_review"
    ctrl["review_note"] = reason
    if cid not in run["reviewer_queue"]: run["reviewer_queue"].append(cid)
    run["summary"] = _summary(run["controls"])
    run["gate_status"] = _gate_status(run["summary"])
    run["log"].append(_log_entry(f"{cid} sent to human review. Reason: {reason}"))
    return jsonify({"ok":True,"summary":run["summary"]})

@app.route("/api/audit/<run_id>/waiver", methods=["POST"])
def api_waiver(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d = request.get_json(force=True)
    cid=d.get("control_id"); rat=d.get("rationale","").strip()
    app_=d.get("approver","").strip(); exp=d.get("expiry","")
    if not all([cid,rat,app_,exp]):
        return jsonify({"error":"rationale, approver and expiry are all required for a waiver"}), 400
    run  = RUNS[run_id]
    ctrl = next((c for c in run["controls"] if c["id"]==cid), None)
    if not ctrl: return jsonify({"error":"Control not found"}), 404
    ctrl["status"] = "waived"
    ctrl["waiver"] = {"rationale":rat,"approver":app_,"expiry":exp,"recorded_at":_now()}
    if cid in run["reviewer_queue"]: run["reviewer_queue"].remove(cid)
    run["summary"] = _summary(run["controls"])
    run["gate_status"] = _gate_status(run["summary"])
    run["log"].append(_log_entry(f"Waiver recorded for {cid} by {app_}. Expiry: {exp}."))
    return jsonify({"ok":True,"summary":run["summary"],"waiver":ctrl["waiver"]})

@app.route("/api/audit/<run_id>/confirm_fail", methods=["POST"])
def api_confirm_fail(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d   = request.get_json(force=True)
    cid = d.get("control_id"); reason = d.get("reason","Confirmed failure")
    run = RUNS[run_id]
    ctrl = next((c for c in run["controls"] if c["id"]==cid), None)
    if not ctrl: return jsonify({"error":"Control not found"}), 404
    ctrl["status"] = "fail"
    ctrl["confirmed_fail_reason"] = reason
    if cid in run["reviewer_queue"]: run["reviewer_queue"].remove(cid)
    run["summary"] = _summary(run["controls"])
    run["gate_status"] = _gate_status(run["summary"])
    run["log"].append(_log_entry(f"{cid} confirmed Fail by reviewer. Reason: {reason}"))
    return jsonify({"ok":True,"summary":run["summary"]})

@app.route("/api/audit/<run_id>/assign_owner", methods=["POST"])
def api_assign_owner(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d = request.get_json(force=True)
    cid=d.get("control_id"); owner=d.get("owner","")
    run  = RUNS[run_id]
    ctrl = next((c for c in run["controls"] if c["id"]==cid), None)
    if not ctrl: return jsonify({"error":"Control not found"}), 404
    ctrl["assigned_owner"] = owner
    run["log"].append(_log_entry(f"{cid} assigned to {owner}"))
    return jsonify({"ok":True})

@app.route("/api/audit/<run_id>/reaudit", methods=["POST"])
def api_reaudit(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d      = request.get_json(force=True)
    cids   = d.get("control_ids",[])
    reason = d.get("reason","Re-audit requested")
    if not cids: return jsonify({"error":"At least one control_id required"}), 400
    run = RUNS[run_id]
    run["log"].append(_log_entry(f"Re-audit requested for {', '.join(cids)}. Reason: {reason}"))
    new_id = _build_run(run["pin"], run["gate"], run["checklist_id"],
                        parent_run_id=run_id, reaudit_controls=cids)
    return jsonify({"ok":True,"new_run_id":new_id,"redirect":f"/audit/{new_id}"}), 201

@app.route("/api/audit/<run_id>/gate_decision", methods=["POST"])
def api_gate_decision(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    d = request.get_json(force=True)
    decision=d.get("decision"); reviewer=d.get("reviewer","").strip(); notes=d.get("notes","")
    if decision not in ("approve","reject","defer"):
        return jsonify({"error":"decision must be approve, reject or defer"}), 400
    if not reviewer: return jsonify({"error":"Reviewer name required"}), 400
    run = RUNS[run_id]
    run["gate_decision"] = {"decision":decision,"reviewer":reviewer,"notes":notes,"recorded_at":_now()}
    if decision == "approve": run["gate_status"] = "pass"
    elif decision == "reject": run["gate_status"] = "fail"
    run["log"].append(_log_entry(f"Gate decision: {decision.upper()} by {reviewer}. Notes: {notes}"))
    return jsonify({"ok":True,"gate_decision":run["gate_decision"],"gate_status":run["gate_status"]})

@app.route("/api/audit/<run_id>/export", methods=["GET"])
def api_export(run_id):
    if run_id not in RUNS: return jsonify({"error":"Not found"}), 404
    run = RUNS[run_id]; cl = CHECKLISTS.get(run["checklist_id"],{})
    lines = ["="*70,"COMVIVA AUDIT GATE REPORT","="*70,
             f"Run ID         : {run['run_id']}",
             f"Project        : {run['project_name']}",
             f"PIN            : {run['pin']}",
             f"Project Type   : {run['project_type']}",
             f"Gate           : {run['gate']} — RFP to Solution Proposal",
             f"Checklist      : {cl.get('name','')}",
             f"Policy Version : {run['policy_version']} (Approved {run['policy_approved']})",
             f"AI Model       : {run['ai_model']}",
             f"Prompt Version : {run['prompt_version']}",
             f"Gate Status    : {run['gate_status'].upper()}",
             f"Generated      : {_now()}","","COMPLIANCE POLICIES","-"*40]
    for pol in cl.get("policies",[]):
        lines.append(f"  [{pol['id']}] {pol['name']}: {pol['rule']}")
    lines += ["","SUMMARY","-"*40]
    for k,v in run["summary"].items():
        if k != "total": lines.append(f"  {k.replace('_',' ').title():<22}: {v}")
    lines += ["","CONTROL RESULTS","-"*40]
    for c in run["controls"]:
        st = c.get("status","pending").replace("_"," ").upper()
        lines += [f"\n[{c['id']}] {c['requirement']}",
                  f"  Status              : {st}",
                  f"  Severity            : {c['severity'].upper()}",
                  f"  Check type          : {c['check_type']}",
                  f"  Acceptance Criteria : {c.get('acceptance_criteria','')}",
                  f"  Evidence            : {c.get('evidence_file') or 'None'} ({c.get('evidence_src','')})",
                  f"  Agent rationale     : {c.get('rationale','')}"]
        if c.get("waiver"):
            w=c["waiver"]
            lines.append(f"  Waiver              : {w['rationale']} | {w['approver']} | Expiry: {w['expiry']}")
    lines += ["","AUDIT LOG","-"*40] + [f"  {e}" for e in run["log"]]
    if run.get("gate_decision"):
        gd=run["gate_decision"]
        lines += ["","GATE DECISION","-"*40,
                  f"  Decision : {gd['decision'].upper()}",
                  f"  Reviewer : {gd['reviewer']}",
                  f"  Notes    : {gd['notes']}",
                  f"  Recorded : {gd['recorded_at']}"]
    lines += ["","="*70,"END OF REPORT","="*70]
    return "\n".join(lines), 200, {
        "Content-Type":"text/plain; charset=utf-8",
        "Content-Disposition":f"attachment; filename=GateReport_{run_id}.txt"}

@app.route("/api/runs", methods=["GET"])
def api_all_runs():
    result = [{"run_id":r["run_id"],"pin":r["pin"],"project_name":r["project_name"],
               "gate":r["gate"],"gate_status":r["gate_status"],"started_at":r["started_at"],
               "completed":r["completed"],"is_reaudit":r["is_reaudit"],
               "parent_run_id":r["parent_run_id"]} for r in RUNS.values()]
    return jsonify(sorted(result, key=lambda x: x["started_at"] or "", reverse=True))

@app.route("/api/projects", methods=["GET"])
def api_projects():
    return jsonify(list(PROJECTS.values()))

if __name__ == "__main__":
    print("="*60)
    print("  AI-Driven Audit & Compliance — Phase 1 Prototype")
    print("  3R Infotech · Comviva")
    print("  http://localhost:5000")
    print("="*60)
    app.run(debug=True, port=5000, use_reloader=False)
