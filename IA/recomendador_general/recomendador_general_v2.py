"""
recomendador_general_v2.py

Motor de recomendaciones para la pantalla de inicio.

Comportamiento por tipo de usuario:
    cold_start   — Solo ve: más comprados + descuentos.
    poco_activo  — Ve: carrito (si tiene) + wishlist (si tiene) + más comprados + descuentos.
    muy_activo   — Ve todo: carrito + wishlist + pedidos anteriores + más comprados + descuentos.
"""

import time
from datetime import datetime

from core.models_V2 import SubcatalogoResultado, ItemSugerido
from core.repositorio_db_v2 import RepositorioPostgresV2
from recomendador_general.clasificador_usuario import ClasificadorUsuario


class RecomendadorGeneral:
    def __init__(self, repositorio: RepositorioPostgresV2):
        self.repo          = repositorio
        self.clasificador  = ClasificadorUsuario(repositorio)

    def obtener_home_recomendaciones(
        self, id_usuario: int, limite_por_seccion: int = 5
    ) -> dict:
        """
        Devuelve la estructura lista para el Frontend con los carruseles personalizados según el tipo de usuario.
        """
        t0 = time.time()

        # ── 1. Clasificar usuario ─────────────────────────────────────────
        perfil       = self.clasificador.clasificar(id_usuario)
        tipo_usuario = perfil.tipo_usuario

        # ── 2. Obtener datos crudos desde la BD ───────────────────────────
        datos_crudos = self.repo.obtener_recomendaciones_generales(
            id_usuario, limite_por_seccion
        )

        # ── 3. Definir qué secciones mostrar según el tipo de usuario ─────
        if tipo_usuario == "cold_start":
            secciones_visibles = ["mas_comprados", "descuentos"]

        elif tipo_usuario == "poco_activo":
            secciones_visibles = ["carrito", "wishlist", "mas_comprados", "descuentos"]

        else:  # muy_activo
            secciones_visibles = [
                "carrito", "wishlist", "pedidos_anteriores",
                "mas_comprados", "descuentos",
            ]

        # ── 4. Títulos para el Frontend ───────────────────────────────────
        nombres_secciones = {
            "carrito":            "Continúa tu compra",
            "wishlist":           "De tu Lista de Deseos",
            "pedidos_anteriores": "Vuelve a pedirlo",
            "mas_comprados":      "Lo más popular",
            "descuentos":         "Aprovecha estas ofertas",
        }

        # ── 5. Construir carruseles ───────────────────────────────────────
        carruseles = []

        for clave in secciones_visibles:
            items_catalogo = datos_crudos.get(clave, [])
            if not items_catalogo:
                continue  # No mostrar carruseles vacíos

            items_sugeridos = []
            for item in items_catalogo:
                etiqueta = self._generar_etiqueta(clave, item)

                items_sugeridos.append(ItemSugerido(
                    item_id              = item.item_id,
                    tipo                 = item.tipo,
                    nombre               = item.nombre,
                    categoria_principal  = item.categorias[0] if item.categorias else "",
                    precio_unitario      = item.precio,
                    precio_final         = item.precio_final,
                    cantidad_sugerida    = 1,
                    precio_total         = item.precio_final,
                    razon_cantidad       = self._razon_por_seccion(clave),
                    score_relevancia     = 1.0,
                    etiqueta             = etiqueta,
                    calificacion         = item.calificacion,
                    descuento_porcentaje = item.descuento_porcentaje,
                    nombre_negocio       = item.nombre_negocio,
                ))

            subcat = SubcatalogoResultado(
                nombre=nombres_secciones[clave],
                items=items_sugeridos,
            )
            subcat.calcular_presupuesto()
            carruseles.append(subcat)

        latencia = round((time.time() - t0) * 1000, 2)

        # ── 6. Payload final para la API ──────────────────────────────────
        return {
            "usuario_id":   id_usuario,
            "tipo_usuario": tipo_usuario,          # ← nuevo campo útil para el Frontend
            "perfil":       perfil.resumen,        # ← debug / logs
            "carruseles":   carruseles,
            "total_items":  sum(len(c.items) for c in carruseles),
            "latencia_ms":  latencia,
            "generated_at": datetime.now().isoformat(),
        }

    def _generar_etiqueta(self, clave: str, item) -> str:
        if clave == "descuentos" and item.descuento_porcentaje:
            return f"-{int(item.descuento_porcentaje)}% OFF"
        if clave == "mas_comprados":
            return "Best Seller"
        if clave == "pedidos_anteriores":
            return "Comprar de nuevo"
        if clave == "wishlist":
            return "En tu lista de deseos"
        if clave == "carrito":
            return "Pendiente en tu carrito"
        return ""

    def _razon_por_seccion(self, clave: str) -> str:
        razones = {
            "carrito":            "Lo dejaste en tu carrito.",
            "wishlist":           "Está en tu lista de deseos.",
            "pedidos_anteriores": "Ya lo compraste antes.",
            "mas_comprados":      "Popular entre otros compradores.",
            "descuentos":         "Tiene descuento activo ahora.",
        }
        return razones.get(clave, "Recomendación general.")

if __name__ == "__main__":
    DB_CONFIG = {
        "host":     "localhost",
        "database": "issi",
        "user":     "miyata",
        "password": "525125",
        "port":     5432,
    }

    try:
        repo         = RepositorioPostgresV2(DB_CONFIG)
        recomendador = RecomendadorGeneral(repo)

        for uid in [1, 2, 3]:
            print(f"\n{'='*55}")
            print(f"  Recomendaciones para usuario {uid}")
            print(f"{'='*55}")

            resultado = recomendador.obtener_home_recomendaciones(
                id_usuario=uid, limite_por_seccion=3
            )

            print(f"  Tipo : {resultado['tipo_usuario'].upper()}")
            print(f"  Perfil: {resultado['perfil']}")
            print()

            for carrusel in resultado["carruseles"]:
                print(f"  [{carrusel.nombre}]")
                for item in carrusel.items:
                    etiqueta = f" [{item.etiqueta}]" if item.etiqueta else ""
                    print(f"    · {item.nombre:<45} ${item.precio_final:>8.2f}{etiqueta}")
                print()

            print(f"  Total items : {resultado['total_items']}")
            print(f"  Latencia    : {resultado['latencia_ms']} ms")

    except Exception as e:
        print(f"\n[!] Error: {e}")
        print("→ Verifica que DB_CONFIG tenga las credenciales correctas.")