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
import { ConfirmTypeDialog } from "../../components/ConfirmTypeDialog";
import type { DirectoryPersonDto, DirectorySearchResult, MesaStatRowDto, MesaStatsDto, VecinoDirectoryPersonDto } from "@gcba/shared";
import { displayPersonDocument, documentColumnLabel } from "@gcba/shared";
import {
  downloadAccreditedXlsx,
  downloadEventTwoSheetsXlsx,
  downloadGroupedXlsx,
  downloadPeopleBaseXlsx
} from "../../lib/downloadExport";
import { Icon } from "../../components/Icon";
import { useAuth } from "../auth/auth-context";
import { EventAccessConfig } from "./EventAccessConfig";
import { VecinoMesasPanel } from "./VecinoMesasPanel";

type EventPerson = {
  id: string;
  status: "pending" | "accredited";
  source: "manual" | "imported";
  accreditedAt: string | null;
  extraData?: Record<string, unknown> | null;
  person: {
    cuilNormalized: string;
    firstName: string;
    lastName: string;
    dni: string | null;
    company: string | null;
    position: string | null;
    address?: string | null;
    comuna?: string | null;
    phone?: string | null;
    email?: string | null;
  };
};

function displayOrDash(value: unknown): string {
  if (value == null || String(value).trim() === "") return "—";
  return String(value);
}

function vecinoMesaFromExtra(extraData?: Record<string, unknown> | null): string {
  return displayOrDash(extraData?.mesa);
}

function vecinoPresenteFromExtra(extraData?: Record<string, unknown> | null): string {
  return displayOrDash(extraData?.presente);
}

