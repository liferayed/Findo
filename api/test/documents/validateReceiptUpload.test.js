const { validateReceiptUpload, MAX_FILE_SIZE_BYTES } = require('../../src/documents/validateReceiptUpload');

function fakeFile({ mimetype = 'image/png', size = 1024 } = {}) {
  return { mimetype, size, buffer: Buffer.alloc(size) };
}

describe('validateReceiptUpload', () => {
  test('a valid JPEG under the size limit passes with no errors', () => {
    const errors = validateReceiptUpload({ file: fakeFile({ mimetype: 'image/jpeg' }) });
    expect(errors).toEqual([]);
  });

  test('a valid PNG passes with no errors', () => {
    const errors = validateReceiptUpload({ file: fakeFile({ mimetype: 'image/png' }) });
    expect(errors).toEqual([]);
  });

  test('a missing file is rejected', () => {
    const errors = validateReceiptUpload({ file: undefined });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('file is required')]));
  });

  test('a non-image file (e.g. text/plain) is rejected with the exact brief-specified message', () => {
    const errors = validateReceiptUpload({ file: fakeFile({ mimetype: 'text/plain' }) });
    expect(errors).toContain("Only JPEG/PNG images are supported right now — PDF receipts aren't yet handled.");
  });

  test('a PDF is rejected with the same clear message as any other non-image type', () => {
    const errors = validateReceiptUpload({ file: fakeFile({ mimetype: 'application/pdf' }) });
    expect(errors).toContain("Only JPEG/PNG images are supported right now — PDF receipts aren't yet handled.");
  });

  test('a file over 10MB is rejected', () => {
    const errors = validateReceiptUpload({
      file: fakeFile({ size: MAX_FILE_SIZE_BYTES + 1 }),
    });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('too large')]));
  });

  test('a file exactly at the 10MB limit is accepted', () => {
    const errors = validateReceiptUpload({ file: fakeFile({ size: MAX_FILE_SIZE_BYTES }) });
    expect(errors).toEqual([]);
  });

  test('multiple problems are all reported together', () => {
    const errors = validateReceiptUpload({
      file: { mimetype: 'application/pdf', size: MAX_FILE_SIZE_BYTES + 1, buffer: Buffer.alloc(1) },
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
