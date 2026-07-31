import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { ROUTER_BASENAME } from "./base.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { DialogProvider } from "./components/Dialogs.js";
import { applyTheme, storedTheme } from "./theme.js";
import "./styles/theme.css";

// Before the first render, so the app never flashes the wrong theme.
applyTheme(storedTheme());

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <AuthProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
