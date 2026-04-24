import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";
import { useLastEvent } from "../../lib/lastEventContext";
import { SearchByCuilPanel } from "../../components/SearchByCuilPanel";
import { PersonSummaryCard } from "../../components/PersonSummaryCard";
import { ManualPersonForm } from "../../components/ManualPersonForm";
import { ImportWizard } from "../../components/ImportWizard";
import { ActivityTimeline } from "../../components/ActivityTimeline";
import { DataTable } from "../../components/DataTable";
import { RoleGuard } from "../../components/RoleGuard";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadAccreditedCsv } from "../../lib/downloadExport";
import { Icon } from "../../components/Icon";

type EventPerson = {
  id: string;
  status: "pending" | "accredited";
  source: "manual" | "imported";
  accreditedAt: string | null;
  person: {
    cuilNormalized: string;
    firstName: string;
    lastName: string;
    dni: string | null;
    company: string | null;
    position: string | null;
  };
};

const tabs = [
  "Acreditar",
  "Personas",
  "Acreditados",
  "Fuera de base",
  "Importar XLSX",
  "Actividad",
  "Dashboard",
  "Configuración"
] as const;

const TAB_TO_SLUG: Record<(typeof tabs)[number], string> = {
  Acreditar: "terminal",
  Personas: "personas",
  Acreditados: "acreditados",
  "Fuera de base": "fuera-de-base",
  "Importar XLSX": "importar",
  Actividad: "actividad",
  Dashboard: "metricas",
  Configuración: "config"
};

const SLUG_TO_TAB: Record<string, (typeof tabs)[number]> = {
  terminal: "Acreditar",
  personas: "Personas",
  acreditados: "Acreditados",
  "fuera-de-base": "Fuera de base",
  importar: "Importar XLSX",
  actividad: "Actividad",
  metricas: "Dashboard",
  config: "Configuración"
};

