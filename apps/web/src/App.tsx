import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { LibraryPage } from "./pages/LibraryPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { SetupPage } from "./pages/SetupPage.js";

export function App() {
  const { loading, needsSetup, username } = useAuth();

  if (loading) return <div className="loading">Opening the library…</div>;

  // Setup outranks everything: until the account exists there is nothing else
  // the app can usefully show, and every other route would answer 401 or 503.
  if (needsSetup) return <SetupPage />;

  if (!username) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
