const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

// Same convention as receiptStorage.js's UPLOAD_DIR, its own subdirectory — statements are a
// distinct document type with a distinct (larger, sometimes multi-page) file shape.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'statements');

const EXTENSION_FOR_MIME_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

async function saveStatementFile(file) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const extension = EXTENSION_FOR_MIME_TYPE[file.mimetype] || 'bin';
  const filename = `${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
  return `api/uploads/statements/${filename}`;
}

// pdftoppm writes <prefix>-1.png, <prefix>-2.png, ... (1-indexed, no leading zeros for a
// single-digit page count, per poppler-utils' default naming) into a fresh temp directory,
// which is removed after reading, win or lose.
async function renderPdfPagesToImages(absolutePath) {
  const tmpDir = await fs.mkdtemp(path.join(UPLOAD_DIR, '.render-'));
  try {
    const prefix = path.join(tmpDir, 'page');
    await execFileAsync('pdftoppm', ['-png', '-r', '200', absolutePath, prefix]);
    const files = (await fs.readdir(tmpDir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return Promise.all(files.map(async (name) => (await fs.readFile(path.join(tmpDir, name))).toString('base64')));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Renders every page of the statement at `fileRef` to a base64-encoded PNG. A PDF is rendered
 * via pdftoppm (poppler-utils); a single image file is returned as its own one-page "render"
 * without shelling out at all — most bank statements users upload as a screenshot/photo are a
 * single image, not a PDF, and this avoids pdftoppm entirely for that common case.
 */
async function renderPagesToImages(fileRef) {
  const absolutePath = path.join(UPLOAD_DIR, path.basename(fileRef));
  if (fileRef.endsWith('.pdf')) {
    return renderPdfPagesToImages(absolutePath);
  }
  return [(await fs.readFile(absolutePath)).toString('base64')];
}

async function deleteStatementFileQuietly(fileRef) {
  if (!fileRef) {
    return;
  }
  try {
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(fileRef)));
  } catch {
    // best-effort only
  }
}

module.exports = { saveStatementFile, renderPagesToImages, deleteStatementFileQuietly, UPLOAD_DIR };
