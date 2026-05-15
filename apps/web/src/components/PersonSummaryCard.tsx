import { formatCuil } from "@gcba/shared";
import { AccreditationStatusBadge } from "./AccreditationStatusBadge";
import { Icon } from "./Icon";

type Props = {
  eventPerson: {
    id: string;
    status: "pending" | "accredited";
    source: "manual" | "imported";
    accreditedAt: string | null;
    person: {
      firstName: string;
      lastName: string;
      cuilNormalized: string;
      dni: string | null;
      company: string | null;
      position: string | null;
    };
  };
};

export function PersonSummaryCard({ eventPerson }: Props) {
  const fullName = `${eventPerson.person.lastName}, ${eventPerson.person.firstName}`.toUpperCase();

  return (
    <article className="card person-summary-card">
      <div className="person-summary-card__floating">
        <span className="badge badge-success person-summary-card__floating-badge">
          <span className={`person-summary-card__dot${eventPerson.status === "accredited" ? "" : " person-summary-card__dot--off"}`} />
          {eventPerson.status === "accredited" ? "Acreditado" : "En revisión"}
        </span>
      </div>

      <div className="bento-grid">
        <div className="bento-main">
          <p className="person-hero-name">{fullName}</p>
          <p className="person-summary-card__idline">
            CUIL {formatCuil(eventPerson.person.cuilNormalized)}
            {eventPerson.person.dni ? ` · DNI ${eventPerson.person.dni}` : ""}
          </p>
          <div className="person-summary-card__grid">
            <div>
              <p className="label-md field-label">
                Ministerio
              </p>
              <p className="person-summary-card__value">
                {eventPerson.person.company ?? "—"}
              </p>
            </div>
            <div>
              <p className="label-md field-label">
                Rol
              </p>
              <p className="person-summary-card__value">
                {eventPerson.person.position ?? "—"}
              </p>
            </div>
          </div>
          <div className="person-summary-card__status">
            <AccreditationStatusBadge status={eventPerson.status} source={eventPerson.source} />
          </div>
          {eventPerson.status === "accredited" ? (
            <p className="message-success person-summary-card__done">
              <Icon name="verified" filled style={{ fontSize: 20 }} />
              Persona ya acreditada en este evento
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
