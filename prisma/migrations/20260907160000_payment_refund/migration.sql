-- AlterEnum
-- REFUNDED is a distinct terminal state, not a return to UNPAID: the money was
-- taken and given back, and a reconciliation report has to be able to tell that
-- apart from a charge that never happened.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
-- gatewayResponse keeps the provider's own reply verbatim. Derived columns lose
-- the detail that settles a dispute, and there is no way to recover it later.
ALTER TABLE "payments" ADD COLUMN "gatewayResponse" JSONB;

-- The reversal is recorded alongside the original charge rather than replacing
-- it, because both are facts the ledger needs.
ALTER TABLE "payments" ADD COLUMN "refundTrxId" TEXT;
ALTER TABLE "payments" ADD COLUMN "refundAmount" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "payments" ADD COLUMN "refundedAt" TIMESTAMP(3);
