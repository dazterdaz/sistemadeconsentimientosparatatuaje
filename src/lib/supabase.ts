import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Faltan variables de entorno de Supabase');
  throw new Error('Missing Supabase environment variables');
}

// Función para verificar si estamos en modo offline para testing o si hemos detectado problemas de red
const isOfflineMode = () => {
  return localStorage.getItem('app_offline_mode') === 'true' || 
         localStorage.getItem('app_network_unreachable') === 'true';
};

// Cache para almacenar el último estado de conectividad
let lastConnectionStatus = {
  isConnected: false,
  timestamp: 0
};

// Configuración de reintentos con backoff exponencial - Aumentados los tiempos
const RETRY_SETTINGS = {
  initialDelay: 2000,    // Aumentado de 1000ms a 2000ms
  maxDelay: 60000,       // Aumentado de 30000ms a 60000ms
  maxRetries: 8,         // Aumentado de 5 a 8
  factor: 1.5            // Reducido de 2 a 1.5 para un crecimiento más gradual
};

// Función de ayuda para esperar un tiempo específico
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Añadimos opciones de configuración adicionales para mejorar la conexión
export const supabase = createClient<Database>(
  supabaseUrl, 
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      headers: {
        'pragma': 'no-cache',
        'cache-control': 'no-cache',
      },
      // Mejorar el manejo de errores en fetch
      fetch: (...args) => {
        // Si estamos en modo offline, rechazar todas las peticiones
        if (isOfflineMode()) {
          console.log('Operación de Supabase bloqueada: modo offline activado');
          return Promise.reject(new Error('Aplicación en modo offline'));
        }
        
        // Añadir timeout a las peticiones
        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 30000); // Aumentado de 15s a 30s
        
        // Reemplazar el primer argumento (URL) con un objeto que incluya signal
        if (typeof args[0] === 'string') {
          args[1] = { ...args[1], signal };
        } else if (args[0] instanceof Request) {
          args[0] = new Request(args[0], { signal });
        }
        
        return fetch(...args)
          .then(response => {
            clearTimeout(timeoutId);
            
            // Restablecer el estado de red si estaba marcado como no disponible
            if (localStorage.getItem('app_network_unreachable') === 'true') {
              localStorage.removeItem('app_network_unreachable');
            }
            
            return response;
          })
          .catch(err => {
            clearTimeout(timeoutId);
            console.error('Error en fetch Supabase:', err);
            
            // Mejorar el mensaje de error dependiendo del tipo
            let errorMessage = err.message || 'Error desconocido al conectar con el servidor';
            
            if (err.name === 'AbortError') {
              errorMessage = 'La conexión con el servidor ha excedido el tiempo de espera. Por favor, verifica tu conexión a Internet y vuelve a intentarlo.';
              // Marcar la red como no disponible si es un timeout
              localStorage.setItem('app_network_unreachable', 'true');
            } else if (err.name === 'TypeError' && 
                     (err.message.includes('NetworkError') || 
                      err.message.includes('Failed to fetch'))) {
              errorMessage = 'Error de red: No se pudo conectar al servidor. Compruebe su conexión a Internet y asegúrese de que el servidor está accesible.';
              // Marcar la red como no disponible
              localStorage.setItem('app_network_unreachable', 'true');
            }
            
            const enhancedError = new Error(errorMessage);
            enhancedError.name = err.name;
            throw enhancedError;
          });
      }
    },
    realtime: {
      params: {
        eventsPerSecond: 2 // Reducido de 5 a 2 para disminuir la carga de red
      }
    }
  }
);

