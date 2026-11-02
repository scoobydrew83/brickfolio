/** Title row at the top of a page, with optional actions on the right. */
export function PageHeader({ title, badge, children, actions }: { title: string; badge?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight [font-stretch:110%]">{title}</h1>
          {badge}
        </div>
        {children && <div className="mt-1 text-sm text-fg-3">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
