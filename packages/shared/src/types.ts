import type { AppRole } from "./constants";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

export type EventStatus = "draft" | "active" | "closed" | "archived";

export type EventCardDto = {
  id: string;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  status: EventStatus;
  location: string | null;
  totalPeople: number;
  accreditedPeople: number;
};