export function EventDetailPage() {
  const { setLastEventId } = useLastEvent();
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const slug = searchParams.get("tab") || "terminal";
  const tab = SLUG_TO_TAB[slug] ?? "Acreditar";
  const [selected, setSelected] = useState<EventPerson | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showFueraManualForm, setShowFueraManualForm] = useState(false);
  const [showFueraDeBaseModal, setShowFueraDeBaseModal] = useState(false);
  const [lastSearchedCuil, setLastSearchedCuil] = useState("");

  useEffect(() => {
    if (!SLUG_TO_TAB[slug]) {
      setSearchParams({ tab: "terminal" }, { replace: true });
    }
  }, [slug, setSearchParams]);

  useEffect(() => {
    if (id) setLastEventId(id);
  }, [id]);

  const setTab = (label: (typeof tabs)[number]) => {
    setSearchParams({ tab: TAB_TO_SLUG[label] });
  };

  const eventQuery = useQuery({
    queryKey: ["event", id],
    queryFn: async () => (await api.get(`/events/${id}`)).data
  });
  const peopleQuery = useQuery({
    queryKey: ["people", id],
    queryFn: async () => (await api.get(`/events/${id}/people?page=1&pageSize=100`)).data
  });
  const activityQuery = useQuery({
    queryKey: ["activity", id],
    queryFn: async () => (await api.get(`/events/${id}/activity`)).data
  });
  const statsQuery = useQuery({
    queryKey: ["stats", id],
    queryFn: async () => (await api.get(`/events/${id}/stats`)).data
  });
  const timelineQuery = useQuery({
    queryKey: ["timeline", id],
    queryFn: async () => (await api.get(`/events/${id}/stats/timeline`)).data
  });
  const rankingQuery = useQuery({
    queryKey: ["ranking", id],
    queryFn: async () => (await api.get(`/events/${id}/stats/by-user`)).data
  });
  type AccreditedRow = {
    person: {
      cuilNormalized: string;
      lastName: string;
      firstName: string;
      dni: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
      position: string | null;
    };
    source: string;
    status: string;
    accreditedAt: string | null;
    accreditedByUser: { name: string } | null;
  };

  const accreditedImportedQuery = useQuery({
    queryKey: ["people", id, "accredited", "imported"],
    queryFn: async () =>
      (await api.get(
        `/events/${id}/people?status=accredited&source=imported&page=1&pageSize=5000`
      )).data as { total: number; rows: AccreditedRow[] },
    enabled: tab === "Acreditados"
  });

  const accreditedManualQuery = useQuery({
    queryKey: ["people", id, "accredited", "manual"],
    queryFn: async () =>
      (await api.get(
        `/events/${id}/people?status=accredited&source=manual&page=1&pageSize=5000`
      )).data as { total: number; rows: AccreditedRow[] },
    enabled: tab === "Fuera de base"
  });

  const searchMutation = useMutation({
    mutationFn: async (cuil: string) => (await api.get(`/events/${id}/people/search?cuil=${encodeURIComponent(cuil)}`)).data,
    onSuccess: (data) => setSelected(data),
    onError: () => setSelected(null)
  });
  const accreditMutation = useMutation({
    mutationFn: async () => (await api.post(`/events/${id}/people/${selected?.id}/accredit`)).data,
    onSuccess: () => {
      setShowConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["people", id] });
      queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      queryClient.invalidateQueries({ queryKey: ["stats", id] });
    }
  });
  const manualMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await api.post(`/events/${id}/people/manual`, payload)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["people", id] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
    }
  });
  const manualAndAccreditMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const created = await api.post<{ id: string }>(`/events/${id}/people/manual`, payload);
      await api.post(`/events/${id}/people/${created.data.id}/accredit`);
      return created.data;
    },
    onSuccess: () => {
      setShowFueraDeBaseModal(false);
      setShowConfirm(false);
      setSelected(null);
      setLastSearchedCuil("");
      void queryClient.invalidateQueries({ queryKey: ["people", id] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      void queryClient.invalidateQueries({ queryKey: ["stats", id] });
    }
  });

  const peopleRows = (peopleQuery.data?.rows ?? []) as Array<{
    person: { cuilNormalized: string; lastName: string; firstName: string };
    status: string;
    source: string;
  }>;
  const fastKpis = useMemo(
    () => [
      { label: "En base", value: eventQuery.data?.totalPeople ?? 0 },
      { label: "Acreditados", value: eventQuery.data?.accreditedPeople ?? 0 },
      { label: "Pendientes", value: statsQuery.data?.pending ?? 0 },
      { label: "Manuales", value: statsQuery.data?.manual ?? 0 }
    ],
    [eventQuery.data, statsQuery.data]
  );

  if (eventQuery.isLoading) return <div className="page-state">Cargando evento...</div>;

  return (
    <section>
      <header className="card" style={{ marginBottom: "2rem" }}>
        <p className="label-md" style={{ marginBottom: "0.5rem" }}>
          Evento seleccionado
        </p>
        <h1 className="display-sm">{eventQuery.data?.name}</h1>
        <p className="lead">{eventQuery.data?.description ?? "Sin descripción"}</p>
        <div className="kpi-inline">
          {fastKpis.map((item) => (
            <div key={item.label} className="kpi-chip">
              <p className="kpi-chip__label">{item.label}</p>
              <p className="kpi-chip__value">{item.value}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="tabs-strip">
        {tabs.map((label) => (
          <button
            key={label}
            className={`tab-btn ${tab === label ? "active" : ""}`}
            onClick={() => setTab(label)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "Acreditar" ? (
        <div className="two-cols">
          <SearchByCuilPanel
            onSearch={(cuil) => {
              setLastSearchedCuil(cuil);
              searchMutation.mutate(cuil);
            }}
          />
          <div>
            {selected ? (
              <PersonSummaryCard eventPerson={selected} />
            ) : (
              <p style={{ color: "var(--on-surface-variant)", fontWeight: 600 }}>
                Ingresá un CUIL para consultar identidad en este evento.
              </p>
            )}
            {selected?.status === "pending" ? (
              <button className="btn btn-primary btn-hero" style={{ marginTop: "1rem" }} onClick={() => setShowConfirm(true)} type="button">
                Acreditar
              </button>
            ) : null}
            {searchMutation.isError ? (
              <>
                <p className="message-warning">No encontrado en el evento.</p>
                <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"]}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: "0.75rem" }}
                    onClick={() => setShowFueraDeBaseModal(true)}
                  >
                    Acreditar fuera de base
                  </button>
                </RoleGuard>
              </>
            ) : null}
          </div>
          <ConfirmDialog
            open={showConfirm}
            title="Confirmar acreditación"
            message="Esta acción acredita a la persona en el evento."
            onCancel={() => setShowConfirm(false)}
            onConfirm={() => accreditMutation.mutate()}
          />
          {showFueraDeBaseModal ? (
            <div className="modal-backdrop">
              <div className="modal card" style={{ width: "min(720px, 95vw)" }}>
                <h3 style={{ marginTop: 0 }}>Acreditar fuera de base</h3>
                <p style={{ color: "var(--on-surface-variant)" }}>
                  Registrá la persona manualmente y se acredita de forma automática en este evento.
                </p>
                <ManualPersonForm
                  initialCuilRaw={lastSearchedCuil}
                  submitLabel={manualAndAccreditMutation.isPending ? "Procesando..." : "Registrar y acreditar"}
                  onSubmit={(values) => manualAndAccreditMutation.mutate(values as unknown as Record<string, unknown>)}
                />
                <div className="row gap" style={{ justifyContent: "flex-end", marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowFueraDeBaseModal(false)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "Personas" ? (
        <DataTable
          rows={peopleRows}
          columns={[
            { key: "cuil", header: "CUIL", render: (row) => row.person.cuilNormalized },
            { key: "apellido", header: "Apellido", render: (row) => row.person.lastName },
            { key: "nombre", header: "Nombre", render: (row) => row.person.firstName },
            { key: "estado", header: "Estado", render: (row) => row.status },
            { key: "origen", header: "Origen", render: (row) => row.source }
          ]}
        />
      ) : null}

      {tab === "Acreditados" ? (
        <div>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="display-sm" style={{ fontSize: "1.35rem", margin: "0 0 0.35rem" }}>
                Acreditados desde la base importada
              </h3>
              <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
                Personas que estaban en la base del evento y ya figuran acreditadas. Los cargados manualmente (fuera de
                base) están en la pestaña homónima.
              </p>
              <p style={{ margin: "0.75rem 0 0", fontWeight: 800, color: "var(--primary-container)" }}>
                Total en esta lista: {accreditedImportedQuery.data?.total ?? "…"}
              </p>
            </div>
            <div className="row gap" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await downloadAccreditedCsv(id, "all");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                CSV todos
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await downloadAccreditedCsv(id, "imported");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                CSV desde base
              </button>
            </div>
          </div>
          {accreditedImportedQuery.isLoading ? (
            <p className="page-state">Cargando acreditados…</p>
          ) : (
            <DataTable
              rows={accreditedImportedQuery.data?.rows ?? []}
              columns={[
                { key: "cuil", header: "CUIL", render: (row) => row.person.cuilNormalized },
                { key: "apellido", header: "Apellido", render: (row) => row.person.lastName },
                { key: "nombre", header: "Nombre", render: (row) => row.person.firstName },
                {
                  key: "fecha",
                  header: "Acreditado",
                  render: (row) =>
                    row.accreditedAt ? new Date(row.accreditedAt).toLocaleString("es-AR") : "—"
                },
                {
                  key: "por",
                  header: "Por",
                  render: (row) => row.accreditedByUser?.name ?? "—"
                }
              ]}
            />
          )}
        </div>
      ) : null}

      {tab === "Fuera de base" ? (
        <div>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 className="display-sm" style={{ fontSize: "1.35rem", margin: "0 0 0.35rem" }}>
                Acreditados fuera de base
              </h3>
              <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.9375rem" }}>
                Altas manuales en terminal que ya fueron acreditadas (no provienen de la planilla importada).
              </p>
              <p style={{ margin: "0.75rem 0 0", fontWeight: 800, color: "var(--primary-container)" }}>
                Total fuera de base: {accreditedManualQuery.data?.total ?? "…"}
              </p>
            </div>
            <div className="row gap" style={{ flexWrap: "wrap" }}>
              <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"]}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowFueraManualForm((v) => !v)}
                >
                  <Icon name="person_add" />
                  {showFueraManualForm ? "Ocultar formulario de alta" : "Registrar nuevo fuera de base"}
                </button>
              </RoleGuard>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await downloadAccreditedCsv(id, "manual");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                CSV fuera de base
              </button>
            </div>
          </div>
          <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"]}>
            {showFueraManualForm ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <ManualPersonForm
                  onSubmit={(values) => manualMutation.mutate(values as unknown as Record<string, unknown>)}
                />
              </div>
            ) : null}
          </RoleGuard>
          {accreditedManualQuery.isLoading ? (
            <p className="page-state">Cargando…</p>
          ) : (
            <DataTable
              rows={accreditedManualQuery.data?.rows ?? []}
              columns={[
                { key: "cuil", header: "CUIL", render: (row) => row.person.cuilNormalized },
                { key: "apellido", header: "Apellido", render: (row) => row.person.lastName },
                { key: "nombre", header: "Nombre", render: (row) => row.person.firstName },
                {
                  key: "fecha",
                  header: "Acreditado",
                  render: (row) =>
                    row.accreditedAt ? new Date(row.accreditedAt).toLocaleString("es-AR") : "—"
                },
                {
                  key: "por",
                  header: "Por",
                  render: (row) => row.accreditedByUser?.name ?? "—"
                }
              ]}
            />
          )}
        </div>
      ) : null}

      {tab === "Importar XLSX" ? (
        <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO"]} fallback={<p className="message-warning">Sin permisos para importar.</p>}>
          <ImportWizard eventId={id} />
        </RoleGuard>
      ) : null}

      {tab === "Actividad" ? <ActivityTimeline items={activityQuery.data ?? []} /> : null}

      {tab === "Dashboard" ? (
        <div className="two-cols">
          <section className="card">
            <h3 className="display-sm" style={{ fontSize: "1.25rem" }}>
              Timeline de acreditaciones
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={timelineQuery.data ?? []}>
                <XAxis dataKey="bucket" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="var(--primary-container)" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>
          <section className="card">
            <h3 className="display-sm" style={{ fontSize: "1.25rem" }}>
              Ranking de acreditadores
            </h3>
            <ol className="ranked-list">
              {(rankingQuery.data ?? []).map((item: { userName: string; count: number }, index: number) => (
                <li key={`${item.userName}-${index}`}>
                  <strong>{item.userName}</strong>: {item.count}
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      {tab === "Configuración" ? (
        <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO"]} fallback={<p className="message-warning">Sin permisos de configuración.</p>}>
          <section className="card">
            <h3 className="display-sm" style={{ fontSize: "1.25rem" }}>
              Configuración del evento
            </h3>
            <p style={{ color: "var(--on-surface-variant)" }}>
              Gestión de usuarios asignados y estado del evento disponible vía API de administración.
            </p>
          </section>
        </RoleGuard>
      ) : null}
    </section>
  );
}
