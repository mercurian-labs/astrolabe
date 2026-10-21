import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";

import astrolabeDots from "./assets/astrolabe-wordmark-dots.svg";
import astrolabeInk from "./assets/astrolabe-wordmark-ink.svg";
import mercurianDark from "./assets/mercurian-wordmark-dark.svg";
import mercurian from "./assets/mercurian-wordmark.svg";
import { navigate } from "./router";

const mask = (url: string) => ({
  maskImage: `url("${url}")`,
  WebkitMaskImage: `url("${url}")`,
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
});

/**
 * The "Astrolabe." wordmark drawn like the app's (apps/web AstrolabeMarks):
 * the lettering in the text color, the full stop in brand rust.
 */
function AstrolabeWordmark(props: { readonly className?: string; readonly style?: CSSProperties }) {
  return (
    <span
      role="img"
      aria-label="Astrolabe"
      className={`relative inline-block aspect-[373.52/59.74] ${props.className ?? "h-8"}`}
      style={props.style}
    >
      <span className="absolute inset-0 bg-text" style={mask(astrolabeInk)} />
      <span className="absolute inset-0 bg-rust" style={mask(astrolabeDots)} />
    </span>
  );
}

/**
 * "Welcome to Astrolabe." set as one line in the wordmarks' typeface, with the
 * wordmark itself as its last word. The wordmark is drawn at 76 px per em
 * with its baseline 3.24 px above its bottom edge, so in ems it sits on the
 * text's baseline.
 */
function WelcomeHeader() {
  return (
    <h1 className="text-center font-display text-[28px] font-semibold leading-tight text-text sm:text-[34px]">
      Welcome to{" "}
      <AstrolabeWordmark
        className=""
        style={{ height: `${59.74 / 76}em`, verticalAlign: `${-3.24 / 76}em` }}
      />
    </h1>
  );
}

function MercurianWordmark(props: { readonly className: string }) {
  return (
    <picture>
      <source srcSet={mercurianDark} media="(prefers-color-scheme: dark)" />
      <img src={mercurian} alt="Mercurian" className={props.className} />
    </picture>
  );
}

/**
 * The page frame: every page leads with Astrolabe and is signed by Mercurian,
 * its maker, at the bottom.
 */
export function Page(props: {
  readonly children: ReactNode;
  readonly wide?: boolean;
  /** Lead with "Welcome to Astrolabe." instead of the bare wordmark. */
  readonly welcome?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-5 py-10 sm:py-16">
      <div className="mb-10">{props.welcome ? <WelcomeHeader /> : <AstrolabeWordmark />}</div>
      <main className={`w-full ${props.wide ? "max-w-xl" : "max-w-sm"}`}>{props.children}</main>
      <footer
        className={`mt-auto flex w-full flex-col items-center gap-3 pt-12 text-center text-xs text-muted ${props.wide ? "max-w-xl" : "max-w-sm"}`}
      >
        <span className="mb-1 h-px w-full bg-line" />
        <MercurianWordmark className="h-4 w-auto" />
        <p className="flex gap-4">
          <a className="hover:text-text" href="https://astrolabe.sh/privacy-policy">
            Privacy
          </a>
          <a className="hover:text-text" href="https://astrolabe.sh/terms-of-service">
            Terms
          </a>
        </p>
      </footer>
    </div>
  );
}

export function Heading(props: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-text">{props.title}</h1>
      {props.children ? <p className="mt-1.5 text-sm text-muted">{props.children}</p> : null}
    </header>
  );
}

export function Card(props: { readonly children: ReactNode; readonly title?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      {props.title ? <h2 className="mb-4 text-sm font-semibold text-text">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-on-accent hover:opacity-90",
  secondary: "border-input bg-surface text-text hover:bg-raised",
  ghost: "border-transparent bg-transparent text-muted hover:text-text",
  danger: "border-input bg-surface text-error hover:bg-error-surface",
};

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** An in-app link that keeps the page instead of reloading it. */
export function Link(props: { readonly to: string; readonly children: ReactNode }) {
  return (
    <a
      href={props.to}
      className="font-medium text-text underline decoration-line underline-offset-4 hover:decoration-text"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { readonly label: string; readonly hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="h-10 rounded-lg border border-input bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      />
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** One field for a six-digit emailed or authenticator code. */
export function CodeField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {props.label ?? "Code"}
      </label>
      <input
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        pattern="[0-9]{6}"
        className="h-12 rounded-lg border border-input bg-surface px-3 text-center font-mono text-xl tracking-[0.5em] text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      />
    </div>
  );
}

export function Notice(props: {
  readonly tone?: "error" | "info" | "warning";
  readonly children: ReactNode;
}) {
  const tone = props.tone ?? "info";
  const styles = {
    error: "border-error/30 bg-error-surface text-error",
    warning: "border-warning/30 bg-warning-surface text-warning",
    info: "border-line bg-raised text-text",
  }[tone];
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${styles}`}
    >
      {props.children}
    </p>
  );
}

export function Divider(props: { readonly label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" />
      {props.label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex justify-center py-16 text-sm text-muted"
    >
      Loading…
    </div>
  );
}
