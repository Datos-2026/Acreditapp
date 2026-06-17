import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../auth/auth-context";
import { useLastEvent } from "../../lib/lastEventContext";
import { Icon } from "../../components/Icon";
import { eventFormSchema, eventFormToPayload, type EventFormValues } from "./eventForm";
export function CreateEventPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const backHref = location.pathname.includes("/admin/") ? "/admin/eventos" : "/eventos";
  const queryClient = useQueryClient();
  const { setLastEventId } = useLastEvent();
  const forceVecinos = user?.role === "ADMIN_VECINOS";
  const { register, handleSubmit, formState } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      status: "draft",
      description: "",
      kind: forceVecinos ? "vecinos" : "gcba"
    }
  });
  const mutation = useMutation({
    mutationFn: async (values: EventFormValues) => {
      const { data } = await api.post<{ id: string }>("/events", eventFormToPayload(values));
      return data;
    },
    onSuccess: (data) => {
      setLastEventId(data.id);
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      navigate(`/events/${data.id}?tab=terminal`);
    }
  });
  if (!user?.role || !["SUPERADMIN", "ADMIN_EVENTO", "ADMIN_VECINOS"].includes(user.role)) {
    return <Navigate to="/eventos" replace />;
  }
  return (
    <section className="create-event-page">
      <header className="page-header page-header--compact">
        <div className="page-header__copy">
          <h1 className="display-sm">Nuevo evento</h1>
          <p className="lead page-header__lead">
            Definí fechas, estado y ubicación. Después podés operar el evento desde Terminal, Importador y Métricas.
          </p>
        </div>
      </header>
      <Link
        to={backHref}
        className="btn btn-link"
        style={{ marginBottom: "1rem", display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <Icon name="arrow_back" />
        Volver al listado
      </Link>
      <div className="card create-event-card">
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))}>
          <label className="label-md field-label" htmlFor="name">
            Nombre
          </label>
          <input id="name" className="input input--boxed" {...register("name")} />
          {formState.errors.name ? <p className="message-error">{formState.errors.name.message}</p> : null}
          <label className="label-md field-label field-label--spaced" htmlFor="desc">
            Descripción
          </label>
          <textarea id="desc" className="input input--boxed" rows={3} {...register("description")} />
          <div className="two-cols form-block-spaced">
            <div>
              <label className="label-md field-label" htmlFor="start">
                Inicio
              </label>
              <input id="start" type="datetime-local" className="input input--boxed" {...register("startAt")} />
            </div>
            <div>
              <label className="label-md field-label" htmlFor="end">
                Fin
              </label>
              <input id="end" type="datetime-local" className="input input--boxed" {...register("endAt")} />
            </div>
          </div>
          {formState.errors.endAt ? <p className="message-error">{formState.errors.endAt.message}</p> : null}
          <label className="label-md field-label field-label--spaced" htmlFor="loc">
            Ubicación
          </label>
          <input id="loc" className="input input--boxed" {...register("location")} />
          <label className="label-md field-label field-label--spaced" htmlFor="st">
            Estado
          </label>
          <select id="st" className="input input--boxed" {...register("status")}>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="closed">Cerrado</option>
            <option value="archived">Archivado</option>
          </select>
          {user?.role === "SUPERADMIN" ? (
            <>
              <label className="label-md field-label field-label--spaced" htmlFor="kind">
                Tipo de evento
              </label>
              <select id="kind" className="input input--boxed" {...register("kind")}>
                <option value="gcba">Evento GCBA (dotación / CUIL)</option>
                <option value="vecinos">Evento Vecinos (DNI / comunas)</option>
              </select>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "var(--on-surface-variant)" }}>
                Define qué plantilla de importación y qué directorio global se usa al acreditar fuera de base.
              </p>
            </>
          ) : forceVecinos ? (
            <input type="hidden" {...register("kind")} value="vecinos" />
          ) : null}
          <div className="row gap create-event-card__actions">
            <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
              <Icon name="save" />
              {mutation.isPending ? "Guardando…" : "Crear evento"}
            </button>
            <Link to="/" className="btn btn-secondary">
              Cancelar
            </Link>
          </div>
          {mutation.isError ? <p className="message-error">No se pudo crear el evento. Revisá los datos o el nombre duplicado.</p> : null}
        </form>
      </div>
    </section>
  );
}
