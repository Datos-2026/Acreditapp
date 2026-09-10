import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { manualPersonFormSchema, type ManualPersonFormValues } from "../lib/manualPersonFormSchema";

type Props = {
  onSubmit: (values: ManualPersonFormValues) => void;
  initialCuilRaw?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitDisabledHint?: string;
  /** Bloque opcional (ej. selector de mesa) dentro del formulario de Fuera de base. */
  mesaSection?: ReactNode;
};

export function ManualPersonForm({
  onSubmit,
  initialCuilRaw = "",
  submitLabel = "Crear persona manual",
  submitDisabled = false,
  submitDisabledHint,
  mesaSection
}: Props) {
  const { register, handleSubmit, formState, reset } = useForm<ManualPersonFormValues>({
    resolver: zodResolver(manualPersonFormSchema),
    defaultValues: {
      cuilRaw: initialCuilRaw
    }
  });

  useEffect(() => {
    reset({ cuilRaw: initialCuilRaw });
  }, [initialCuilRaw, reset]);

  return (
    <form className="card manual-person-form" onSubmit={handleSubmit(onSubmit)}>
      <header className="manual-person-form__header">
        <h3>Registrar fuera de base</h3>
        <p>Completá los datos de la persona. Si el evento usa mesas, elegí una antes de guardar.</p>
      </header>

      {mesaSection ? <div className="manual-person-form__mesa">{mesaSection}</div> : null}

      <div className="manual-person-form__fields">
        <div className="manual-person-form__field">
          <label className="label-md field-label" htmlFor="manual-cuil-dni">
            CUIL o DNI
          </label>
          <input
            id="manual-cuil-dni"
            className="input input--boxed"
            placeholder="20-12345678-9"
            autoComplete="off"
            inputMode="numeric"
            {...register("cuilRaw")}
          />
        </div>
        <div className="manual-person-form__field">
          <label className="label-md field-label" htmlFor="manual-first-name">
            Nombre
          </label>
          <input
            id="manual-first-name"
            className="input input--boxed"
            placeholder="Nombre"
            {...register("firstName")}
          />
        </div>
        <div className="manual-person-form__field">
          <label className="label-md field-label" htmlFor="manual-last-name">
            Apellido
          </label>
          <input
            id="manual-last-name"
            className="input input--boxed"
            placeholder="Apellido"
            {...register("lastName")}
          />
        </div>
        <div className="manual-person-form__field">
          <label className="label-md field-label" htmlFor="manual-email">
            Email <span className="manual-person-form__optional">(opcional)</span>
          </label>
          <input
            id="manual-email"
            className="input input--boxed"
            placeholder="correo@ejemplo.com"
            {...register("email")}
          />
        </div>
        <div className="manual-person-form__field">
          <label className="label-md field-label" htmlFor="manual-phone">
            Teléfono <span className="manual-person-form__optional">(opcional)</span>
          </label>
          <input
            id="manual-phone"
            className="input input--boxed"
            placeholder="11 1234-5678"
            {...register("phone")}
          />
        </div>
        <div className="manual-person-form__field manual-person-form__field--full">
          <label className="label-md field-label" htmlFor="manual-notes">
            Observaciones <span className="manual-person-form__optional">(opcional)</span>
          </label>
          <textarea
            id="manual-notes"
            className="input"
            placeholder="Notas internas"
            {...register("notes")}
          />
        </div>
      </div>

      <div className="manual-person-form__actions">
        <button className="btn btn-primary" type="submit" disabled={submitDisabled}>
          {submitLabel}
        </button>
        {submitDisabled && submitDisabledHint ? (
          <p className="message-warning manual-person-form__submit-hint">{submitDisabledHint}</p>
        ) : null}
        {formState.errors.cuilRaw ? <p className="message-error">{formState.errors.cuilRaw.message}</p> : null}
        {formState.errors.firstName ? (
          <p className="message-error">{formState.errors.firstName.message}</p>
        ) : null}
        {formState.errors.lastName ? <p className="message-error">{formState.errors.lastName.message}</p> : null}
        {formState.errors.email ? <p className="message-error">{formState.errors.email.message}</p> : null}
      </div>
    </form>
  );
}
