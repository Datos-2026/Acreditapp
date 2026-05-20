import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { Icon } from "./Icon";

/** Panel de gestión (solo SUPERADMIN): eventos, usuarios, altas. */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  if (user?.role !== "SUPERADMIN") {
    return <Navigate to="/eventos" replace />;
  }

  const linkClass = (active: boolean) => `sidebar-link${active ? " sidebar-link--active" : ""}`;

  const onAdminHome = location.pathname === "/admin";
  const onEventosSection = location.pathname.startsWith("/admin/eventos");
  const onUsuarios = location.pathname === "/admin/usuarios";
  const onDirectorio = location.pathname === "/admin/directorio";

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileMenuOpen ? " sidebar--mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand__row">
            <div className="sidebar-brand__icon">
              <Icon name="admin_panel_settings" style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <h1 className="sidebar-brand__title">Administración</h1>
          </div>
          <p className="sidebar-brand__sub">GCBA · Superadmin</p>
        </div>

        <nav className="sidebar-nav">
          <Link to="/admin" className={linkClass(onAdminHome)}>
            <Icon name="dashboard" filled={onAdminHome} />
            Inicio
          </Link>
          <Link to="/admin/eventos" className={linkClass(onEventosSection && !onUsuarios)}>
            <Icon name="event" filled={onEventosSection && !onUsuarios} />
            Eventos
          </Link>
          <Link to="/admin/usuarios" className={linkClass(onUsuarios)}>
            <Icon name="manage_accounts" filled={onUsuarios} />
            Usuarios
          </Link>
          <Link to="/admin/directorio" className={linkClass(onDirectorio)}>
            <Icon name="folder_shared" filled={onDirectorio} />
            Directorio GCBA
          </Link>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-logout" onClick={() => void logout()}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {mobileMenuOpen ? <button type="button" className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} /> : null}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="icon-btn topbar__menu-trigger"
              aria-label="Abrir menú"
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              <Icon name={mobileMenuOpen ? "close" : "menu"} />
            </button>
            <span className="topbar__brand">GCBA | Acreditación</span>
            <span className="topbar__divider">/</span>
            <span className="topbar__context">Panel administración</span>
          </div>
          <div className="topbar__actions">
            <div className="topbar__meta">
              <p className="topbar__name">{user?.name}</p>
              <p className="topbar__role">{user?.role}</p>
            </div>
            <div className="topbar__avatar" aria-hidden />
          </div>
        </header>
        <div className="page-canvas">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
