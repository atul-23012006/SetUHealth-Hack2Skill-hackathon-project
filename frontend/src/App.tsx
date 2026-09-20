import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import PublicLayout from "./components/PublicLayout";
import Dashboard from "./pages/Dashboard";
import StateView from "./pages/StateView";
import PHCDetail from "./pages/PHCDetail";
import MedicineStateDetail from "./pages/MedicineStateDetail";
import Federated from "./pages/Federated";
import Assistant from "./pages/Assistant";
import Transfers from "./pages/Transfers";
import PublicPortal from "./pages/PublicPortal";
import PublicStateDetail from "./pages/PublicStateDetail";
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
