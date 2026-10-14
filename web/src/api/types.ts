/**
 * Tipos de lo que devuelve la API, sacados directamente de las funciones
 * del servidor que la construyen. Si el servidor cambia un campo, la
 * comprobacion de tipos del panel falla en el sitio exacto: los dos lados
 * no pueden desincronizarse sin que se note.
 *
 * Son importaciones solo de tipos: no viaja nada del servidor al navegador.
 */
import type { datosResumen } from '../../../src/web/datos/resumen';
import type { datosTokens } from '../../../src/web/datos/tokens';
import type { datosToken } from '../../../src/web/datos/token';
import type { datosAlertas } from '../../../src/web/datos/alertas';
import type { datosResultados } from '../../../src/web/datos/resultados';
import type { datosSistema, datosActividad } from '../../../src/web/datos/sistema';
import type {
  datosTelegramResumen, datosFuentes, datosMenciones, datosMensajes, datosDescubiertos,
} from '../../../src/web/datos/telegram';
import type { datosConvergenciaResumen, datosVeredictos } from '../../../src/web/datos/convergencia';
import type { TokenFila } from '../../../src/web/datos/comun';
import type { ResumenRobot } from '../../../src/worker/robots';

type R<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

export type { TokenFila, ResumenRobot };
export type Resumen = R<typeof datosResumen>;
export type ListaTokens = R<typeof datosTokens>;
export type FichaToken = NonNullable<R<typeof datosToken>>;
export type ListaAlertas = R<typeof datosAlertas>;
export type Resultados = R<typeof datosResultados>;
export type Sistema = R<typeof datosSistema>;
export type ListaActividad = R<typeof datosActividad>;
export type TelegramResumen = R<typeof datosTelegramResumen>;
export type ListaFuentes = R<typeof datosFuentes>;
export type ListaMenciones = R<typeof datosMenciones>;
export type ListaMensajes = R<typeof datosMensajes>;
export type ListaDescubiertos = R<typeof datosDescubiertos>;
export type ConvergenciaResumen = R<typeof datosConvergenciaResumen>;
export type ListaVeredictos = R<typeof datosVeredictos>;
export type Veredicto = ListaVeredictos['items'][number];

export interface EstadoPanel {
  pausado: boolean;
  tareasCaidas: string[];
}
