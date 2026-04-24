import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@gcba/shared";
import type { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { Icon } from "../../components/Icon";

type FormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(loginSchema)
  });

  return (
    <div className="login-page">
      <div className="login-hero">
        <p style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.85, margin: 0 }}>
          Gobierno de la Ciudad
        </p>
        <h1>Acreditación institucional con claridad operativa</h1>
        <p>
          Ingresá con tu cuenta para operar terminales de check-in, importar bases y consultar métricas por evento.
        </p>
      </div>
      <div className="login-panel">
        <div className="login-card card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "var(--primary-container)",
                display: "grid",
                placeItems: "center"
              }}
            >
              <Icon name="badge" style={{ color: "#fff", fontSize: 26 }} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Iniciar sesión</h2>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.8125rem", color: "var(--on-surface-variant)" }}>
                GCBA | Acreditación
              </p>
            </div>
          </div>
          <form
            onSubmit={handleSubmit(async (values) => {
              try {
                await login(values.email, values.password);
                navigate("/");
              } catch {
                setError("Credenciales inválidas");
              }
            })}
          >
            <label className="label-md" htmlFor="email" style={{ display: "block", marginBottom: "0.35rem" }}>
              Correo electrónico
            </label>
            <input id="email" className="input input--boxed" type="email" placeholder="nombre@gcba.local" {...register("email")} />
            <label className="label-md" htmlFor="password" style={{ display: "block", margin: "1rem 0 0.35rem" }}>
              Contraseña
            </label>
            <input id="password" className="input input--boxed" type="password" placeholder="••••••••" {...register("password")} />
            <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: "1.25rem" }}>
              Entrar
            </button>
          </form>
          <button className="btn btn-link" type="button" style={{ width: "100%", marginTop: "0.75rem" }}>
            Recuperar contraseña
          </button>
          {error ? <p className="message-error">{error}</p> : null}
          {formState.errors.email ? <p className="message-error">{formState.errors.email.message}</p> : null}
        </div>
      </div>
    </div>
  );
}
