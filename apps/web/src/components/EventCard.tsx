import type { EventCardDto } from "@gcba/shared";
import { Link } from "react-router-dom";
import { formatDateTimeAr } from "@gcba/shared";
import { Icon } from "./Icon";

type Props = {
  event: EventCardDto;
};

const statusClass: Record<EventCardDto["status"], string> = {
  active: "status-pill status-pill--active",
  draft: "status-pill status-pill--draft",
  closed: "status-pill status-pill--closed",
  archived: "status-pill status-pill--archived"
};

const statusLabel: Record<EventCardDto["status"], string> = {
  active: "Activo",
  draft: "Borrador",
  closed: "Cerrado",
  archived: "Archivado"
};

export function EventCard({ event }: Props) {
  return (
    <article className="card event-card-stitch">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
        <span className={statusClass[event.status]}>{statusLabel[event.status]}</span>
        <button type="button" className="icon-btn" aria-label="Más opciones" style={{ margin: "-0.25rem" }}>
          <Icon name="more_vert" />
        </button>
      </div>
      <h3 style={{ fontSize: "1.25rem", fontWeight: 900, color: "var(--primary)", margin: "0 0 0.75rem", lineHeight: 1.2 }}>
        {event.name}
      </h3>
      <p style={{ color: "var(--on-surface-variant)", fontSize: "0.9375rem", margin: "0 0 1rem", lineHeight: 1.45 }}>
        {event.description ?? "Sin descripción"}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "var(--on-surface-variant)" }}>
        <Icon name="calendar_today" style={{ fontSize: 18 }} />
        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>{formatDateTimeAr(event.startAt)}</span>
      </div>
      <p style={{ fontSize: "0.875rem", margin: "0 0 1.25rem", color: "var(--on-surface)" }}>
        <strong>En base:</strong> {event.totalPeople} &nbsp;|&nbsp; <strong>Acreditados:</strong>{" "}
        {event.accreditedPeople}
      </p>
      <Link to={`/events/${event.id}?tab=terminal`} className="btn btn-primary" style={{ width: "100%" }}>
        <Icon name="arrow_forward" />
        Ingresar al evento
      </Link>
    </article>
  );
}