// Función para verificar la conectividad de Internet general
const checkInternetConnection = async (): Promise<boolean> => {
  try {
    // Intentar cargar una imagen pequeña de un CDN confiable con más tiempo de timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // Aumentado de 5s a 10s
    
    const response = await fetch('https://www.gstatic.com/generate/1x1.png', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return true; // Si llegamos aquí, hay conexión a Internet
  } catch (error) {
    console.error('Error al verificar conexión a Internet:', error);
    return false;
  }
};

// Función de ayuda para verificar la conexión con mejoras
export const checkSupabaseConnection = async (): Promise<boolean> => {
  // Si ya verificamos la conexión recientemente, devolver el resultado en caché
  const CACHE_TTL = 30000; // Aumentado de 10s a 30s
  const now = Date.now();
  
  if (now - lastConnectionStatus.timestamp < CACHE_TTL) {
    return lastConnectionStatus.isConnected;
  }
  
  // Si estamos en modo offline, devolver false inmediatamente
  if (isOfflineMode()) {
    lastConnectionStatus = { isConnected: false, timestamp: now };
    return false;
  }
  
  // Primero verificar si hay conexión a Internet en general
  const hasInternet = await checkInternetConnection();
  if (!hasInternet) {
    console.log('No hay conexión a Internet disponible');
    localStorage.setItem('app_network_unreachable', 'true');
    lastConnectionStatus = { isConnected: false, timestamp: now };
    return false;
  }
  
  // Implementar retries con backoff exponencial
  let currentRetry = 0;
  let delay = RETRY_SETTINGS.initialDelay;
  
  while (currentRetry < RETRY_SETTINGS.maxRetries) {
    try {
      // Usar un endpoint más ligero para la comprobación con más tiempo de timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // Aumentado de 7s a 15s
      
      const { error } = await supabase.from('config').select('count', { count: 'exact', head: true })
        .abortSignal(controller.signal);
      
      clearTimeout(timeoutId);
      
      const isConnected = !error;
      lastConnectionStatus = { isConnected, timestamp: now };
      
      // Si recuperamos la conexión y estábamos en modo offline o red no disponible, desactivar esos modos
      if (isConnected) {
        localStorage.removeItem('app_offline_mode');
        localStorage.removeItem('app_network_unreachable');
        console.log('Conexión a Supabase establecida correctamente');
      }
      
      return isConnected;
    } catch (error) {
      console.error(`Intento ${currentRetry + 1}/${RETRY_SETTINGS.maxRetries} fallido:`, error);
      
      currentRetry++;
      
      // Si hemos agotado los reintentos, actualizamos el estado y retornamos false
      if (currentRetry >= RETRY_SETTINGS.maxRetries) {
        console.error('Todos los intentos de conexión a Supabase han fallado');
        lastConnectionStatus = { isConnected: false, timestamp: now };
        // Marcar la red como no disponible después de agotar los reintentos
        localStorage.setItem('app_network_unreachable', 'true');
        return false;
      }
      
      // Calcular el siguiente delay con backoff exponencial
      delay = Math.min(delay * RETRY_SETTINGS.factor, RETRY_SETTINGS.maxDelay);
      console.log(`Reintentando en ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  // Si llegamos aquí, todos los intentos han fallado
  lastConnectionStatus = { isConnected: false, timestamp: now };
  return false;
};

// Resto del código se mantiene igual...
export const toggleOfflineMode = (active: boolean) => {
  if (active) {
    localStorage.setItem('app_offline_mode', 'true');
    console.log('Modo offline activado manualmente');
  } else {
    localStorage.removeItem('app_offline_mode');
    localStorage.removeItem('app_network_unreachable');
    console.log('Modo offline desactivado manualmente');
  }
};

export const createRealtimeSubscription = (
  table: string, 
  callback: () => void,
  schema: string = 'public',
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*' = '*'
) => {
  if (isOfflineMode()) {
    console.log(`Suscripción en tiempo real para ${table} no iniciada (modo offline)`);
    return {
      unsubscribe: () => console.log(`Cancelando suscripción de ${table} (modo offline)`)
    };
  }
  
  return supabase
    .channel(`changes_${table}`)
    .on(
      'postgres_changes',
      {
        event: event,
        schema: schema,
        table: table
      },
      () => {
        console.log(`Cambios detectados en la tabla ${table}`);
        callback();
      }
    )
    .subscribe((status) => {
      console.log(`Supabase subscription status for ${table}:`, status);
      
      if (status === 'OFFLINE' || status === 'CLOSED') {
        console.log(`Suscripción ${table} ${status}, intentando reconectar en 30s...`);
        setTimeout(() => {
          checkSupabaseConnection().then(isConnected => {
            if (isConnected) {
              callback();
            }
          });
        }, 30000); // Aumentado de 15s a 30s
      }
    });
};

interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

const dataCache = new Map<string, CacheItem<any>>();

export const cacheData = <T>(key: string, data: T, ttlSeconds: number = 300) => {
  const now = Date.now();
  dataCache.set(key, {
    data,
    timestamp: now,
    expiry: now + (ttlSeconds * 1000)
  });
};

export const getCachedData = <T>(key: string): T | null => {
  const item = dataCache.get(key);
  const now = Date.now();
  
  if (!item) return null;
  if (now > item.expiry) {
    dataCache.delete(key);
    return null;
  }
  
  return item.data as T;
};

export const clearCacheItem = (key: string) => {
  dataCache.delete(key);
};

export const clearCache = () => {
  dataCache.clear();
};