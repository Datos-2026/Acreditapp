import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { Icon } from "./Icon";

/**
 * Vista operativa de un solo evento (terminal, importación, métricas, informe).
 * Para cambiar de evento, el superadmin vuelve al panel; el resto a "Mis eventos".
 */
export function EventShellLayout() {
  const { user, logout } = useAuth();
  const { id: eventId = "" } = useParams();
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get("tab") || "terminal";
  const isInformeRoute = location.pathname.endsWith("/informe");
  const isTerminalView = !isInformeRoute && tab === "terminal";

  const eventPath = (t: string) => `/events/${eventId}?tab=${t}`;
  const linkClass = (active: boolean) => `sidebar-link${active ? " sidebar-link--active" : ""}`;

  const backHref = user?.role === "SUPERADMIN" ? "/admin/eventos" : "/eventos";
  const backLabel = user?.role === "SUPERADMIN" ? "Panel administración" : "Mis eventos";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand__row">
            <div className="sidebar-brand__icon">
              <Icon name="domain" style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <h1 className="sidebar-brand__title">Operación evento</h1>
          </div>
          <p className="sidebar-brand__sub">Acreditación</p>
        </div>

        <nav className="sidebar-nav">
          <Link
            to={eventPath("terminal")}
            className={linkClass(!isInformeRoute && tab === "terminal")}
          >
            <Icon name="qr_code_scanner" filled={!isInformeRoute && tab === "terminal"} />
            Terminal
          </Link>

          <Link to={eventPath("importar")} className={linkClass(!isInformeRoute && tab === "importar")}>
            <Icon name="cloud_upload" filled={!isInformeRoute && tab === "importar"} />
            Importador
          </Link>

          <Link to={eventPath("metricas")} className={linkClass(!isInformeRoute && tab === "metricas")}>
            <Icon name="analytics" filled={!isInformeRoute && tab === "metricas"} />
            Métricas
          </Link>
        </nav>

        <div className="sidebar-footer">
          <Link to={backHref} className="sidebar-cta">
            <Icon name="arrow_back" />
            {backLabel}
          </Link>
          <button type="button" className="sidebar-logout" onClick={() => void logout()}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className={`topbar${isTerminalView ? " topbar--terminal" : ""}`}>
          <div className="topbar__left">
            <span className="topbar__brand">GCBA | Acreditación</span>
            <>
              <span className="topbar__divider">/</span>
              <span className="topbar__context">
                {isInformeRoute ? "Informe post-evento" : "Operación en evento"}
              </span>
            </>
          </div>
          <div className="topbar__actions">
            <button type="button" className="icon-btn" aria-label="Notificaciones">
              <Icon name="notifications" />
            </button>
            <button type="button" className="icon-btn" aria-label="Configuración">
              <Icon name="settings" />
            </button>
            <div className="topbar__separator" />
            <div className="topbar__meta">
              <p className="topbar__name">{user?.name}</p>
              <p className="topbar__role">{user?.role}</p>
            </div>
            <div className="topbar__avatar" aria-hidden />
          </div>
        </header>
        <div className={`page-canvas${isTerminalView ? " page-canvas--terminal" : ""}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
