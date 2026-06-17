import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { Icon } from "./Icon";

const SUPERADMIN_EVENTOS_REDIRECT: Record<string, string> = {
  "/eventos": "/admin/eventos",
  "/eventos/calendario": "/admin/eventos/calendario",
  "/eventos/nuevo": "/admin/eventos/nuevo"
};

export function EventsBrowseLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (user?.role === "SUPERADMIN") {
    const target = SUPERADMIN_EVENTOS_REDIRECT[location.pathname] ?? "/admin";
    return <Navigate to={target} replace />;
  }

  const canCreateEvent = user?.role === "ADMIN_EVENTO" || user?.role === "ADMIN_VECINOS";
  const isAdminVecinos = user?.role === "ADMIN_VECINOS";
  const isList = location.pathname === "/eventos";
  const isCal = location.pathname === "/eventos/calendario";
  const isNuevo = location.pathname === "/eventos/nuevo";
  const isVecinoDir = location.pathname === "/vecinos/directorio";
  const isVecinoUsers = location.pathname === "/vecinos/usuarios";
  const navBtn = (active: boolean) =>
    `btn btn-ghost events-browse-nav__link${active ? " events-browse-nav__link--active" : ""}`;

  return (
    <div className="app-shell app-shell--events-browse">
      <main className="main-content main-content--full-width">
        <header className="topbar topbar--events-browse">
          <div className="topbar__left events-browse-topbar__left">
            <span className="topbar__brand">GCBA | Acreditación</span>
            <span className="topbar__divider" aria-hidden />
            <nav className="events-browse-nav" aria-label="Sección eventos">
              <Link to="/eventos" className={navBtn(isList)}>
                <Icon name="event" />
                Listado
              </Link>
              <Link to="/eventos/calendario" className={navBtn(isCal)}>
                <Icon name="calendar_month" />
                Calendario
              </Link>
              {canCreateEvent ? (
                <Link to="/eventos/nuevo" className={navBtn(isNuevo)}>
                  <Icon name="add_circle" />
                  Nuevo evento
                </Link>
              ) : null}
              {isAdminVecinos ? (
                <>
                  <Link to="/vecinos/directorio" className={navBtn(isVecinoDir)}>
                    <Icon name="groups" />
                    Directorio vecinos
                  </Link>
                  <Link to="/vecinos/usuarios" className={navBtn(isVecinoUsers)}>
                    <Icon name="manage_accounts" />
                    Usuarios
                  </Link>
                </>
              ) : null}
            </nav>
          </div>
          <div className="topbar__actions">
            <div className="topbar__meta">
              <p className="topbar__name">{user?.name}</p>
              <p className="topbar__role">{user?.role}</p>
            </div>
            <div className="topbar__avatar" aria-hidden />
            <button type="button" className="btn btn-ghost btn--sm" onClick={() => void logout()}>
              <Icon name="logout" />
              Salir
            </button>
          </div>
        </header>
        <div className="page-canvas page-canvas--events-browse">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
