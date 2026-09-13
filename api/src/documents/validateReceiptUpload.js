// Images only, per the F1.6 scope decision — PDF (and everything else) is explicitly out of
// scope for this pass. Keyed by mimetype so the same map also gives us the file extension to
// store under.
const ALLOWED_MIME_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB, per the brief

// Exported so app.js's multer `limits.fileSize` rejection (which happens at the HTTP layer,
// before a file this large is even fully buffered into memory) can produce the exact same
// message as this module's own oversize check — one user-facing string, not two.
const UNSUPPORTED_FILE_TYPE_MESSAGE = "Only JPEG/PNG images are supported right now — PDF receipts aren't yet handled.";
const FILE_TOO_LARGE_MESSAGE = 'File is too large — receipts must be 10MB or smaller.';

function extensionForMimeType(mimetype) {
  return ALLOWED_MIME_TYPES[mimetype] || 'bin';
}

/**
 * Validates a receipt upload request (just the multer file — account_id is no longer required
 * at upload time as of the extract/confirm split; that check now lives in handleConfirm) before
 * any disk I/O or vision-model call happens. Pure and synchronous so a rejected request (wrong
 * file type, oversized) never gets far enough to write a file.
 */
function validateReceiptUpload({ file }) {
  const errors = [];

  if (!file) {
    errors.push('file is required');
  } else {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      errors.push(UNSUPPORTED_FILE_TYPE_MESSAGE);
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE_BYTES) {
      errors.push(FILE_TOO_LARGE_MESSAGE);
    }
  }

  return errors;
}

module.exports = {
  validateReceiptUpload,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  extensionForMimeType,
  UNSUPPORTED_FILE_TYPE_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
};
