import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const controlClass =
  "block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 " +
  "placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 " +
  "aria-[invalid=true]:border-red-500";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs leading-relaxed text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          ⚠ {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={controlClass} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={controlClass} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={controlClass} />;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" }) {
  const styles = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100",
    ghost: "text-emerald-700 hover:bg-emerald-50",
    danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
    dangerGhost: "text-red-600 hover:bg-red-50",
  }[variant];
  return (
    <button
      {...props}
      className={
        "inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-base font-semibold " +
        "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        styles +
        " " +
        className
      }
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={"rounded-2xl border border-slate-200 bg-white p-4 shadow-sm " + className}>{children}</section>
  );
}

export function Notice({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-slate-200 bg-slate-100 text-slate-700",
  }[kind];
  const icon = { error: "⚠", success: "✓", info: "ℹ" }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={"rounded-xl border px-3 py-2.5 text-sm " + styles}>
      <span aria-hidden="true">{icon} </span>
      {children}
    </div>
  );
}

export function FullPageMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[60dvh] items-center justify-center text-center text-slate-500">{children}</div>;
}
