import { statusLabel } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

export { TopBar } from "./top-bar";

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 px-5 pt-4 pb-6 md:flex-row md:flex-wrap md:items-end md:px-12 md:pt-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight break-words md:truncate md:text-4xl">{title}</h1>
        {sub && <div className="text-lg font-medium text-navy-2">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Page body: the gutter every list page shares.
export function Body({ children }: { children: React.ReactNode }) {
  return <div className="relative z-2 px-5 pb-16 md:px-12">{children}</div>;
}

export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="g-card flex flex-col gap-5 p-6 md:p-8">
      {title && <h2 className="text-xl font-extrabold">{title}</h2>}
      {children}
    </section>
  );
}

export function StatusTag({ status, lang = "en" }: { status: string; lang?: Lang }) {
  const tone = status === "running" ? "is-running" : status === "done" ? "is-done" : status === "needs_retry" ? "is-bad" : "";
  return <span className={`g-tag ${tone}`}>{statusLabel(status, lang)}</span>;
}

// A read-only answer on the check page: label, then the value.
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="g-label">{label}</div>
      <div className="text-lg font-bold break-words">{children}</div>
    </div>
  );
}
