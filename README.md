# 🚀 Junior Astronaut Mission Trainer

Juego multijugador estilo **Among Us** donde un grupo de astronautas junior debe completar misiones en una estación espacial mientras un impostor sabotea la tripulación.

Sin base de datos y **sin dependencias**: el servidor usa los WebSockets nativos de [Bun](https://bun.sh).

## Cómo jugar

### Requisitos
- [Bun](https://bun.sh) instalado (nada más).

### Arrancar
```bash
bun server.ts
# o
bun start
```
Abre http://localhost:3000

Un jugador crea la sala, comparte el código, los demás se unen y el anfitrión pulsa **Iniciar partida** (mínimo 3 jugadores).

## Controles
- `W A S D` o flechas: moverse
- `ESPACIO`: hacer tareas (mantener) o eliminar (si sos impostor)
- `R`: reportar un cuerpo
- `E`: reunión de emergencia (en la cafetería)
- En reunión: clic en un jugador para votar, luego **Confirmar voto**

## Cómo se gana
- **Tripulación**: completa todas las tareas o expulsa al impostor.
- **Impostor**: elimina a la tripulación hasta quedar en ventaja (o empate).

## Estructura
- `server.ts` — servidor WebSocket + archivos estáticos (estado en memoria)
- `public/index.html` — interfaz
- `public/style.css` — estilos
- `public/game.js` — lógica del cliente (canvas)

## Desplegar
El servidor mantiene las salas en memoria, así que un solo proceso basta. Sirve en Render, Railway o Fly.io con el comando `bun server.ts` y el puerto de la variable `PORT`.
