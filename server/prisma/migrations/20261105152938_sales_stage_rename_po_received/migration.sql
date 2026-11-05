-- The last Networking sales stage was named after a partner programme.
-- Rename the value. No row is lost: Postgres keeps the data and only the name changes.
ALTER TYPE "SalesStage" RENAME VALUE 'PO_RECEIVED_BY_VAR' TO 'PURCHASE_ORDER_RECEIVED';
