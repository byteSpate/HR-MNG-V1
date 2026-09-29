-- Owner approved 2026-09-29: say Opportunity, not deal.
-- Only the untouched seeded name is changed, so a name Finance edited survives,
-- and running this twice changes nothing.
WITH renamed AS (
  UPDATE "Account"
  SET "name" = 'Goods Bought for Won Opportunities'
  WHERE "code" = '1214' AND "name" = 'Goods Bought for Won Deals'
  RETURNING "id"
)
INSERT INTO "AuditLog" ("id", "entity", "entityId", "action", "changedBy", "changedAt", "before", "after", "note")
SELECT gen_random_uuid()::text, 'ACCOUNT', "id", 'UPDATE', NULL, now(),
       '{"name": "Goods Bought for Won Deals"}'::jsonb,
       '{"name": "Goods Bought for Won Opportunities"}'::jsonb,
       'Renamed by migration: Opportunity, not deal (owner approved 2026-09-29)'
FROM renamed;
