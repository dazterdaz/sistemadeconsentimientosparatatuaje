import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Consentimiento, EstadisticasGenerales, EstadisticaArtista } from '../types';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase, checkSupabaseConnection, createRealtimeSubscription, cacheData, getCachedData } from '../lib/supabase';

interface ConsentimientosContextType {
  consentimientos: Consentimiento[];
  consentimientosArchivados: Consentimiento[]; 
  addConsentimiento: (consentimiento: Omit<Consentimiento, 'id' | 'codigo' | 'fechaCreacion' | 'archivado'>) => Promise<Consentimiento>;
  getConsentimiento: (id: string) => Consentimiento | undefined;
  getConsentimientoPorCodigo: (codigo: string) => Consentimiento | undefined;
  archivarConsentimiento: (id: string) => Promise<void>;
  getEstadisticas: () => EstadisticasGenerales;
  connectionError: boolean;
  isLoading: boolean;
  retryConnection: () => void;
}

const ConsentimientosContext = createContext<ConsentimientosContextType | undefined>(undefined);

const CONSENT_CACHE_KEY = 'app_consents_data';
const ARCHIVED_CONSENT_CACHE_KEY = 'app_archived_consents_data';
const CONSENT_CACHE_TTL = 3600; // 1 hora en segundos

const generateCode = () => {
  const prefix = 'TCF';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = `${prefix}-`;
  
  // Generar primera parte
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  code += '-';
  
  // Generar segunda parte
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
};

