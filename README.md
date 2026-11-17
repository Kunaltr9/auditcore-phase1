# AuditCore — Phase 1 Prototype

**AI-Driven Audit & Compliance Multi-Agent Framework**  
3R Infotech · Built for Comviva

---

## What this is

A working Phase 1 prototype of the AI-Driven Audit & Compliance platform described in the 3R Infotech Solution Approach document. It demonstrates the full end-to-end audit flow for **Gate 1 (G1): RFP → Solution Proposal**.

## Flow

```
Customer defines checklist + acceptance criteria
        ↓
Customer approves & versions the checklist
        ↓
Customer starts audit (selects project + gate)
        ↓
Agents automatically retrieve evidence from SharePoint (read-only)
        ↓
Agents evaluate each control against customer-defined acceptance criteria
        ↓
Compliance Evaluator scores: Pass / Fail / Needs Review / Unable to Verify
        ↓
Human reviewer acts on findings (Waiver / Confirm Fail / Assign Owner)
        ↓
Gate decision recorded (Approve / Reject / Defer)
```

## Phase 1 Scope

| Component | Detail |
|---|---|
| Gate | G1 — RFP to Solution Proposal |
| Connector | SharePoint (Microsoft Graph, read-only) |
| Agents | Evidence Agent · Checklist Agent · Scope/Traceability Agent · Compliance Evaluator |
| Phase 2 agents | Review Agent · Test & Quality Agent (stubbed, not active) |
| Infrastructure | Flask (Python) · In-memory store · Simulated AWS Step Functions pipeline |

## Running locally

```bash
pip install flask flask-cors
python app.py
```

Open **http://localhost:5000**

## Navigation

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `/` | Start audits, view active checklist, recent runs |
| Checklist Setup | `/setup` | Define controls, acceptance criteria, policies · approve & version |
| Projects | `/projects` | All Comviva projects with per-project audit history |
| Audit Results | `/reports` | All audit runs — open, export, search |
| Connectors | `/connectors` | SharePoint (active) · Phase 2 connectors (Dataverse, Jira, Confluence…) |
| Settings | `/settings` | Tenant config, AI model, checklist summary, phase roadmap |
| Audit Screen | `/audit/<run_id>` | Live audit: pipeline, agent activity, control verdicts, reviewer actions |

## Key features

- **Checklist builder** — add/edit/delete controls, each with acceptance criteria the agent evaluates against
- **Live audit pipeline** — 5-step pipeline animates in real time as agents run
- **Evidence auto-collection** — agents connect to SharePoint and retrieve documents; no manual uploads
- **Per-control verdicts** — each control shows: acceptance criteria · evidence retrieved · agent rationale · Pass/Fail/Review
- **Waiver flow** — requires rationale, approver name and expiry date; waivers are not Passes
- **Re-audit** — creates a linked run, re-runs only selected controls, preserves original results
- **Gate decision** — Approve / Reject / Defer, recorded with reviewer name
- **Export** — full text gate report with criteria, evidence, verdicts, waivers and audit log

## Project structure

```
prototype/
├── app.py                  # Flask backend — all APIs, agent simulation, checklist store
├── templates/
│   ├── _nav.html           # Shared sidebar (included by all pages)
│   ├── index.html          # Dashboard
│   ├── setup.html          # Checklist & policy setup
│   ├── audit.html          # Live audit results screen
│   ├── projects.html       # Projects list
│   ├── reports.html        # Audit Results (all runs)
│   ├── connectors.html     # Connector status
│   └── settings.html       # Platform settings
└── static/
    ├── app.js              # Frontend — polling, all modal flows, filters, tabs
    └── style.css           # Full design system
```

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/projects` | List all projects |
| GET | `/api/checklist` | Get all checklists |
| GET | `/api/checklist/<id>` | Get a specific checklist |
| POST | `/api/checklist` | Save/version a checklist |
| POST | `/api/checklist/<id>/approve` | Approve a checklist version |
| POST | `/api/checklist/<id>/control` | Add a control |
| DELETE | `/api/checklist/<id>/control/<ctrl_id>` | Delete a control |
| POST | `/api/audit/start` | Start a new audit run |
| GET | `/api/audit/<run_id>` | Poll audit status and results |
| POST | `/api/audit/<run_id>/review` | Send control to human review |
| POST | `/api/audit/<run_id>/waiver` | Record a waiver |
| POST | `/api/audit/<run_id>/confirm_fail` | Confirm a failure |
| POST | `/api/audit/<run_id>/assign_owner` | Assign an owner to a control |
| POST | `/api/audit/<run_id>/reaudit` | Create a linked re-audit run |
| POST | `/api/audit/<run_id>/gate_decision` | Record gate decision |
| GET | `/api/audit/<run_id>/export` | Export gate report as text |
| GET | `/api/runs` | List all audit runs |

---

*3R Infotech · Comviva · Phase 1 Pilot*
