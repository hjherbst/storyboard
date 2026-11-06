import Link from "next/link";
import type { ReactNode } from "react";

export function SiteHeader({
  eyebrow,
  action,
}: {
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <header className="site-header">
      <div className="site-header__brand">
        <Link href="/" className="brand-mark">
          Storyboard
        </Link>
        {eyebrow ? <p className="site-header__eyebrow">{eyebrow}</p> : null}
      </div>
      {action ? <div className="site-header__action">{action}</div> : null}
    </header>
  );
}
