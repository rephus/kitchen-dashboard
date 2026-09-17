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
- dos garrafas de agua de 8 L por compra, descontando las que ya estén en la cesta;
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

Kitchen debería generar un archivo por compra, por ejemplo `compras/pendiente.json`:

```json
{
  "purchaseId": "2026-09-21-weekly",
  "store": "dia",
  "postalCode": "29130",
  "status": "ready",
  "items": [
    {
      "source": "recurring",
      "name": "agua",
      "quantity": 2,
      "unit": "garrafa de 8 L",
      "preference": "exacta"
    },
    {
      "source": "shopping-list",
      "name": "atún en lata",
      "quantity": 1,
      "preference": "siempre en aceite de oliva"
    }
  ],
  "excluded": [
    {
      "name": "pastillas de lavavajillas",
      "reason": "comprar en Carrefour"
    }
  ]
}
```

Cuando una selección se haya confirmado una vez, se puede añadir `diaProductId` al producto preferido. Esto ahorra búsquedas y evita escoger otra variante, pero el agente debe comprobar que el nombre, formato y disponibilidad siguen coincidiendo.

El proceso debe ser idempotente: ejecutar dos veces el mismo `purchaseId` deja las mismas cantidades objetivo y no duplica productos. La propuesta solo pasa a `basket-prepared` cuando la cesta se haya verificado. Los elementos de `data/shopping.json` siguen sin marcar hasta que Javier confirme el pedido o la recepción.

## Ejecución programada

Una tarea semanal puede leer Kitchen, preparar recetas y dejar la cesta lista para revisión. Debe avisar únicamente cuando:

- la cesta haya quedado preparada;
- falte un producto o haya una ambigüedad;
- la cuenta necesite iniciar sesión de nuevo;
- DIA haya cambiado y la automatización ya no pueda completar una acción.

La tarea depende de que el Mac con Codex esté disponible y de que la sesión de DIA siga válida en el navegador. No debe intentar recuperarse usando una contraseña o una cookie guardada.

## Evolución posterior

La primera mejora útil en Kitchen es una pantalla semanal con varias recetas, selección de platos y cantidades para cuatro personas. Al confirmar, Kitchen consolida ingredientes compartidos, descuenta la despensa y genera `pendiente.json`. El navegador queda como un adaptador reemplazable; si DIA publica una API oficial en el futuro, podrá sustituirse sin cambiar el planificador.
