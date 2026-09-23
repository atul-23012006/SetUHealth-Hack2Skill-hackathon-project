import { lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import PublicLayout from "./components/PublicLayout";
// Route-level code splitting: each page (and the heavy libraries only it uses:
// charts, Leaflet, Three.js) loads on first visit instead of in the entry bundle.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StateView = lazy(() => import("./pages/StateView"));
const PHCDetail = lazy(() => import("./pages/PHCDetail"));
const MedicineStateDetail = lazy(() => import("./pages/MedicineStateDetail"));
const Federated = lazy(() => import("./pages/Federated"));
const Assistant = lazy(() => import("./pages/Assistant"));
const Transfers = lazy(() => import("./pages/Transfers"));
const Explore = lazy(() => import("./pages/Explore"));
const PublicPortal = lazy(() => import("./pages/PublicPortal"));
const PublicStateDetail = lazy(() => import("./pages/PublicStateDetail"));
import { LangProvider } from "./lib/LangContext";
import { AuthProvider } from "./lib/AuthContext";

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="states/:state" element={<StateView />} />
              <Route path="phcs/:id" element={<PHCDetail />} />
              <Route path="medicines/:medicine/states/:state" element={<MedicineStateDetail />} />
              <Route path="explore" element={<Explore />} />
              <Route path="federated" element={<Federated />} />
              <Route path="transfers" element={<Transfers />} />
              <Route path="assistant" element={<Assistant />} />
            </Route>
            <Route element={<PublicLayout />}>
              <Route path="public" element={<PublicPortal />} />
              <Route path="public/states/:state" element={<PublicStateDetail />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LangProvider>
  );
}
