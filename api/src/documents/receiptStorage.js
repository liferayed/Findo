const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { extensionForMimeType } = require('./validateReceiptUpload');

// api/src/documents/../../uploads/receipts -> api/uploads/receipts (gitignored). Unencrypted
// local disk storage is a deliberate, documented interim gap for this feature — see
// database-schema.md's "Interim state (as of F1.6)" note — not something to build out here.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'receipts');

/**
 * Writes an uploaded receipt (already validated) to api/uploads/receipts/<uuid>.<ext> and
 * returns the file_ref string to store on the shared_items row.
 */
async function saveReceiptFile(file) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${extensionForMimeType(file.mimetype)}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
  return `api/uploads/receipts/${filename}`;
}

/**
 * Best-effort cleanup for a receipt file when something goes wrong after it was saved (e.g. a
 * DB error partway through recording the upload) — never lets a cleanup failure mask the
 * original error.
 */
async function deleteReceiptFileQuietly(fileRef) {
  if (!fileRef) {
    return;
  }
  try {
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(fileRef)));
  } catch {
    // best-effort only
  }
}

module.exports = { saveReceiptFile, deleteReceiptFileQuietly, UPLOAD_DIR };
