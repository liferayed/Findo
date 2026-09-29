const { computeDocumentStatus } = require('../../src/documents/documentStatus');

describe('computeDocumentStatus', () => {
  test('receipts pass parse_status through unchanged', () => {
    for (const parseStatus of ['pending', 'parsed', 'needs_clarification', 'failed']) {
      expect(computeDocumentStatus({ documentType: 'receipt', parseStatus, progress: null, extractedData: null })).toBe(parseStatus);
    }
  });

  test.each([
    ['bank_statement'],
    ['card_statement'],
  ])('%s: failed', (documentType) => {
    expect(computeDocumentStatus({ documentType, parseStatus: 'failed', progress: null, extractedData: null })).toBe('failed');
  });

  test('needs_clarification -> needs_account', () => {
    expect(computeDocumentStatus({ documentType: 'bank_statement', parseStatus: 'needs_clarification', progress: null, extractedData: null })).toBe('needs_account');
  });

  test('parsed with no confirmedAt -> ready_for_review', () => {
    expect(computeDocumentStatus({ documentType: 'bank_statement', parseStatus: 'parsed', progress: null, extractedData: { resolvedAccountId: 'a1' } })).toBe('ready_for_review');
  });

  test('parsed with confirmedAt -> confirmed', () => {
    expect(computeDocumentStatus({ documentType: 'bank_statement', parseStatus: 'parsed', progress: null, extractedData: { confirmedAt: '2026-09-27T00:00:00Z' } })).toBe('confirmed');
  });

  test('pending with progress -> processing; without -> pending', () => {
    expect(computeDocumentStatus({ documentType: 'bank_statement', parseStatus: 'pending', progress: { page: 1, totalPages: 3 }, extractedData: null })).toBe('processing');
    expect(computeDocumentStatus({ documentType: 'bank_statement', parseStatus: 'pending', progress: null, extractedData: null })).toBe('pending');
  });

  test('a declined offer (accountOfferDeclined true, resolvedAccountId null) is still ready_for_review once parsed', () => {
    expect(
      computeDocumentStatus({
        documentType: 'bank_statement', parseStatus: 'parsed', progress: null,
        extractedData: { resolvedAccountId: null, accountOfferDeclined: true },
      })
    ).toBe('ready_for_review');
  });
});
