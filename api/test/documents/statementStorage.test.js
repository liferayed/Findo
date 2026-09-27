const path = require('node:path');
const fs = require('node:fs/promises');
const { saveStatementFile, renderPagesToImages, deleteStatementFileQuietly, UPLOAD_DIR } = require('../../src/documents/statementStorage');

function fakeFile(overrides = {}) {
  return { buffer: Buffer.from('fake-bytes'), mimetype: 'image/png', size: 11, originalname: 'statement.png', ...overrides };
}

describe('statementStorage', () => {
  test('saveStatementFile writes under api/uploads/statements with a uuid filename', async () => {
    const fileRef = await saveStatementFile(fakeFile());
    expect(fileRef).toMatch(/^api\/uploads\/statements\/[0-9a-f-]{36}\.png$/);
    const bytes = await fs.readFile(path.join(UPLOAD_DIR, path.basename(fileRef)));
    expect(bytes.toString()).toBe('fake-bytes');
    await deleteStatementFileQuietly(fileRef);
  });

  test('renderPagesToImages on a single image file returns that one image, base64-encoded, without shelling out', async () => {
    const fileRef = await saveStatementFile(fakeFile());
    const pages = await renderPagesToImages(fileRef);
    expect(pages).toHaveLength(1);
    expect(Buffer.from(pages[0], 'base64').toString()).toBe('fake-bytes');
    await deleteStatementFileQuietly(fileRef);
  });

  test('deleteStatementFileQuietly on a missing file does not throw', async () => {
    await expect(deleteStatementFileQuietly('api/uploads/statements/does-not-exist.png')).resolves.toBeUndefined();
  });

  test('deleteStatementFileQuietly on undefined does not throw', async () => {
    await expect(deleteStatementFileQuietly(undefined)).resolves.toBeUndefined();
  });
});
