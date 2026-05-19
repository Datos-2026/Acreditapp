import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { manualPersonSchema } from "@gcba/shared";
import type { z } from "zod";

type Props = {
  onSubmit: (values: FormValues) => void;
  initialCuilRaw?: string;
  submitLabel?: string;
};

type FormValues = z.infer<typeof manualPersonSchema>;

export function ManualPersonForm({ onSubmit, initialCuilRaw = "", submitLabel = "Crear persona manual" }: Props) {
  const { register, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(manualPersonSchema),
    defaultValues: {
      cuilRaw: initialCuilRaw
    }
  });

  useEffect(() => {
    reset({ cuilRaw: initialCuilRaw });
  }, [initialCuilRaw, reset]);

  return (
    <form className="card form-grid" onSubmit={handleSubmit(onSubmit)}>
      <h3>Registrar fuera de base</h3>
      <label className="label-md field-label" htmlFor="manual-cuil-dni">
        CUIL o DNI
      </label>
      <input
        id="manual-cuil-dni"
        className="input input--boxed"
        placeholder="CUIL o DNI"
        autoComplete="off"
        inputMode="numeric"
        {...register("cuilRaw")}
      />
      <input className="input input--boxed" placeholder="Nombre" {...register("firstName")} />
      <input className="input input--boxed" placeholder="Apellido" {...register("lastName")} />
      <input className="input input--boxed" placeholder="Email (opcional)" {...register("email")} />
      <input className="input input--boxed" placeholder="Teléfono (opcional)" {...register("phone")} />
      <textarea className="input" placeholder="Observaciones (opcional)" {...register("notes")} />
      <button className="btn btn-primary" type="submit">
        {submitLabel}
      </button>
      {formState.errors.cuilRaw ? <p className="message-error">{formState.errors.cuilRaw.message}</p> : null}
      {formState.errors.firstName ? <p className="message-error">{formState.errors.firstName.message}</p> : null}
      {formState.errors.lastName ? <p className="message-error">{formState.errors.lastName.message}</p> : null}
      {formState.errors.email ? <p className="message-error">{formState.errors.email.message}</p> : null}
    </form>
  );
}
