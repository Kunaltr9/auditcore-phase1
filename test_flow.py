"""
Full flow test for the AuditCore prototype.
Run: python test_flow.py
"""
import requests, time, json

BASE = "http://localhost:5000"
OK   = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"

def check(label, cond, detail=""):
    icon = OK if cond else FAIL
    print(f"  {icon} {label}" + (f" — {detail}" if detail else ""))
    return cond

def sep(title):
    print(f"\n{'='*55}\n  {title}\n{'='*55}")

all_passed = True

# ─── 1. Page routes ─────────────────────────────────────
sep("1. Page Routes")
for path in ["/", "/setup"]:
    r = requests.get(BASE + path)
    all_passed &= check(f"GET {path}", r.status_code == 200, f"HTTP {r.status_code}")

# ─── 2. Checklist API ───────────────────────────────────
sep("2. Checklist API")
cl = requests.get(f"{BASE}/api/checklist").json()
c0 = cl[0]
all_passed &= check("GET /api/checklist returns list",   len(cl) > 0)
all_passed &= check("Default checklist present",         c0["checklist_id"] == "CL-G1-DEFAULT")
all_passed &= check("12 controls seeded",                len(c0["controls"]) == 12)
all_passed &= check("6 policies seeded",                 len(c0["policies"]) == 6)
all_passed &= check("Checklist pre-approved",            c0["approved"] is True)

# Add a custom control
r = requests.post(f"{BASE}/api/checklist/{c0['checklist_id']}/control", json={
    "id":"G1-C99","requirement":"Custom test control",
    "acceptance_criteria":"Test passes","severity":"advisory",
    "check_type":"deterministic","source_hint":"SharePoint"
})
all_passed &= check("Add custom control", r.status_code == 200, f"total={r.json().get('total_controls')}")

# Delete the custom control
r = requests.delete(f"{BASE}/api/checklist/{c0['checklist_id']}/control/G1-C99")
all_passed &= check("Delete custom control", r.status_code == 200)

# Save checklist (creates new version)
r = requests.post(f"{BASE}/api/checklist", json={
    "checklist_id": c0["checklist_id"],
    "gate": "G1",
    "name": c0["name"],
    "controls": c0["controls"],
    "policies": c0["policies"],
})
all_passed &= check("Save checklist → new version", r.status_code == 201, r.json().get("version"))

# Approve checklist
r = requests.post(f"{BASE}/api/checklist/{c0['checklist_id']}/approve", json={"approver":"Test QA"})
all_passed &= check("Approve checklist", r.status_code == 200, r.json().get("version"))

# Validation: audit blocked on unapproved checklist
# (create unapproved checklist)
r_new = requests.post(f"{BASE}/api/checklist", json={
    "checklist_id":"CL-UNAPPROVED","gate":"G1","name":"Unapproved Test",
    "controls": c0["controls"][:2], "policies":[]
})
r_block = requests.post(f"{BASE}/api/audit/start", json={
    "pin":"PIN-2024-0047","gate":"G1","checklist_id":"CL-UNAPPROVED"
})
all_passed &= check("Audit blocked on unapproved checklist", r_block.status_code == 400,
                    r_block.json().get("error",""))

# ─── 3. Start Audit ─────────────────────────────────────
sep("3. Start Audit (agents auto-collect evidence)")
r = requests.post(f"{BASE}/api/audit/start", json={
    "pin":"PIN-2024-0047","gate":"G1","checklist_id":c0["checklist_id"]
})
all_passed &= check("POST /api/audit/start", r.status_code == 201, r.json().get("run_id"))
RUN_ID = r.json()["run_id"]
print(f"\n  Run ID: {RUN_ID}")

# ─── 4. Poll until complete ──────────────────────────────
sep("4. Agent Execution (polling)")
for attempt in range(20):
    time.sleep(3)
    run = requests.get(f"{BASE}/api/audit/{RUN_ID}").json()
    step = run["pipeline_step"]
    done = run["completed"]
    pending = run["summary"]["pending"]
    print(f"  [{attempt+1}] step={step} completed={done} pending={pending}", end="\r")
    if done:
        break

print()
all_passed &= check("Audit completed",          run["completed"])
all_passed &= check("Pipeline reached step 5",  run["pipeline_step"] >= 5)
all_passed &= check("No pending controls",      run["summary"]["pending"] == 0)
all_passed &= check("7 controls passed",        run["summary"]["pass"] == 7, str(run["summary"]["pass"]))
all_passed &= check("2 controls failed",        run["summary"]["fail"] == 2, str(run["summary"]["fail"]))
all_passed &= check("2 controls need review",   run["summary"]["needs_review"] == 2)
all_passed &= check("1 unable to verify",       run["summary"]["unable_to_verify"] == 1)

