const { saveStatementFile } = require('./statementStorage');
const { enqueueStatementExtraction } = require('./statementQueue');
const { ValidationError, NotFoundError } = require('../errors');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function createStatementUploadService({ pool }) {
  async function handleStatementUpload(userId, { file }) {
    if (!file || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new ValidationError(['Only JPEG/PNG/PDF statements are supported.']);
    }
    if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(['File is too large — statements must be 10MB or smaller.']);
    }

    const fileRef = await saveStatementFile(file);
    const { rows: [sharedItem] } = await pool.query(
      `INSERT INTO shared_items (user_id, channel, content_type, file_ref, original_filename, parse_status)
       VALUES ($1, 'web_upload', 'file', $2, $3, 'pending') RETURNING id`,
      [userId, fileRef, file.originalname || null]
    );
    await pool.query(`INSERT INTO documents (shared_item_id, document_type) VALUES ($1, 'bank_statement')`, [sharedItem.id]);
    await enqueueStatementExtraction(sharedItem.id, userId);
    return { sharedItemId: sharedItem.id };
  }

  async function getStatementStatus(userId, sharedItemId) {
    const { rows } = await pool.query(
      `SELECT si.parse_status, si.progress FROM shared_items si WHERE si.id = $1 AND si.user_id = $2`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    const { parse_status: parseStatus, progress } = rows[0];
    // Note (Task 5, resolved by F1.7 Task 8): parse_status stays 'parsed' after confirm — it
    // does not gain a distinct "confirmed" value. Whether a statement has been confirmed is
    // recorded on documents.extracted_data.confirmedAt instead (set atomically by
    // statementConfirmService.confirmReview). Wiring that into this function's `status` value
    // is explicitly out of scope for Task 8; the review page's own polling reads
    // extracted_data directly post-confirm rather than relying on this endpoint.
    const status =
      parseStatus === 'failed' ? 'failed' :
      parseStatus === 'needs_clarification' ? 'needs_account' :
      parseStatus === 'parsed' ? 'ready_for_review' :
      progress ? 'processing' : 'pending';
    return { status, page: progress ? progress.page : null, totalPages: progress ? progress.totalPages : null };
  }

  return { handleStatementUpload, getStatementStatus };
}

module.exports = { createStatementUploadService, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };
