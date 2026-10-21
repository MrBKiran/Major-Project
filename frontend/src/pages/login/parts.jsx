/** Small pieces shared by the sign-in steps and the account page, so they look alike. */

export const inputCls =
  "w-full rounded-lg border border-border-strong bg-surface-page px-3 py-2 text-body-sm text-fg-strong " +
  "placeholder:text-fg-subtle outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/30";

export const submitCls =
  "w-full rounded-lg bg-accent-deep px-4 py-2.5 text-body font-semibold text-white transition duration-150 " +
  "hover:bg-accent-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";

export const ghostCls =
  "rounded-lg border border-border bg-surface-card px-3 py-2 text-label font-medium text-fg-secondary " +
  "transition hover:border-fg-muted hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-caption text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg border border-p1/30 bg-p1/10 px-3 py-2 text-label text-p1">
      {children}
    </p>
  );
}

export function InfoNote({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-lg border border-border bg-surface-page px-3 py-2 text-label text-fg-tertiary">
      {children}
    </p>
  );
}
