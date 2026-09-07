-- AlterTable
-- Payment rows are mutated after insert (status -> PAID/FAILED, transactionId
-- filled in from the gateway), so settlement time has to be recorded.
ALTER TABLE "payments" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill: a row that has never been updated is current as of its creation,
-- so createdAt is a truthful value here — CURRENT_TIMESTAMP would claim every
-- historic payment was touched at migration time.
UPDATE "payments" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "updatedAt" SET NOT NULL;
