const { saveStatementFile } = require('./statementStorage');
const { enqueueStatementExtraction } = require('./statementQueue');
const { ValidationError, NotFoundError } = require('../errors');
const { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } = require('./validateStatementUpload');
const { computeDocumentStatus } = require('./documentStatus');
const { redactText } = require('../redaction/redactSensitive');

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
      [userId, fileRef, redactText(file.originalname) || null]
    );
    await pool.query(`INSERT INTO documents (shared_item_id, document_type) VALUES ($1, 'bank_statement')`, [sharedItem.id]);
    await enqueueStatementExtraction(sharedItem.id, userId);
    return { sharedItemId: sharedItem.id };
  }

  async function getStatementStatus(userId, sharedItemId) {
    const { rows } = await pool.query(
      `SELECT si.parse_status, si.progress, d.document_type, d.extracted_data
       FROM shared_items si JOIN documents d ON d.shared_item_id = si.id
       WHERE si.id = $1 AND si.user_id = $2`,
      [sharedItemId, userId]
    );
    if (rows.length === 0) {
      throw new NotFoundError('statement not found');
    }
    const { parse_status: parseStatus, progress, document_type: documentType, extracted_data: extractedData } = rows[0];
    const status = computeDocumentStatus({ documentType, parseStatus, progress, extractedData });
    return { status, page: progress ? progress.page : null, totalPages: progress ? progress.totalPages : null };
  }

  return { handleStatementUpload, getStatementStatus };
}

module.exports = { createStatementUploadService, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };
