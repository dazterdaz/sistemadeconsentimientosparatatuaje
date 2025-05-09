import React from 'react';
import { CheckCircle, WifiOff, RefreshCw, Loader2 } from 'lucide-react';

interface ErrorMessageSupabaseProps {
  errorMessage?: string;
  onRetry: () => void;
  isRetrying?: boolean;
  hasConnectionError: boolean;
  className?: string;
}

const ErrorMessageSupabase: React.FC<ErrorMessageSupabaseProps> = ({
  errorMessage,
  onRetry,
  isRetrying = false,
  hasConnectionError,
  className = ''
}) => {
  // Si no hay error, mostrar un mensaje de éxito
  if (!hasConnectionError && !errorMessage) {
    return (
      <div className={`bg-green-50 border border-green-200 rounded-md p-4 flex items-center ${className}`}>
        <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
        <span className="text-green-800">Conectado correctamente a la base de datos</span>
      </div>
    );
  }

  return (
    <div className={`bg-red-50 border border-red-200 rounded-md p-4 ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          <WifiOff className="h-5 w-5 text-red-500" />
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">
            Error de conexión
          </h3>
          <div className="mt-2 text-sm text-red-700">
            <p>
              {errorMessage || 'No se pudo establecer conexión con la base de datos. Esto puede deberse a problemas de red o a que el servidor está temporalmente no disponible.'}
            </p>
            <p className="mt-2">
              La aplicación intentará reconectarse automáticamente. También puedes usar datos en caché si están disponibles.
            </p>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-75"
            >
              {isRetrying ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Reconectando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reintentar conexión
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ErrorMessageSupabase;