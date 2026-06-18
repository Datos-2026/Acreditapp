import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

type PodiumRow = {
  userId: string | null;
  userName: string;
  userEmail: string | null;
  userRole: string | null;
  isActive: boolean;
  count: number;
  eventCount: number;
  averagePerEvent: number;
};

type PodiumResponse = {
  generatedAt: string;
  totalAccredited: number;
  totalEventsWithAccreditations: number;
  ranking: PodiumRow[];
  averageRanking: PodiumRow[];
};

const PLACE_LABEL: Record<number, string> = {
  1: "1°",
  2: "2°",
  3: "3°"
};

const PLACE_TITLE: Record<number, string> = {
  1: "Oro",
  2: "Plata",
  3: "Bronce"
};

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

function formatAverage(value: number): string {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

type PodiumSectionProps = {
  title: string;
  lead: string;
  summary: Array<{ label: string; value: string }>;
  ranking: PodiumRow[];
  mode: "total" | "average";
  listAriaLabel: string;
};

function PodiumSection({ title, lead, summary, ranking, mode, listAriaLabel }: PodiumSectionProps) {
  const top3 = useMemo(() => ranking.slice(0, 3), [ranking]);
  const rest = useMemo(() => ranking.slice(3), [ranking]);

  const ordered: Array<{ place: 1 | 2 | 3; row: PodiumRow | undefined }> = [
    { place: 2, row: top3[1] },
    { place: 1, row: top3[0] },
    { place: 3, row: top3[2] }
  ];

  if (top3.length === 0) {
    return (
      <section className="podium-block">
        <div className="page-header page-header--compact">
          <div className="page-header__copy">
            <h2 className="display-sm">{title}</h2>
            <p className="lead page-header__lead">{lead}</p>
          </div>
        </div>
        <p className="message-warning">Todavía no hay datos para este podio.</p>
      </section>
    );
  }

  return (
    <section className="podium-block">
      <div className="page-header page-header--compact">
        <div className="page-header__copy">
          <h2 className="display-sm">{title}</h2>
          <p className="lead page-header__lead">{lead}</p>
        </div>
      </div>

      <article className="card podium-summary">
        {summary.map((item) => (
          <div key={item.label}>
            <p className="label-md">{item.label}</p>
            <p className="display-sm" style={{ fontSize: "2rem", marginBottom: 0 }}>
              {item.value}
            </p>
          </div>
        ))}
      </article>

      <div className="podium-stage" role="list" aria-label={listAriaLabel}>
        {ordered.map(({ place, row }) => (
          <div
            key={place}
            role="listitem"
            className={`podium-spot podium-spot--${place}${row ? "" : " podium-spot--empty"}`}
          >
            <div className="podium-card">
              <div className={`podium-medal podium-medal--${place}`} aria-hidden>
                <Icon name="emoji_events" style={{ fontSize: "1.5rem" }} />
              </div>
              <div className={`podium-avatar podium-avatar--${place}`} aria-hidden>
                {row ? initialsFrom(row.userName) : "—"}
              </div>
              <p className="podium-name" title={row?.userName ?? "Sin datos"}>
                {row?.userName ?? "Sin datos"}
              </p>
              <p className="podium-role">
                {row?.userRole ?? "—"} {row && !row.isActive ? "· inactivo" : ""}
              </p>
              {mode === "total" ? (
                <p className="podium-count">
                  <strong>{(row?.count ?? 0).toLocaleString("es-AR")}</strong> acreditaciones
                </p>
              ) : (
                <>
                  <p className="podium-count">
                    <strong>{formatAverage(row?.averagePerEvent ?? 0)}</strong> por evento
                  </p>
                  <p className="podium-subcount">
                    {row?.eventCount ?? 0} evento{(row?.eventCount ?? 0) === 1 ? "" : "s"} ·{" "}
                    {(row?.count ?? 0).toLocaleString("es-AR")} acreditaciones
                  </p>
                </>
              )}
            </div>
            <div className={`podium-pedestal podium-pedestal--${place}`}>
              <span className="podium-place">{PLACE_LABEL[place]}</span>
              <span className="podium-place-sub">{PLACE_TITLE[place]}</span>
            </div>
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <article className="card" style={{ marginTop: "1.5rem" }}>
          <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
            Detrás del podio
          </h3>
          <ol className="podium-rest-list">
            {rest.map((row, idx) => (
              <li key={row.userId ?? idx} className="podium-rest-item">
                <span className="podium-rest-rank">{idx + 4}°</span>
                <div className="podium-rest-info">
                  <p className="podium-rest-name">{row.userName}</p>
                  <p className="podium-rest-meta">
                    {row.userRole ?? "—"}
                    {row.userEmail ? ` · ${row.userEmail}` : ""}
                    {!row.isActive ? " · inactivo" : ""}
                  </p>
                </div>
                <span className="podium-rest-count">
                  {mode === "total"
                    ? `${row.count.toLocaleString("es-AR")} acreditaciones`
                    : `${formatAverage(row.averagePerEvent)} / evento · ${row.eventCount} evento${row.eventCount === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ol>
        </article>
      ) : null}
    </section>
  );
}

export function PodioPage() {
  const podiumQuery = useQuery({
    queryKey: ["admin", "podium"],
    queryFn: async () => (await api.get<PodiumResponse>("/admin/podium")).data
  });

  const hasData =
    (podiumQuery.data?.ranking.length ?? 0) > 0 || (podiumQuery.data?.averageRanking.length ?? 0) > 0;

  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Podio histórico de acreditadores</h1>
          <p className="lead page-header__lead">
            Dos rankings para reconocer al equipo: volumen total histórico y rendimiento promedio por evento en el que
            participó cada acreditador.
          </p>
        </div>
      </div>

      {podiumQuery.isLoading ? (
        <p className="page-state">Cargando podio…</p>
      ) : podiumQuery.isError ? (
        <p className="message-error">No se pudo cargar el podio. Reintentá en unos segundos.</p>
      ) : !hasData ? (
        <p className="message-warning">
          Todavía no hay acreditaciones registradas. Una vez que el equipo empiece a acreditar, el podio se llena solo.
        </p>
      ) : (
        <div className="podium-page-sections">
          <PodiumSection
            title="Podio por volumen total"
            lead="Quienes acreditaron más personas sumando todos los eventos."
            summary={[
              {
                label: "Total acreditaciones registradas",
                value: (podiumQuery.data?.totalAccredited ?? 0).toLocaleString("es-AR")
              },
              {
                label: "Acreditadores con al menos una",
                value: String(podiumQuery.data?.ranking.length ?? 0)
              }
            ]}
            ranking={podiumQuery.data?.ranking ?? []}
            mode="total"
            listAriaLabel="Top 3 por volumen total"
          />

          <PodiumSection
            title="Podio por promedio por evento"
            lead="Quienes rinden mejor por jornada: total de acreditaciones dividido por la cantidad de eventos en los que acreditó al menos una persona."
            summary={[
              {
                label: "Eventos con acreditaciones",
                value: String(podiumQuery.data?.totalEventsWithAccreditations ?? 0)
              },
              {
                label: "Acreditadores en el ranking",
                value: String(podiumQuery.data?.averageRanking.length ?? 0)
              }
            ]}
            ranking={podiumQuery.data?.averageRanking ?? []}
            mode="average"
            listAriaLabel="Top 3 por promedio por evento"
          />
        </div>
      )}
    </section>
  );
}
