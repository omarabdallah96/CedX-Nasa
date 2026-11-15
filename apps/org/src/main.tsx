import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useParams } from 'react-router';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import './styles/tokens.css';
import './styles/app.css';
import { SessionProvider, useSession } from './lib/session.tsx';
import { useT } from './lib/i18n.ts';
import { ToastProvider, Empty } from './ui/parts.tsx';
import { Shell } from './ui/Shell.tsx';
import { Landing } from './routes/Landing.tsx';
import { RequestAccess } from './routes/RequestAccess.tsx';
import { Login } from './routes/Login.tsx';
import { Invite } from './routes/Invite.tsx';
import { PublicFrame } from './routes/PublicFrame.tsx';
import { Overview } from './routes/app/Overview.tsx';
import { Sites } from './routes/app/Sites.tsx';
import { SitePage } from './routes/app/SitePage.tsx';
import { Tools, TOOLS, defaultTool } from './routes/app/Tools.tsx';
import { Alerts } from './routes/app/Alerts.tsx';
import { Team } from './routes/app/Team.tsx';
import { Settings } from './routes/app/Settings.tsx';

/** Signed in, with an organization: else the sign-in page, or a page that says how to get one. */
function RequireOrg() {
  const { booting, user, orgs, org } = useSession();
  const { t } = useT();
  const location = useLocation();
  if (booting || (user && !orgs)) return <p className="boot" role="status">{t.common.loading}</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!org) {
    return (
      <PublicFrame>
        <Empty icon="team" title={t.shell.noOrg} action={<a className="btn" href="/org/request-access">{t.landing.request}</a>}>{t.shell.noOrgHint}</Empty>
      </PublicFrame>
    );
  }
  return <Outlet />;
}

function ToolRoute() {
  const { tool } = useParams();
  const { org } = useSession();
  if (!TOOLS.includes(tool as (typeof TOOLS)[number])) return <Navigate to={`/app/tools/${defaultTool(org!.kind)}`} replace />;
  return <Tools tool={tool as (typeof TOOLS)[number]} />;
}

function DefaultTool() {
  const { org } = useSession();
  return <Navigate to={`/app/tools/${defaultTool(org!.kind)}`} replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/request-access', element: <RequestAccess /> },
  { path: '/login', element: <Login /> },
  { path: '/invite/:token', element: <Invite /> },
  {
    path: '/app',
    element: <RequireOrg />,
    children: [{
      element: <Shell />,
      children: [
        { index: true, element: <Overview /> },
        { path: 'sites', element: <Sites /> },
        { path: 'sites/:siteId', element: <SitePage /> },
        { path: 'tools', element: <DefaultTool /> },
        { path: 'tools/:tool', element: <ToolRoute /> },
        { path: 'alerts', element: <Alerts /> },
        { path: 'team', element: <Team /> },
        { path: 'settings', element: <Settings /> },
      ],
    }],
  },
  { path: '*', element: <Navigate to="/" replace /> },
], { basename: '/org' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SessionProvider>
  </StrictMode>,
);
