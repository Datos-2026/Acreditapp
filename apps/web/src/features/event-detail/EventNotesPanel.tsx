import { useState } from "react";

import { EventGeneralNotesPanel } from "./EventGeneralNotesPanel";
import { EventPersonNotesPanel } from "./EventPersonNotesPanel";

type NotesMode = "general" | "person";

type Props = {
  eventId: string;
  eventKind: "gcba" | "vecinos";
};

export function EventNotesPanel({ eventId, eventKind }: Props) {
  const [mode, setMode] = useState<NotesMode>("general");

  return (
    <div className="notes-panel-root">
      <div className="notes-mode-tabs" role="tablist" aria-label="Tipo de notas">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "general"}
          className={`notes-mode-tabs__btn${mode === "general" ? " notes-mode-tabs__btn--active" : ""}`}
          onClick={() => setMode("general")}
        >
          Notas generales
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "person"}
          className={`notes-mode-tabs__btn${mode === "person" ? " notes-mode-tabs__btn--active" : ""}`}
          onClick={() => setMode("person")}
        >
          Notas por persona
        </button>
      </div>

      {mode === "general" ? (
        <EventGeneralNotesPanel eventId={eventId} eventKind={eventKind} />
      ) : (
        <EventPersonNotesPanel eventId={eventId} eventKind={eventKind} />
      )}
    </div>
  );
}
