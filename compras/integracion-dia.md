# Integración de Kitchen con DIA

Estado: diseño de prototipo, 17 de septiembre de 2026.

## Decisión actual

DIA no ofrece una API pública y documentada para iniciar sesión o modificar la cesta. La web usa endpoints internos `/api/v3/...`, pero el intento desde Playwright fue bloqueado con HTTP 403 incluso usando Chromium visible. No conviene integrar Kitchen directamente con esos endpoints ni copiar cookies de la cuenta.

El prototipo más práctico es un agente programado de Codex que utilice el navegador autenticado de Codex. El agente prepara la cesta y se detiene siempre antes de tramitar el pedido. Si la sesión ha caducado, debe pedir a Javier que vuelva a iniciar sesión y no modificar la cesta.

## Reparto de responsabilidades

Kitchen prepara una propuesta de compra a partir de:

- los elementos sin marcar de `data/shopping.json`;
- `compras/preferencias.md`;
- `compras/despensa.md`;
- las recetas seleccionadas para esa semana;
- los productos recurrentes activos de `data/recurring-items.json`, inicialmente dos garrafas de agua de 8 L por compra, descontando lo que ya esté en la cesta;
- las ideas de recetas y listas adicionales guardadas en el plan semanal;
- productos pendientes de otras tiendas o farmacia, que deben figurar en el informe pero no entrar en la cesta de DIA.

El agente de DIA:

1. Comprueba que hay una sesión autenticada y que el código postal es 29130.
2. Lee la propuesta de Kitchen y la cesta actual.
3. Busca cada producto y aplica las preferencias confirmadas.
4. Ajusta cantidades hasta el objetivo; no suma unidades ciegamente.
5. Conserva los productos que no pertenezcan a la propuesta y señala la diferencia para revisión.
6. No elige sustituciones que contradigan una preferencia ni resuelve textos ambiguos por su cuenta.
7. No selecciona entrega, no introduce pago y no confirma el pedido.
8. Escribe un informe con productos añadidos, cantidades, precio observado, faltantes, ambigüedades y cualquier acción manual necesaria.

## Contrato propuesto

Kitchen guarda la selección de la próxima semana en `data/weekly-plan.json`. El plan contiene las recetas elegidas y una señal explícita para el programador:

```json
{
  "version": 1,
  "period": "next-week",
  "selectedRecipes": ["chilli", "puchero"],
  "selectedQuickMeals": ["basic-3-pasta-with-tomato-tuna-and-olives"],
  "requests": [
    {
      "id": "request-example",
      "type": "recipe-idea",
      "text": "Buscar una receta familiar rápida con pescado"
    }
  ],
  "orderReady": true,
  "updatedAt": "2026-09-17T15:30:00.000Z"
}
```

La API `GET /api/weekly-plan` amplía ese archivo con títulos, ingredientes y los productos recurrentes activos. `selectedRecipes` contiene recetas completas y `selectedQuickMeals` contiene platos rápidos, incluidos los platos sencillos del planificador anterior y los creados con nombre más ingredientes. `requests` permite dejar una idea de receta o una lista adicional que el agente debe interpretar al preparar el pedido.

Al guardar una petición de tipo `recipe-idea`, Kitchen genera inmediatamente una receta completa para cuatro personas, la guarda como Markdown en `recipes/` con `generated: true` y `source: weekly-idea`, la añade al recetario y la selecciona en el plan semanal. La petición conserva `recipeSlug`, título, fecha y estado para mantener el vínculo y facilitar la revisión. El recetario muestra una etiqueta **Auto** y un aviso dentro del detalle; desde allí se puede revisar y editar el título o la categoría. Si la generación falla, la idea permanece guardada con estado `generation-failed` y la interfaz ofrece **Retry**.

Los recurrentes se editan mediante `GET/PUT /api/recurring-items` y viven en `data/recurring-items.json`. No se copian a `data/shopping.json`: así siguen siendo reglas de cada pedido y no elementos pendientes de la lista manual. Al cambiar una selección, una petición o un recurrente, Kitchen pone `orderReady` en `false`. Los cambios de recetas sustituyen en `data/shopping.json` únicamente los ingredientes cuyo `source` sea `weekly-plan`; mantienen intactos los productos introducidos manualmente. El programador solo puede preparar la cesta cuando `orderReady` sea `true`.

