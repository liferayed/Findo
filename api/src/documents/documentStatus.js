// Shared by statementUploadService.getStatementStatus and documentsService.listDocuments so
// the two never drift on what "confirmed" vs "ready for review" means. Receipts (F1.6) are
// synchronous — their parse_status already IS the user-facing status, no translation needed.
// Statements (F1.7) go through an async pipeline whose parse_status alone can't distinguish
// "reviewable" from "already confirmed" — both are parse_status: 'parsed' — so confirmedAt on
// extracted_data (set atomically by statementConfirmService.confirmReview) is the tie-breaker.
function computeDocumentStatus({ documentType, parseStatus, progress, extractedData }) {
  if (documentType === 'receipt') {
    return parseStatus;
  }
  if (parseStatus === 'failed') {
    return 'failed';
  }
  if (parseStatus === 'needs_clarification') {
    return 'needs_account';
  }
  if (parseStatus === 'parsed') {
    return extractedData && extractedData.confirmedAt ? 'confirmed' : 'ready_for_review';
  }
  return progress ? 'processing' : 'pending';
}

module.exports = { computeDocumentStatus };
