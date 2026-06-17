import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginPage } from "../features/auth/LoginPage";
import { EventCard } from "../components/EventCard";
import { PersonSummaryCard } from "../components/PersonSummaryCard";

vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    login: vi.fn(),
    user: null
  })
}));

describe("frontend critical flows", () => {
  it("renderiza login", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /entrar/i })).toBeInTheDocument();
  });

  it("renderiza cards de eventos", () => {
    render(
      <MemoryRouter>
        <EventCard
          event={{
            id: "1",
            name: "Expo Empleo",
            description: "Desc",
            startAt: new Date().toISOString(),
            endAt: new Date().toISOString(),
            status: "active",
            kind: "gcba",
            location: "La Rural",
            totalPeople: 100,
            accreditedPeople: 20
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Expo Empleo")).toBeInTheDocument();
    expect(screen.getByText("Ingresar al evento")).toBeInTheDocument();
  });

  it("muestra estado de acreditación", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PersonSummaryCard
          eventPerson={{
            id: "ep1",
            status: "accredited",
            source: "manual",
            accreditedAt: new Date().toISOString(),
            person: {
              cuilNormalized: "20123456783",
              firstName: "Juan",
              lastName: "Perez",
              dni: "30111222",
              company: "GCBA",
              position: "Invitado"
            }
          }}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Persona ya acreditada/i)).toBeInTheDocument();
  });
});