export const ConsentimientosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [consentimientos, setConsentimientos] = useState<Consentimiento[]>(() => {
    // Intentar cargar desde caché al iniciar
    const cachedData = getCachedData<Consentimiento[]>(CONSENT_CACHE_KEY);
    console.log('Datos en caché iniciales (activos):', cachedData?.length || 0);
    return cachedData || [];
  });
  
  const [consentimientosArchivados, setConsentimientosArchivados] = useState<Consentimiento[]>(() => {
    // Intentar cargar desde caché al iniciar
    const cachedData = getCachedData<Consentimiento[]>(ARCHIVED_CONSENT_CACHE_KEY);
    console.log('Datos en caché iniciales (archivados):', cachedData?.length || 0);
    return cachedData || [];
  });
  
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 10; // Aumentado para más persistencia (de 7 a 10)

  // Función de backoff exponencial para reintentos
  const getRetryDelay = useCallback((attempt: number) => {
    const baseDelay = 1000; // 1 segundo
    const maxDelay = 120000; // 120 segundos (aumentado de 60s a 120s)
    const calculatedDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Añadir un poco de aleatoriedad (jitter) para evitar tormentas de solicitudes
    return calculatedDelay + Math.random() * 1000;
  }, []);

  // Función para cargar consentimientos mejorada
  const loadConsentimientos = useCallback(async () => {
    try {
      // Comprobar si tenemos datos en caché primero y usarlos inmediatamente
      const cachedConsents = getCachedData<Consentimiento[]>(CONSENT_CACHE_KEY);
      const cachedArchivedConsents = getCachedData<Consentimiento[]>(ARCHIVED_CONSENT_CACHE_KEY);
      
      if (cachedConsents || cachedArchivedConsents) {
        console.log('Usando datos en caché inicialmente mientras se verifica la conexión');
        if (cachedConsents && cachedConsents.length > 0) setConsentimientos(cachedConsents);
        if (cachedArchivedConsents && cachedArchivedConsents.length > 0) setConsentimientosArchivados(cachedArchivedConsents);
        // No desbloqueamos la UI todavía para evitar parpadeo si la conexión es rápida
      }
      
      setLoading(true);
      console.log('Cargando consentimientos desde Supabase...');
      
      // Verificar conexión primero con un timeout
      const connectionPromise = checkSupabaseConnection();
      
      // Establecer un timeout para la verificación de conexión
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 30000); // 30 segundos de timeout (aumentado de 15s a 30s)
      });
      
      // Usar el resultado de la primera promesa que se resuelva
      const isConnected = await Promise.race([connectionPromise, timeoutPromise]);
      
      if (!isConnected) {
        console.error('No se pudo conectar a Supabase (timeout o error de conexión)');
        setConnectionError(true);
        
        // Si tenemos datos en caché, los usamos y reducimos la sensación de error
        if (cachedConsents || cachedArchivedConsents) {
          console.log('Usando datos en caché debido a problemas de conexión');
          
          // Ya hemos establecido los datos de la caché arriba, mostramos la UI
          setLoading(false);
          
          // Intentar nuevamente en segundo plano si no hemos superado el máximo de intentos
          if (retryCount < MAX_RETRIES) {
            const delay = getRetryDelay(retryCount);
            console.log(`Reintentando conectar en segundo plano (${retryCount + 1}/${MAX_RETRIES}) en ${delay}ms...`);
            setRetryCount(prev => prev + 1);
            setTimeout(loadConsentimientos, delay);
            return;
          } else {
            console.log('Máximo de reintentos alcanzado, usando datos en caché');
            return;
          }
        }
        
        // Sin caché, reintentamos con backoff exponencial
        if (retryCount < MAX_RETRIES) {
          const delay = getRetryDelay(retryCount);
          console.log(`Reintentando conectar (${retryCount + 1}/${MAX_RETRIES}) en ${delay}ms...`);
          setRetryCount(prev => prev + 1);
          setTimeout(loadConsentimientos, delay);
          return;
        } else {
          console.log('Máximo de reintentos alcanzado, usando lista vacía');
          setLoading(false);
          return;
        }
      }
      
      // Reiniciar el estado de error si la conexión fue exitosa
      setConnectionError(false);
      setRetryCount(0); // Reiniciar el contador de intentos
      
      // Obtener consentimientos no archivados primero con un timeout más generoso
      const controller = new AbortController();
      const signal = controller.signal;
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout (aumentado de 30s a 45s)
      
      try {
        const { data: dataActivos, error: errorActivos } = await supabase
          .from('consents')
          .select(`
            id, 
            code, 
            client_info, 
            tutor_info, 
            artist_id, 
            client_signature, 
            tutor_signature, 
            archived, 
            created_at, 
            updated_at,
            artists:artist_id (name)
          `)
          .eq('archived', false)
          .order('created_at', { ascending: false })
          .abortSignal(signal);
        
        clearTimeout(timeoutId);
        
        if (errorActivos) {
          console.error('Error al cargar consentimientos activos:', errorActivos);
          throw new Error(`Error al cargar consentimientos activos: ${errorActivos.message}`);
        }
        
        console.log('Consentimientos activos obtenidos:', dataActivos?.length || 0);
        
        // Obtener consentimientos archivados con un nuevo timeout
        const archivedController = new AbortController();
        const archivedSignal = archivedController.signal;
        const archivedTimeoutId = setTimeout(() => archivedController.abort(), 45000); // 45s timeout (aumentado de 30s a 45s)
        
        try {
          const { data: dataArchivados, error: errorArchivados } = await supabase
            .from('consents')
            .select(`
              id, 
              code, 
              client_info, 
              tutor_info, 
              artist_id, 
              client_signature, 
              tutor_signature, 
              archived, 
              created_at, 
              updated_at,
              artists:artist_id (name)
            `)
            .eq('archived', true)
            .order('created_at', { ascending: false })
            .abortSignal(archivedSignal);
          
          clearTimeout(archivedTimeoutId);
          
          if (errorArchivados) {
            console.error('Error al cargar consentimientos archivados:', errorArchivados);
            throw new Error(`Error al cargar consentimientos archivados: ${errorArchivados.message}`);
          }
          
          console.log('Consentimientos archivados obtenidos:', dataArchivados?.length || 0);
          
          // Transformar los datos al formato de la aplicación
          const transformarDatos = (data: any[] | null): Consentimiento[] => {
            return data?.map(item => {
              const clientInfo = item.client_info as any;
              const tutorInfo = item.tutor_info as any;
              
              return {
                id: item.id,
                codigo: item.code,
                fechaCreacion: item.created_at,
                cliente: {
                  nombre: clientInfo.nombre,
                  apellidos: clientInfo.apellidos,
                  edad: clientInfo.edad,
                  rut: clientInfo.rut,
                  fechaNacimiento: clientInfo.fechaNacimiento,
                  direccion: clientInfo.direccion,
                  telefono: clientInfo.telefono,
                  email: clientInfo.email,
                  confirmacionDatos: clientInfo.confirmacionDatos
                },
                tutor: tutorInfo ? {
                  nombre: tutorInfo.nombre,
                  rut: tutorInfo.rut,
                  parentesco: tutorInfo.parentesco,
                  otroParentesco: tutorInfo.otroParentesco,
                  firma: tutorInfo.firma
                } : undefined,
                informacionSalud: clientInfo.informacionSalud || {},
                artistaSeleccionado: item.artists?.name || '',
                firma: item.client_signature,
                archivado: item.archived
              } as Consentimiento;
            }) || [];
          };
          
          const consentimientosActivos = transformarDatos(dataActivos);
          const consentimientosArchivadosLista = transformarDatos(dataArchivados);
          
          // Guardar en caché para uso offline - aumentar TTL para más durabilidad
          cacheData(CONSENT_CACHE_KEY, consentimientosActivos, CONSENT_CACHE_TTL * 3); // Aumentado de *2 a *3
          cacheData(ARCHIVED_CONSENT_CACHE_KEY, consentimientosArchivadosLista, CONSENT_CACHE_TTL * 3); // Aumentado de *2 a *3
          
          setConsentimientos(consentimientosActivos);
          setConsentimientosArchivados(consentimientosArchivadosLista);
          
          console.log('Consentimientos activos en estado:', consentimientosActivos.length);
          console.log('Consentimientos archivados en estado:', consentimientosArchivadosLista.length);
        } catch (archivedError) {
          clearTimeout(archivedTimeoutId);
          if (archivedError.name === 'AbortError') {
            console.error('Timeout al cargar consentimientos archivados');
            // Si tenemos problemas con los archivados, al menos mostramos los activos
            const consentimientosActivos = transformarDatos(dataActivos);
            setConsentimientos(consentimientosActivos);
            cacheData(CONSENT_CACHE_KEY, consentimientosActivos, CONSENT_CACHE_TTL * 3);
            throw new Error('Timeout al cargar consentimientos archivados. La operación ha tardado demasiado.');
          }
          throw archivedError;
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          console.error('Timeout al cargar consentimientos');
          throw new Error('Timeout al cargar consentimientos. La operación ha tardado demasiado.');
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Error al cargar consentimientos:', error);
      setConnectionError(true);
      
      // Mantener datos existentes si hay error, no resetear
      // Si tenemos caché, mostrar la UI aunque haya error
      if (consentimientos.length > 0 || consentimientosArchivados.length > 0) {
        setLoading(false);
      }
      
      // Programar reintento si no hemos alcanzado el límite
      if (retryCount < MAX_RETRIES) {
        const delay = getRetryDelay(retryCount);
        console.log(`Error en carga, reintentando en segundo plano (${retryCount + 1}/${MAX_RETRIES}) en ${delay}ms...`);
        setRetryCount(prev => prev + 1);
        setTimeout(loadConsentimientos, delay);
      }
    } finally {
      // Asegurarnos de que no quedamos en estado de carga indefinidamente
      setTimeout(() => {
        if (loading) {
          console.log('Forzando finalización de estado de carga después de timeout');
          setLoading(false);
        }
      }, 60000); // 60 segundos máximo de estado de carga (aumentado de 45s a 60s)
    }
  }, [retryCount, getRetryDelay, consentimientos.length, consentimientosArchivados.length, loading]);

  // Función para forzar reintento de conexión
  const retryConnection = useCallback(() => {
    console.log('Forzando reintento de conexión...');
    setRetryCount(0); // Reiniciar contador de intentos
    setConnectionError(false); // Resetear estado de error
    loadConsentimientos(); // Intentar cargar datos nuevamente
  }, [loadConsentimientos]);

  useEffect(() => {
    loadConsentimientos();
    
    // Configurar suscripción en tiempo real para consentimientos
    const consentsSubscription = createRealtimeSubscription('consents', () => {
      console.log('Actualización detectada en la tabla consents, recargando datos...');
      // Comprobar conexión antes de intentar recargar
      checkSupabaseConnection().then(isConnected => {
        if (isConnected) {
          loadConsentimientos();
        } else {
          console.log('No hay conexión para recargar consentimientos');
        }
      });
    });
    
    // Limpiar suscripción al desmontar
    return () => {
      consentsSubscription.unsubscribe();
    };
  }, [loadConsentimientos]);

  const addConsentimiento = async (newConsentimiento: Omit<Consentimiento, 'id' | 'codigo' | 'fechaCreacion' | 'archivado'>): Promise<Consentimiento> => {
    // Verificar conexión primero
    const isConnected = await checkSupabaseConnection();
    if (!isConnected) {
      throw new Error('No se puede conectar a Supabase. Por favor, verifica tu conexión e inténtalo de nuevo.');
    }
    
    console.log('Añadiendo nuevo consentimiento...');
    const codigo = generateCode();
    const fechaCreacion = new Date().toISOString();
    
    try {
      // Buscar el ID del artista seleccionado
      console.log('Buscando artista:', newConsentimiento.artistaSeleccionado);
      
      // Buscar con timeout
      const artistController = new AbortController();
      const artistSignal = artistController.signal;
      const artistTimeoutId = setTimeout(() => artistController.abort(), 15000); // 15s timeout (aumentado de 10s a 15s)
      
      try {
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('id')
          .eq('name', newConsentimiento.artistaSeleccionado)
          .single()
          .abortSignal(artistSignal);
        
        clearTimeout(artistTimeoutId);
        
        if (artistError) {
          console.error('Error al obtener el ID del artista:', artistError);
          throw new Error(`No se pudo encontrar el artista seleccionado: ${artistError.message}`);
        }
        
        const artistId = artistData.id;
        console.log('ID del artista encontrado:', artistId);
        
        // Preparar datos para el consentimiento
        const clientInfo = {
          nombre: newConsentimiento.cliente.nombre,
          apellidos: newConsentimiento.cliente.apellidos,
          edad: newConsentimiento.cliente.edad,
          rut: newConsentimiento.cliente.rut,
          fechaNacimiento: newConsentimiento.cliente.fechaNacimiento,
          direccion: newConsentimiento.cliente.direccion,
          telefono: newConsentimiento.cliente.telefono,
          email: newConsentimiento.cliente.email,
          confirmacionDatos: newConsentimiento.cliente.confirmacionDatos,
          informacionSalud: newConsentimiento.informacionSalud
        };
        
        const tutorInfo = newConsentimiento.tutor ? {
          nombre: newConsentimiento.tutor.nombre,
          rut: newConsentimiento.tutor.rut,
          parentesco: newConsentimiento.tutor.parentesco,
          otroParentesco: newConsentimiento.tutor.otroParentesco,
          firma: newConsentimiento.tutor.firma
        } : null;
        
        console.log('Guardando consentimiento en Supabase...');
        
        // Utilizar AbortController para establecer un timeout
        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout (aumentado de 20s a 30s)
        
        try {
          // Crear el nuevo consentimiento en Supabase
          const { data, error } = await supabase
            .from('consents')
            .insert({
              code: codigo,
              client_info: clientInfo,
              tutor_info: tutorInfo,
              artist_id: artistId,
              client_signature: newConsentimiento.firma,
              tutor_signature: newConsentimiento.tutor?.firma || null,
              archived: false
            })
            .select()
            .abortSignal(signal);
          
          clearTimeout(timeoutId);
          
          if (error) {
            console.error('Error al guardar consentimiento:', error);
            throw new Error(`Error al guardar consentimiento: ${error.message}`);
          }
          
          if (!data || data.length === 0) {
            throw new Error('No se recibieron datos al crear el consentimiento');
          }
          
          console.log('Consentimiento guardado en Supabase:', data[0].id);
          
          // Crear objeto de consentimiento para retornar
          const consentimientoCompleto: Consentimiento = {
            ...newConsentimiento,
            id: data[0].id,
            codigo,
            fechaCreacion,
            archivado: false
          };
          
          // Actualizar estado local para una respuesta más inmediata
          setConsentimientos(prev => {
            const updated = [consentimientoCompleto, ...prev];
            // Actualizar caché
            cacheData(CONSENT_CACHE_KEY, updated, CONSENT_CACHE_TTL);
            return updated;
          });
          
          return consentimientoCompleto;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            throw new Error('Tiempo de espera agotado al guardar el consentimiento. Por favor intente nuevamente.');
          }
          throw fetchError;
        }
      } catch (artistFetchError) {
        clearTimeout(artistTimeoutId);
        if (artistFetchError.name === 'AbortError') {
          throw new Error('Tiempo de espera agotado al buscar el artista. Por favor intente nuevamente.');
        }
        throw artistFetchError;
      }
    } catch (error) {
      console.error('Error en addConsentimiento:', error);
      // Re-verificar conexión para actualizar estado
      const stillConnected = await checkSupabaseConnection();
      if (!stillConnected) {
        setConnectionError(true);
      }
      throw error;
    }
  };

  const getConsentimiento = (id: string) => {
    // Buscar en consentimientos activos y archivados
    return consentimientos.find(c => c.id === id) || 
           consentimientosArchivados.find(c => c.id === id);
  };

  const getConsentimientoPorCodigo = (codigo: string) => {
    // Buscar en consentimientos activos y archivados
    return consentimientos.find(c => c.codigo === codigo) || 
           consentimientosArchivados.find(c => c.codigo === codigo);
  };

  const archivarConsentimiento = async (id: string) => {
    // Verificar conexión primero
    const isConnected = await checkSupabaseConnection();
    if (!isConnected) {
      throw new Error('No se puede conectar a Supabase. Por favor, verifica tu conexión e inténtalo de nuevo.');
    }
    
    console.log('Archivando consentimiento con ID:', id);
    
    try {
      // Obtener el consentimiento antes de archivarlo para poder moverlo después
      const consentimiento = getConsentimiento(id);
      if (!consentimiento) {
        throw new Error('No se encontró el consentimiento a archivar');
      }
      
      // Actualizar estado local primero para una respuesta inmediata
      // 1. Crear una copia del consentimiento marcado como archivado
      const consentimientoArchivado = { ...consentimiento, archivado: true };
      
      // 2. Remover de la lista de activos
      const nuevosActivos = consentimientos.filter(c => c.id !== id);
      setConsentimientos(nuevosActivos);
      
      // 3. Añadir a la lista de archivados
      const nuevosArchivados = [consentimientoArchivado, ...consentimientosArchivados];
      setConsentimientosArchivados(nuevosArchivados);
      
      // 4. Actualizar cache de ambas listas
      cacheData(CONSENT_CACHE_KEY, nuevosActivos, CONSENT_CACHE_TTL);
      cacheData(ARCHIVED_CONSENT_CACHE_KEY, nuevosArchivados, CONSENT_CACHE_TTL);
      
      // Utilizar AbortController para establecer un timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout (aumentado de 15s a 25s)
      
      try {
        // Usar RPC para ejecutar una función que actualice el registro
        const { data, error } = await supabase.rpc('archivar_consentimiento', {
          consentimiento_id: id
        }).abortSignal(controller.signal);
        
        clearTimeout(timeoutId);
        
        if (error) {
          console.error('Error al archivar consentimiento:', error);
          throw new Error(`Error al archivar consentimiento: ${error.message}`);
        }
        
        console.log('Consentimiento archivado en Supabase:', data);
        console.log('Estado local actualizado correctamente');
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Tiempo de espera agotado al archivar el consentimiento. Por favor intente nuevamente.');
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Error en archivarConsentimiento:', error);
      
      // Re-verificar conexión para actualizar estado
      const stillConnected = await checkSupabaseConnection();
      if (!stillConnected) {
        setConnectionError(true);
      }
      
      throw error;
    }
  };

  const getEstadisticas = (): EstadisticasGenerales => {
    const activosConsentimientos = consentimientos;
    
    const totalFormularios = activosConsentimientos.length;
    const menoresEdad = activosConsentimientos.filter(c => c.cliente.edad < 18).length;
    const mayoresEdad = totalFormularios - menoresEdad;
    
    const porDiaMap = new Map<string, number>();
    activosConsentimientos.forEach(c => {
      try {
        const fecha = format(parseISO(c.fechaCreacion), 'yyyy-MM-dd');
        porDiaMap.set(fecha, (porDiaMap.get(fecha) || 0) + 1);
      } catch (e) {
        console.error('Error al formatear fecha:', e);
      }
    });
    
    const porDia = Array.from(porDiaMap.entries()).map(([fecha, cantidad]) => ({
      fecha: format(parseISO(fecha), 'dd/MM/yyyy'),
      cantidad
    })).sort((a, b) => a.fecha.localeCompare(b.fecha));
    
    const porMesMap = new Map<string, number>();
    activosConsentimientos.forEach(c => {
      try {
        const mes = format(parseISO(c.fechaCreacion), 'yyyy-MM');
        porMesMap.set(mes, (porMesMap.get(mes) || 0) + 1);
      } catch (e) {
        console.error('Error al formatear mes:', e);
      }
    });
    
    const porMes = Array.from(porMesMap.entries()).map(([mes, cantidad]) => ({
      mes: format(parseISO(`${mes}-01`), 'MMMM yyyy', { locale: es }),
      cantidad
    })).sort((a, b) => a.mes.localeCompare(b.mes));
    
    const artistasMap = new Map<string, number>();
    activosConsentimientos.forEach(c => {
      const artista = c.artistaSeleccionado;
      if (artista) {
        artistasMap.set(artista, (artistasMap.get(artista) || 0) + 1);
      }
    });
    
    const artistasStats: EstadisticaArtista[] = Array.from(artistasMap.entries())
      .map(([nombre, totalClientes]) => ({ nombre, totalClientes }))
      .sort((a, b) => b.totalClientes - a.totalClientes);
    
    return {
      totalFormularios,
      menoresEdad,
      mayoresEdad,
      porDia,
      porMes,
      artistasStats
    };
  };

  return (
    <ConsentimientosContext.Provider value={{
      consentimientos,
      consentimientosArchivados,
      addConsentimiento,
      getConsentimiento,
      getConsentimientoPorCodigo,
      archivarConsentimiento,
      getEstadisticas,
      connectionError,
      isLoading: loading,
      retryConnection
    }}>
      {children}
    </ConsentimientosContext.Provider>
  );
};

export const useConsentimientos = () => {
  const context = useContext(ConsentimientosContext);
  if (context === undefined) {
    throw new Error('useConsentimientos debe usarse dentro de un ConsentimientosProvider');
  }
  return context;
};