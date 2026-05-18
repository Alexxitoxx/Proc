"""
repositorio_db_v2.py

Repositorio PostgreSQL para el módulo de recomendaciones generales (home).
Implementa todas las consultas que necesita RecomendadorGeneral.

Consultas que expone:
    · obtener_recomendaciones_generales()  → carruseles del home
    · obtener_actividad_usuario()          → para ClasificadorUsuario
    · obtener_similares_por_embedding()    → similitud coseno (pgvector)

Importado por:
    · recomendador_general_v2.py
    · clasificador_usuario.py
"""

import logging
from typing import Optional

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    _DRIVER_OK = True
except ImportError:
    _DRIVER_OK = False

from core.models_V2 import ItemCatalogo

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
)


# ═══════════════════════════════════════════════════════════════════════════
#  CLASE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════

class RepositorioPostgresV2:
    """
    Capa de acceso a datos para las recomendaciones del home.

    Parámetro DB_CONFIG de ejemplo:
        {
            "host":     "localhost",
            "database": "issi",
            "user":     "miyata",
            "password": "525125",
            "port":     5432
        }
    """

    def __init__(self, db_config: dict):
        self.db_config = db_config

    # ─────────────────────────────────────────────────────────────────────
    #  CONEXIÓN
    # ─────────────────────────────────────────────────────────────────────
    def _abrir(self):
        if not _DRIVER_OK:
            raise RuntimeError("psycopg2 no instalado. Ejecutar: pip install psycopg2-binary")
        # Soporte para clave 'database' o 'dbname' indistintamente
        config = dict(self.db_config)
        if "database" in config and "dbname" not in config:
            config["dbname"] = config.pop("database")
        return psycopg2.connect(**config)

    # ─────────────────────────────────────────────────────────────────────
    #  MÉTODO PRINCIPAL — llamado por RecomendadorGeneral
    # ─────────────────────────────────────────────────────────────────────
    def obtener_recomendaciones_generales(
        self, id_usuario: int, limite_por_seccion: int = 5
    ) -> dict:
        """
        Devuelve un dict con hasta 5 secciones de recomendaciones.
        Cada sección es una lista de ItemCatalogo.

        Estructura devuelta:
        {
            "carrito":           [ItemCatalogo, ...],
            "wishlist":          [ItemCatalogo, ...],
            "pedidos_anteriores":[ItemCatalogo, ...],
            "mas_comprados":     [ItemCatalogo, ...],
            "descuentos":        [ItemCatalogo, ...],
        }

        Si el usuario es cold_start, carrito/wishlist/pedidos estarán vacíos
        y el recomendador usará mas_comprados y descuentos como fallback.
        """
        resultado = {}

        try:
            conn = self._abrir()

            resultado["carrito"]            = self._items_en_carrito(conn, id_usuario, limite_por_seccion)
            resultado["wishlist"]           = self._items_en_wishlist(conn, id_usuario, limite_por_seccion)
            resultado["pedidos_anteriores"] = self._items_pedidos_anteriores(conn, id_usuario, limite_por_seccion)
            resultado["mas_comprados"]      = self._items_mas_comprados(conn, limite_por_seccion)
            resultado["descuentos"]         = self._items_con_descuento(conn, limite_por_seccion)

            conn.close()

        except Exception as e:
            logging.error(f"Error en obtener_recomendaciones_generales (usuario {id_usuario}): {e}")

        return resultado

    # ─────────────────────────────────────────────────────────────────────
    #  SECCIÓN 1 — CARRITO ACTIVO
    #  Productos/servicios que el usuario dejó en el carrito sin comprar.
    # ─────────────────────────────────────────────────────────────────────
    def _items_en_carrito(
        self, conn, id_usuario: int, limite: int
    ) -> list[ItemCatalogo]:
        """
        Lee carrito → carrito_items y enriquece con datos del producto/servicio.
        Solo devuelve items activos y con stock.
        """
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                'P-' || p.id                                    AS item_id,
                'producto'                                      AS tipo,
                p.nombre,
                p.descripcion,
                obtener_precio_vigente(p.id, NULL)              AS precio,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.calificacion,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN p.precio > 0
                     AND obtener_precio_vigente(p.id, NULL) < p.precio
                    THEN ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias
            FROM carrito           ca
            JOIN carrito_items     ci ON ci.id_carrito = ca.id
            JOIN productos         p  ON p.id = ci.id_producto
            JOIN negocios          n  ON n.id = p.id_negocio
            LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
            LEFT JOIN categorias   c  ON c.id = pc.id_categoria
            WHERE ca.id_usuario  = %s
              AND p.esta_activo  = TRUE
              AND p.stock_total  > 0
            GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                     p.precio, p.esta_activo, n.nombre_comercial
            ORDER BY p.calificacion DESC NULLS LAST
            LIMIT %s
        """, (id_usuario, limite))
        filas = cur.fetchall()

        # También servicios en el carrito
        cur.execute("""
            SELECT
                'S-' || s.id                                    AS item_id,
                'servicio'                                      AS tipo,
                s.nombre,
                s.descripcion,
                obtener_precio_vigente(NULL, s.id)              AS precio,
                obtener_precio_vigente(NULL, s.id)              AS precio_final,
                s.calificacion,
                s.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN s.precio_base > 0
                     AND obtener_precio_vigente(NULL, s.id) < s.precio_base
                    THEN ROUND((1 - obtener_precio_vigente(NULL, s.id) / s.precio_base) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias
            FROM carrito           ca
            JOIN carrito_items     ci ON ci.id_carrito = ca.id
            JOIN servicios         s  ON s.id = ci.id_servicio
            JOIN negocios          n  ON n.id = s.id_negocio
            LEFT JOIN servicio_categoria sc ON sc.id_servicio = s.id
            LEFT JOIN categorias   c  ON c.id = sc.id_categoria
            WHERE ca.id_usuario  = %s
              AND s.esta_activo  = TRUE
            GROUP BY s.id, s.nombre, s.descripcion, s.calificacion,
                     s.precio_base, s.esta_activo, n.nombre_comercial
            LIMIT %s
        """, (id_usuario, limite))
        filas += cur.fetchall()
        cur.close()

        return [self._fila_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  SECCIÓN 2 — WISHLIST
    #  Items guardados en listas de deseos del usuario.
    # ─────────────────────────────────────────────────────────────────────
    def _items_en_wishlist(
        self, conn, id_usuario: int, limite: int
    ) -> list[ItemCatalogo]:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                'P-' || p.id                                    AS item_id,
                'producto'                                      AS tipo,
                p.nombre,
                p.descripcion,
                obtener_precio_vigente(p.id, NULL)              AS precio,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.calificacion,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN p.precio > 0
                     AND obtener_precio_vigente(p.id, NULL) < p.precio
                    THEN ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias
            FROM listas_deseos     ld
            JOIN wishlist_items    wi ON wi.id_lista = ld.id
            JOIN productos         p  ON p.id = wi.id_producto
            JOIN negocios          n  ON n.id = p.id_negocio
            LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
            LEFT JOIN categorias   c  ON c.id = pc.id_categoria
            WHERE ld.id_usuario  = %s
              AND p.esta_activo  = TRUE
              AND p.stock_total  > 0
            GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                     p.precio, p.esta_activo, n.nombre_comercial
            ORDER BY MAX(wi.fecha_agregado) DESC
            LIMIT %s
        """, (id_usuario, limite))
        filas = cur.fetchall()

        cur.execute("""
            SELECT
                'S-' || s.id                                    AS item_id,
                'servicio'                                      AS tipo,
                s.nombre,
                s.descripcion,
                obtener_precio_vigente(NULL, s.id)              AS precio,
                obtener_precio_vigente(NULL, s.id)              AS precio_final,
                s.calificacion,
                s.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN s.precio_base > 0
                     AND obtener_precio_vigente(NULL, s.id) < s.precio_base
                    THEN ROUND((1 - obtener_precio_vigente(NULL, s.id) / s.precio_base) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias
            FROM listas_deseos     ld
            JOIN wishlist_items    wi ON wi.id_lista = ld.id
            JOIN servicios         s  ON s.id = wi.id_servicio
            JOIN negocios          n  ON n.id = s.id_negocio
            LEFT JOIN servicio_categoria sc ON sc.id_servicio = s.id
            LEFT JOIN categorias   c  ON c.id = sc.id_categoria
            WHERE ld.id_usuario  = %s
              AND s.esta_activo  = TRUE
            GROUP BY s.id, s.nombre, s.descripcion, s.calificacion,
                     s.precio_base, s.esta_activo, n.nombre_comercial
            ORDER BY MAX(wi.fecha_agregado) DESC
            LIMIT %s
        """, (id_usuario, limite))
        filas += cur.fetchall()
        cur.close()

        return [self._fila_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  SECCIÓN 3 — PEDIDOS ANTERIORES
    #  Items que el usuario ya compró. Recomendamos volver a pedirlos.
    # ─────────────────────────────────────────────────────────────────────
    def _items_pedidos_anteriores(
        self, conn, id_usuario: int, limite: int
    ) -> list[ItemCatalogo]:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                'P-' || p.id                                    AS item_id,
                'producto'                                      AS tipo,
                p.nombre,
                p.descripcion,
                obtener_precio_vigente(p.id, NULL)              AS precio,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.calificacion,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN p.precio > 0
                     AND obtener_precio_vigente(p.id, NULL) < p.precio
                    THEN ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias,
                MAX(pe.fecha_pedido)                            AS ultima_compra
            FROM pedidos           pe
            JOIN detalle_pedido    dp ON dp.id_pedido = pe.id
            JOIN productos         p  ON p.id = dp.id_producto
            JOIN negocios          n  ON n.id = p.id_negocio
            LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
            LEFT JOIN categorias   c  ON c.id = pc.id_categoria
            WHERE pe.id_usuario  = %s
              AND pe.estado_pedido NOT IN ('CANCELADO')
              AND p.esta_activo   = TRUE
              AND p.stock_total   > 0
            GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                     p.precio, p.esta_activo, n.nombre_comercial
            ORDER BY ultima_compra DESC
            LIMIT %s
        """, (id_usuario, limite))
        filas = cur.fetchall()
        cur.close()

        return [self._fila_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  SECCIÓN 4 — MÁS COMPRADOS (global, sin importar usuario)
    #  Fallback principal para Cold Start y usuarios poco activos.
    # ─────────────────────────────────────────────────────────────────────
    def _items_mas_comprados(
        self, conn, limite: int
    ) -> list[ItemCatalogo]:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                'P-' || p.id                                    AS item_id,
                'producto'                                      AS tipo,
                p.nombre,
                p.descripcion,
                obtener_precio_vigente(p.id, NULL)              AS precio,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.calificacion,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                CASE
                    WHEN p.precio > 0
                     AND obtener_precio_vigente(p.id, NULL) < p.precio
                    THEN ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                    ELSE NULL
                END                                             AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias,
                COUNT(dp.id)                                    AS veces_comprado
            FROM detalle_pedido    dp
            JOIN pedidos           pe ON pe.id = dp.id_pedido
            JOIN productos         p  ON p.id = dp.id_producto
            JOIN negocios          n  ON n.id = p.id_negocio
            LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
            LEFT JOIN categorias   c  ON c.id = pc.id_categoria
            WHERE pe.estado_pedido NOT IN ('CANCELADO')
              AND p.esta_activo   = TRUE
              AND p.stock_total   > 0
              AND pe.fecha_pedido >= NOW() - INTERVAL '30 days'
            GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                     p.precio, p.esta_activo, n.nombre_comercial
            ORDER BY veces_comprado DESC, p.calificacion DESC NULLS LAST
            LIMIT %s
        """, (limite,))
        filas = cur.fetchall()
        cur.close()

        return [self._fila_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  SECCIÓN 5 — DESCUENTOS ACTIVOS
    #  Items con descuento vigente, ordenados por mayor ahorro.
    # ─────────────────────────────────────────────────────────────────────
    def _items_con_descuento(
        self, conn, limite: int
    ) -> list[ItemCatalogo]:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                'P-' || p.id                                    AS item_id,
                'producto'                                      AS tipo,
                p.nombre,
                p.descripcion,
                p.precio                                        AS precio,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.calificacion,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,
                ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                                                                AS descuento_porcentaje,
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias
            FROM productos         p
            JOIN descuentos        d  ON d.id = p.id_descuento
            JOIN negocios          n  ON n.id = p.id_negocio
            LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
            LEFT JOIN categorias   c  ON c.id = pc.id_categoria
            WHERE p.esta_activo   = TRUE
              AND p.stock_total   > 0
              AND d.codigo_cupon  IS NULL
              AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
            GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                     p.precio, p.esta_activo, n.nombre_comercial
            ORDER BY descuento_porcentaje DESC, p.calificacion DESC NULLS LAST
            LIMIT %s
        """, (limite,))
        filas = cur.fetchall()
        cur.close()

        return [self._fila_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  ACTIVIDAD DE USUARIO — usado por ClasificadorUsuario
    # ─────────────────────────────────────────────────────────────────────
    def obtener_actividad_usuario(self, id_usuario: int) -> dict:
        """
        Devuelve un dict listo para construir PerfilActividad.
        Una sola consulta con subconsultas para minimizar round-trips.
        """
        try:
            conn = self._abrir()
            cur  = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("""
                SELECT
                    -- Total de pedidos no cancelados
                    (SELECT COUNT(*) FROM pedidos
                     WHERE id_usuario = %s
                       AND estado_pedido NOT IN ('CANCELADO')
                    )                                           AS total_pedidos,

                    -- Total de interacciones históricas
                    (SELECT COUNT(*) FROM interacciones_usuario
                     WHERE id_usuario = %s
                    )                                           AS total_interacciones,

                    -- Interacciones en los últimos 7 días
                    (SELECT COUNT(*) FROM interacciones_usuario
                     WHERE id_usuario = %s
                       AND fecha_hora >= NOW() - INTERVAL '7 days'
                    )                                           AS interacciones_ultimos_7_dias,

                    -- Items activos en carrito
                    (SELECT COUNT(*) FROM carrito ca
                     JOIN carrito_items ci ON ci.id_carrito = ca.id
                     WHERE ca.id_usuario = %s
                    )                                           AS items_en_carrito,

                    -- Items en listas de deseos
                    (SELECT COUNT(*) FROM listas_deseos ld
                     JOIN wishlist_items wi ON wi.id_lista = ld.id
                     WHERE ld.id_usuario = %s
                    )                                           AS items_en_wishlist,

                    -- Días desde el último pedido (NULL si nunca compró)
                    (SELECT EXTRACT(DAY FROM NOW() - MAX(fecha_pedido))::INT
                     FROM pedidos
                     WHERE id_usuario = %s
                       AND estado_pedido NOT IN ('CANCELADO')
                    )                                           AS dias_desde_ultimo_pedido
            """, (id_usuario,) * 6)

            fila = cur.fetchone()
            cur.close()
            conn.close()

            return {
                "id_usuario":                   id_usuario,
                "total_pedidos":                int(fila["total_pedidos"]),
                "total_interacciones":          int(fila["total_interacciones"]),
                "interacciones_ultimos_7_dias": int(fila["interacciones_ultimos_7_dias"]),
                "items_en_carrito":             int(fila["items_en_carrito"]),
                "items_en_wishlist":            int(fila["items_en_wishlist"]),
                "dias_desde_ultimo_pedido":     fila["dias_desde_ultimo_pedido"],
            }

        except Exception as e:
            logging.error(f"Error en obtener_actividad_usuario ({id_usuario}): {e}")
            # Devuelve perfil vacío → se clasificará como cold_start
            return {
                "id_usuario":                   id_usuario,
                "total_pedidos":                0,
                "total_interacciones":          0,
                "interacciones_ultimos_7_dias": 0,
                "items_en_carrito":             0,
                "items_en_wishlist":            0,
                "dias_desde_ultimo_pedido":     None,
            }

    # ─────────────────────────────────────────────────────────────────────
    #  SIMILITUD COSENO — búsqueda por embedding (pgvector)
    #  Usado cuando el usuario tiene historial rico (muy_activo).
    #
    #  REQUISITO: Los embeddings deben estar generados en la BD.
    #  Ver: generar_embeddings.py para poblar embedding_vector.
    # ─────────────────────────────────────────────────────────────────────
    def obtener_similares_por_embedding(
        self,
        embedding: list[float],
        tipo: str = "producto",       # "producto" | "servicio"
        excluir_ids: list[str] = None,
        limite: int = 10,
    ) -> list[ItemCatalogo]:
        """
        Busca los N items más similares al embedding dado usando
        distancia coseno (<=> operador de pgvector).

        Parámetros:
            embedding    — Vector float[1536] generado por OpenAI/tu modelo
            tipo         — Buscar en tabla productos o servicios
            excluir_ids  — IDs a excluir (ej: los que ya están en el carrito)
            limite       — Cuántos resultados devolver

        Retorna lista de ItemCatalogo ordenada por similitud descendente.
        """
        if excluir_ids is None:
            excluir_ids = []

        # Extraer los ids numéricos de strings tipo "P-5", "S-3"
        ids_numericos = []
        for id_str in excluir_ids:
            try:
                ids_numericos.append(int(id_str.split("-")[1]))
            except (IndexError, ValueError):
                pass

        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        try:
            conn = self._abrir()
            cur  = conn.cursor(cursor_factory=RealDictCursor)

            if tipo == "producto":
                exclusion_sql = f"AND p.id NOT IN ({','.join(['%s'] * len(ids_numericos))})" if ids_numericos else ""
                cur.execute(f"""
                    SELECT
                        'P-' || p.id                                AS item_id,
                        'producto'                                  AS tipo,
                        p.nombre,
                        p.descripcion,
                        obtener_precio_vigente(p.id, NULL)          AS precio,
                        obtener_precio_vigente(p.id, NULL)          AS precio_final,
                        p.calificacion,
                        p.esta_activo,
                        n.nombre_comercial                          AS nombre_negocio,
                        CASE
                            WHEN p.precio > 0
                             AND obtener_precio_vigente(p.id, NULL) < p.precio
                            THEN ROUND((1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100, 2)
                            ELSE NULL
                        END                                         AS descuento_porcentaje,
                        ARRAY_AGG(DISTINCT c.nombre_categoria)      AS categorias,
                        1 - (p.embedding_vector <=> %s::vector)     AS similitud
                    FROM productos p
                    JOIN negocios  n  ON n.id = p.id_negocio
                    LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
                    LEFT JOIN categorias c ON c.id = pc.id_categoria
                    WHERE p.esta_activo  = TRUE
                      AND p.stock_total  > 0
                      AND p.embedding_vector IS NOT NULL
                      {exclusion_sql}
                    GROUP BY p.id, p.nombre, p.descripcion, p.calificacion,
                             p.precio, p.esta_activo, n.nombre_comercial, p.embedding_vector
                    ORDER BY p.embedding_vector <=> %s::vector
                    LIMIT %s
                """, [embedding_str] + ids_numericos + [embedding_str, limite])

            else:  # servicio
                exclusion_sql = f"AND s.id NOT IN ({','.join(['%s'] * len(ids_numericos))})" if ids_numericos else ""
                cur.execute(f"""
                    SELECT
                        'S-' || s.id                                AS item_id,
                        'servicio'                                  AS tipo,
                        s.nombre,
                        s.descripcion,
                        obtener_precio_vigente(NULL, s.id)          AS precio,
                        obtener_precio_vigente(NULL, s.id)          AS precio_final,
                        s.calificacion,
                        s.esta_activo,
                        n.nombre_comercial                          AS nombre_negocio,
                        CASE
                            WHEN s.precio_base > 0
                             AND obtener_precio_vigente(NULL, s.id) < s.precio_base
                            THEN ROUND((1 - obtener_precio_vigente(NULL, s.id) / s.precio_base) * 100, 2)
                            ELSE NULL
                        END                                         AS descuento_porcentaje,
                        ARRAY_AGG(DISTINCT c.nombre_categoria)      AS categorias,
                        1 - (s.embedding_vector <=> %s::vector)     AS similitud
                    FROM servicios s
                    JOIN negocios  n  ON n.id = s.id_negocio
                    LEFT JOIN servicio_categoria sc ON sc.id_servicio = s.id
                    LEFT JOIN categorias c ON c.id = sc.id_categoria
                    WHERE s.esta_activo = TRUE
                      AND s.embedding_vector IS NOT NULL
                      {exclusion_sql}
                    GROUP BY s.id, s.nombre, s.descripcion, s.calificacion,
                             s.precio_base, s.esta_activo, n.nombre_comercial, s.embedding_vector
                    ORDER BY s.embedding_vector <=> %s::vector
                    LIMIT %s
                """, [embedding_str] + ids_numericos + [embedding_str, limite])

            filas = cur.fetchall()
            cur.close()
            conn.close()
            return [self._fila_a_item(f) for f in filas]

        except Exception as e:
            logging.error(f"Error en obtener_similares_por_embedding: {e}")
            return []

    # ─────────────────────────────────────────────────────────────────────
    #  CONVERSOR — fila de BD → ItemCatalogo
    # ─────────────────────────────────────────────────────────────────────
    def _fila_a_item(self, fila: dict) -> ItemCatalogo:
        categorias = [c for c in (fila.get("categorias") or []) if c]
        return ItemCatalogo(
            item_id              = fila["item_id"],
            tipo                 = fila["tipo"],
            nombre               = fila["nombre"] or "",
            descripcion          = fila.get("descripcion") or "",
            precio               = float(fila["precio"] or 0),
            calificacion         = float(fila["calificacion"]) if fila.get("calificacion") else 0.0,
            esta_activo          = bool(fila.get("esta_activo", True)),
            categorias           = categorias,
            ids_categorias       = [],
            nombre_negocio       = fila.get("nombre_negocio") or "",
            descuento_porcentaje = float(fila["descuento_porcentaje"]) if fila.get("descuento_porcentaje") else None,
        )