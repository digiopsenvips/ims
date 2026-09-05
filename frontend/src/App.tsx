import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';

// Pages
import { LoginPage } from './pages/LoginPage';
import { MemberNameConfirmPage } from './pages/MemberNameConfirmPage';
import { MemberSalePortalPage } from './pages/MemberSalePortalPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsProductsPage } from './pages/ProjectsProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { EventsPage } from './pages/EventsPage';
import { SalesManagementPage } from './pages/SalesManagementPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { UserManagementPage } from './pages/UserManagementPage';

export const App: React.FC = () => {
  const { user, isMember } = useAuth();

  return (
    <Routes>
      {/* Public Login */}
      <Route path="/login" element={<LoginPage />} />

      {/* Member Pre-Sale Verification - Redirect directly to Sales Entry */}
      <Route path="/member-confirm" element={<Navigate to="/sales-entry" replace />} />

      {/* Standalone PWA view for Member Sale Portal */}
      <Route
        path="/sales-entry"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<MemberSalePortalPage />} />
      </Route>

      {/* Main Authenticated Layout */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            isMember ? <Navigate to="/sales-entry" replace /> : <Navigate to="/dashboard" replace />
          }
        />

        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="projects-products"
          element={
            <ProtectedRoute allowedRoles={['DEVELOPER', 'ADMIN']}>
              <ProjectsProductsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="inventory"
          element={
            <ProtectedRoute requiredPermission="view_inventory">
              <InventoryPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="events"
          element={
            <ProtectedRoute>
              <EventsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="sales"
          element={
            <ProtectedRoute>
              <SalesManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="analytics"
          element={
            <ProtectedRoute requiredPermission="view_analytics">
              <AnalyticsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="users"
          element={
            <ProtectedRoute allowedRoles={['DEVELOPER', 'ADMIN']}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Catch-all fallback */}
      <Route
        path="*"
        element={
          <Navigate to={user ? (isMember ? '/sales-entry' : '/dashboard') : '/login'} replace />
        }
      />
    </Routes>
  );
};
