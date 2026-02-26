
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="bg-white p-10 rounded-[2rem] shadow-2xl border border-slate-100 max-w-md w-full text-center space-y-6">
            <div className="bg-red-50 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto">
              <AlertCircle size={40} className="text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">¡Ups! Algo salió mal</h2>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                La aplicación encontró un error inesperado. Hemos registrado el problema.
              </p>
            </div>
            {this.state.error && (
              <div className="bg-slate-50 p-4 rounded-xl text-left overflow-hidden">
                <p className="text-[10px] font-mono text-red-600 break-all">
                  {this.state.error.toString()}
                </p>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-[#0f172a] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all flex items-center justify-center gap-3 shadow-xl"
            >
              <RefreshCw size={16} /> Recargar Aplicación
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
