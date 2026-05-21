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
};

type PodiumResponse = {
  generatedAt: string;
  totalAccredited: number;
  ranking: PodiumRow[];
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

/** Devuelve solo iniciales para el avatar (máx. 2 letras). */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export function PodioPage() {
  const podiumQuery = useQuery({
    queryKey: ["admin", "podium"],
    queryFn: async () => (await api.get<PodiumResponse>("/admin/podium")).data
  });

  const top3 = useMemo(() => podiumQuery.data?.ranking.slice(0, 3) ?? [], [podiumQuery.data]);
  const rest = useMemo(() => podiumQuery.data?.ranking.slice(3) ?? [], [podiumQuery.data]);

  /** Orden visual: 2°, 1°, 3° (centro más alto). */
  const ordered: Array<{ place: 1 | 2 | 3; row: PodiumRow | undefined }> = [
    { place: 2, row: top3[1] },
    { place: 1, row: top3[0] },
    { place: 3, row: top3[2] }
  ];

  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Podio histórico de acreditadores</h1>
          <p className="lead page-header__lead">
            Los tres acreditadores con más personas acreditadas sumando todos los eventos. Útil para reconocer al equipo
            con mejor rendimiento.
          </p>
        </div>
      </div>

      {podiumQuery.isLoading ? (
        <p className="page-state">Cargando podio…</p>
      ) : podiumQuery.isError ? (
        <p className="message-error">No se pudo cargar el podio. Reintentá en unos segundos.</p>
      ) : top3.length === 0 ? (
        <p className="message-warning">
          Todavía no hay acreditaciones registradas. Una vez que el equipo empiece a acreditar, el podio se llena solo.
        </p>
      ) : (
        <>
          <article className="card podium-summary">
            <div>
              <p className="label-md">Total acreditaciones registradas</p>
              <p className="display-sm" style={{ fontSize: "2rem", marginBottom: 0 }}>
                {podiumQuery.data?.totalAccredited.toLocaleString("es-AR") ?? 0}
              </p>
            </div>
            <div>
              <p className="label-md">Acreditadores con al menos una</p>
              <p className="display-sm" style={{ fontSize: "2rem", marginBottom: 0 }}>
                {podiumQuery.data?.ranking.length ?? 0}
              </p>
            </div>
          </article>

          <div className="podium-stage" role="list" aria-label="Top 3 acreditadores">
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
                  <p className="podium-count">
                    <strong>{(row?.count ?? 0).toLocaleString("es-AR")}</strong> acreditaciones
                  </p>
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
              <h2 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                Detrás del podio
              </h2>
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
                      {row.count.toLocaleString("es-AR")} acreditaciones
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
