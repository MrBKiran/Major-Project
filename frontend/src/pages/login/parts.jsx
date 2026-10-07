/** Small pieces shared by the sign-in steps and the account page, so they look alike. */

export const inputCls =
  "w-full rounded-lg border border-edge bg-ink-900 px-3 py-2 text-[13px] text-slate-100 " +
  "placeholder:text-slate-600 outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/30";

export const submitCls =
  "w-full rounded-lg bg-accent-deep px-4 py-2.5 text-sm font-semibold text-white transition duration-150 " +
  "hover:bg-accent/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";

export const ghostCls =
  "rounded-lg border border-edge bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-300 " +
  "transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-600">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg border border-p1/30 bg-p1/10 px-3 py-2 text-[12px] text-p1">
      {children}
    </p>
  );
}

export function InfoNote({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-lg border border-edge bg-ink-900 px-3 py-2 text-[12px] text-slate-400">
      {children}
    </p>
  );
}
