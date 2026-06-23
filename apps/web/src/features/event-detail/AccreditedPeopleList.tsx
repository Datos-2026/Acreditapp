import { displayPersonDocument } from "@gcba/shared";

import { Icon } from "../../components/Icon";

import { type AccreditedNoteRow } from "./notes-shared";

type Props = {
  eventKind: "gcba" | "vecinos";
  filtered: AccreditedNoteRow[];
  totalRows: number;
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId?: string | null;
  onSelect?: (row: AccreditedNoteRow) => void;
  onDoubleClick?: (row: AccreditedNoteRow) => void;
  listHint?: string;
  showNoteBadge?: boolean;
};

export function AccreditedPeopleList({
  eventKind,
  filtered,
  totalRows,
  isLoading,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  onDoubleClick,
  listHint,
  showNoteBadge = false
}: Props) {
  return (
    <div className="card panel notes-layout__list">
      <p className="label-md field-label">Acreditados ({filtered.length})</p>
      <input
        className="input input--boxed"
        placeholder="Buscar por nombre o documento"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {listHint ? <p className="notes-list-hint">{listHint}</p> : null}
      {isLoading ? (
        <p className="page-state">Cargando acreditados…</p>
      ) : totalRows === 0 ? (
        <p className="message-warning" style={{ marginTop: "1rem" }}>
          Todavía no hay acreditados.
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
                onClick={() => onSelect?.(row)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  onDoubleClick?.(row);
                }}
              >
                <span className="notes-person-list__name">
                  {row.person.lastName}, {row.person.firstName}
                </span>
                <span className="notes-person-list__meta">
                  {displayPersonDocument(row.person, eventKind)}
                  {showNoteBadge && row.eventNotes?.trim() ? (
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
  );
}
