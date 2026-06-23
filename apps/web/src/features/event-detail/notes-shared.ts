import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { EventKind } from "@gcba/shared";
import { displayPersonDocument } from "@gcba/shared";

import { api } from "../../lib/api";

export type AccreditedNoteRow = {
  id: string;
  eventNotes: string | null;
  person: {
    cuilNormalized: string;
    lastName: string;
    firstName: string;
    dni: string | null;
  };
};

export function speakerLabel(person: AccreditedNoteRow["person"]): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

export function useAccreditedForNotes(eventId: string) {
  const [search, setSearch] = useState("");

  const peopleQuery = useQuery({
    queryKey: ["people", eventId, "accredited-notes"],
    queryFn: async () =>
      (
        await api.get(`/events/${eventId}/people`, {
          params: { status: "accredited", page: 1, pageSize: 5000 }
        })
      ).data as { total: number; rows: AccreditedNoteRow[] }
  });

  const rows = peopleQuery.data?.rows ?? [];

  return { peopleQuery, rows, search, setSearch };
}

export function filterAccreditedRows(
  rows: AccreditedNoteRow[],
  search: string,
  eventKind: EventKind
): AccreditedNoteRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const name = `${row.person.lastName} ${row.person.firstName}`.toLowerCase();
    const doc = displayPersonDocument(row.person, eventKind).toLowerCase();
    return name.includes(q) || doc.includes(q);
  });
}
