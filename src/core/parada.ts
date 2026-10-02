/**
 * Aviso de parada para las tareas largas.
 *
 * Al reiniciar el servicio se cerraba la base de datos con las vueltas a
 * medias: el lector de Telegram, que tarda hasta dos minutos, fallaba en el
 * mensaje que estuviera procesando y ese mensaje podia quedar guardado sin
 * analizar, y ya no se volvia a mirar. Ahora el motor avisa de que se va a
 * parar, las tareas largas terminan lo que tienen entre manos y no empiezan
 * nada nuevo, y solo entonces se cierra la base de datos.
 */
let parando = false;

export function pedirParada(): void {
  parando = true;
}

export function sePidioParar(): boolean {
  return parando;
}
