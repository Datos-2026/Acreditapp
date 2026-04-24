import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { AppLayout } from "../components/AppLayout";
import { LoginPage } from "../features/auth/LoginPage";
import { EventsHomePage } from "../features/events/EventsHomePage";
import { EventsCalendarPage } from "../features/events/EventsCalendarPage";
import { CreateEventPage } from "../features/events/CreateEventPage";
import { EventDetailPage } from "../features/event-detail/EventDetailPage";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<EventsHomePage />} />
          <Route path="/eventos" element={<EventsCalendarPage />} />
          <Route path="/events/new" element={<CreateEventPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
