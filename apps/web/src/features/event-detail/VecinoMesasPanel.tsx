import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { MesaStatsDto } from "@gcba/shared";

import { api } from "../../lib/api";

import { Icon } from "../../components/Icon";



type Props = {

  eventId: string;

  mesaCount: number | null | undefined;

  canConfigure: boolean;

  compact?: boolean;
  placement?: "footer" | "toolbar";
};



export function VecinoMesasPanel({
  eventId,
  mesaCount,
  canConfigure,
  compact = false,
  placement = "footer"
}: Props) {

  const queryClient = useQueryClient();

  const [draftCount, setDraftCount] = useState(String(mesaCount ?? 6));

  const [notice, setNotice] = useState<string | null>(null);



  const statsQuery = useQuery({

    queryKey: ["mesas", eventId],

    queryFn: async () => (await api.get<MesaStatsDto>(`/events/${eventId}/mesas/stats`)).data,

    refetchInterval: 15_000

  });



  const configMutation = useMutation({

    mutationFn: async (count: number) =>

      (await api.patch(`/events/${eventId}/mesas/config`, { mesaCount: count })).data,

    onSuccess: () => {

      setNotice("Cantidad de mesas guardada.");

      void queryClient.invalidateQueries({ queryKey: ["mesas", eventId] });

      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });

    },

    onError: () => setNotice(null)

  });



  const stats = statsQuery.data;

  const active = stats?.autoAssignEnabled && (stats.mesaCount ?? 0) > 0;

  const maxAccredited = Math.max(1, ...(stats?.mesas.map((m) => m.accredited) ?? [1]));

  const sheetError = stats?.lastSheetError?.trim();



  if (!active && !canConfigure) {

    return null;

  }



  if (compact) {

    const panelClass =
      placement === "toolbar"
        ? "mesa-panel-compact mesa-panel-compact--toolbar card"
        : "mesa-panel-compact";

    return (

      <div className={panelClass}>

        <div className="mesa-panel-compact__head">

          <span className="mesa-panel-compact__title">

            <Icon name="table_restaurant" />

            Mesas

          </span>

          <span className="mesa-panel-compact__meta">

            {active && stats ? `Acreditados: ${stats.totalAccredited}` : "Sin mesas activas"}

          </span>

        </div>



        {!active && canConfigure ? (

          <div className="mesa-panel-compact__setup">

            <input

              id="mesa-count"

              type="number"

              min={1}

              max={99}

              className="input input--boxed"

              style={{ width: 72, padding: "0.35rem 0.5rem", fontSize: "0.8125rem" }}

              value={draftCount}

              onChange={(e) => setDraftCount(e.target.value)}

              aria-label="Cantidad de mesas"

            />

            <button

              type="button"

              className="btn btn-primary"

              style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}

              disabled={configMutation.isPending}

              onClick={() => {

                const n = Number(draftCount);

                if (!Number.isFinite(n) || n < 1 || n > 99) return;

                configMutation.mutate(n);

              }}

            >

              Iniciar

            </button>

          </div>

        ) : null}



        {active && stats ? (

          <div className="mesa-panel-compact__chips">

            {stats.mesas.map((mesa) => (

              <div key={mesa.mesaNumber} className="mesa-chip" title={`${mesa.accredited} acreditados`}>

                <span className="mesa-chip__label">M{mesa.mesaNumber}</span>

                <span className="mesa-chip__count">{mesa.accredited}</span>

                <span className="mesa-chip__bar" aria-hidden>

                  <span

                    className="mesa-chip__fill"

                    style={{ width: `${Math.round((mesa.accredited / maxAccredited) * 100)}%` }}

                  />

                </span>

              </div>

            ))}

          </div>

        ) : statsQuery.isLoading ? (

          <p className="mesa-panel-compact__loading">Cargando mesas…</p>

        ) : null}



        {canConfigure && active ? (

          <details className="mesa-panel-compact__config">

            <summary>Cambiar cantidad</summary>

            <div className="mesa-panel-compact__setup" style={{ marginTop: "0.5rem" }}>

              <input

                id="mesa-count-edit"

                type="number"

                min={1}

                max={99}

                className="input input--boxed"

                style={{ width: 72, padding: "0.35rem 0.5rem", fontSize: "0.8125rem" }}

                value={draftCount}

                onChange={(e) => setDraftCount(e.target.value)}

                aria-label="Cantidad de mesas"

              />

              <button

                type="button"

                className="btn btn-secondary"

                style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem" }}

                disabled={configMutation.isPending}

                onClick={() => {

                  const n = Number(draftCount);

                  if (!Number.isFinite(n) || n < 1 || n > 99) return;

                  configMutation.mutate(n);

                }}

              >

                Actualizar

              </button>

            </div>

          </details>

        ) : null}



        {sheetError ? (

          <p className="message-error" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>

            {sheetError}

          </p>

        ) : stats?.googleSheetName ? (

          <p className="mesa-panel-compact__sheet" style={{ margin: "0.35rem 0 0", fontSize: "0.7rem" }}>

            Hoja: {stats.googleSheetName}

          </p>

        ) : null}



        {notice ? (

          <p className="message-success" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>

            {notice}

          </p>

        ) : null}

        {configMutation.isError ? (

          <p className="message-error" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>

            No se pudo guardar la cantidad de mesas.

          </p>

        ) : null}

      </div>

    );

  }



  return (

    <article className="card" style={{ marginBottom: "1rem" }}>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between", alignItems: "flex-start" }}>

        <div>

          <h3 className="display-sm" style={{ fontSize: "1.1rem", margin: "0 0 0.35rem", display: "flex", alignItems: "center", gap: 8 }}>

            <Icon name="table_restaurant" />

            Mesas

          </h3>

          <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.875rem", maxWidth: "52ch" }}>

            Al acreditar, elegí la mesa manualmente para cada persona.

          </p>

        </div>

        {(sheetError || stats?.googleSheetName) ? (

          <div style={{ textAlign: "right" }}>

            {stats?.googleSheetName ? (

              <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: "var(--on-surface-variant)" }}>

                Hoja: <strong>{stats.googleSheetName}</strong>

              </p>

            ) : null}

            {sheetError ? (

              <p className="message-error" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", maxWidth: "28ch" }}>

                {sheetError}

              </p>

            ) : null}

          </div>

        ) : null}

      </div>



      {!active && canConfigure ? (

        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>

          <div>

            <label className="label-md field-label" htmlFor="mesa-count-full">

              Cantidad de mesas

            </label>

            <input

              id="mesa-count-full"

              type="number"

              min={1}

              max={99}

              className="input input--boxed"

              style={{ width: 120 }}

              value={draftCount}

              onChange={(e) => setDraftCount(e.target.value)}

            />

          </div>

          <button

            type="button"

            className="btn btn-primary"

            disabled={configMutation.isPending}

            onClick={() => {

              const n = Number(draftCount);

              if (!Number.isFinite(n) || n < 1 || n > 99) return;

              configMutation.mutate(n);

            }}

          >

            <Icon name="save" />

            {configMutation.isPending ? "Guardando…" : "Iniciar con mesas"}

          </button>

        </div>

      ) : null}



      {notice ? <p className="message-success" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{notice}</p> : null}

      {configMutation.isError ? (

        <p className="message-error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>

          No se pudo guardar la cantidad de mesas.

        </p>

      ) : null}



      {active && stats ? (

        <>

          <p style={{ margin: "1rem 0 0.5rem", fontWeight: 700, color: "var(--primary-container)" }}>

            Acreditados: {stats.totalAccredited}

            {stats.unassignedAccredited > 0 ? ` · Sin mesa: ${stats.unassignedAccredited}` : ""}

          </p>

          <div className="mesa-stats-grid">

            {stats.mesas.map((mesa) => (

              <div key={mesa.mesaNumber} className="mesa-stat-card">

                <div className="mesa-stat-card__head">

                  <strong>Mesa {mesa.mesa}</strong>

                  <span>{mesa.accredited}</span>

                </div>

                <div className="mesa-stat-card__bar" aria-hidden>

                  <div

                    className="mesa-stat-card__fill"

                    style={{ width: `${Math.round((mesa.accredited / maxAccredited) * 100)}%` }}

                  />

                </div>

              </div>

            ))}

          </div>

          {canConfigure && active ? (

            <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>

              <div>

                <label className="label-md field-label" htmlFor="mesa-count-edit-full">

                  Cambiar cantidad

                </label>

                <input

                  id="mesa-count-edit-full"

                  type="number"

                  min={1}

                  max={99}

                  className="input input--boxed"

                  style={{ width: 120 }}

                  value={draftCount}

                  onChange={(e) => setDraftCount(e.target.value)}

                />

              </div>

              <button

                type="button"

                className="btn btn-secondary"

                disabled={configMutation.isPending}

                onClick={() => {

                  const n = Number(draftCount);

                  if (!Number.isFinite(n) || n < 1 || n > 99) return;

                  configMutation.mutate(n);

                }}

              >

                Actualizar mesas

              </button>

            </div>

          ) : null}

        </>

      ) : statsQuery.isLoading ? (

        <p className="page-state" style={{ marginTop: "0.75rem" }}>

          Cargando mesas…

        </p>

      ) : null}

    </article>

  );

}


