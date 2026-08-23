import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import StateView from "./pages/StateView";
import PHCDetail from "./pages/PHCDetail";
import MedicineStateDetail from "./pages/MedicineStateDetail";
import Federated from "./pages/Federated";
import Assistant from "./pages/Assistant";
import Transfers from "./pages/Transfers";
import { LangProvider } from "./lib/LangContext";

export default function App() {
  return (
    <LangProvider>
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
        </Routes>
      </BrowserRouter>
    </LangProvider>
  );
}
