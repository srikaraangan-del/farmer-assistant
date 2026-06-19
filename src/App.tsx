import { Routes, Route } from "react-router";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import AuthLayout from "./components/AuthLayout";
import Dashboard from "./pages/Dashboard";
import Farmers from "./pages/Farmers";
import Conversations from "./pages/Conversations";
import WhatsAppSimulator from "./pages/WhatsAppSimulator";
import DailyBriefings from "./pages/DailyBriefings";
import MarketPrices from "./pages/MarketPrices";
import Schemes from "./pages/Schemes";
import Weather from "./pages/Weather";
import CropKnowledge from "./pages/CropKnowledge";
import AiIntents from "./pages/AiIntents";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <AuthLayout>
            <Dashboard />
          </AuthLayout>
        }
      />
      <Route
        path="/farmers"
        element={
          <AuthLayout>
            <Farmers />
          </AuthLayout>
        }
      />
      <Route
        path="/conversations"
        element={
          <AuthLayout>
            <Conversations />
          </AuthLayout>
        }
      />
      <Route
        path="/whatsapp"
        element={
          <AuthLayout>
            <WhatsAppSimulator />
          </AuthLayout>
        }
      />
      <Route
        path="/briefings"
        element={
          <AuthLayout>
            <DailyBriefings />
          </AuthLayout>
        }
      />
      <Route
        path="/market-prices"
        element={
          <AuthLayout>
            <MarketPrices />
          </AuthLayout>
        }
      />
      <Route
        path="/schemes"
        element={
          <AuthLayout>
            <Schemes />
          </AuthLayout>
        }
      />
      <Route
        path="/weather"
        element={
          <AuthLayout>
            <Weather />
          </AuthLayout>
        }
      />
      <Route
        path="/crop-knowledge"
        element={
          <AuthLayout>
            <CropKnowledge />
          </AuthLayout>
        }
      />
      <Route
        path="/ai-intents"
        element={
          <AuthLayout>
            <AiIntents />
          </AuthLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <AuthLayout>
            <Settings />
          </AuthLayout>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