Antes de buscar productos, el agente debe comprobar que cada idea de receta tiene una receta generada vinculada y usar sus ingredientes; también debe normalizar los renglones de las listas adicionales. Si una petición sigue pendiente o es ambigua, debe dejarla como faltante y pedir revisión en vez de adivinar.

Cuando una selección de supermercado se haya confirmado una vez, se puede añadir `diaProductId` al producto preferido. Esto ahorra búsquedas y evita escoger otra variante, pero el agente debe comprobar que el nombre, formato y disponibilidad siguen coincidiendo.

El proceso debe ser idempotente: ejecutar dos veces el mismo plan deja las mismas cantidades objetivo y no duplica productos. Los elementos de `data/shopping.json` siguen sin marcar hasta que Javier confirme el pedido o la recepción.

Después de verificar que la cesta ha quedado preparada, el programador debe escribir un resumen estructurado y ejecutar el cierre:

```bash
npm run notify:order-ready -- \
  --input /ruta/temporal/resultado-compra.json \
  --idempotency-key compra-2026-09-24-dia
```

El resumen admite `store`, `completedAt`, `items`, `total`, `currency`, `recipes`, `missing`, `notes` y `basketUrl`. Cada elemento de `items` lleva `name`, `quantity`, `price` opcional y un `status`: `added`, `already-present`, `missing` o `manual`.

El comando genera `output/pdf/compra-preparada-<fecha>.pdf`, solicita a Pushbullet una URL de subida, adjunta el PDF a una notificación y guarda una clave de idempotencia. Solo después de que Pushbullet confirme el envío cambia `orderReady` a `false` y anota `lastPreparedAt` y `lastReport` en el plan. Las recetas permanecen seleccionadas, pero una ejecución posterior no vuelve a preparar la misma compra sin una nueva confirmación de Javier. Un reintento con la misma clave devuelve el resultado anterior sin mandar otro aviso.

Para probar la integración sin tocar el plan semanal se añade `--test`. El título y el PDF quedan marcados como prueba, y el comando no modifica `orderReady` ni el historial de ejecuciones.

## Ejecución programada

Una tarea semanal puede leer Kitchen, preparar recetas y dejar la cesta lista para revisión. Debe avisar únicamente cuando:

- la cesta haya quedado preparada;
- falte un producto o haya una ambigüedad;
- la cuenta necesite iniciar sesión de nuevo;
- DIA haya cambiado y la automatización ya no pueda completar una acción.

La tarea depende de que el Mac con Codex esté disponible y de que la sesión de DIA siga válida en el navegador. No debe intentar recuperarse usando una contraseña o una cookie guardada.

El aviso de Pushbullet es el último paso de una ejecución de compra, no una tarea independiente. Si no hay una tarea semanal activa, solo se envía cuando un agente prepara una cesta y ejecuta el cierre anterior.

## Evolución posterior

Kitchen ya ofrece una pantalla de próxima semana con sugerencias de platos principales, platos rápidos, creación de nuevos platos rápidos, selección desde todo el recetario, ingredientes automáticos y la señal `orderReady`. La siguiente mejora útil es consolidar cantidades compatibles entre recetas y descontar la despensa estructurada antes de preparar la cesta. El navegador queda como un adaptador reemplazable; si DIA publica una API oficial en el futuro, podrá sustituirse sin cambiar el planificador.

## Alternativa Mercadona

Mercadona presta servicio en la dirección configurada de Alhaurín de la Torre, 29130, mediante la web clásica. La comprobación del 23/09/2026 mostró la dirección aceptada, acceso a tramos de entrega y una tarifa de servicio de 8,20 €. La ayuda oficial indica que `mercadona.es` decide por código postal entre la tienda nueva y la clásica.

La interfaz clásica parece favorable para automatización con navegador: usa formularios, campos de cantidad y botones de inclusión sencillos, carga menos JavaScript y muestra la cesta en la misma pantalla. Aun así, depende de una sesión autenticada, usa un diseño antiguo basado en tablas y no ofrece una API pública documentada. Antes de convertirla en adaptador principal hay que hacer una prueba completa y reversible: iniciar sesión, añadir un producto conocido, comprobar que la cesta persiste en otro navegador o dispositivo y retirarlo. El agente seguirá deteniéndose antes de formalizar el pedido.
