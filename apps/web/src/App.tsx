import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import { Scene } from "./components/Scene";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { Account } from "./pages/Account";
import { TransactionDetail } from "./pages/TransactionDetail";
import { Docs } from "./pages/Docs";
import { Pitch } from "./pages/Pitch";

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Scene />
        <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />

          {/* Everything the wallet can do, and how it works. */}
          <Route path="/docs" element={<Docs />} />

          {/* The story: why Selkie, why Canton, where it goes. */}
          <Route path="/pitch" element={<Pitch />} />

          {/* Your wallet, tabbed. */}
          <Route path="/dashboard" element={<Navigate to="/dashboard/activity" replace />} />
          <Route path="/dashboard/:tab" element={<Dashboard />} />

          {/* Shareable: a handle can always be paid, even before it has a wallet. */}
          <Route path="/account/:handle" element={<Account />} />

          {/* A receipt, readable only by the two people in the payment. */}
          <Route path="/tx/:id" element={<TransactionDetail />} />

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