function MesaSelect({
  mesaCount,
  value,
  onChange,
  id,
  mesaStats,
  showCountsSummary = false
}: {
  mesaCount: number;
  value: string;
  onChange: (value: string) => void;
  id: string;
  mesaStats?: MesaStatRowDto[];
  showCountsSummary?: boolean;
}) {
  const countByMesa = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of mesaStats ?? []) {
      map.set(row.mesaNumber, row.accredited);
    }
    return map;
  }, [mesaStats]);

  const mesaLabel = (n: number) => {
    const count = countByMesa.get(n) ?? 0;
    const people = count === 1 ? "1 persona" : `${count} personas`;
    return `Mesa ${n} (${people})`;
  };

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <label className="label-md field-label" htmlFor={id}>
        Mesa
      </label>
      <select
        id={id}
        className="input input--boxed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", maxWidth: 300, marginTop: "0.35rem" }}
      >
        <option value="">Elegir mesa…</option>
        {Array.from({ length: mesaCount }, (_, i) => i + 1).map((n) => (
          <option key={n} value={String(n)}>
            {mesaStats ? mesaLabel(n) : `Mesa ${n}`}
          </option>
        ))}
      </select>
      {showCountsSummary && mesaStats && mesaStats.length > 0 ? (
        <div className="mesa-select-summary" aria-label="Personas por mesa">
          {mesaStats.map((row) => (
            <span key={row.mesaNumber} className="mesa-select-summary__chip">
              M{row.mesaNumber}: <strong>{row.accredited}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

const MONTH_SHORT_AR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Formatea los buckets devueltos por `/stats/timeline`.
 * El backend manda strings `"YYYY-MM-DDTHH:mm"` ya en hora local Argentina
 * (cada 15 minutos), así que no aplicamos otra zona horaria al renderizar.
 */
function formatTimelineTick(raw: string) {
  if (typeof raw !== "string") return String(raw ?? "");
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (localMatch) {
    const [, , mm, dd, hh, mi] = localMatch;
    const month = MONTH_SHORT_AR[Number(mm) - 1] ?? mm;
    return `${dd}-${month}, ${hh}:${mi}`;
  }
  try {
    return new Date(raw).toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires"
    });
  } catch {
    return raw;
  }
}

const tabs = [
  "Acreditar",
  "Personas",
  "Acreditados",
  "Fuera de base",
  "Descargas",
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
  Descargas: "descargas",
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
  descargas: "Descargas",
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
  const [accreditMesa, setAccreditMesa] = useState("");
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
  const [unaccreditPersonTarget, setUnaccreditPersonTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<
    "all" | "accredited" | "accredited_imported" | null
  >(null);
  const [showCloseEvent, setShowCloseEvent] = useState(false);
  const [showReopenEvent, setShowReopenEvent] = useState(false);
  const [downloadScope, setDownloadScope] = useState<"accredited" | "all">("accredited");
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const canManageEvent =
    user?.role === "SUPERADMIN" ||
    user?.role === "ADMIN_EVENTO" ||
    user?.role === "ADMIN_VECINOS";
  const editEventPath = `/eventos/${id}/editar`;

  useEffect(() => {
    if (!SLUG_TO_TAB[slug]) {
      setSearchParams({ tab: "terminal" }, { replace: true });
    }
  }, [slug, setSearchParams]);

  useEffect(() => {
    if (
      slug === "config" &&
      user?.role !== "SUPERADMIN" &&
      user?.role !== "ADMIN_VECINOS"
    ) {
      setSearchParams({ tab: "terminal" }, { replace: true });
    }
  }, [slug, user?.role, setSearchParams]);

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

  const eventKind = (eventQuery.data?.kind ?? "gcba") as "gcba" | "vecinos";
  const isVecinosEvent = eventKind === "vecinos";
  const mesaCount = eventQuery.data?.mesaCount ?? 0;
  const mesasRequired = isVecinosEvent && mesaCount > 0;

  const mesasStatsQuery = useQuery({
    queryKey: ["mesas", id],
    queryFn: async () => (await api.get<MesaStatsDto>(`/events/${id}/mesas/stats`)).data,
    enabled: mesasRequired && tab === "Acreditar",
    refetchInterval: 15_000
  });

  const mesaStatsRows = mesasStatsQuery.data?.mesas ?? [];
  const canConfigureVecinosOps =
    isVecinosEvent &&
    Boolean(user?.role && ["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS", "ACREDITADOR"].includes(user.role));

  const visibleTabs = useMemo(() => {
    if (user?.role === "SUPERADMIN") return [...tabs];
    if (user?.role === "ADMIN_VECINOS" && isVecinosEvent) {
      return [...tabs];
    }
    return tabs.filter((t) => t !== "Configuración");
  }, [user?.role, isVecinosEvent]);

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
    id: string;
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

  type BreakdownResult = {
    by: string;
    scope: "accredited" | "all";
    total: number;
    groups: Array<{ key: string; count: number }>;
    eventKind?: "gcba" | "vecinos";
  };

  const comunaBreakdownQuery = useQuery({
    queryKey: ["breakdown", id, "comuna", downloadScope],
    queryFn: async () =>
      (await api.get(`/events/${id}/people/breakdown?by=comuna&scope=${downloadScope}`)).data as BreakdownResult,
    enabled: tab === "Descargas" && isVecinosEvent
  });

  const mesaBreakdownQuery = useQuery({
    queryKey: ["breakdown", id, "mesa", downloadScope],
    queryFn: async () =>
      (await api.get(`/events/${id}/people/breakdown?by=mesa&scope=${downloadScope}`)).data as BreakdownResult,
    enabled: tab === "Descargas" && isVecinosEvent
  });

  const ministerioBreakdownQuery = useQuery({
    queryKey: ["breakdown", id, "ministerio", downloadScope],
    queryFn: async () =>
      (await api.get(`/events/${id}/people/breakdown?by=ministerio&scope=${downloadScope}`)).data as BreakdownResult,
    enabled: tab === "Descargas" && !isVecinosEvent
  });

  const rolBreakdownQuery = useQuery({
    queryKey: ["breakdown", id, "rol", downloadScope],
    queryFn: async () =>
      (await api.get(`/events/${id}/people/breakdown?by=rol&scope=${downloadScope}`)).data as BreakdownResult,
    enabled: tab === "Descargas" && !isVecinosEvent
  });

  type LiveSearchRow = {
    id: string;
    status: "pending" | "accredited";
    source: "manual" | "imported";
    accreditedAt: string | null;
    extraData?: Record<string, unknown> | null;
    person: {
      cuilNormalized: string;
      firstName: string;
      lastName: string;
      dni: string | null;
      company: string | null;
      position: string | null;
      address?: string | null;
      comuna?: string | null;
      phone?: string | null;
      email?: string | null;
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
  const isExactDocumentSearch =
    normalizedDigits.length === 11 || (normalizedDigits.length >= 6 && normalizedDigits.length <= 8);
  const exactCuilQuery = useQuery({
    queryKey: ["people", id, "searchByCuil", normalizedDigits],
    queryFn: async (): Promise<DirectorySearchResult | null> => {
      try {
        const { data } = await api.get<DirectorySearchResult>(
          `/events/${id}/people/search?cuil=${encodeURIComponent(normalizedDigits)}`
        );
        return data;
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status === 404) return { inEvent: false, fromDirectory: false };
        throw err;
      }
    },
    enabled: tab === "Acreditar" && isExactDocumentSearch
  });

  const exactEventPerson = useMemo(() => {
    const data = exactCuilQuery.data;
    return data && data.inEvent ? (data.eventPerson as EventPerson) : null;
  }, [exactCuilQuery.data]);

  const directoryMatch = useMemo((): Extract<DirectorySearchResult, { fromDirectory: true }> | null => {
    const data = exactCuilQuery.data;
    if (data && !data.inEvent && data.fromDirectory) return data;
    return null;
  }, [exactCuilQuery.data]);

  const directoryManualPayload = useMemo((): { cuilNormalized?: string; dni?: string } | null => {
    if (!directoryMatch) return null;
    if (directoryMatch.directoryKind === "vecinos") {
      return { dni: directoryMatch.directoryPerson.dni };
    }
    return { cuilNormalized: directoryMatch.directoryPerson.cuilNormalized };
  }, [directoryMatch]);

  const displayRows = useMemo(() => {
    if (liveRows.length > 0) return liveRows;
    if (isExactDocumentSearch && exactEventPerson) {
      return [exactEventPerson as unknown as LiveSearchRow];
    }
    return [];
  }, [liveRows, exactEventPerson, isExactDocumentSearch]);

  /**
   * Al cambiar la búsqueda, la persona previamente seleccionada puede no estar más
   * entre los resultados (e incluso podría aparecer una persona del directorio GCBA).
   * Limpiamos el detalle anterior para evitar que se mezcle con la nueva búsqueda.
   */
  useEffect(() => {
    if (!selected) return;
    if (debouncedSearch.length < 2) {
      setSelected(null);
      return;
    }
    if (directoryMatch) {
      setSelected(null);
      return;
    }
    const stillVisible = displayRows.some((row) => row.id === selected.id);
    if (!stillVisible) setSelected(null);
  }, [debouncedSearch, directoryMatch, displayRows, selected]);

  /** Limpia por completo la búsqueda y el detalle de la pestaña Acreditar. */
  const clearLiveSearch = () => {
    setLiveSearchInput("");
    setDebouncedSearch("");
    setLastSearchedCuil("");
    setSelected(null);
    setSearchedOnce(false);
    setUiNotice(null);
    setAccreditMesa("");
  };

  useEffect(() => {
    setAccreditMesa("");
  }, [selected?.id, directoryMatch?.directoryPerson]);

  useEffect(() => {
    if (showConfirm && mesasRequired) {
      void queryClient.invalidateQueries({ queryKey: ["mesas", id] });
    }
  }, [showConfirm, mesasRequired, id, queryClient]);
  const accreditMutation = useMutation({
    mutationFn: async (mesa?: number) =>
      (
        await api.post<EventPerson>(`/events/${id}/people/${selected?.id}/accredit`, {
          ...(mesa != null ? { mesa } : {})
        })
      ).data,
    onSuccess: (data) => {
      setShowConfirm(false);
      setAccreditMesa("");
      const mesa = vecinoMesaFromExtra(data.extraData);
      setUiNotice(
        isVecinosEvent && mesa !== "—"
          ? `Persona acreditada. Asignada a mesa ${mesa}.`
          : "Persona acreditada correctamente."
      );
      setSelected(data);
      queryClient.invalidateQueries({ queryKey: ["people", id] });
      queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      queryClient.invalidateQueries({ queryKey: ["people", id, "live"] });
      queryClient.invalidateQueries({ queryKey: ["stats", id] });
      queryClient.invalidateQueries({ queryKey: ["mesas", id] });
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
  const manualFromDirectoryMutation = useMutation({
    mutationFn: async (payload: { cuilNormalized?: string; dni?: string; mesa?: number }) => {
      const created = await api.post<{ id: string }>(`/events/${id}/people/manual-from-directory`, payload);
      await api.post(`/events/${id}/people/${created.data.id}/accredit`, {
        ...(payload.mesa != null ? { mesa: payload.mesa } : {})
      });
      return created.data;
    },
    onSuccess: () => {
      setSelected(null);
      setAccreditMesa("");
      setLastSearchedCuil("");
      setLiveSearchInput("");
      setDebouncedSearch("");
      setUiNotice(
        isVecinosEvent
          ? "Persona del directorio de vecinos acreditada fuera de base."
          : "Persona del directorio GCBA acreditada fuera de base."
      );
      void queryClient.invalidateQueries({ queryKey: ["mesas", id] });
      void queryClient.invalidateQueries({ queryKey: ["people", id] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "accredited"] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "live"] });
      void queryClient.invalidateQueries({ queryKey: ["people", id, "searchByCuil"] });
      void queryClient.invalidateQueries({ queryKey: ["stats", id] });
    }
  });

  const manualAndAccreditMutation = useMutation({
    mutationFn: async ({ values, mesa }: { values: Record<string, unknown>; mesa?: number }) => {
      const created = await api.post<{ id: string }>(`/events/${id}/people/manual`, values);
      await api.post(`/events/${id}/people/${created.data.id}/accredit`, {
        ...(mesa != null ? { mesa } : {})
      });
      return created.data;
    },
    onSuccess: () => {
      setShowFueraDeBaseModal(false);
      setShowConfirm(false);
      setAccreditMesa("");
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
      setUiNotice("Persona quitada de la nómina del evento.");
      invalidatePeopleData();
    }
  });

  const unaccreditPersonMutation = useMutation({
    mutationFn: async (eventPersonId: string) => {
      await api.post(`/events/${id}/people/${eventPersonId}/unaccredit`);
    },
    onSuccess: () => {
      setUnaccreditPersonTarget(null);
      setUiNotice("Acreditación revertida. La persona volvió a estado pendiente.");
      invalidatePeopleData();
      void queryClient.invalidateQueries({ queryKey: ["mesas", id] });
    }
  });

  const bulkDeletePeopleMutation = useMutation({
    mutationFn: async (scope: "all" | "accredited" | "accredited_imported") => {
      const { data } = await api.delete<{ deleted?: number; unaccredited?: number }>(
        `/events/${id}/people/bulk`,
        { params: { scope } }
      );
      return data;
    },
    onSuccess: (data) => {
      setBulkDeleteScope(null);
      setSelected(null);
      if (data.unaccredited != null) {
        setUiNotice(
          data.unaccredited === 1
            ? "1 persona volvió a estado pendiente."
            : `${data.unaccredited} personas volvieron a estado pendiente.`
        );
      } else {
        setUiNotice(`Se eliminaron ${data.deleted ?? 0} registro(s) del evento.`);
      }
      invalidatePeopleData();
      void queryClient.invalidateQueries({ queryKey: ["mesas", id] });
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

  const eventStatus = (eventQuery.data?.status ?? "draft") as "draft" | "active" | "closed" | "archived";
  const isAccreditationClosed = eventStatus === "closed" || eventStatus === "archived";

  const setEventStatusMutation = useMutation({
    mutationFn: async (status: "active" | "closed") => {
      const { data } = await api.patch(`/events/${id}`, { status });
      return data;
    },
    onSuccess: (_data, status) => {
      setShowCloseEvent(false);
      setShowReopenEvent(false);
      setUiNotice(
        status === "closed"
          ? "Acreditación cerrada. Las personas ya no pueden ser acreditadas."
          : "Acreditación reabierta. Ya se puede volver a acreditar."
      );
      void queryClient.invalidateQueries({ queryKey: ["event", id] });
      void queryClient.invalidateQueries({ queryKey: ["events"] });
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
            <p className="lead">
              {eventQuery.data?.description ?? "Sin descripción"}
              {isVecinosEvent ? (
                <span className="status-pill status-pill--active" style={{ marginLeft: "0.75rem", verticalAlign: "middle" }}>
                  Evento Vecinos
                </span>
              ) : (
                <span className="status-pill" style={{ marginLeft: "0.75rem", verticalAlign: "middle" }}>
                  Evento GCBA
                </span>
              )}
            </p>
            {isAccreditationClosed ? (
              <p
                className="message-warning"
                style={{ marginTop: "0.75rem", marginBottom: 0, fontWeight: 700 }}
              >
                Acreditación cerrada — no se pueden registrar nuevas acreditaciones. Se puede consultar y exportar.
              </p>
            ) : null}
            {canManageEvent ? (
              <div className="row gap event-detail-header__manage" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
                <Link to={editEventPath} className="btn btn-secondary">
                  <Icon name="edit" />
                  Editar evento
                </Link>
                {isAccreditationClosed ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowReopenEvent(true)}
                    disabled={setEventStatusMutation.isPending}
                  >
                    <Icon name="lock_open" />
                    Reabrir acreditación
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ color: "var(--error)" }}
                    onClick={() => setShowCloseEvent(true)}
                    disabled={setEventStatusMutation.isPending}
                  >
                    <Icon name="lock" />
                    CERRAR ACREDITACIÓN
                  </button>
                )}
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
        <section className="search-card accred-search-row">
          <section className="terminal-section card accred-search-card accred-search-card--main">
            <label className="label-md field-label search-label" htmlFor="live-cuil-search">
              Buscar en base
            </label>
            <div className="search-cuil-form__input-wrap search-input-wrap">
              <input
                id="live-cuil-search"
                autoFocus
                autoComplete="off"
                className="input cuil-mega search-input"
                placeholder={isVecinosEvent ? "DNI / Apellido" : "CUIL / DNI / Apellido"}
                value={liveSearchInput}
                onChange={(e) => {
                  setUiNotice(null);
                  setSearchedOnce(false);
                  setLiveSearchInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    clearLiveSearch();
                    return;
                  }
                  if (e.key !== "Enter") return;
                  if (isAccreditationClosed) return;
                  if (debouncedSearch.length < 2) return;
                  if (livePeopleQuery.isLoading || exactCuilQuery.isLoading) return;

                  if (
                    directoryManualPayload &&
                    displayRows.length === 0 &&
                    !manualFromDirectoryMutation.isPending
                  ) {
                    e.preventDefault();
                    if (mesasRequired && !accreditMesa) return;
                    manualFromDirectoryMutation.mutate({
                      ...directoryManualPayload,
                      mesa: mesasRequired ? Number(accreditMesa) : undefined
                    });
                    return;
                  }

                  if (displayRows.length === 1) {
                    e.preventDefault();
                    const only = displayRows[0] as EventPerson;
                    setSelected(only);
                    setSearchedOnce(true);
                    setLastSearchedCuil(only.person.cuilNormalized);
                    if (only.status === "pending" && !accreditMutation.isPending) {
                      // Mismo flujo que el click en el botón rojo: confirmación + acreditación.
                      setShowConfirm(true);
                    }
                  }
                }}
              />
              {liveSearchInput.length > 0 ? (
                <button
                  type="button"
                  className="search-cuil-form__clear"
                  aria-label="Borrar búsqueda"
                  title="Borrar búsqueda (Esc)"
                  onClick={() => {
                    clearLiveSearch();
                    const input = document.getElementById("live-cuil-search") as HTMLInputElement | null;
                    input?.focus();
                  }}
                >
                  <Icon name="close" style={{ fontSize: "1.75rem" }} />
                </button>
              ) : null}
              <div className="search-cuil-form__icon">
                <Icon name="search" style={{ fontSize: "2rem", color: "var(--secondary-container)" }} />
              </div>
            </div>
            <p className="search-cuil-form__hint search-help">
              Buscá una persona de la base y tocá Enter para acreditarla (o usá el botón rojo).
            </p>
          </section>
          {isVecinosEvent ? (
            <VecinoMesasPanel
              eventId={id}
              mesaCount={eventQuery.data?.mesaCount}
              canConfigure={canConfigureVecinosOps}
              compact
              placement="toolbar"
            />
          ) : null}
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
            ) : livePeopleQuery.isError || exactCuilQuery.isError ? (
              <p className="message-error">No se pudo consultar la base en este momento. Reintentá.</p>
            ) : directoryMatch && displayRows.length === 0 ? (
              <div>
                <p className="label-md field-label">
                  Resultados (directorio {isVecinosEvent ? "vecinos" : "GCBA"})
                </p>
                <p className="message-warning" style={{ marginTop: "0.5rem" }}>
                  Encontrado en el directorio {isVecinosEvent ? "de vecinos" : "GCBA"}, no en la base de este evento.
                  Ver detalle a la derecha.
                </p>
              </div>
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
                      {isVecinosEvent ? (
                        <>
                          <p className="live-result-card__meta">DNI {row.person.dni ?? "—"}</p>
                          <p className="live-result-card__meta">{row.person.comuna ?? "Sin comuna"}</p>
                      {row.status === "accredited" ? (
                        <p className="live-result-card__meta">Mesa {vecinoMesaFromExtra(row.extraData)}</p>
                      ) : null}
                        </>
                      ) : (
                        <>
                          <p className="live-result-card__meta">{row.person.cuilNormalized}</p>
                          <p className="live-result-card__meta">{row.person.company ?? "Sin ministerio"}</p>
                          <p className="live-result-card__meta">{row.person.position ?? "Sin rol"}</p>
                        </>
                      )}
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
            !exactCuilQuery.isError &&
            debouncedSearch.length >= 2 &&
            displayRows.length === 0 &&
            !directoryMatch ? (
              <div style={{ marginTop: "1rem" }}>
                <p className="message-warning">No hay coincidencias en la base para esta búsqueda.</p>
                {isAccreditationClosed ? (
                  <p className="message-warning" style={{ marginTop: "0.5rem" }}>
                    La acreditación de este evento está cerrada.
                  </p>
                ) : (
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
                )}
              </div>
            ) : null}
          </div>
          <div className="card panel detail-panel accred-console__right">
            {directoryMatch && !selected ? (
              <div className="accred-detail">
                <div
                  className="message-warning"
                  style={{ background: "var(--warning-container)", padding: "0.75rem", borderRadius: 8, marginBottom: "1rem" }}
                >
                  <strong>ESTE USUARIO ES FUERA DE BASE DE ANOTADOS</strong>
                  <p style={{ margin: "0.35rem 0 0" }}>
                    {directoryMatch.directoryKind === "vecinos"
                      ? "Está en el directorio de vecinos pero no fue cargado en la base de este evento."
                      : "Está en el directorio GCBA pero no fue cargado en la base de este evento."}
                  </p>
                </div>
                <div className="accred-detail__head">
                  <h3 className="accred-detail__name">
                    {`${directoryMatch.directoryPerson.lastName}, ${directoryMatch.directoryPerson.firstName}`}
                  </h3>
                  <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS", "ACREDITADOR"]}>
                    {isAccreditationClosed ? (
                      <span className="status-pill" style={{ background: "var(--warning-container)" }}>
                        Acreditación cerrada
                      </span>
                    ) : (
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={
                          manualFromDirectoryMutation.isPending ||
                          !directoryManualPayload ||
                          (mesasRequired && !accreditMesa)
                        }
                        onClick={() =>
                          directoryManualPayload &&
                          manualFromDirectoryMutation.mutate({
                            ...directoryManualPayload,
                            mesa: mesasRequired ? Number(accreditMesa) : undefined
                          })
                        }
                      >
                        <Icon name="verified" />
                        {manualFromDirectoryMutation.isPending ? "Procesando…" : "Acreditar fuera de base"}
                      </button>
                    )}
                  </RoleGuard>
                </div>
                {mesasRequired ? (
                  <MesaSelect
                    id="directory-accredit-mesa"
                    mesaCount={mesaCount}
                    value={accreditMesa}
                    onChange={setAccreditMesa}
                    mesaStats={mesaStatsRows}
                  />
                ) : null}
                <div className="accred-detail__rows">
                  {directoryMatch.directoryKind === "vecinos" ? (
                    <>
                      <p><strong>DNI</strong> {(directoryMatch.directoryPerson as VecinoDirectoryPersonDto).dni}</p>
                      <p><strong>Domicilio</strong> {(directoryMatch.directoryPerson as VecinoDirectoryPersonDto).address ?? "—"}</p>
                      <p><strong>Comuna</strong> {(directoryMatch.directoryPerson as VecinoDirectoryPersonDto).comuna ?? "—"}</p>
                      <p><strong>Teléfono</strong> {(directoryMatch.directoryPerson as VecinoDirectoryPersonDto).phone ?? "—"}</p>
                      <p><strong>Email</strong> {(directoryMatch.directoryPerson as VecinoDirectoryPersonDto).email ?? "—"}</p>
                    </>
                  ) : (
                    <>
                      <p><strong>CUIL</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).cuilNormalized}</p>
                      <p><strong>DNI</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).dni ?? "—"}</p>
                      <p><strong>Ministerio</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).ministerio ?? "—"}</p>
                      <p><strong>Puesto</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).litPuesto ?? "—"}</p>
                      <p><strong>Rep.</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).descRep ?? "—"}</p>
                      <p><strong>Email</strong> {(directoryMatch.directoryPerson as DirectoryPersonDto).email ?? "—"}</p>
                    </>
                  )}
                </div>
                {manualFromDirectoryMutation.isError ? (
                  <p className="message-error">No se pudo acreditar desde el directorio. Reintentá.</p>
                ) : null}
              </div>
            ) : selected ? (
              <div className="accred-detail">
                <div className="accred-detail__head">
                  <h3 className="accred-detail__name">{`${selected.person.lastName}, ${selected.person.firstName}`}</h3>
                  {selected?.status === "pending" ? (
                    isAccreditationClosed ? (
                      <span className="status-pill" style={{ background: "var(--warning-container)" }}>
                        Acreditación cerrada
                      </span>
                    ) : (
                      <button className="btn btn-danger" onClick={() => setShowConfirm(true)} type="button">
                        <Icon name="verified" />
                        Acreditar
                      </button>
                    )
                  ) : (
                    <span className="status-pill status-pill--active">Acreditado</span>
                  )}
                </div>
                <div className="accred-detail__rows">
                  {isVecinosEvent ? (
                    <>
                      <p>
                        <strong>DNI</strong> {displayOrDash(selected.person.dni)}
                      </p>
                      <p>
                        <strong>Dirección</strong>{" "}
                        {displayOrDash(selected.person.address ?? selected.extraData?.direccion)}
                      </p>
                      <p>
                        <strong>Comuna</strong> {displayOrDash(selected.person.comuna)}
                      </p>
                      <p>
                        <strong>Teléfono</strong> {displayOrDash(selected.person.phone)}
                      </p>
                      <p>
                        <strong>Mesa</strong> {vecinoMesaFromExtra(selected.extraData)}
                      </p>
                      <p>
                        <strong>Presente</strong> {vecinoPresenteFromExtra(selected.extraData)}
                      </p>
                      <p>
                        <strong>Origen</strong> {selected.source === "manual" ? "Fuera de base" : "Base importada"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>CUIL</strong> {selected.person.cuilNormalized}
                      </p>
                      <p>
                        <strong>DNI</strong> {selected.person.dni ?? "—"}
                      </p>
                      <p>
                        <strong>Ministerio</strong> {selected.person.company ?? "—"}
                      </p>
                      <p>
                        <strong>Rol</strong> {selected.person.position ?? "—"}
                      </p>
                      <p>
                        <strong>Origen</strong> {selected.source === "manual" ? "Fuera de base" : "Base importada"}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--on-surface-variant)", fontWeight: 600 }}>
                {debouncedSearch.length >= 2 && displayRows.length > 0 && !searchedOnce
                  ? "Seleccioná una persona desde la lista para ver su detalle."
                  : directoryMatch
                    ? "Persona del directorio GCBA — usá el botón para acreditar fuera de base."
                    : "Escribí y seleccioná una persona para ver su detalle."}
              </p>
            )}
            {accreditMutation.isError ? <p className="message-error">No se pudo acreditar. Reintentá en unos segundos.</p> : null}
          </div>
          <ConfirmDialog
            open={showConfirm}
            title="Confirmar acreditación"
            message={
              selected
                ? `¿Seguro que querés acreditar a ${selected.person.lastName}, ${selected.person.firstName}?`
                : "Esta acción acredita a la persona en el evento."
            }
            confirmLabel={accreditMutation.isPending ? "Acreditando…" : "Acreditar"}
            confirmDisabled={
              accreditMutation.isPending ||
              (mesasRequired &&
                (!accreditMesa || Number(accreditMesa) < 1 || Number(accreditMesa) > mesaCount))
            }
            onCancel={() => {
              setShowConfirm(false);
              setAccreditMesa("");
            }}
            onConfirm={() => {
              if (accreditMutation.isPending) return;
              if (mesasRequired && !accreditMesa) return;
              accreditMutation.mutate(mesasRequired ? Number(accreditMesa) : undefined);
            }}
          >
            {mesasRequired ? (
              <MesaSelect
                id="accredit-mesa"
                mesaCount={mesaCount}
                value={accreditMesa}
                onChange={setAccreditMesa}
                mesaStats={mesaStatsRows}
                showCountsSummary
              />
            ) : null}
          </ConfirmDialog>
          {showFueraDeBaseModal ? (
            <div className="modal-backdrop">
              <div className="modal card" style={{ width: "min(720px, 95vw)" }}>
                <h3 style={{ marginTop: 0 }}>Acreditar fuera de base</h3>
                <p style={{ color: "var(--on-surface-variant)" }}>
                  Registrá la persona manualmente y se acredita en este evento.
                </p>
                {mesasRequired ? (
                  <MesaSelect
                    id="fuera-base-mesa"
                    mesaCount={mesaCount}
                    value={accreditMesa}
                    onChange={setAccreditMesa}
                    mesaStats={mesaStatsRows}
                  />
                ) : null}
                <ManualPersonForm
                  initialCuilRaw={lastSearchedCuil}
                  submitLabel={manualAndAccreditMutation.isPending ? "Procesando..." : "Registrar y acreditar"}
                  onSubmit={(values) =>
                    manualAndAccreditMutation.mutate({
                      values: values as unknown as Record<string, unknown>,
                      mesa: mesasRequired ? Number(accreditMesa) : undefined
                    })
                  }
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
                      <Icon name="undo" />
                      Deshacer todas las acreditaciones
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
              { key: "cuil", header: documentColumnLabel(eventKind), render: (row) => displayPersonDocument(row.person, eventKind) },
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
                              label: `${row.person.lastName}, ${row.person.firstName} (${displayPersonDocument(row.person, eventKind)})`
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await downloadEventTwoSheetsXlsx(id);
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="table_view" />
                Exportar XLSX (2 hojas)
              </button>
              {canManageEvent ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: "var(--error)" }}
                  onClick={() => setBulkDeleteScope("accredited_imported")}
                >
                  <Icon name="undo" />
                  Deshacer acreditaciones de esta lista
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
                { key: "cuil", header: documentColumnLabel(eventKind), render: (row) => displayPersonDocument(row.person, eventKind) },
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
                },
                {
                  key: "acciones",
                  header: "",
                  render: (row) => (
                    <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS", "ACREDITADOR"]}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.35rem 0.65rem" }}
                        title="Deshacer acreditación"
                        onClick={() =>
                          setUnaccreditPersonTarget({
                            id: row.id,
                            label: `${row.person.lastName}, ${row.person.firstName} (${displayPersonDocument(row.person, eventKind)})`
                          })
                        }
                      >
                        <Icon name="undo" />
                      </button>
                    </RoleGuard>
                  )
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
                { key: "cuil", header: documentColumnLabel(eventKind), render: (row) => displayPersonDocument(row.person, eventKind) },
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
                },
                {
                  key: "acciones",
                  header: "",
                  render: (row) => (
                    <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS", "ACREDITADOR"]}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.35rem 0.65rem" }}
                        title="Deshacer acreditación"
                        onClick={() =>
                          setUnaccreditPersonTarget({
                            id: row.id,
                            label: `${row.person.lastName}, ${row.person.firstName} (${displayPersonDocument(row.person, eventKind)})`
                          })
                        }
                      >
                        <Icon name="undo" />
                      </button>
                    </RoleGuard>
                  )
                }
              ]}
            />
          )}
        </div>
      ) : null}

      {tab === "Descargas" ? (
        <div className="downloads-panel">
          <div className="card">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 className="display-sm" style={{ fontSize: "1.35rem", margin: "0 0 0.35rem" }}>
                  Panel de descargas
                </h3>
                <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.9375rem", maxWidth: "60ch" }}>
                  {isVecinosEvent
                    ? "Exportá personas separadas por comuna o por mesa. Cada archivo trae una hoja por grupo más una hoja Resumen con los totales."
                    : "Exportá personas separadas por ministerio o por ROL. Cada archivo trae una hoja por grupo más una hoja Resumen con los totales."}
                </p>
              </div>
              <div className="seg-control" role="group" aria-label="Alcance de la descarga">
                <button
                  type="button"
                  className={`seg-control__btn ${downloadScope === "accredited" ? "active" : ""}`}
                  onClick={() => setDownloadScope("accredited")}
                >
                  Solo acreditados
                </button>
                <button
                  type="button"
                  className={`seg-control__btn ${downloadScope === "all" ? "active" : ""}`}
                  onClick={() => setDownloadScope("all")}
                >
                  Todas las personas
                </button>
              </div>
            </div>
          </div>

          <div className="downloads-grid">
            {(isVecinosEvent
              ? [
                  { by: "comuna" as const, title: "Por comuna", icon: "location_city", query: comunaBreakdownQuery },
                  { by: "mesa" as const, title: "Por mesa", icon: "table_restaurant", query: mesaBreakdownQuery }
                ]
              : [
                  { by: "ministerio" as const, title: "Por ministerio", icon: "apartment", query: ministerioBreakdownQuery },
                  { by: "rol" as const, title: "Por ROL", icon: "badge", query: rolBreakdownQuery }
                ]
            ).map(({ by, title, icon, query }) => {
              const groups = query.data?.groups ?? [];
              const topGroups = groups.slice(0, 8);
              const busyKey = `${by}-${downloadScope}`;
              return (
                <div key={by} className="card download-card">
                  <div className="row gap" style={{ alignItems: "center", marginBottom: "0.5rem" }}>
                    <Icon name={icon} />
                    <h4 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h4>
                  </div>
                  <p style={{ margin: "0 0 0.75rem", color: "var(--on-surface-variant)", fontSize: "0.875rem" }}>
                    {query.isLoading
                      ? "Calculando grupos…"
                      : `${groups.length} grupo(s) · ${query.data?.total ?? 0} persona(s)`}
                  </p>
                  {topGroups.length > 0 ? (
                    <ul className="download-breakdown">
                      {topGroups.map((g) => (
                        <li key={g.key}>
                          <span className="download-breakdown__name" title={g.key}>{g.key}</span>
                          <span className="download-breakdown__count">{g.count}</span>
                        </li>
                      ))}
                      {groups.length > topGroups.length ? (
                        <li className="download-breakdown__more">
                          + {groups.length - topGroups.length} grupo(s) más en el archivo
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p style={{ color: "var(--on-surface-variant)", fontSize: "0.875rem" }}>
                      {query.isLoading ? "" : "Sin datos para este alcance."}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: "0.75rem" }}
                    disabled={downloadBusy === busyKey || groups.length === 0}
                    onClick={async () => {
                      setDownloadBusy(busyKey);
                      try {
                        await downloadGroupedXlsx(id, by, downloadScope);
                      } catch {
                        alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                      } finally {
                        setDownloadBusy(null);
                      }
                    }}
                  >
                    <Icon name="download" />
                    {downloadBusy === busyKey ? "Generando…" : "Descargar XLSX"}
                  </button>
                </div>
              );
            })}

            <div className="card download-card download-card--muted">
              <div className="row gap" style={{ alignItems: "center", marginBottom: "0.5rem" }}>
                <Icon name="cake" />
                <h4 style={{ margin: 0, fontSize: "1.1rem" }}>Por rango etario</h4>
              </div>
              <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.875rem" }}>
                Todavía no disponible: hoy no guardamos fecha de nacimiento ni edad de las personas, así que no se
                puede agrupar por rango etario. Si la planilla de importación incluye una columna de fecha de
                nacimiento, podemos sumarlo.
              </p>
            </div>
          </div>

          <div className="card">
            <h4 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>Otras exportaciones</h4>
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
                Acreditados (todos)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await downloadEventTwoSheetsXlsx(id);
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="table_view" />
                Acreditados + fuera de base (2 hojas)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await downloadPeopleBaseXlsx(id, { importedOnly: true });
                  } catch {
                    alert("No se pudo descargar. Reintentá o revisá tu sesión.");
                  }
                }}
              >
                <Icon name="download" />
                Base importada
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "Importar XLSX" ? (
        <RoleGuard roles={["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS"]} fallback={<p className="message-warning">Sin permisos para importar.</p>}>
          <ImportWizard eventId={id} eventKind={eventKind} />
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
                  Cantidad de acreditaciones cada 15 minutos · horario Argentina.
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
        <RoleGuard roles={["SUPERADMIN", "ADMIN_VECINOS"]} fallback={<p className="message-warning">Sin permisos para configurar accesos al evento.</p>}>
          <EventAccessConfig eventId={id} />
        </RoleGuard>
      ) : null}

      <ConfirmTypeDialog
        open={showDeleteEvent}
        title="Eliminar evento"
        message={`Vas a eliminar el evento "${eventQuery.data?.name ?? ""}". Se borrarán personas del evento, importaciones e informes. No se puede deshacer.`}
        requiredText={eventQuery.data?.name ?? ""}
        requiredTextLabel={eventQuery.data?.name ?? ""}
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
        open={Boolean(unaccreditPersonTarget)}
        title="Deshacer acreditación"
        message={`¿Revertir la acreditación de ${unaccreditPersonTarget?.label ?? "esta persona"}? Volverá a estado pendiente y seguirá en la nómina del evento.`}
        onCancel={() => setUnaccreditPersonTarget(null)}
        onConfirm={() =>
          unaccreditPersonTarget && unaccreditPersonMutation.mutate(unaccreditPersonTarget.id)
        }
        confirmLabel={unaccreditPersonMutation.isPending ? "Procesando…" : "Deshacer acreditación"}
        danger
      />
      <ConfirmTypeDialog
        open={bulkDeleteScope === "all"}
        title="Vaciar toda la base del evento"
        message={`Vas a vaciar TODA la base del evento "${eventQuery.data?.name ?? ""}". Se eliminarán pendientes y acreditadas, importadas y manuales. No se puede deshacer.`}
        requiredText={eventQuery.data?.name ?? ""}
        requiredTextLabel={eventQuery.data?.name ?? ""}
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("all")}
        confirmLabel="Vaciar toda la base"
        danger
      />
      <ConfirmTypeDialog
        open={bulkDeleteScope === "accredited"}
        title="Deshacer todas las acreditaciones"
        message={`Vas a revertir TODAS las acreditaciones del evento "${eventQuery.data?.name ?? ""}" (importadas y fuera de base). Las personas volverán a pendiente y permanecerán en la nómina.`}
        requiredText={eventQuery.data?.name ?? ""}
        requiredTextLabel={eventQuery.data?.name ?? ""}
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("accredited")}
        confirmLabel="Deshacer acreditaciones"
        danger
      />
      <ConfirmTypeDialog
        open={bulkDeleteScope === "accredited_imported"}
        title="Deshacer acreditaciones de esta lista"
        message={`Vas a revertir las acreditaciones de quienes venían de la planilla importada en "${eventQuery.data?.name ?? ""}". Volverán a pendiente y seguirán en Personas.`}
        requiredText={eventQuery.data?.name ?? ""}
        requiredTextLabel={eventQuery.data?.name ?? ""}
        onCancel={() => setBulkDeleteScope(null)}
        onConfirm={() => bulkDeletePeopleMutation.mutate("accredited_imported")}
        confirmLabel="Deshacer acreditaciones"
        danger
      />
      <ConfirmTypeDialog
        open={showCloseEvent}
        title="Cerrar acreditación del evento"
        message={`Una vez cerrada la acreditación, no se podrán registrar nuevas acreditaciones para "${eventQuery.data?.name ?? ""}". Sí se podrá consultar y exportar. Podés reabrirla más tarde.`}
        requiredText={eventQuery.data?.name ?? ""}
        requiredTextLabel={eventQuery.data?.name ?? ""}
        onCancel={() => setShowCloseEvent(false)}
        onConfirm={() => setEventStatusMutation.mutate("closed")}
        confirmLabel="CERRAR ACREDITACIÓN"
        danger
      />
      <ConfirmDialog
        open={showReopenEvent}
        title="Reabrir acreditación"
        message="Se vuelve a permitir acreditar personas en este evento."
        onCancel={() => setShowReopenEvent(false)}
        onConfirm={() => setEventStatusMutation.mutate("active")}
        confirmLabel="Reabrir"
      />
    </section>
  );
}
