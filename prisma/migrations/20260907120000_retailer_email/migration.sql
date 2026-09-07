-- AlterTable
-- Nullable and not unique on purpose: most retailers have no email address,
-- and two shops under one owner may legitimately share one. `phone` remains
-- the unique business key for a retailer.
ALTER TABLE "retailers" ADD COLUMN "email" TEXT;
