import { Navigate, NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth";

/** Sidebar entries, in the order work flows through the app. */
const NAVIGATION = [
  { to: "/agent", label: "Agent" },
  { to: "/accounts", label: "Accounts" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/leads", label: "Leads" },
  { to: "/review", label: "Review" },
  { to: "/invites", label: "Invites" },
];

/**
 * The frame around every logged-in page: sidebar on the left, page on the
 * right. Sends anyone not logged in to the login page.
 */
export function Layout() {
  const { user, logout } = useAuth();

  if (user === undefined) return <div className="p-8 text-slate-500">Loading…</div>;
  if (user === null) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <div className="text-sm font-semibold">Lead Filtering</div>
          <div className="truncate text-xs text-slate-500">{user.organizationName}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAVIGATION.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500">
          <div className="truncate">{user.email}</div>
          <button onClick={() => void logout()} className="mt-1 text-indigo-600 hover:underline">
            Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
