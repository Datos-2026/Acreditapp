import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../../lib/api";
import { useLastEvent } from "../../lib/lastEventContext";
import { ManualPersonForm } from "../../components/ManualPersonForm";
import { ImportWizard } from "../../components/ImportWizard";
import { ActivityTimeline } from "../../components/ActivityTimeline";
import { DataTable } from "../../components/DataTable";
import { RoleGuard } from "../../components/RoleGuard";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { downloadAccreditedXlsx, downloadPeopleBaseXlsx } from "../../lib/downloadExport";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";
import { EventAccessConfig } from "./EventAccessConfig";

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

type EventStats = {
  pending?: number;
  manual?: number;
  accredited?: number;
  importedInBase?: number;
  accreditedImported?: number;
  accreditedManual?: number;
};

/** Paleta para tortas / barras (contrasta sobre fondo oscuro del tema) */
const CHART_COLORS = ["#4a9eff", "#5ce0a8", "#e8b86d", "#c084fc", "#f472b6"];

function formatTimelineTick(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

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
  const { user } = useAuth();
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
  const [uiNotice, setUiNotice] = useState<string | null>(null);
  const [liveSearchInput, setLiveSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [showDeleteEvent, setShowDeleteEvent] = useState(false);
  const [deletePersonTarget, setDeletePersonTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<
    "all" | "accredited" | "accredited_imported" | null
  >(null);
  const navigate = useNavigate();
  const canManageEvent = user?.role === "SUPERADMIN" || user?.role === "ADMIN_EVENTO";
  const editEventPath = `/eventos/${id}/editar`;

  useEffect(() => {
    if (!SLUG_TO_TAB[slug]) {
      setSearchParams({ tab: "terminal" }, { replace: true });
    }
  }, [slug, setSearchParams]);

  useEffect(() => {
    if (slug === "config" && user?.role !== "SUPERADMIN") {
      setSearchParams({ tab: "terminal" }, { replace: true });
    }
  }, [slug, user?.role, setSearchParams]);

  const visibleTabs = useMemo(
    () => (user?.role === "SUPERADMIN" ? [...tabs] : tabs.filter((t) => t !== "Configuración")),
    [user?.role]
  );

  useEffect(() => {
    if (id) setLastEventId(id);
  }, [id, setLastEventId]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(liveSearchInput.trim()), 220);
    return () => clearTimeout(handle);
  }, [liveSearchInput]);

  const setTab = (label: (typeof tabs)[number]) => {
    setSearchParams({ tab: TAB_TO_SLUG[label] });
  };

  const eventQuery = useQuery({
    queryKey: ["event", id],
    queryFn: async () => (await api.get(`/events/${id}`)).data
  });
  const peopleQuery = useQuery({
    queryKey: ["people", id, "list"],
    queryFn: async () =>
      (await api.get(`/events/${id}/people?page=1&pageSize=5000`)).data as {
        total: number;
        rows: Array<{
          id: string;
          status: string;
          source: string;
          person: { cuilNormalized: string; lastName: string; firstName: string };
        }>;
      }
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
    queryFn: async () => (await api.get(`/events/${id}/stats/timeline`)).data,
    enabled: tab === "Dashboard"
  });
  const rankingQuery = useQuery({
    queryKey: ["ranking", id],
    queryFn: async () => (await api.get(`/events/${id}/stats/by-user`)).data,
    enabled: tab === "Dashboard"
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

  type LiveSearchRow = {
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

  const livePeopleQuery = useQuery({
    queryKey: ["people", id, "live", debouncedSearch],
    queryFn: async () =>
      (await api.get(`/events/${id}/people?q=${encodeURIComponent(debouncedSearch)}&page=1&pageSize=5000`)).data as {
        total: number;
        rows: LiveSearchRow[];
      },
    enabled: tab === "Acreditar" && debouncedSearch.length >= 2
  });

  const liveRows = useMemo(() => (livePeopleQuery.data?.rows ?? []) as LiveSearchRow[], [livePeopleQuery.data?.rows]);
  const normalizedDigits = debouncedSearch.replace(/\D/g, "");
  const exactCuilQuery = useQuery({
    queryKey: ["people", id, "searchByCuil", normalizedDigits],
    queryFn: async () =>
      (await api.get(`/events/${id}/people/search?cuil=${encodeURIComponent(normalizedDigits)}`)).data as EventPerson,
    enabled: tab === "Acreditar" && normalizedDigits.length === 11
  });
  const displayRows = useMemo(() => {
    const onlyDigits = debouncedSearch.replace(/\D/g, "");
    if (liveRows.length > 0) return liveRows;
    if (onlyDigits.length === 11 && exactCuilQuery.data) {
      return [exactCuilQuery.data as unknown as LiveSearchRow];
    }
    return [];
  }, [liveRows, exactCuilQuery.data, debouncedSearch]);
  const accreditMutation = useMutation({
    mutationFn: async () => (await api.post(`/events/${id}/people/${selected?.id}/accredit`)).data,
    onSuccess: () => {
      setShowConfirm(false);
      setUiNotice("Persona acreditada correctamente.");
      queryClient.invalidateQueries({ queryKey: ["people", id] });
      queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      queryClient.invalidateQueries({ queryKey: ["people", id, "live"] });
      queryClient.invalidateQueries({ queryKey: ["stats", id] });
    }
  });
  const manualMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await api.post(`/events/${id}/people/manual`, payload)).data,
    onSuccess: () => {
      setUiNotice("Alta fuera de base registrada.");
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
      setLiveSearchInput("");
      setDebouncedSearch("");
      setUiNotice("Persona registrada y acreditada fuera de base.");
      void queryClient.invalidateQueries({ queryKey: ["people", id] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "live"] });
      void queryClient.invalidateQueries({ queryKey: ["stats", id] });
    }
  });

  const peopleRows = peopleQuery.data?.rows ?? [];

  const invalidatePeopleData = () => {
    void queryClient.invalidateQueries({ queryKey: ["people", id] });
    void queryClient.invalidateQueries({ queryKey: ["people", id, "list"] });
    void queryClient.invalidateQueries({ queryKey: ["people", id, "live"] });
    void queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
    void queryClient.invalidateQueries({ queryKey: ["stats", id] });
    void queryClient.invalidateQueries({ queryKey: ["event", id] });
  };

  const deletePersonMutation = useMutation({
    mutationFn: async (eventPersonId: string) => {
      await api.delete(`/events/${id}/people/${eventPersonId}`);
    },
    onSuccess: () => {
      setDeletePersonTarget(null);
      setSelected(null);
      setUiNotice("Persona quitada del evento.");
      invalidatePeopleData();
    }
  });

  const bulkDeletePeopleMutation = useMutation({
    mutationFn: async (scope: "all" | "accredited" | "accredited_imported") => {
      const { data } = await api.delete<{ deleted: number }>(`/events/${id}/people/bulk`, {
        params: { scope }
      });
      return data;
    },
    onSuccess: (data) => {
      setBulkDeleteScope(null);
      setSelected(null);
      setUiNotice(`Se eliminaron ${data.deleted} registro(s) del evento.`);
      invalidatePeopleData();
    }
  });
  const stats = statsQuery.data as EventStats | undefined;

  const fastKpis = useMemo(
    () => [
      { label: "En base", value: eventQuery.data?.totalPeople ?? 0 },
      { label: "Acreditados", value: eventQuery.data?.accreditedPeople ?? 0 },
      { label: "Pendientes", value: stats?.pending ?? 0 },
      { label: "Manuales", value: stats?.manual ?? 0 }
    ],
    [eventQuery.data, stats]
  );

  const statusBarData = useMemo(
    () => [
      { estado: "Acreditados", cantidad: stats?.accredited ?? 0 },
      { estado: "Pendientes", cantidad: stats?.pending ?? 0 }
    ],
    [stats?.accredited, stats?.pending]
  );

  const originVolumeData = useMemo(() => {
    const imp = stats?.importedInBase ?? 0;
    const man = stats?.manual ?? 0;
    return [
      { name: "Base importada", value: imp },
      { name: "Alta manual", value: man }
    ].filter((d) => d.value > 0);
  }, [stats?.importedInBase, stats?.manual]);

  const accreditedByOriginData = useMemo(() => {
    const i = stats?.accreditedImported ?? 0;
    const m = stats?.accreditedManual ?? 0;
    return [
      { name: "Desde planilla", value: i },
      { name: "Fuera de base", value: m }
    ].filter((d) => d.value > 0);
  }, [stats?.accreditedImported, stats?.accreditedManual]);

  const rankingBarData = useMemo(() => {
    const rows = (rankingQuery.data ?? []) as { userName: string; count: number }[];
    return [...rows].reverse();
  }, [rankingQuery.data]);

  const deleteEventMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/events/${id}`);
    },
    onSuccess: () => {
      setShowDeleteEvent(false);
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(user?.role === "SUPERADMIN" ? "/admin/eventos" : "/eventos");
    }
  });

  if (eventQuery.isLoading) return <div className="page-state">Cargando evento...</div>;

  return (
    <section className={`event-operation-page${tab === "Acreditar" ? " event-operation-page--terminal" : ""}`}>
      <header className={`card event-detail-header${tab === "Acreditar" ? " event-detail-header--compact" : ""}`}>
        <div className="event-summary">
          <div className="event-title">
            <p className="label-md" style={{ marginBottom: "0.35rem" }}>
              Evento seleccionado
            </p>
            <h1 className="display-sm">{eventQuery.data?.name}</h1>
            <p className="lead">{eventQuery.data?.description ?? "Sin descripción"}</p>
            {canManageEvent ? (
              <div className="row gap event-detail-header__manage" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
                <Link to={editEventPath} className="btn btn-secondary">
                  <Icon name="edit" />
                  Editar evento
                </Link>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: "var(--error)" }}
                  onClick={() => setShowDeleteEvent(true)}
                >
                  <Icon name="delete" />
                  Eliminar evento
                </button>
              </div>
            ) : null}
          </div>
          <div className="kpi-inline metrics">
            {fastKpis.map((item) => (
              <div key={item.label} className="kpi-chip metric-card">
                <p className="kpi-chip__label metric-label">{item.label}</p>
                <p className="kpi-chip__value metric-value">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>
      {uiNotice ? (
        <p className="message-success" style={{ marginBottom: "1rem" }}>
          {uiNotice}
        </p>
      ) : null}

      {tab === "Acreditar" ? (
        <section className="search-card">
          <section className="terminal-section card accred-search-card">
            <label className="label-md field-label search-label" htmlFor="live-cuil-search">
              Buscar en base
            </label>
            <div className="search-cuil-form__input-wrap search-input-wrap">
              <input
                id="live-cuil-search"
                autoFocus
                autoComplete="off"
                className="input cuil-mega search-input"
                placeholder="CUIL / DNI / Apellido"
                value={liveSearchInput}
                onChange={(e) => {
                  setUiNotice(null);
                  setSearchedOnce(false);
                  setLiveSearchInput(e.target.value);
                }}
              />
              <div className="search-cuil-form__icon">
                <Icon name="search" style={{ fontSize: "2.5rem", color: "var(--secondary-container)" }} />
              </div>
            </div>
            <p className="search-cuil-form__hint search-help">Buscá y seleccioná una persona de la base para acreditar.</p>
          </section>
        </section>
      ) : null}

      <div className={`tabs-strip${tab === "Acreditar" ? " tabs-strip--compact" : ""}`}>
        {visibleTabs.map((label) => (
          <button
            key={label}
            className={`tab-btn ${tab === label ? "active" : ""}`}
            onClick={() => setTab(label)}
            type="button"
          >
            {label}
          </button>
        ))}
        <Link className="tab-btn tab-btn--informe" to={`/events/${id}/informe`} title="Informe post-evento y PDF">
          <Icon name="description" style={{ fontSize: "1.1rem", verticalAlign: "middle", marginRight: 4 }} />
          Informe
        </Link>
      </div>

      {tab === "Acreditar" ? (
        <div className="workspace panels-layout two-cols accred-layout accred-console accred-console--fit">
          <div className="card panel results-panel accred-console__left">
            {debouncedSearch.length < 2 ? (
              <p style={{ color: "var(--on-surface-variant)", fontWeight: 600, margin: 0 }}>
                Escribí al menos 2 caracteres para buscar personas en la base.
              </p>
            ) : livePeopleQuery.isLoading || exactCuilQuery.isLoading ? (
              <p className="page-state" style={{ padding: "1.25rem 0" }}>
                Buscando...
              </p>
            ) : livePeopleQuery.isError || (normalizedDigits.length === 11 && exactCuilQuery.isError) ? (
              <p className="message-error">No se pudo consultar la base en este momento. Reintentá.</p>
            ) : (
              <>
                <p className="label-md field-label">Resultados ({displayRows.length})</p>
                <div className="live-results-grid live-results-grid--dark">
                  {displayRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`live-result-card${selected?.id === row.id ? " live-result-card--active" : ""}`}
                      onClick={() => {
                        setSearchedOnce(true);
                        setSelected(row as EventPerson);
                        setLastSearchedCuil(row.person.cuilNormalized);
                      }}
                    >
                      <p className="live-result-card__name">{`${row.person.lastName}, ${row.person.firstName}`}</p>
                      <p className="live-result-card__meta">{row.person.cuilNormalized}</p>
                      <p className="live-result-card__meta">{row.person.company ?? "Sin ministerio"}</p>
                      <p className="live-result-card__meta">{row.person.position ?? "Sin rol"}</p>
                      <span className={`status-pill status-pill--${row.status === "accredited" ? "active" : "draft"}`}>
                        {row.status === "accredited" ? "Acreditado" : "Pendiente"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!livePeopleQuery.isLoading &&
            !exactCuilQuery.isLoading &&
            !livePeopleQuery.isError &&
            debouncedSearch.length >= 2 &&
            displayRows.length === 0 ? (
              <div style={{ marginTop: "1rem" }}>
                <p className="message-warning">No hay coincidencias en la base para esta búsqueda.</p>
                <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"]}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => {
                      setLastSearchedCuil(debouncedSearch.replace(/\D/g, ""));
                      setUiNotice(null);
                      setShowFueraDeBaseModal(true);
                    }}
                  >
                    Acreditar fuera de base
                  </button>
                </RoleGuard>
              </div>
            ) : null}
          </div>
          <div className="card panel detail-panel accred-console__right">
            {selected ? (
              <div className="accred-detail">
                <div className="accred-detail__head">
                  <h3 className="accred-detail__name">{`${selected.person.lastName}, ${selected.person.firstName}`}</h3>
                  {selected?.status === "pending" ? (
                    <button className="btn btn-danger" onClick={() => setShowConfirm(true)} type="button">
                      <Icon name="verified" />
                      Acreditar
                    </button>
                  ) : (
                    <span className="status-pill status-pill--active">Acreditado</span>
                  )}
                </div>
                <div className="accred-detail__rows">
                  <p><strong>CUIL</strong> {selected.person.cuilNormalized}</p>
                  <p><strong>DNI</strong> {selected.person.dni ?? "—"}</p>
                  <p><strong>Ministerio</strong> {selected.person.company ?? "—"}</p>
                  <p><strong>Rol</strong> {selected.person.position ?? "—"}</p>
                  <p><strong>Origen</strong> {selected.source === "manual" ? "Fuera de base" : "Base importada"}</p>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--on-surface-variant)", fontWeight: 600 }}>
                {debouncedSearch.length >= 2 && displayRows.length > 0 && !searchedOnce
                  ? "Seleccioná una persona desde la lista para ver su detalle."
                  : "Escribí y seleccioná una persona para ver su detalle."}
              </p>
            )}
            {accreditMutation.isError ? <p className="message-error">No se pudo acreditar. Reintentá en unos segundos.</p> : null}
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
                {manualAndAccreditMutation.isError ? (
                  <p className="message-error">No se pudo registrar/acreditar fuera de base. Reintentá.</p>
                ) : null}
                <div className="row gap" style={{ justifyContent: "flex-end", marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowFueraDeBaseModal(false);
                      setUiNotice(null);
                    }}
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
        <div>
          <div
              className="card"
              style={{
                marginBottom: "1rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                justifyContent: "space-between",
                alignItems: "flex-start"
              }}
            >
              <div>
                <h3 className="display-sm" style={{ fontSize: "1.2rem", margin: "0 0 0.35rem" }}>
                  Gestión de la base del evento
                </h3>
                <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>
                  Total en nómina: <strong>{peopleQuery.data?.total ?? "…"}</strong>. Quitar una persona la saca del
                  evento (pendiente o acreditada).
                </p>
              </div>
              <div className="row gap" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await downloadPeopleBaseXlsx(id, { importedOnly: true });
                    } catch {
                      alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                    }
                  }}
                >
                  <Icon name="download" />
                  Exportar base XLSX
                </button>
                {canManageEvent ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ color: "var(--error)" }}
                      onClick={() => setBulkDeleteScope("accredited")}
                    >
                      <Icon name="delete_sweep" />
                      Vaciar acreditados
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ color: "var(--error)" }}
                      onClick={() => setBulkDeleteScope("all")}
                    >
                      <Icon name="delete_forever" />
                      Vaciar toda la base
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          <DataTable
            rows={peopleRows}
            columns={[
              { key: "cuil", header: "CUIL", render: (row) => row.person.cuilNormalized },
              { key: "apellido", header: "Apellido", render: (row) => row.person.lastName },
              { key: "nombre", header: "Nombre", render: (row) => row.person.firstName },
              { key: "estado", header: "Estado", render: (row) => row.status },
              { key: "origen", header: "Origen", render: (row) => row.source },
              ...(canManageEvent
                ? [
                    {
                      key: "acciones",
                      header: "",
                      render: (row: (typeof peopleRows)[number]) => (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0.35rem 0.65rem", color: "var(--error)" }}
                          title="Quitar del evento"
                          onClick={() =>
                            setDeletePersonTarget({
                              id: row.id,
                              label: `${row.person.lastName}, ${row.person.firstName} (${row.person.cuilNormalized})`
                            })
                          }
                        >
                          <Icon name="delete" />
                        </button>
                      )
                    }
                  ]
                : [])
            ]}
          />
        </div>
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
                    await downloadAccreditedXlsx(id, "all");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                XLSX todos
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await downloadAccreditedXlsx(id, "imported");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                XLSX desde base
              </button>
              {canManageEvent ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: "var(--error)" }}
                  onClick={() => setBulkDeleteScope("accredited_imported")}
                >
                  <Icon name="delete_sweep" />
                  Vaciar esta lista
                </button>
              ) : null}
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
                    await downloadAccreditedXlsx(id, "manual");
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                XLSX fuera de base
              </button>
            </div>
          </div>
          <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ACREDITADOR"]}>
            {showFueraManualForm ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <ManualPersonForm
                  onSubmit={(values) => manualMutation.mutate(values as unknown as Record<string, unknown>)}
                />
                {manualMutation.isError ? (
                  <p className="message-error">No se pudo registrar la persona fuera de base.</p>
                ) : null}
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
        <div>
          <p className="dashboard-charts-intro">
            Visualización del estado del evento, el origen de los registros y la actividad en el tiempo.
          </p>
          {statsQuery.isLoading ? (
            <p className="page-state">Cargando gráficos…</p>
          ) : statsQuery.isError ? (
            <p className="message-error">No se pudieron cargar los datos del dashboard. Reintentá.</p>
          ) : (
            <div className="dashboard-charts-grid">
              <section className="card dashboard-chart-card">
                <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                  Estado de acreditación
                </h3>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                  Total de personas acreditadas frente a pendientes.
                </p>
                <div className="dashboard-chart-body">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={statusBarData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="estado" tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }} />
                      <YAxis tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--surface-container-high)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 8
                        }}
                      />
                      <Bar dataKey="cantidad" name="Personas" radius={[6, 6, 0, 0]}>
                        {statusBarData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="card dashboard-chart-card">
                <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                  Registros por origen
                </h3>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                  Cuántas filas vienen de la planilla importada y cuántas son altas manuales.
                </p>
                <div className="dashboard-chart-body">
                  {originVolumeData.length === 0 ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      Todavía no hay personas cargadas en el evento.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={originVolumeData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={88}
                          paddingAngle={2}
                        >
                          {originVolumeData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "var(--surface-container-high)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "0.85rem" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              <section className="card dashboard-chart-card">
                <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                  Acreditados por origen
                </h3>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                  De las personas ya acreditadas, cuántas venían de base y cuántas se dieron de alta manual.
                </p>
                <div className="dashboard-chart-body">
                  {accreditedByOriginData.length === 0 ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      Aún no hay acreditaciones registradas.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={accreditedByOriginData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={88}
                          paddingAngle={2}
                        >
                          {accreditedByOriginData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[(i + 1) % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "var(--surface-container-high)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "0.85rem" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              <section className="card dashboard-chart-card dashboard-chart-card--wide">
                <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                  Acreditaciones en el tiempo
                </h3>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                  Cantidad de acreditaciones por hora (según la marca de tiempo guardada).
                </p>
                <div className="dashboard-chart-body">
                  {timelineQuery.isLoading ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      Cargando serie temporal…
                    </p>
                  ) : (timelineQuery.data ?? []).length === 0 ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      No hay acreditaciones con hora registrada para graficar.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={timelineQuery.data ?? []} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                        <XAxis
                          dataKey="bucket"
                          tick={{ fill: "var(--on-surface-variant)", fontSize: 10 }}
                          tickFormatter={formatTimelineTick}
                          interval="preserveStartEnd"
                          minTickGap={28}
                        />
                        <YAxis tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }} allowDecimals={false} />
                        <Tooltip
                          labelFormatter={formatTimelineTick}
                          contentStyle={{
                            background: "var(--surface-container-high)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          name="Acreditaciones"
                          stroke={CHART_COLORS[0]}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: CHART_COLORS[0] }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              <section className="card dashboard-chart-card dashboard-chart-card--wide">
                <h3 className="display-sm" style={{ fontSize: "1.2rem", marginTop: 0 }}>
                  Acreditaciones por operador
                </h3>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                  Total de acreditaciones registradas a nombre de cada usuario.
                </p>
                <div
                  className="dashboard-chart-body"
                  style={{ minHeight: Math.max(200, 48 + rankingBarData.length * 36) }}
                >
                  {rankingQuery.isLoading ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      Cargando ranking…
                    </p>
                  ) : rankingBarData.length === 0 ? (
                    <p className="page-state" style={{ padding: "2rem 0" }}>
                      Nadie acreditó todavía, o no hay usuario asociado a las acreditaciones.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(200, 48 + rankingBarData.length * 36)}>
                      <BarChart
                        layout="vertical"
                        data={rankingBarData}
                        margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "var(--on-surface-variant)", fontSize: 12 }} allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="userName"
                          width={132}
                          tick={{ fill: "var(--on-surface-variant)", fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--surface-container-high)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8
                          }}
                        />
                        <Bar dataKey="count" name="Acreditaciones" radius={[0, 6, 6, 0]}>
                          {rankingBarData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      ) : null}

      {tab === "Configuración" ? (
        <RoleGuard roles={["SUPERADMIN"]} fallback={<p className="message-warning">Solo el superadmin puede configurar accesos al evento.</p>}>
          <EventAccessConfig eventId={id} />
        </RoleGuard>
      ) : null}

      <ConfirmDialog
        open={showDeleteEvent}
        title="Eliminar evento"
        message={`¿Eliminar "${eventQuery.data?.name ?? "este evento"}"? Se borrarán personas del evento, importaciones e informes. No se puede deshacer.`}
        onCancel={() => setShowDeleteEvent(false)}
        onConfirm={() => deleteEventMutation.mutate()}
        confirmLabel="Eliminar evento"
        danger
      />
      <ConfirmDialog
        open={Boolean(deletePersonTarget)}
        title="Quitar persona del evento"
        message={`¿Quitar a ${deletePersonTarget?.label ?? "esta persona"} de la nómina del evento? Dejará de figurar en la base y en acreditados.`}
        onCancel={() => setDeletePersonTarget(null)}
        onConfirm={() => deletePersonTarget && deletePersonMutation.mutate(deletePersonTarget.id)}
        confirmLabel="Quitar"
        danger
      />
      <ConfirmDialog
        open={bulkDeleteScope === "all"}
        title="Vaciar toda la base del evento"
        message="Se eliminarán todas las personas de este evento (pendientes y acreditadas, importadas y manuales). No se puede deshacer."
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("all")}
        confirmLabel="Vaciar toda la base"
        danger
      />
      <ConfirmDialog
        open={bulkDeleteScope === "accredited"}
        title="Vaciar acreditados"
        message="Se eliminarán del evento todas las personas acreditadas (importadas y fuera de base). Las pendientes en la base se mantienen."
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("accredited")}
        confirmLabel="Vaciar acreditados"
        danger
      />
      <ConfirmDialog
        open={bulkDeleteScope === "accredited_imported"}
        title="Vaciar acreditados desde base"
        message="Se eliminarán del evento solo los acreditados que venían de la planilla importada (esta lista)."
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("accredited_imported")}
        confirmLabel="Vaciar lista"
        danger
      />
    </section>
  );
}
