import { APP_BUILD } from "@/lib/build";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>Storyboard</span>
      <span aria-hidden="true">·</span>
      <span>Build {APP_BUILD}</span>
    </footer>
  );
}
