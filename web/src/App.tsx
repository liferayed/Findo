import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { StatementReviewPage } from './pages/StatementReviewPage';

// Keyed on the route param so navigating directly between two statements' review pages
// (bypassing /documents) unmounts and remounts StatementReviewPage instead of reusing the
// same instance with stale data/checked/tags/rowAccountId/popover state from the old id.
function StatementReviewPageWrapper() {
  const { id } = useParams();
  return <StatementReviewPage key={id} />;
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/accounts" replace />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id/review" element={<StatementReviewPageWrapper />} />
      </Routes>
    </AppShell>
  );
}
