// Side-effect-free constants for statement upload validation, split out of
// statementUploadService.js (F1.7 final review I2) so that app.js — which only needs these two
// values for its multer size limit — doesn't have to import statementUploadService.js, whose
// module graph pulls in statementQueue.js and, with it, an IORedis connection opened as a
// module-load side effect. Mirrors validateReceiptUpload.js's constants shape.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

module.exports = { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES };
