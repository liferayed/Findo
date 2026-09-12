import { Header } from './components/Header';
import { AccountsPanel } from './AccountsPanel';

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <AccountsPanel />
      </main>
    </div>
  );
}
