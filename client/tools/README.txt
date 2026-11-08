Design tools (client/tools)

  npm run check:design   Counts places that break the design rules and fails if any count
                         went UP compared with design-debt.json. After you remove debt,
                         run:  node tools/design-ratchet.mjs --update

  node tools/design-inventory.mjs   Lists every hand-picked size and color, with counts.

  npm run audit:mobile -- <role> <start> <end>
                         Phone audit at 390 px. Roles: admin hr finance manager employee.
                         Needs: the dev server (next dev --webpack, memory cap, restart
                         between batches), the dev database, and playwright-core
                         (set PLAYWRIGHT_CORE to its index.mjs, and AUDIT_CHROME to a
                         Chrome binary if the default one is missing).
                         Other settings: AUDIT_ONLY (comma list, keeps routes that contain it), AUDIT_WIDTH (default 390), AUDIT_BASE (default http://localhost:3100),
                         AUDIT_API_PORT (default 4100), AUDIT_PASSWORD (demo password), DESKTOP=1 for a 1366 px sweep.
                         Results go to .playwright-mcp/mobile/<role>.ndjson
