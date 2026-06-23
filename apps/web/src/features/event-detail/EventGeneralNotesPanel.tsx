import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

import { AccreditedPeopleList } from "./AccreditedPeopleList";
import { filterAccreditedRows, speakerLabel, useAccreditedForNotes } from "./notes-shared";

type Props = {
  eventId: string;
  eventKind: "gcba" | "vecinos";
};

function insertSpeakerLine(
  textarea: HTMLTextAreaElement,
  current: string,
  label: string
): string {
  const prefix = `${label}: `;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const needsNewline = before.length > 0 && !before.endsWith("\n");
  const insertion = `${needsNewline ? "\n" : ""}${prefix}`;
  const next = before + insertion + after;
  const cursor = before.length + insertion.length;
  requestAnimationFrame(() => {
    textarea.setSelectionRange(cursor, cursor);
    textarea.focus();
  });
  return next;
}

export function EventGeneralNotesPanel({ eventId, eventKind }: Props) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { peopleQuery, rows, search, setSearch } = useAccreditedForNotes(eventId);
  const filtered = filterAccreditedRows(rows, search, eventKind);

  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () =>
      (await api.get<{ meetingMinutes?: string | null }>(`/events/${eventId}`)).data
  });

  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [eventId]);

  useEffect(() => {
    if (!eventQuery.data || loaded) return;
    setDraft(eventQuery.data.meetingMinutes ?? "");
    setLoaded(true);
  }, [eventQuery.data, loaded]);

  const saveMutation = useMutation({
    mutationFn: async (meetingMinutes: string | null) => {
      const { data } = await api.patch<{ meetingMinutes: string | null }>(
        `/events/${eventId}/meeting-minutes`,
        { meetingMinutes }
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    }
  });

  function handleDoubleClickPerson(row: (typeof rows)[number]) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setDraft((current) => insertSpeakerLine(textarea, current, speakerLabel(row.person)));
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
        onDoubleClick={handleDoubleClickPerson}
        listHint="Doble clic en una persona para insertar su nombre en el acta (ej. Juan Carlos:)."
      />

      <div className="card panel notes-layout__editor notes-layout__editor--minutes">
        <div className="notes-editor__head">
          <h3 className="display-sm" style={{ margin: 0, fontSize: "1.15rem" }}>
            Acta del encuentro
          </h3>
          <p className="notes-editor__doc">
            Escribí el desarrollo minuto a minuto. Usá el listado para marcar quién habla.
          </p>
        </div>
        <label className="label-md field-label" htmlFor="meeting-minutes">
          Minuta
        </label>
        <textarea
          id="meeting-minutes"
          ref={textareaRef}
          className="input input--boxed notes-minutes-textarea"
          placeholder={
            "Ej.\nHoy en el día de la fecha se lleva a cabo la reunión de vecinos de Lomas del Pepe.\nJuan Carlos: ..."
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row gap" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveMutation.isPending || eventQuery.isLoading}
            onClick={() => saveMutation.mutate(draft.trim() || null)}
          >
            <Icon name="save" />
            {saveMutation.isPending ? "Guardando…" : "Guardar acta"}
          </button>
          {saveMutation.isSuccess ? (
            <span className="message-success" style={{ alignSelf: "center" }}>
              Acta guardada.
            </span>
          ) : null}
          {saveMutation.isError ? (
            <span className="message-error" style={{ alignSelf: "center" }}>
              No se pudo guardar.
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
