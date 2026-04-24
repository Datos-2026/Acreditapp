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
      <input className="input input--boxed" placeholder="CUIL" {...register("cuilRaw")} />
      <input className="input input--boxed" placeholder="Nombre" {...register("firstName")} />
      <input className="input input--boxed" placeholder="Apellido" {...register("lastName")} />
      <input className="input input--boxed" placeholder="DNI" {...register("dni")} />
      <input className="input input--boxed" placeholder="Email" {...register("email")} />
      <input className="input input--boxed" placeholder="Teléfono" {...register("phone")} />
      <input className="input input--boxed" placeholder="Empresa" {...register("company")} />
      <input className="input input--boxed" placeholder="Cargo" {...register("position")} />
      <textarea className="input" placeholder="Observaciones" {...register("notes")} />
      <button className="btn btn-primary" type="submit">
        {submitLabel}
      </button>
      {formState.errors.cuilRaw ? <p className="message-error">{formState.errors.cuilRaw.message}</p> : null}
    </form>
  );
}
