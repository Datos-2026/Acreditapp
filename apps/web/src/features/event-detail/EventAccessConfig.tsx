import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole } from "@gcba/shared";
import { api } from "../../lib/api";

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN_EVENTO: "Admin de evento",
  ACREDITADOR: "Acreditador",
  LECTURA: "Solo lectura",
  INFORMADOR: "Informador (solo informes)"
};

const ROLES_FOR_NEW_USER: AppRole[] = ["ACREDITADOR", "ADMIN_EVENTO", "LECTURA", "INFORMADOR"];

type EventUserRow = {
  userId: string;
  user: { id: string; name: string; email: string; role: string; isActive: boolean };
};

type EventWithAssignments = {
  id: string;
  name: string;
  eventUsers?: EventUserRow[];
};

type UserListRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

type Props = { eventId: string };

export function EventAccessConfig({ eventId }: Props) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [assignFeedback, setAssignFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("ACREDITADOR");

  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => (await api.get<EventWithAssignments>(`/events/${eventId}`)).data
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserListRow[]>("/users")).data
  });

  const assignableUsers = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.role !== "SUPERADMIN").sort((a, b) => a.name.localeCompare(b.name)),
    [usersQuery.data]
  );

  const serverKey = useMemo(
    () => (eventQuery.data?.eventUsers ?? []).map((e) => e.userId).sort().join(","),
    [eventQuery.data?.eventUsers]
  );

  useEffect(() => {
    setSelectedIds(new Set((eventQuery.data?.eventUsers ?? []).map((eu) => eu.userId)));
  }, [eventId, serverKey]);

  const assignMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      await api.post(`/events/${eventId}/users`, { userIds });
    },
    onSuccess: () => {
      setAssignFeedback({ kind: "ok", text: "Accesos actualizados." });
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
    onError: (err: unknown) => {
      const r =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response
          : undefined;
      setAssignFeedback({ kind: "err", text: r?.data?.message ?? "No se pudo guardar. Reintentá." });
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<UserListRow>(`/events/${eventId}/users/create-and-assign`, {
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        role: newRole
      });
      return data;
    },
    onSuccess: (created) => {
      setCreateNotice(`Listo: ${created.email} ya puede ingresar a este evento con su contraseña.`);
      setCreateError(null);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("ACREDITADOR");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
    onError: (err: unknown) => {
      setCreateNotice(null);
      const ax = err as { response?: { data?: { message?: string; error?: string } } };
      const m = ax.response?.data?.message ?? ax.response?.data?.error ?? "No se pudo crear el usuario.";
      setCreateError(m);
    }
  });

  function toggle(id: string) {
    setAssignFeedback(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="event-access-config" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <p style={{ margin: 0, fontSize: "0.95rem", color: "var(--on-surface-variant)" }}>
        <strong>Usuarios de la plataforma</strong> (cuentas y roles) se gestionan en{" "}
        <Link to="/admin/usuarios" style={{ color: "var(--primary)" }}>
          Usuarios
        </Link>
        . Acá solo definís <strong>quién tiene acceso a este evento</strong> entre los que ya existen, o das de alta a
        alguien y lo dejás operando en este evento con el bloque de abajo.
      </p>

      <section className="card">
        <h3 className="display-sm" style={{ fontSize: "1.25rem", marginTop: 0 }}>
          Equipo con acceso a este evento
        </h3>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.35rem" }}>
          Marcá o desmarcá personas y guardá. El superadmin siempre puede entrar al evento aunque no esté en la lista.
        </p>

        {eventQuery.isLoading ? (
          <p className="page-state" style={{ padding: "1rem 0" }}>
            Cargando…
          </p>
        ) : eventQuery.isError ? (
          <p className="message-error">No se pudo cargar el evento.</p>
        ) : (
          <>
            <p className="label-md field-label" style={{ marginTop: "1rem" }}>
              «{eventQuery.data?.name}»
            </p>
            {usersQuery.isLoading ? (
              <p className="page-state">Cargando usuarios…</p>
            ) : usersQuery.isError ? (
              <p className="message-error">No se pudo cargar la lista de usuarios.</p>
            ) : assignableUsers.length === 0 ? (
              <p className="message-warning">No hay usuarios asignables. Creá uno abajo.</p>
            ) : (
              <ul
                className="event-access-config__list"
                style={{
                  listStyle: "none",
                  margin: "0.5rem 0 0",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  maxHeight: "min(360px, 50vh)",
                  overflowY: "auto"
                }}
              >
                {assignableUsers.map((u) => (
                  <li key={u.id}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.65rem",
                        cursor: u.isActive ? "pointer" : "not-allowed",
                        opacity: u.isActive ? 1 : 0.55
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        disabled={!u.isActive}
                        onChange={() => u.isActive && toggle(u.id)}
                      />
                      <span>
                        <strong>{u.name}</strong>
                        <span style={{ color: "var(--on-surface-variant)", fontSize: "0.9rem" }}> · {u.email}</span>
                        <span
                          className="status-pill status-pill--draft"
                          style={{ marginLeft: "0.35rem", fontSize: "0.75rem", verticalAlign: "middle" }}
                        >
                          {ROLE_LABEL[u.role] ?? u.role}
                        </span>
                        {!u.isActive ? (
                          <span style={{ color: "var(--error)", fontSize: "0.85rem", marginLeft: "0.35rem" }}>
                            (inactivo)
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {assignFeedback ? (
              <p
                className={assignFeedback.kind === "err" ? "message-error" : "message-success"}
                style={{ marginTop: "0.75rem" }}
              >
                {assignFeedback.text}
              </p>
            ) : null}

            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: "1rem" }}
              disabled={assignMutation.isPending || usersQuery.isLoading}
              onClick={() => {
                setAssignFeedback(null);
                assignMutation.mutate(Array.from(selectedIds));
              }}
            >
              {assignMutation.isPending ? "Guardando…" : "Guardar accesos al evento"}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="display-sm" style={{ fontSize: "1.15rem", marginTop: 0 }}>
          Alta rápida para este evento
        </h3>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.35rem" }}>
          Creá la cuenta y asignala solo a <strong>este</strong> evento en un paso (ideal para operadores del día). Para
          una cuenta que aún no va a un evento, usá{" "}
          <Link to="/admin/usuarios" style={{ color: "var(--primary)" }}>
            Usuarios
          </Link>
          .
        </p>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem", maxWidth: "420px" }}>
          <div>
            <label className="label-md field-label" htmlFor="ea-name">
              Nombre
            </label>
            <input id="ea-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label className="label-md field-label" htmlFor="ea-email">
              Email (usuario)
            </label>
            <input
              id="ea-email"
              className="input"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label-md field-label" htmlFor="ea-pass">
              Contraseña inicial
            </label>
            <input
              id="ea-pass"
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <p style={{ fontSize: "0.8rem", color: "var(--on-surface-variant)", margin: "0.25rem 0 0" }}>
              Mínimo 8 caracteres.
            </p>
          </div>
          <div>
            <label className="label-md field-label" htmlFor="ea-role">
              Rol
            </label>
            <select id="ea-role" className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as AppRole)}>
              {ROLES_FOR_NEW_USER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {createNotice ? <p className="message-success" style={{ marginTop: "0.75rem" }}>{createNotice}</p> : null}
        {createError ? <p className="message-error" style={{ marginTop: "0.75rem" }}>{createError}</p> : null}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: "1rem" }}
          disabled={
            createMutation.isPending || newName.trim().length < 2 || newEmail.length < 3 || newPassword.length < 8
          }
          onClick={() => {
            setCreateNotice(null);
            setCreateError(null);
            createMutation.mutate();
          }}
        >
          {createMutation.isPending ? "Creando…" : "Crear usuario y dar acceso al evento"}
        </button>
      </section>
    </div>
  );
}
