import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { displayPersonDocument } from "@gcba/shared";

import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

type AccreditedRow = {
  id: string;
  eventNotes: string | null;
  person: {
    cuilNormalized: string;
    lastName: string;
    firstName: string;
    dni: string | null;
  };
};

type Props = {
  eventId: string;
  eventKind: "gcba" | "vecinos";
};

export function EventNotesPanel({ eventId, eventKind }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  const peopleQuery = useQuery({
    queryKey: ["people", eventId, "accredited-notes"],
    queryFn: async () =>
      (
        await api.get(`/events/${eventId}/people`, {
          params: { status: "accredited", page: 1, pageSize: 5000 }
        })
      ).data as { total: number; rows: AccreditedRow[] }
  });

  const rows = peopleQuery.data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = `${row.person.lastName} ${row.person.firstName}`.toLowerCase();
      const doc = displayPersonDocument(row.person, eventKind).toLowerCase();
      return name.includes(q) || doc.includes(q);
    });
  }, [rows, search, eventKind]);

  const selected = filtered.find((r) => r.id === selectedId) ?? rows.find((r) => r.id === selectedId);

  const saveMutation = useMutation({
    mutationFn: async ({ eventPersonId, eventNotes }: { eventPersonId: string; eventNotes: string | null }) => {
      const { data } = await api.patch<AccreditedRow>(`/events/${eventId}/people/${eventPersonId}/notes`, {
        eventNotes
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["people", eventId, "accredited-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["people", eventId] });
    }
  });

  function selectRow(row: AccreditedRow) {
    setSelectedId(row.id);
    setDraftNote(row.eventNotes ?? "");
  }

  return (
    <div className="workspace panels-layout two-cols notes-layout">
      <div className="card panel notes-layout__list">
        <p className="label-md field-label">Acreditados ({filtered.length})</p>
        <input
          className="input input--boxed"
          placeholder="Buscar por nombre o documento"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {peopleQuery.isLoading ? (
          <p className="page-state">Cargando acreditados…</p>
        ) : rows.length === 0 ? (
          <p className="message-warning" style={{ marginTop: "1rem" }}>
            Todavía no hay acreditados para asignar notas.
          </p>
        ) : filtered.length === 0 ? (
          <p className="message-warning" style={{ marginTop: "1rem" }}>
            No hay resultados para esa búsqueda.
          </p>
        ) : (
          <ul className="notes-person-list">
            {filtered.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`notes-person-list__item${selectedId === row.id ? " notes-person-list__item--active" : ""}`}
                  onClick={() => selectRow(row)}
                >
                  <span className="notes-person-list__name">
                    {row.person.lastName}, {row.person.firstName}
                  </span>
                  <span className="notes-person-list__meta">
                    {displayPersonDocument(row.person, eventKind)}
                    {row.eventNotes?.trim() ? (
                      <span className="notes-person-list__badge" title="Tiene nota">
                        <Icon name="sticky_note_2" style={{ fontSize: "0.95rem" }} />
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card panel notes-layout__editor">
        {!selected ? (
          <p style={{ color: "var(--on-surface-variant)", fontWeight: 600, margin: 0 }}>
            Seleccioná una persona de la lista para cargar o editar su nota.
          </p>
        ) : (
          <>
            <div className="notes-editor__head">
              <h3 className="display-sm" style={{ margin: 0, fontSize: "1.15rem" }}>
                {selected.person.lastName}, {selected.person.firstName}
              </h3>
              <p className="notes-editor__doc">{displayPersonDocument(selected.person, eventKind)}</p>
            </div>
            <label className="label-md field-label" htmlFor="event-person-note">
              Nota
            </label>
            <textarea
              id="event-person-note"
              className="input input--boxed"
              rows={8}
              placeholder="Escribí la nota para esta persona…"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
            />
            <div className="row gap" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    eventPersonId: selected.id,
                    eventNotes: draftNote.trim() || null
                  })
                }
              >
                <Icon name="save" />
                {saveMutation.isPending ? "Guardando…" : "Guardar nota"}
              </button>
              {saveMutation.isSuccess ? (
                <span className="message-success" style={{ alignSelf: "center" }}>
                  Nota guardada.
                </span>
              ) : null}
              {saveMutation.isError ? (
                <span className="message-error" style={{ alignSelf: "center" }}>
                  No se pudo guardar.
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
