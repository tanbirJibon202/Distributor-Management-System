import type { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Memory storage, not disk: the buffer goes straight to Cloudinary, so nothing
 * is written locally. Render's filesystem is ephemeral anyway, and skipping the
 * write avoids leaving orphaned temp files when an upload fails midway.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      // Rejecting with an Error rather than `false` so the caller gets a
      // reason instead of a silently missing file.
      callback(new Error('Only JPEG, PNG and WebP images are accepted'));
      return;
    }
    callback(null, true);
  },
}).single('image');

/**
 * Runs the upload and translates multer's own failures into AppErrors.
 *
 * Without this, an oversized or wrong-typed file reaches the global handler as
 * a bare Error and is reported as a 500 — telling the client the server broke
 * when in fact their file was rejected, and giving them nothing to act on.
 */
export const uploadSingleImage = (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `Image is too large. The limit is ${MAX_FILE_BYTES / (1024 * 1024)}MB.`
          : error.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Unexpected file field. Send the image as "image".'
            : error.message;
      next(new AppError(httpStatus.BAD_REQUEST, message));
      return;
    }

    next(
      new AppError(
        httpStatus.BAD_REQUEST,
        error instanceof Error ? error.message : 'Image upload failed',
      ),
    );
  });
};
