---
name: llenar-seccion-excel
description: Llena una sección de la ficha en Excel con ver_hoja, llenar_campos y llenar_tablas en grupos. Usar en cada sección del llenado.
---

# Llenar la sección en el Excel

1. `ver_hoja` **una vez** (rango acotado, p. ej. A1:M40).
2. `llenar_campos` con **todos** los campos de la guía (`no_encontrado` si no hay evidencia). Corrige solo lo que la herramienta rechace.
3. Tablas: grupos de 8–12. Read **solo** esas guías (`05_secciones_a_llenar/.../tablas/<id>.md`), `llenar_tablas`, corrige rechazadas, siguiente grupo.
4. Entre grupos **no** vuelvas a Grep, a leer PDF ni a `ver_hoja`.
5. Cuando campos y tablas pendientes estén entregados, un último mensaje: `Listo`.
