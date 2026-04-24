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
    <article className="card" style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "1.25rem", right: "1.25rem" }}>
        <span className="badge badge-success" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--on-tertiary-fixed)",
              opacity: eventPerson.status === "accredited" ? 1 : 0.35
            }}
          />
          {eventPerson.status === "accredited" ? "Acreditado" : "En revisión"}
        </span>
      </div>

      <div className="bento-grid">
        <div className="bento-main">
          <p className="person-hero-name">{fullName}</p>
          <p style={{ fontSize: "1.125rem", color: "var(--primary-container)", fontWeight: 600, margin: "0 0 1.5rem" }}>
            CUIL {formatCuil(eventPerson.person.cuilNormalized)}
            {eventPerson.person.dni ? ` · DNI ${eventPerson.person.dni}` : ""}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "2rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid rgba(194,199,204,0.35)"
            }}
          >
            <div>
              <p className="label-md" style={{ marginBottom: "0.35rem" }}>
                Empresa / Institución
              </p>
              <p style={{ fontSize: "1.125rem", fontWeight: 800, color: "var(--primary)", margin: 0 }}>
                {eventPerson.person.company ?? "—"}
              </p>
            </div>
            <div>
              <p className="label-md" style={{ marginBottom: "0.35rem" }}>
                Cargo / Función
              </p>
              <p style={{ fontSize: "1.125rem", fontWeight: 800, color: "var(--primary)", margin: 0 }}>
                {eventPerson.person.position ?? "—"}
              </p>
            </div>
          </div>
          <div style={{ marginTop: "1.25rem" }}>
            <AccreditationStatusBadge status={eventPerson.status} source={eventPerson.source} />
          </div>
          {eventPerson.status === "accredited" ? (
            <p className="message-success" style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="verified" filled style={{ fontSize: 20 }} />
              Persona ya acreditada en este evento
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
