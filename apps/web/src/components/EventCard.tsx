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
    <article className="card event-card">
      <div className="event-card__top">
        <span className={statusClass[event.status]}>{statusLabel[event.status]}</span>
        <button type="button" className="icon-btn event-card__menu" aria-label="Más opciones">
          <Icon name="more_vert" />
        </button>
      </div>
      <h3 className="event-card__title">
        {event.name}
      </h3>
      <p className="event-card__description">
        {event.description ?? "Sin descripción"}
      </p>
      <div className="event-card__meta">
        <Icon name="calendar_today" style={{ fontSize: 18 }} />
        <span>{formatDateTimeAr(event.startAt)}</span>
      </div>
      <p className="event-card__stats">
        <strong>En base:</strong> {event.totalPeople} &nbsp;|&nbsp; <strong>Acreditados:</strong>{" "}
        {event.accreditedPeople}
      </p>
      <Link to={`/events/${event.id}?tab=terminal`} className="btn btn-primary event-card__action">
        <Icon name="arrow_forward" />
        Ingresar al evento
      </Link>
    </article>
  );
}
