-- AlterTable
-- imageUrl is what clients render; imagePublicId is Cloudinary's handle, kept
-- so replacing an image can delete the file it supersedes instead of leaking
-- an orphan in the asset store. Both nullable — products exist without images.
ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "products" ADD COLUMN "imagePublicId" TEXT;
