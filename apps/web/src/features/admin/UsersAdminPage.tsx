import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLE_OPTIONS, type AppRole } from "@gcba/shared";
import { api } from "../../lib/api";
import { useAuth } from "../auth/auth-context";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN_EVENTO: "Admin de evento",
  ADMIN_VECINOS: "Admin vecinos",
  ACREDITADOR: "Acreditador",
  LECTURA: "Solo lectura",
  INFORMADOR: "Informador (solo informes)"
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

function errMessage(err: unknown, fallback: string): string {
  const ax = err as { response?: { data?: { message?: string; error?: string } } };
  return ax.response?.data?.message ?? ax.response?.data?.error ?? fallback;
}

export function UsersAdminPage({ scope = "admin" }: { scope?: "admin" | "vecinos" }) {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const isVecinosScope = scope === "vecinos";
  const creatableRoles: AppRole[] = isVecinosScope
    ? ["ACREDITADOR", "LECTURA", "INFORMADOR"]
    : (ROLE_OPTIONS.filter((r) => r !== "SUPERADMIN" && r !== "ADMIN_VECINOS") as AppRole[]);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("ACREDITADOR");
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [rowPassword, setRowPassword] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserRow[]>("/users")).data
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<UserRow>("/users", {
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        role: newRole,
        isActive: true
      });
      return data;
    },
    onSuccess: (created) => {
      setCreateNotice(
        `Usuario creado: ${created.email}. No tiene acceso a ningún evento hasta que lo asignes en la configuración de cada evento.`
      );
      setCreateError(null);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("ACREDITADOR");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => {
      setCreateNotice(null);
      setCreateError(errMessage(err, "No se pudo crear el usuario."));
    }
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const { data } = await api.patch<UserRow>(`/users/${id}`, body);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/${id}`);
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => {
      setDeleteTarget(null);
      setDeleteError(errMessage(err, "No se pudo eliminar el usuario."));
    }
  });

  const passwordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await api.patch(`/users/${id}`, { password });
    },
    onSuccess: (_, { id }) => {
      setRowPassword((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    }
  });

  if (isVecinosScope) {
    if (authUser?.role !== "ADMIN_VECINOS" && authUser?.role !== "SUPERADMIN") {
      return <Navigate to="/eventos" replace />;
    }
  } else if (authUser?.role !== "SUPERADMIN") {
    return <Navigate to="/eventos" replace />;
  }

  const rows = usersQuery.data ?? [];
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));

  const canDeleteUser = (u: UserRow) =>
    u.id !== authUser?.id && u.role !== "SUPERADMIN";

  return (
    <section>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Eliminar usuario"
        message={
          deleteTarget
            ? `¿Eliminar la cuenta de ${deleteTarget.name} (${deleteTarget.email})? Se quitará el acceso a todos los eventos. No se puede deshacer.`
            : ""
        }
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />

      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Usuarios de la plataforma</h1>
          <p className="lead page-header__lead">
            Alta y mantenimiento de cuentas. El acceso a cada evento se define aparte, en{" "}
            <strong>Configuración</strong> dentro del evento.
          </p>
        </div>
        <div className="page-header__actions">
          <Link to="/admin/eventos" className="btn btn-secondary">
            <Icon name="event" />
            Eventos
          </Link>
        </div>
      </div>

      <section className="card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.15rem", marginTop: 0 }}>
          Nuevo usuario
        </h2>
        <p style={{ color: "var(--on-surface-variant)", marginTop: "0.35rem" }}>
          Crea la cuenta aquí si todavía no debe operar en un evento concreto, o si preferís asignarlo después desde cada
          evento.
        </p>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem", maxWidth: "440px" }}>
          <div>
            <label className="label-md field-label" htmlFor="adm-user-name">
              Nombre
            </label>
            <input
              id="adm-user-name"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div>
            <label className="label-md field-label" htmlFor="adm-user-email">
              Email
            </label>
            <input
              id="adm-user-email"
              className="input"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label-md field-label" htmlFor="adm-user-pass">
              Contraseña inicial
            </label>
            <input
              id="adm-user-pass"
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
            <label className="label-md field-label" htmlFor="adm-user-role">
              Rol
            </label>
            <select
              id="adm-user-role"
              className="input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AppRole)}
            >
              {creatableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </div>
        </div>
        {createNotice ? <p className="message-success" style={{ marginTop: "0.75rem" }}>{createNotice}</p> : null}
        {createError ? <p className="message-error" style={{ marginTop: "0.75rem" }}>{createError}</p> : null}
        <button
          type="button"
          className="btn btn-primary"
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
          {createMutation.isPending ? "Creando…" : "Crear usuario"}
        </button>
      </section>

      <section className="card">
        <h2 className="display-sm" style={{ fontSize: "1.15rem", marginTop: 0 }}>
          Listado
        </h2>
        {usersQuery.isLoading ? (
          <p className="page-state" style={{ padding: "1.5rem 0" }}>
            Cargando usuarios…
          </p>
        ) : usersQuery.isError ? (
          <p className="message-error">No se pudo cargar el listado.</p>
        ) : (
          <div className="users-admin-table" style={{ overflowX: "auto", marginTop: "1rem" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                  <th style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>Nombre</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Email</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Rol</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Activo</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Nueva contraseña</th>
                  <th style={{ padding: "0.5rem 0.75rem" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.6rem 0.75rem 0.6rem 0", verticalAlign: "middle" }}>
                      <strong>{u.name}</strong>
                      {u.id === authUser?.id ? (
                        <span style={{ color: "var(--on-surface-variant)", fontSize: "0.8rem", marginLeft: "0.35rem" }}>
                          (vos)
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "middle", color: "var(--on-surface-variant)" }}>
                      {u.email}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "middle" }}>
                      <select
                        className="input"
                        style={{ minWidth: "11rem", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                        value={u.role}
                        disabled={patchMutation.isPending || u.id === authUser?.id}
                        onChange={(e) => {
                          const role = e.target.value as AppRole;
                          patchMutation.mutate({ id: u.id, body: { role } });
                        }}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r] ?? r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "middle" }}>
                      <input
                        type="checkbox"
                        checked={u.isActive}
                        disabled={patchMutation.isPending || u.id === authUser?.id}
                        onChange={() => patchMutation.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                      />
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                        <input
                          className="input"
                          type="password"
                          style={{ maxWidth: "140px", padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                          placeholder="Opcional"
                          value={rowPassword[u.id] ?? ""}
                          onChange={(e) => setRowPassword((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}
                          disabled={
                            passwordMutation.isPending ||
                            u.id === authUser?.id ||
                            (rowPassword[u.id] ?? "").length < 8
                          }
                          onClick={() => {
                            const p = rowPassword[u.id] ?? "";
                            if (p.length >= 8) passwordMutation.mutate({ id: u.id, password: p });
                          }}
                        >
                          {passwordMutation.isPending ? "…" : "Actualizar"}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem", verticalAlign: "middle" }}>
                      {canDeleteUser(u) ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: "0.35rem 0.65rem",
                            fontSize: "0.8rem",
                            color: "var(--error, #f87171)",
                            borderColor: "rgba(248,113,113,0.45)"
                          }}
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(u);
                          }}
                        >
                          Eliminar
                        </button>
                      ) : (
                        <span style={{ color: "var(--on-surface-variant)", fontSize: "0.85rem" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!usersQuery.isLoading && !usersQuery.isError ? (
          <div className="users-admin-mobile-list">
            {sorted.map((u) => (
              <article key={`mobile-${u.id}`} className="users-admin-mobile-card">
                <p className="users-admin-mobile-card__title">
                  <strong>{u.name}</strong>
                  {u.id === authUser?.id ? <span>(vos)</span> : null}
                </p>
                <p className="users-admin-mobile-card__meta">{u.email}</p>
                <div className="users-admin-mobile-card__field">
                  <label className="label-md">Rol</label>
                  <select
                    className="input"
                    value={u.role}
                    disabled={patchMutation.isPending || u.id === authUser?.id}
                    onChange={(e) => patchMutation.mutate({ id: u.id, body: { role: e.target.value as AppRole } })}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r] ?? r}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="users-admin-mobile-card__checkbox">
                  <input
                    type="checkbox"
                    checked={u.isActive}
                    disabled={patchMutation.isPending || u.id === authUser?.id}
                    onChange={() => patchMutation.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                  />
                  Activo
                </label>
                <div className="users-admin-mobile-card__field">
                  <label className="label-md">Nueva contraseña</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Opcional"
                    value={rowPassword[u.id] ?? ""}
                    onChange={(e) => setRowPassword((prev) => ({ ...prev, [u.id]: e.target.value }))}
                    autoComplete="new-password"
                  />
                </div>
                <div className="row gap users-admin-mobile-card__actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={passwordMutation.isPending || u.id === authUser?.id || (rowPassword[u.id] ?? "").length < 8}
                    onClick={() => {
                      const p = rowPassword[u.id] ?? "";
                      if (p.length >= 8) passwordMutation.mutate({ id: u.id, password: p });
                    }}
                  >
                    {passwordMutation.isPending ? "Actualizando…" : "Actualizar contraseña"}
                  </button>
                  {canDeleteUser(u) ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(u);
                      }}
                    >
                      Eliminar usuario
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {deleteError ? <p className="message-error" style={{ marginTop: "0.75rem" }}>{deleteError}</p> : null}
        {passwordMutation.isError ? (
          <p className="message-error" style={{ marginTop: "0.75rem" }}>
            {errMessage(passwordMutation.error, "No se pudo actualizar la contraseña.")}
          </p>
        ) : null}
      </section>
    </section>
  );
}
