import { Link } from "react-router-dom";
import { Icon } from "../../components/Icon";

export function AdminHomePage() {
  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Panel de administración</h1>
          <p className="lead page-header__lead">
            Gestioná eventos y cuentas. Para operar un evento (acreditar, importar, métricas, informe), abrilo desde
            Eventos.
          </p>
        </div>
      </div>

      <div className="dashboard-overview-quick">
        <article className="card">
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Eventos
          </h3>
          <p style={{ margin: "0.5rem 0 1rem", color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
            Listado, calendario y alta. Desde ahí ingresás a la vista operativa de cada evento.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <Link to="/admin/eventos" className="btn btn-primary">
              <Icon name="event" />
              Ir al listado
            </Link>
            <Link to="/admin/eventos/calendario" className="btn btn-secondary">
              <Icon name="calendar_month" />
              Calendario
            </Link>
            <Link to="/admin/eventos/nuevo" className="btn btn-secondary">
              <Icon name="add_circle" />
              Nuevo evento
            </Link>
          </div>
        </article>
        <article className="card">
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Directorio GCBA
          </h3>
          <p style={{ margin: "0.5rem 0 1rem", color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
            Base global de dotación (reserva). Quien no está en la base del evento pero sí en el directorio se acredita
            como fuera de base de anotados.
          </p>
          <Link to="/admin/directorio" className="btn btn-primary">
            <Icon name="folder_shared" />
            Gestionar directorio
          </Link>
        </article>
        <article className="card">
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Usuarios
          </h3>
          <p style={{ margin: "0.5rem 0 1rem", color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
            Altas, roles y bajas de la plataforma. El acceso por evento se asigna dentro de cada evento (Configuración).
          </p>
          <Link to="/admin/usuarios" className="btn btn-primary">
            <Icon name="manage_accounts" />
            Gestionar usuarios
          </Link>
        </article>
      </div>
    </section>
  );
}
