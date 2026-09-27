const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const childProcess = require('node:child_process');

jest.mock('node:child_process');

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

  describe('renderPagesToImages on a PDF (mocked pdftoppm, no real binary required)', () => {
    afterEach(() => {
      childProcess.execFile.mockReset();
    });

    test('calls execFile with pdftoppm, -png, -r 200, the absolute source path, and an output prefix', async () => {
      const fileRef = await saveStatementFile(fakeFile({ mimetype: 'application/pdf' }));
      const absolutePath = path.join(UPLOAD_DIR, path.basename(fileRef));
      let capturedPrefix;

      childProcess.execFile.mockImplementation((file, args, callback) => {
        capturedPrefix = args[args.length - 1];
        callback(null, { stdout: '', stderr: '' });
      });

      try {
        await renderPagesToImages(fileRef);
      } catch {
        // The mock writes no files, so reading the temp dir afterwards may reject; that's fine —
        // this test only cares about how execFile was invoked.
      }

      expect(childProcess.execFile).toHaveBeenCalledTimes(1);
      const [command, args] = childProcess.execFile.mock.calls[0];
      expect(command).toBe('pdftoppm');
      expect(args).toEqual(['-png', '-r', '200', absolutePath, expect.any(String)]);
      expect(args).toContain('-png');
      expect(args).toContain('-r');
      expect(args).toContain('200');
      expect(path.isAbsolute(capturedPrefix)).toBe(true);
      expect(path.dirname(capturedPrefix)).not.toBe(UPLOAD_DIR);

      await deleteStatementFileQuietly(fileRef);
    });

    test('returns pages in numeric filename order (page-1 before page-2)', async () => {
      const fileRef = await saveStatementFile(fakeFile({ mimetype: 'application/pdf' }));

      childProcess.execFile.mockImplementation(async (file, args, callback) => {
        const prefix = args[args.length - 1];
        const dir = path.dirname(prefix);
        await fs.writeFile(path.join(dir, 'page-2.png'), 'second-page');
        await fs.writeFile(path.join(dir, 'page-1.png'), 'first-page');
        callback(null, { stdout: '', stderr: '' });
      });

      const pages = await renderPagesToImages(fileRef);

      expect(pages).toHaveLength(2);
      expect(Buffer.from(pages[0], 'base64').toString()).toBe('first-page');
      expect(Buffer.from(pages[1], 'base64').toString()).toBe('second-page');

      await deleteStatementFileQuietly(fileRef);
    });

    test('sorts numerically rather than lexicographically (page-2 before page-10)', async () => {
      const fileRef = await saveStatementFile(fakeFile({ mimetype: 'application/pdf' }));

      childProcess.execFile.mockImplementation(async (file, args, callback) => {
        const prefix = args[args.length - 1];
        const dir = path.dirname(prefix);
        await fs.writeFile(path.join(dir, 'page-10.png'), 'page-ten');
        await fs.writeFile(path.join(dir, 'page-2.png'), 'page-two');
        callback(null, { stdout: '', stderr: '' });
      });

      const pages = await renderPagesToImages(fileRef);

      expect(pages).toHaveLength(2);
      expect(Buffer.from(pages[0], 'base64').toString()).toBe('page-two');
      expect(Buffer.from(pages[1], 'base64').toString()).toBe('page-ten');

      await deleteStatementFileQuietly(fileRef);
    });

    test('removes the temp render directory after a successful render', async () => {
      const fileRef = await saveStatementFile(fakeFile({ mimetype: 'application/pdf' }));
      let capturedDir;

      childProcess.execFile.mockImplementation(async (file, args, callback) => {
        const prefix = args[args.length - 1];
        capturedDir = path.dirname(prefix);
        await fs.writeFile(path.join(capturedDir, 'page-1.png'), 'only-page');
        callback(null, { stdout: '', stderr: '' });
      });

      await renderPagesToImages(fileRef);

      expect(capturedDir).toBeDefined();
      expect(fsSync.existsSync(capturedDir)).toBe(false);

      await deleteStatementFileQuietly(fileRef);
    });
  });
});
