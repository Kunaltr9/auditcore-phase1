import requests

BASE = "http://localhost:5000"
OK   = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"

routes = ["/", "/setup", "/projects", "/connectors", "/reports", "/settings"]
all_ok = True
for path in routes:
    r = requests.get(BASE + path)
    icon = OK if r.status_code == 200 else FAIL
    if r.status_code != 200: all_ok = False
    print(f"  {icon} GET {path:<18} → HTTP {r.status_code}")

print()
print("  ALL ROUTES OK" if all_ok else "  SOME ROUTES FAILED")
