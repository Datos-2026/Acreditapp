import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventCardDto } from "@gcba/shared";
import { api } from "../../lib/api";
import { Link } from "react-router-dom";
import { EventCard } from "../../components/EventCard";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";
import { useLastEvent } from "../../lib/lastEventContext";

export function EventsHomePage() {
  const { user } = useAuth();
  const { lastEventId, setLastEventId } = useLastEvent();
  const canCreateEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
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
      <div style={{ marginBottom: "2.5rem", display: "flex", flexWrap: "wrap", gap: "1.5rem", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px" }}>
          <h1 className="display-sm">Panel de control</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Gestión integral de accesos y acreditaciones para eventos institucionales.
          </p>
          <div className="kpi-inline" style={{ marginTop: "1.25rem" }}>
            <div className="kpi-chip">
              <p className="kpi-chip__label">Eventos visibles</p>
              <p className="kpi-chip__value">{filtered.length}</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignSelf: "center" }}>
          <Link to="/eventos" className="btn btn-ghost">
            <Icon name="calendar_month" />
            Calendario
          </Link>
          {canCreateEvent ? (
            <Link to="/events/new" className="btn btn-primary">
              <Icon name="add" />
              Nuevo evento
            </Link>
          ) : null}
        </div>
      </div>

      <div className="filters-bar card card--flat">
        <div style={{ flex: "1 1 220px" }}>
          <label className="label-md" htmlFor="filter-q" style={{ display: "block", marginBottom: "0.35rem" }}>
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
        <div style={{ flex: "0 1 200px" }}>
          <label className="label-md" htmlFor="filter-status" style={{ display: "block", marginBottom: "0.35rem" }}>
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
