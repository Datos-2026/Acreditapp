import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventCardDto } from "@gcba/shared";
import { api } from "../../lib/api";
import { Link, useLocation } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";
import { useLastEvent } from "../../lib/lastEventContext";

export function EventsListPage() {
  const { user } = useAuth();
  const location = useLocation();
  const { lastEventId, setLastEventId } = useLastEvent();
  const canCreateEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
  const newEventPath = location.pathname.startsWith("/admin") ? "/admin/eventos/nuevo" : "/eventos/nuevo";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const response = await api.get<EventCardDto[]>("/events");
      return response.data;
    }
  });

  const filtered = useMemo(
    () =>
      (data ?? []).filter((event) => {
        const matchesQuery = event.name.toLowerCase().includes(query.toLowerCase());
        const matchesStatus = status === "all" ? true : event.status === status;
        return matchesQuery && matchesStatus;
      }),
    [data, query, status]
  );

  useEffect(() => {
    if (!data?.length) return;
    if (!lastEventId) setLastEventId(data[0].id);
  }, [data, lastEventId, setLastEventId]);

  if (isLoading) {
    return <div className="page-state">Cargando eventos...</div>;
  }

  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Todos los eventos</h1>
          <p className="lead page-header__lead">
            Listado con búsqueda y filtros. Abrí un evento para operar terminal, importación y métricas.
          </p>
          <div className="kpi-inline page-header__kpis">
            <div className="kpi-chip">
              <p className="kpi-chip__label">Coincidencias</p>
              <p className="kpi-chip__value">{filtered.length}</p>
            </div>
          </div>
        </div>
        <div className="page-header__actions">
          {canCreateEvent ? (
            <Link to={newEventPath} className="btn btn-primary">
              <Icon name="add" />
              Nuevo evento
            </Link>
          ) : null}
        </div>
      </div>

      <div className="filters-bar card card--flat">
        <div className="filters-bar__grow">
          <label className="label-md field-label" htmlFor="filter-q">
            Buscar
          </label>
          <input
            id="filter-q"
            className="input input--boxed"
            placeholder="Nombre del evento..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filters-bar__fixed">
          <label className="label-md field-label" htmlFor="filter-status">
            Estado
          </label>
          <select
            id="filter-status"
            className="input input--boxed"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="closed">Cerrado</option>
            <option value="archived">Archivado</option>
          </select>
        </div>
      </div>

      <div className="editorial-grid">
        {filtered.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
