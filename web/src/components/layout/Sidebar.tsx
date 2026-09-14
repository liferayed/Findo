import { NavLink } from 'react-router-dom';

const navLinkClass = 'flex items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium hover:bg-stone-50';
const navLinkInactiveClass = 'text-stone-600';
const navLinkActiveClass = 'text-emerald-800 bg-emerald-50';

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="mb-1.5 mt-3.5 px-2.5 text-[10px] font-bold uppercase tracking-wide text-stone-400 first:mt-0">
      {children}
    </div>
  );
}

function FutureItem({ children }: { children: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium text-stone-400">
      <span>{children}</span>
      <span className="rounded border border-stone-200 px-1 text-[9px] font-bold uppercase tracking-wide text-stone-400">
        Soon
      </span>
    </div>
  );
}

export function Sidebar() {
  return (
    <nav className="w-48 shrink-0 border-r border-stone-200 bg-white px-3 py-4">
      <GroupLabel>Money</GroupLabel>
      <NavLink
        to="/accounts"
        className={({ isActive }) => `${navLinkClass} ${isActive ? navLinkActiveClass : navLinkInactiveClass}`}
      >
        Accounts
      </NavLink>
      <NavLink
        to="/transactions"
        className={({ isActive }) => `${navLinkClass} ${isActive ? navLinkActiveClass : navLinkInactiveClass}`}
      >
        Transactions
      </NavLink>
      <NavLink
        to="/documents"
        className={({ isActive }) => `${navLinkClass} ${isActive ? navLinkActiveClass : navLinkInactiveClass}`}
      >
        Documents
      </NavLink>

      <GroupLabel>Insights</GroupLabel>
      <FutureItem>Dashboard</FutureItem>
      <FutureItem>Budgets</FutureItem>
      <FutureItem>Subscriptions</FutureItem>
      <FutureItem>Price Tracking</FutureItem>

      <GroupLabel>Planning</GroupLabel>
      <FutureItem>Offers</FutureItem>
      <FutureItem>Tax Planning</FutureItem>
      <FutureItem>Loans &amp; Debt</FutureItem>
      <FutureItem>Reports</FutureItem>
    </nav>
  );
}
