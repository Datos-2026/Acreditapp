import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../auth/auth-context";
import { Icon } from "../../components/Icon";
import { eventFormSchema, eventFormToPayload, toDatetimeLocalValue, type EventFormValues } from "./eventForm";

type EventDto = {
  id: string;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  status: EventFormValues["status"];
};

export function EditEventPage() {
  const { user } = useAuth();
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdminPath = location.pathname.includes("/admin/");
  const backHref = isAdminPath ? "/admin/eventos" : "/eventos";

  const eventQuery = useQuery({
    queryKey: ["event", id],
    queryFn: async () => (await api.get<EventDto>(`/events/${id}`)).data,
    enabled: Boolean(id)
  });

  const { register, handleSubmit, formState, reset } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema)
  });

  useEffect(() => {
    if (!eventQuery.data) return;
    const e = eventQuery.data;
    reset({
      name: e.name,
      description: e.description ?? "",
      startAt: toDatetimeLocalValue(e.startAt),
      endAt: toDatetimeLocalValue(e.endAt),
      location: e.location ?? "",
      status: e.status
    });
  }, [eventQuery.data, reset]);

  const mutation = useMutation({
    mutationFn: async (values: EventFormValues) => {
      const { data } = await api.patch<EventDto>(`/events/${id}`, eventFormToPayload(values));
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
      void queryClient.invalidateQueries({ queryKey: ["event", id] });
      navigate(`/events/${id}?tab=terminal`);
    }
  });

  if (!user?.role || !["SUPERADMIN", "ADMIN_EVENTO"].includes(user.role)) {
    return <Navigate to="/eventos" replace />;
  }

  if (eventQuery.isLoading) {
    return <div className="page-state">Cargando evento…</div>;
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <section>
        <p className="message-error">No se pudo cargar el evento.</p>
        <Link to={backHref} className="btn btn-secondary">
          Volver
        </Link>
      </section>
    );
  }

  return (
    <section className="create-event-page">
      <header className="page-header page-header--compact">
        <div className="page-header__copy">
          <h1 className="display-sm">Editar evento</h1>
          <p className="lead page-header__lead">Modificá los datos del evento. Los cambios aplican de inmediato.</p>
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
          <div className="row gap create-event-card__actions">
            <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
              <Icon name="save" />
              {mutation.isPending ? "Guardando…" : "Guardar cambios"}
            </button>
            <Link to={backHref} className="btn btn-secondary">
              Cancelar
            </Link>
          </div>
          {mutation.isError ? (
            <p className="message-error">No se pudo guardar. Revisá los datos o si el nombre ya existe.</p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
