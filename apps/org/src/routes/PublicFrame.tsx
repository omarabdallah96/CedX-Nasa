// The frame of the public pages: product page, request access, sign in, invitation.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '../lib/i18n.ts';
import { useSession } from '../lib/session.tsx';
import { Brand, PrefsButtons } from '../ui/Shell.tsx';

export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t } = useT();
  const { user, org } = useSession();
  return (
    <div className="public" data-wide={wide || undefined}>
      <header className="public-head">
        <Brand />
        <nav className="public-nav">
          {user && org
            ? <Link className="btn btn-quiet" to="/app">{t.nav.overview}</Link>
            : <>
                <Link className="link-quiet" to="/login">{t.landing.signIn}</Link>
                <Link className="btn" to="/request-access">{t.landing.request}</Link>
              </>}
          <PrefsButtons />
        </nav>
      </header>
      <main className="public-main" id="main">{children}</main>
      <footer className="public-foot">
        <p>{t.landing.credits}</p>
        <a href="/">{t.landing.publicSite}</a>
      </footer>
    </div>
  );
}
