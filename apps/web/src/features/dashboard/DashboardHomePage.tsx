import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventCardDto } from "@gcba/shared";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";
import { useLastEvent } from "../../lib/lastEventContext";

export function DashboardHomePage() {
  const { user } = useAuth();
  const { lastEventId, setLastEventId } = useLastEvent();
  const canCreateEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
  const { data, isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const response = await api.get<EventCardDto[]>("/events");
      return response.data;
    }
  });

  const summary = useMemo(() => {
    const list = data ?? [];
    const by = (s: EventCardDto["status"]) => list.filter((e) => e.status === s).length;
    return {
      total: list.length,
      active: by("active"),
      draft: by("draft"),
      closed: by("closed"),
      archived: by("archived")
    };
  }, [data]);

  useEffect(() => {
    if (!data?.length) return;
    if (!lastEventId) setLastEventId(data[0].id);
  }, [data, lastEventId, setLastEventId]);

  if (isLoading) {
    return <div className="page-state">Cargando vista general...</div>;
  }

  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Vista general</h1>
          <p className="lead page-header__lead">
            Resumen de eventos y accesos rápidos. El listado completo y el calendario están en la sección Eventos.
          </p>
          <div className="kpi-inline page-header__kpis">
            <div className="kpi-chip">
              <p className="kpi-chip__label">Eventos totales</p>
              <p className="kpi-chip__value">{summary.total}</p>
            </div>
            <div className="kpi-chip">
              <p className="kpi-chip__label">Activos</p>
              <p className="kpi-chip__value">{summary.active}</p>
            </div>
            <div className="kpi-chip">
              <p className="kpi-chip__label">Borradores</p>
              <p className="kpi-chip__value">{summary.draft}</p>
            </div>
            <div className="kpi-chip">
              <p className="kpi-chip__label">Cerrados / archivados</p>
              <p className="kpi-chip__value">{summary.closed + summary.archived}</p>
            </div>
          </div>
        </div>
        <div className="page-header__actions">
          {canCreateEvent ? (
            <Link to="/eventos/nuevo" className="btn btn-primary">
              <Icon name="add" />
              Nuevo evento
            </Link>
          ) : null}
        </div>
      </div>

      <div className="dashboard-overview-quick">
        <article className="card">
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Listado de eventos
          </h3>
          <p style={{ margin: "0.5rem 0 1rem", color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
            Buscá por nombre, filtrá por estado y abrí la operación de cada evento (terminal, importador, métricas).
          </p>
          <Link to="/eventos" className="btn btn-primary">
            <Icon name="event" />
            Ir al listado
          </Link>
        </article>
        <article className="card">
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Calendario
          </h3>
          <p style={{ margin: "0.5rem 0 1rem", color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
            Vista mensual con eventos multi‑día y detalle por fecha.
          </p>
          <Link to="/eventos/calendario" className="btn btn-secondary">
            <Icon name="calendar_month" />
            Abrir calendario
          </Link>
        </article>
      </div>
    </section>
  );
}
