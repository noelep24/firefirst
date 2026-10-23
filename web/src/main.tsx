import '@fontsource/roboto-slab/600.css';
import '@fontsource/roboto-slab/700.css';
import '@fontsource/roboto-slab/800.css';
import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { ApiError } from '@/api/http';
import { AuthProvider, useAuth } from '@/auth';
import { Layout } from '@/components/layout';
import { Loading } from '@/components/ui';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ApparatusList = lazy(() => import('@/pages/ApparatusList'));
const ApparatusDetail = lazy(() => import('@/pages/ApparatusDetail'));
const WorkOrders = lazy(() => import('@/pages/WorkOrders'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const Schedule = lazy(() => import('@/pages/Schedule'));
const Approvals = lazy(() => import('@/pages/Approvals'));
const Events = lazy(() => import('@/pages/Events'));
const Checklists = lazy(() => import('@/pages/Checklists'));
const People = lazy(() => import('@/pages/People'));
const Stations = lazy(() => import('@/pages/Stations'));
const AuditLog = lazy(() => import('@/pages/AuditLog'));
const Import = lazy(() => import('@/pages/Import'));
const Reports = lazy(() => import('@/pages/Reports'));
const Settings = lazy(() => import('@/pages/Settings'));
const Incidents = lazy(() => import('@/pages/Incidents'));
const IncidentDetail = lazy(() => import('@/pages/IncidentDetail'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

function App() {
  const auth = useAuth();
  const [signingUp, setSigningUp] = useState(false);
  if (auth.status === 'loading') return <Loading />;
  if (auth.status === 'signedOut') {
    return signingUp ? <Signup onCancel={() => setSigningUp(false)} /> : <Login onSignup={() => setSigningUp(true)} />;
  }
  const isAdmin = auth.me.role === 'admin';
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="incidents/:id" element={<IncidentDetail />} />
          <Route path="apparatus" element={<ApparatusList />} />
          <Route path="apparatus/:id" element={<ApparatusDetail />} />
          <Route path="work-orders" element={<WorkOrders />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="reports" element={<Reports />} />
          <Route path="events" element={<Events />} />
          <Route path="checklists" element={<Checklists />} />
          <Route path="people" element={<People />} />
          {isAdmin ? <Route path="stations" element={<Stations />} /> : null}
          {isAdmin ? <Route path="audit" element={<AuditLog />} /> : null}
          {isAdmin ? <Route path="import" element={<Import />} /> : null}
          {isAdmin ? <Route path="settings" element={<Settings />} /> : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
