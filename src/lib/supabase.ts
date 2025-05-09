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

// Configuración de reintentos con backoff exponencial
const RETRY_SETTINGS = {
  initialDelay: 1000, // Tiempo inicial (ms)
  maxDelay: 30000,    // Tiempo máximo (ms)
  maxRetries: 5,      // Número máximo de reintentos
  factor: 2           // Factor de incremento exponencial
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
        const timeoutId = setTimeout(() => controller.abort(), 15000); // Aumentado a 15s timeout
        
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
              errorMessage = 'La conexión con el servidor ha excedido el tiempo de espera';
              // Marcar la red como no disponible si es un timeout
              localStorage.setItem('app_network_unreachable', 'true');
            } else if (err.name === 'TypeError' && 
                     (err.message.includes('NetworkError') || 
                      err.message.includes('Failed to fetch'))) {
              errorMessage = 'Error de red: No se pudo conectar al servidor. Compruebe su conexión a Internet.';
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
        eventsPerSecond: 5 // Reducido para disminuir la carga de red
      }
    }
  }
);

// Función para verificar la conectividad de Internet general
const checkInternetConnection = async (): Promise<boolean> => {
  try {
    // Intentar cargar una imagen pequeña de un CDN confiable
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
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
  const CACHE_TTL = 10000; // 10 segundos de caché (aumentado)
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
      // Usar un endpoint más ligero para la comprobación
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000); // Aumentado a 7s timeout
      
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

// Función para activar/desactivar modo offline (para pruebas y uso manual)
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

// Función para crear suscripciones en tiempo real con mejor manejo de errores
export const createRealtimeSubscription = (
  table: string, 
  callback: () => void,
  schema: string = 'public',
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*' = '*'
) => {
  // Si estamos en modo offline, retornar una suscripción falsa
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
      
      // Si hay un error de conexión, intentar volver a conectar después de un tiempo
      if (status === 'OFFLINE' || status === 'CLOSED') {
        console.log(`Suscripción ${table} ${status}, intentando reconectar en 15s...`);
        setTimeout(() => {
          // Verificar si debemos intentar reconectar
          checkSupabaseConnection().then(isConnected => {
            if (isConnected) {
              // Forzar una recarga de datos cuando la conexión se recupera
              callback();
            }
          });
        }, 15000); // Aumentado a 15s para dar más tiempo
      }
    });
};

// Función para gestionar caching básico
interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

// Simple cache en memoria para datos
const dataCache = new Map<string, CacheItem<any>>();

// Función para guardar datos en cache
export const cacheData = <T>(key: string, data: T, ttlSeconds: number = 300) => {
  const now = Date.now();
  dataCache.set(key, {
    data,
    timestamp: now,
    expiry: now + (ttlSeconds * 1000)
  });
};

// Función para obtener datos de cache
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

// Función para borrar un item específico del cache
export const clearCacheItem = (key: string) => {
  dataCache.delete(key);
};

// Función para borrar todo el cache
export const clearCache = () => {
  dataCache.clear();
};