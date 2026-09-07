-- AlterTable
-- Same pair as products: imageUrl is what clients render, imagePublicId is
-- Cloudinary's handle, kept so replacing an avatar can delete the file it
-- supersedes rather than leaving an orphan behind. Both nullable — an account
-- without a picture is the normal case, not a missing value to backfill.
ALTER TABLE "users" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "users" ADD COLUMN "imagePublicId" TEXT;