# Verify acceptance criteria carried through to each control
all_passed &= check("All controls have acceptance_criteria",
    all(c.get("acceptance_criteria") for c in run["controls"]))
all_passed &= check("All completed controls have rationale",
    all(c.get("rationale") for c in run["controls"] if c["status"] != "pending"))

print("\n  Control verdicts:")
for c in run["controls"]:
    print(f"    {c['id']:<10} {c['status']:<22} evidence={'✓' if c.get('evidence_file') else '✗'}")

# ─── 5. Reviewer Actions ────────────────────────────────
sep("5. Reviewer Actions")

# Send to review
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/review",
    json={"control_id":"G1-C08","reason":"Reviewer escalation"})
all_passed &= check("Send to review",   r.status_code==200, f"review_count={r.json()['summary']['needs_review']}")

# Record waiver (validation: missing expiry → 400)
r_v = requests.post(f"{BASE}/api/audit/{RUN_ID}/waiver",
    json={"control_id":"G1-C09","rationale":"test","approver":"test"})
all_passed &= check("Waiver missing expiry → 400", r_v.status_code==400, r_v.json().get("error",""))

# Record valid waiver
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/waiver", json={
    "control_id":"G1-C09","rationale":"Exceptions register provided at G2",
    "approver":"Rajesh Kumar","expiry":"2027-01-31"
})
all_passed &= check("Valid waiver recorded",
    r.status_code==200 and r.json()["summary"]["waived"]==1,
    f"waived={r.json()['summary']['waived']}")

# Confirm fail
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/confirm_fail",
    json={"control_id":"G1-C08","reason":"Proposal still unapproved"})
all_passed &= check("Confirm fail", r.status_code==200)

# Assign owner
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/assign_owner",
    json={"control_id":"G1-C10","owner":"Priya Sharma"})
all_passed &= check("Assign owner", r.status_code==200)

# Gate decision
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/gate_decision",
    json={"decision":"defer","reviewer":"Amit Patel","notes":"Awaiting G1-C08 approval"})
all_passed &= check("Gate decision recorded",
    r.status_code==200 and r.json()["gate_decision"]["decision"]=="defer")

# ─── 6. Re-Audit ────────────────────────────────────────
sep("6. Re-Audit (linked run, agents re-collect evidence)")
r = requests.post(f"{BASE}/api/audit/{RUN_ID}/reaudit",
    json={"control_ids":["G1-C08"],"reason":"Approval signature added"})
all_passed &= check("Re-audit created", r.status_code==201, r.json().get("new_run_id",""))
NEW_ID = r.json()["new_run_id"]

for _ in range(20):
    time.sleep(3)
    rerun = requests.get(f"{BASE}/api/audit/{NEW_ID}").json()
    if rerun["completed"]: break

all_passed &= check("Re-audit completed",        rerun["completed"])
all_passed &= check("Re-audit is linked run",    rerun["is_reaudit"])
all_passed &= check("Parent run ID correct",     rerun["parent_run_id"]==RUN_ID)
all_passed &= check("G1-C08 was re-run",         not any(c.get("carried_from") for c in rerun["controls"] if c["id"]=="G1-C08"))
all_passed &= check("Others carried from parent",any(c.get("carried_from") for c in rerun["controls"] if c["id"]!="G1-C08"))

# ─── 7. Export ──────────────────────────────────────────
sep("7. Export Gate Report")
r = requests.get(f"{BASE}/api/audit/{RUN_ID}/export")
all_passed &= check("Export returns 200",           r.status_code==200)
all_passed &= check("Content-Type is text/plain",   "text/plain" in r.headers.get("Content-Type",""))
all_passed &= check("Report contains run ID",       RUN_ID in r.text)
all_passed &= check("Report contains criteria",     "Acceptance Criteria" in r.text)
all_passed &= check("Report contains waiver",       "Waiver" in r.text)
all_passed &= check("Report contains audit log",    "AUDIT LOG" in r.text)
all_passed &= check("Report contains policies",     "COMPLIANCE POLICIES" in r.text)

# ─── 8. Audit page route ────────────────────────────────
sep("8. Audit Page Route")
r = requests.get(f"{BASE}/audit/{RUN_ID}")
all_passed &= check(f"GET /audit/{RUN_ID}", r.status_code==200)

# ─── Summary ────────────────────────────────────────────
sep("RESULT")
if all_passed:
    print("  \033[92mALL TESTS PASSED\033[0m")
else:
    print("  \033[91mSOME TESTS FAILED — check output above\033[0m")
