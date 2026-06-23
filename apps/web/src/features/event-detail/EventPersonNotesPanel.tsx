import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { displayPersonDocument } from "@gcba/shared";

import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

import { AccreditedPeopleList } from "./AccreditedPeopleList";
import { type AccreditedNoteRow, filterAccreditedRows, useAccreditedForNotes } from "./notes-shared";

type Props = {
  eventId: string;
  eventKind: "gcba" | "vecinos";
};

export function EventPersonNotesPanel({ eventId, eventKind }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const { peopleQuery, rows, search, setSearch } = useAccreditedForNotes(eventId);
  const filtered = filterAccreditedRows(rows, search, eventKind);

  const selected = filtered.find((r) => r.id === selectedId) ?? rows.find((r) => r.id === selectedId);

  const saveMutation = useMutation({
    mutationFn: async ({ eventPersonId, eventNotes }: { eventPersonId: string; eventNotes: string | null }) => {
      const { data } = await api.patch<AccreditedNoteRow>(`/events/${eventId}/people/${eventPersonId}/notes`, {
        eventNotes
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["people", eventId, "accredited-notes"] });
      void queryClient.invalidateQueries({ queryKey: ["people", eventId] });
    }
  });

  function selectRow(row: AccreditedNoteRow) {
    setSelectedId(row.id);
    setDraftNote(row.eventNotes ?? "");
  }

  return (
    <div className="workspace panels-layout two-cols notes-layout">
      <AccreditedPeopleList
        eventKind={eventKind}
        filtered={filtered}
        totalRows={rows.length}
        isLoading={peopleQuery.isLoading}
        search={search}
        onSearchChange={setSearch}
        selectedId={selectedId}
        onSelect={selectRow}
        showNoteBadge
        listHint="Seleccioná una persona para ver o editar su nota individual."
      />

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
