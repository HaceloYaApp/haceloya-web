import { AuthProvider, useAuth } from './context/AuthContext';
import BrandHeader from './components/BrandHeader';
import LoginPage from './pages/LoginPage';
import AgendaPage from './pages/AgendaPage';

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: 'calc(100vh - 52px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="hazard-stripe" style={{ width: 80 }} />
      </div>
    );
  }
  return user ? <AgendaPage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrandHeader />
      <Gate />
    </AuthProvider>
  );
}
