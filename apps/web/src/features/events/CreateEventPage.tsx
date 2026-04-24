import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { z } from "zod";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Link, Navigate, useNavigate } from "react-router-dom";

import { api } from "../../lib/api";

import { useAuth } from "../auth/auth-context";

import { useLastEvent } from "../../lib/lastEventContext";

import { Icon } from "../../components/Icon";



const schema = z

  .object({

    name: z.string().min(3, "Mínimo 3 caracteres"),

    description: z.string().optional(),

    startAt: z.string().min(1, "Requerido"),

    endAt: z.string().min(1, "Requerido"),

    location: z.string().optional(),

    status: z.enum(["draft", "active", "closed", "archived"])

  })

  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {

    message: "La fecha de fin debe ser posterior al inicio",

    path: ["endAt"]

  });



type FormValues = z.infer<typeof schema>;



export function CreateEventPage() {

  const { user } = useAuth();

  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { setLastEventId } = useLastEvent();

  const { register, handleSubmit, formState } = useForm<FormValues>({

    resolver: zodResolver(schema),

    defaultValues: {

      status: "draft",

      description: ""

    }

  });



  if (!user?.role || !["SUPERADMIN", "ADMIN_EVENTO"].includes(user.role)) {

    return <Navigate to="/" replace />;

  }



  const mutation = useMutation({

    mutationFn: async (values: FormValues) => {

      const payload = {

        name: values.name,

        description: values.description || null,

        location: values.location || null,

        status: values.status,

        startAt: new Date(values.startAt).toISOString(),

        endAt: new Date(values.endAt).toISOString()

      };

      const { data } = await api.post<{ id: string }>("/events", payload);

      return data;

    },

    onSuccess: (data) => {

      setLastEventId(data.id);

      void queryClient.invalidateQueries({ queryKey: ["events"] });

      navigate(`/events/${data.id}?tab=terminal`);

    }

  });



  return (

    <section>

      <Link to="/" className="btn btn-link" style={{ marginBottom: "1rem", display: "inline-flex", alignItems: "center", gap: 8 }}>

        <Icon name="arrow_back" />

        Volver al panel

      </Link>

      <div className="card" style={{ maxWidth: 640 }}>

        <h1 className="display-sm" style={{ fontSize: "1.75rem" }}>

          Nuevo evento

        </h1>

        <p className="lead" style={{ marginBottom: "1.5rem" }}>

          Definí fechas y estado. Podés editar detalles después desde la API o futuras pantallas de administración.

        </p>

        <form

          onSubmit={handleSubmit((values) => {

            mutation.mutate(values);

          })}

        >

          <label className="label-md" htmlFor="name" style={{ display: "block", marginBottom: "0.35rem" }}>

            Nombre

          </label>

          <input id="name" className="input input--boxed" {...register("name")} />

          {formState.errors.name ? <p className="message-error">{formState.errors.name.message}</p> : null}



          <label className="label-md" htmlFor="desc" style={{ display: "block", margin: "1rem 0 0.35rem" }}>

            Descripción

          </label>

          <textarea id="desc" className="input input--boxed" rows={3} {...register("description")} />



          <div className="two-cols" style={{ marginTop: "1rem" }}>

            <div>

              <label className="label-md" htmlFor="start" style={{ display: "block", marginBottom: "0.35rem" }}>

                Inicio

              </label>

              <input id="start" type="datetime-local" className="input input--boxed" {...register("startAt")} />

            </div>

            <div>

              <label className="label-md" htmlFor="end" style={{ display: "block", marginBottom: "0.35rem" }}>

                Fin

              </label>

              <input id="end" type="datetime-local" className="input input--boxed" {...register("endAt")} />

            </div>

          </div>

          {formState.errors.endAt ? <p className="message-error">{formState.errors.endAt.message}</p> : null}



          <label className="label-md" htmlFor="loc" style={{ display: "block", margin: "1rem 0 0.35rem" }}>

            Ubicación

          </label>

          <input id="loc" className="input input--boxed" {...register("location")} />



          <label className="label-md" htmlFor="st" style={{ display: "block", margin: "1rem 0 0.35rem" }}>

            Estado

          </label>

          <select id="st" className="input input--boxed" {...register("status")}>

            <option value="draft">Borrador</option>

            <option value="active">Activo</option>

            <option value="closed">Cerrado</option>

            <option value="archived">Archivado</option>

          </select>



          <div className="row gap" style={{ marginTop: "1.5rem", flexWrap: "wrap" }}>

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

