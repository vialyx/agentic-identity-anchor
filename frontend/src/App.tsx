import { useState, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Amplify } from 'aws-amplify'
import { getCurrentUser } from 'aws-amplify/auth'
import awsExports from './aws-exports'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import DeviceDetail from './pages/DeviceDetail'
import Groups from './pages/Groups'
import Agents from './pages/Agents'
import Deployments from './pages/Deployments'
import Tenants from './pages/Tenants'
import LoadingSpinner from './components/LoadingSpinner'

Amplify.configure(awsExports)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

interface AuthState {
  loading: boolean
  authenticated: boolean
  userEmail: string
}

function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    userEmail: '',
  })

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setState({ loading: false, authenticated: true, userEmail: user.username })
      })
      .catch(() => {
        setState({ loading: false, authenticated: false, userEmail: '' })
      })
  }, [])

  return state
}

interface ProtectedRouteProps {
  authenticated: boolean
  children: ReactNode
}

function ProtectedRoute({ authenticated, children }: ProtectedRouteProps) {
  if (!authenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const auth = useAuthState()
  const [selectedTenantId, setSelectedTenantId] = useState('')

  if (auth.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-800">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute authenticated={auth.authenticated}>
                <Layout
                  selectedTenantId={selectedTenantId}
                  onTenantChange={setSelectedTenantId}
                  userEmail={auth.userEmail}
                />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard tenantId={selectedTenantId} />} />
            <Route path="devices" element={<Devices tenantId={selectedTenantId} />} />
            <Route
              path="devices/:deviceId"
              element={<DeviceDetail tenantId={selectedTenantId} />}
            />
            <Route path="groups" element={<Groups tenantId={selectedTenantId} />} />
            <Route path="agents" element={<Agents />} />
            <Route path="deployments" element={<Deployments tenantId={selectedTenantId} />} />
            <Route path="tenants" element={<Tenants />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
