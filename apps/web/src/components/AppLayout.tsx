import { Link, Outlet, useLocation, useMatch } from "react-router-dom";
import { useAuth } from "../features/auth/auth-context";
import { Icon } from "./Icon";
import { useLastEvent } from "../lib/lastEventContext";

export function AppLayout() {
  const { user, logout } = useAuth();
  const { lastEventId } = useLastEvent();
  const eventMatch = useMatch("/events/:id");
  const rawEventId = eventMatch?.params.id;
  /** Evita que `/events/new` (alta de evento) se tome como id de evento */
  const eventIdFromUrl = rawEventId && rawEventId !== "new" ? rawEventId : undefined;
  /** En la URL manda; si estás en Dashboard, usamos el último evento visitado para Terminal / Importador / Métricas */
  const resolvedEventId = eventIdFromUrl ?? lastEventId;
  const location = useLocation();
  const isOnEventUrl = Boolean(eventIdFromUrl);
  const tab = new URLSearchParams(location.search).get("tab") || "terminal";
  const canOpenEventSections = Boolean(resolvedEventId);
  const canCreateEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";

  const eventPath = (t: string) => `/events/${resolvedEventId}?tab=${t}`;
  const linkClass = (active: boolean, muted?: boolean) =>
    `sidebar-link${active ? " sidebar-link--active" : ""}${muted ? " sidebar-link--disabled" : ""}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "rgba(255,255,255,0.1)",
                display: "grid",
                placeItems: "center"
              }}
            >
              <Icon name="domain" style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <h1 className="sidebar-brand__title">Gestión Central</h1>
          </div>
          <p className="sidebar-brand__sub">Modernización</p>
        </div>

        <nav className="sidebar-nav">
          <Link to="/" className={linkClass(location.pathname === "/")}>
            <Icon name="dashboard" filled={location.pathname === "/"} />
            Dashboard
          </Link>

          {canCreateEvent ? (
            <Link to="/events/new" className={linkClass(location.pathname === "/events/new")}>
              <Icon name="add_circle" filled={location.pathname === "/events/new"} />
              Nuevo evento
            </Link>
          ) : null}

          <Link
            to={canOpenEventSections ? eventPath("terminal") : "/"}
            title={canOpenEventSections ? "Terminal de acreditación" : "Elegí un evento en el panel primero"}
            className={linkClass(isOnEventUrl && tab === "terminal", !canOpenEventSections)}
            onClick={(e) => {
              if (!canOpenEventSections) e.preventDefault();
            }}
          >
            <Icon name="qr_code_scanner" filled={isOnEventUrl && tab === "terminal"} />
            Terminal
          </Link>

          <Link
            to={canOpenEventSections ? eventPath("importar") : "/"}
            title={canOpenEventSections ? "Importar base XLSX" : "Elegí un evento en el panel primero"}
            className={linkClass(isOnEventUrl && tab === "importar", !canOpenEventSections)}
            onClick={(e) => {
              if (!canOpenEventSections) e.preventDefault();
            }}
          >
            <Icon name="cloud_upload" filled={isOnEventUrl && tab === "importar"} />
            Importador
          </Link>

          <Link
            to={canOpenEventSections ? eventPath("metricas") : "/"}
            title={canOpenEventSections ? "Métricas del evento" : "Elegí un evento en el panel primero"}
            className={linkClass(isOnEventUrl && tab === "metricas", !canOpenEventSections)}
            onClick={(e) => {
              if (!canOpenEventSections) e.preventDefault();
            }}
          >
            <Icon name="analytics" filled={isOnEventUrl && tab === "metricas"} />
            Métricas
          </Link>
        </nav>

        {!canOpenEventSections ? (
          <p
            style={{
              margin: "0 1rem 1rem",
              padding: "0.75rem",
              fontSize: "0.6875rem",
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.55)",
              borderLeft: "3px solid rgba(255,204,0,0.5)",
              background: "rgba(0,0,0,0.15)"
            }}
          >
            Entrá a un evento desde el panel para usar Terminal, importación y métricas.
          </p>
        ) : null}

        <div className="sidebar-footer">
          <Link
            to="/eventos"
            className={`sidebar-cta${location.pathname === "/eventos" ? " sidebar-cta--active" : ""}`}
          >
            <Icon name="event" />
            Eventos
          </Link>
          <button type="button" className="sidebar-logout" onClick={() => void logout()}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span className="topbar__brand">GCBA | Acreditación</span>
            {isOnEventUrl ? (
              <>
                <span style={{ color: "var(--on-primary-container)", opacity: 0.35 }}>/</span>
                <span style={{ fontWeight: 700, color: "var(--primary-container)", fontSize: "0.95rem" }}>
                  Operación en evento
                </span>
              </>
            ) : null}
          </div>
          <div className="topbar__actions">
            <button type="button" className="icon-btn" aria-label="Notificaciones">
              <Icon name="notifications" />
            </button>
            <button type="button" className="icon-btn" aria-label="Configuración">
              <Icon name="settings" />
            </button>
            <div
              style={{
                width: 1,
                height: 28,
                background: "rgba(194,199,204,0.35)",
                margin: "0 0.25rem"
              }}
            />
            <div className="topbar__meta">
              <p className="topbar__name">{user?.name}</p>
              <p className="topbar__role">{user?.role}</p>
            </div>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(145deg, var(--primary-container), var(--tertiary-fixed-dim))",
                border: "2px solid var(--secondary-container)"
              }}
              aria-hidden
            />
          </div>
        </header>
        <div className="page-canvas">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
