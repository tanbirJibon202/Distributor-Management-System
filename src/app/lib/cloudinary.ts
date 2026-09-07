import { v2 as cloudinary } from 'cloudinary';
import httpStatus from 'http-status';
import config from '../config/index.js';
import { AppError } from '../utils/AppError.js';

let configured = false;

const ensureConfigured = () => {
  if (
    !config.cloudinary_cloud_name ||
    !config.cloudinary_api_key ||
    !config.cloudinary_api_secret
  ) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Image upload is not configured on this server. Set the CLOUDINARY_* variables.',
    );
  }

  if (!configured) {
    cloudinary.config({
      cloud_name: config.cloudinary_cloud_name,
      api_key: config.cloudinary_api_key,
      api_secret: config.cloudinary_api_secret,
      secure: true,
    });
    configured = true;
  }
};

export type UploadedImage = { url: string; publicId: string };

/**
 * Uploads an in-memory image buffer and returns its URL.
 *
 * Multer keeps the file in memory rather than on disk, so nothing is written to
 * the filesystem — which matters on Render, where the disk is ephemeral and a
 * restart would take any uploaded file with it.
 */
export const uploadImage = (buffer: Buffer, folder: string): Promise<UploadedImage> => {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        // Cloudinary derives a unique id; keeping the original filename would
        // let two products with the same file name overwrite each other.
        transformation: [{ width: 1000, height: 1000, crop: 'limit' }, { quality: 'auto' }],
      },
      (error, result) => {
        if (error || !result) {
          reject(
            new AppError(
              httpStatus.BAD_GATEWAY,
              `Image upload failed: ${error?.message ?? 'unknown error'}`,
            ),
          );
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );

    stream.end(buffer);
  });
};

/**
 * Removes an image. Never throws: this only ever runs to tidy up after a
 * replacement, and failing to delete the old file must not fail the request
 * that successfully uploaded the new one.
 */
export const deleteImage = async (publicId: string) => {
  try {
    ensureConfigured();
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error(
      `Cloudinary delete failed for ${publicId}:`,
      error instanceof Error ? error.message : error,
    );
  }
};

export const isImageUploadConfigured = () =>
  Boolean(
    config.cloudinary_cloud_name && config.cloudinary_api_key && config.cloudinary_api_secret,
  );
