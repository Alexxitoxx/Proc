"""

  HOST
    · Si la BD corre en la misma computadora donde corre la IA:
      usa "localhost"

  PORT
    · PostgreSQL usa el puerto 5432 por defecto
    · Solo cambia si el equipo de BD configuró uno diferente
    · Para verificarlo: el equipo de BD ejecuta en su terminal:
      sudo -u postgres psql -c "SHOW port;"

  DBNAME
    · Es el nombre de la base de datos creada para el proyecto
    · El equipo de BD lo sabe. Para verificarlo ejecutan:
      sudo -u postgres psql -l
      y buscan el nombre en la primera columna

  USER
    · Usuario de PostgreSQL con permisos para leer productos/servicios
    · El equipo de BD crea este usuario y te lo comparte
    · Para crear uno con permisos mínimos, el equipo de BD ejecuta:
      CREATE USER ia_user WITH PASSWORD 'la_contrasena';
      GRANT SELECT ON productos, servicios, categorias,
            negocios, descuentos, interacciones_usuario,
            producto_categoria, servicio_categoria TO ia_user;
      GRANT INSERT ON sugerencias_ia TO ia_user;

  PASSWORD
    · La contraseña del usuario anterior
    · El equipo de BD la define al crear el usuario

─────────────────────────────────────────────────────────────────────────────
INSTALACIÓN DEL DRIVER
─────────────────────────────────────────────────────────────────────────────
    pip install psycopg2-binary

─────────────────────────────────────────────────────────────────────────────
PARA VERIFICAR QUE FUNCIONA ANTES DE INTEGRAR AL MOTOR
─────────────────────────────────────────────────────────────────────────────
    python conexion_bd_ia.py

=============================================================================
"""

import logging
from typing  import Optional
from datetime import datetime

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    _DRIVER_OK = True
except ImportError:
    _DRIVER_OK = False

from core.models_V2       import ItemCatalogo, SugerenciaCantidad
from recomendador_prompt.motor_prompt_v2 import RepositorioBase

logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s  %(levelname)s  %(message)s",
)


# ═════════════════════════════════════════════════════════════════════════════
#  CONFIGURACIÓN DE CONEXIÓN
#  ── Llenar con los datos que proporcione el equipo de Base de Datos ─────────
# ═════════════════════════════════════════════════════════════════════════════

DB_CONFIG = {

    # ┌─────────────────────────────────────────────────────────────────────┐
    # │  HOST — Dirección del servidor PostgreSQL                           │
    # │  · Misma máquina          → "localhost"                             │
    # │  · Otra PC en red local   → IP local, ej: "192.168.1.10"            │
    # │  · Nube (Render/Railway)  → hostname del dashboard del servicio     │
    # └─────────────────────────────────────────────────────────────────────┘
    "host"     : "localhost",          # ← ejemplo: "localhost"

    # ┌─────────────────────────────────────────────────────────────────────┐
    # │  PORT — Puerto de PostgreSQL                                        │
    # │  · Por defecto es 5432                                              │
    # │  · Verificar con el equipo de BD si usaron otro                     │
    # └─────────────────────────────────────────────────────────────────────┘
    "port"     : 5432,                   # ← ejemplo: 5432

    # ┌─────────────────────────────────────────────────────────────────────┐
    # │  DBNAME — Nombre exacto de la base de datos del proyecto            │
    # │  · El equipo de BD lo sabe                                          │
    # │  · Para verlo: sudo -u postgres psql -l                             │
    # └─────────────────────────────────────────────────────────────────────┘
    "dbname"   : "issi",          # ← ejemplo: "ecommerce_db"

    # ┌─────────────────────────────────────────────────────────────────────┐
    # │  USER — Usuario de PostgreSQL para el módulo IA                     │
    # │  · El equipo de BD crea este usuario y lo comparte                  │
    # │  · Debe tener SELECT en tablas de catálogo e INSERT en              │
    # │    sugerencias_ia (ver instrucciones arriba en el encabezado)       │
    # └─────────────────────────────────────────────────────────────────────┘
    "user"     : "miyata",          # ← ejemplo: "ia_user"

    # ┌─────────────────────────────────────────────────────────────────────┐
    # │  PASSWORD — Contraseña del usuario anterior                         │
    # │  · El equipo de BD la define al crear el usuario                    │
    # └─────────────────────────────────────────────────────────────────────┘
    "password" : "525125",          # ← ejemplo: "mi_contrasena_segura"
}


# ═════════════════════════════════════════════════════════════════════════════
#  CLASE PRINCIPAL DE CONECTIVIDAD
# ═════════════════════════════════════════════════════════════════════════════

class ConexionBDIA(RepositorioBase):
    """
    Conecta el Motor de IA con PostgreSQL en tiempo real.

    Cada llamada a buscar_items() ejecuta una query real a la BD,
    garantizando que productos nuevos aparezcan automáticamente
    en las recomendaciones sin reiniciar ni modificar la IA.

    Para activarlo en el motor, debes usar:
        repositorio = ConexionBDIA()
    """

    # ─────────────────────────────────────────────────────────────────────
    #  CONEXIÓN
    # ─────────────────────────────────────────────────────────────────────
    def _abrir(self):
        """
        Abre una conexión a PostgreSQL.
        Siempre llamar conn.close() después de usarla.
        """
        if not _DRIVER_OK:
            raise RuntimeError(
                "El driver psycopg2 no está instalado.\n"
                "Ejecutar en la terminal:  pip install psycopg2-binary"
            )
        if "LLENAR_AQUI" in str(DB_CONFIG.values()):
            raise RuntimeError(
                "DB_CONFIG incompleto.\n"
                "Llena host, port, dbname, user y password en este archivo."
            )
        return psycopg2.connect(**DB_CONFIG)

    # ─────────────────────────────────────────────────────────────────────
    #  MÉTODO PRINCIPAL — buscar_items()
    #  Llamado por el motor cada vez que el usuario escribe un prompt
    # ─────────────────────────────────────────────────────────────────────
    def buscar_items(
        self,
        nombres_categorias : list[str],
        palabras_clave     : list[str],
        precio_max         : Optional[float],
        rango_edad         : Optional[str],
        incluir_servicios  : bool,
        limite             : int = 300,
    ) -> list[ItemCatalogo]:
        """
        Consulta productos (y servicios si el prompt los requiere)
        directamente desde PostgreSQL con los filtros del prompt.

        Usa la función obtener_precio_vigente() definida en
        SCHEME/FUNCTIONS.sql para obtener el precio final con
        descuento automático ya aplicado.
        """
        items: list[ItemCatalogo] = []

        try:
            conn = self._abrir()

            productos = self._consultar_productos(
                conn, nombres_categorias, palabras_clave,
                precio_max, rango_edad, limite
            )
            items.extend(productos)

            if incluir_servicios:
                servicios = self._consultar_servicios(
                    conn, nombres_categorias, palabras_clave,
                    precio_max, rango_edad, limite // 2
                )
                items.extend(servicios)

            conn.close()

        except psycopg2.OperationalError as e:
            logging.error(
                "No se pudo conectar a PostgreSQL.\n"
                f"Verificar host, puerto y credenciales en DB_CONFIG.\n"
                f"Detalle: {e}"
            )
        except psycopg2.ProgrammingError as e:
            logging.error(
                f"Error en la query SQL. "
                f"Verificar nombres de tablas y columnas.\n"
                f"Detalle: {e}"
            )
        except Exception as e:
            logging.error(f"Error inesperado en buscar_items: {e}")

        return items

    # ─────────────────────────────────────────────────────────────────────
    #  QUERY DE PRODUCTOS
    # ─────────────────────────────────────────────────────────────────────
    def _consultar_productos(
        self,
        conn,
        nombres_categorias : list[str],
        palabras_clave     : list[str],
        precio_max         : Optional[float],
        rango_edad         : Optional[str],
        limite             : int,
    ) -> list[ItemCatalogo]:
        """
        Trae productos activos con stock desde la tabla productos.

        JOINs que hace:
          · negocios           → nombre_comercial del vendedor
          · producto_categoria → relación N:N con categorías
          · categorias         → nombre de cada categoría
          · interacciones_usuario (72h) → popularidad reciente

        Precio final: calculado con obtener_precio_vigente() de FUNCTIONS.sql
        que ya aplica el descuento automático si está vigente.
        """
        cur = conn.cursor(cursor_factory=RealDictCursor)

        condiciones = [
            "p.esta_activo = TRUE",
            "p.stock_total > 0",
        ]
        params: list = []

        # ── Filtro de precio máximo ───────────────────────────────────────
        # Compara contra el precio YA con descuento usando la función de la BD
        if precio_max:
            condiciones.append(
                "obtener_precio_vigente(p.id, NULL) <= %s"
            )
            params.append(precio_max)

        # ── Filtro de palabras clave ──────────────────────────────────────
        # Busca en nombre y descripción del producto
        # ILIKE = LIKE sin distinguir mayúsculas/minúsculas (propio de PostgreSQL)
        if palabras_clave:
            partes = []
            for kw in palabras_clave:
                partes.append(
                    "(p.nombre ILIKE %s OR p.descripcion ILIKE %s)"
                )
                params.extend([f"%{kw}%", f"%{kw}%"])
            condiciones.append(f"({' OR '.join(partes)})")

        # ── Filtro de edad ────────────────────────────────────────────────
        if rango_edad == "ninos":
            condiciones.append(
                "(p.nombre ILIKE %s OR p.descripcion ILIKE %s)"
            )
            params.extend(["%infantil%", "%infantil%"])

        # ── Filtro de categorías ──────────────────────────────────────────
        # Verifica en la tabla intermedia producto_categoria
        # si el producto pertenece a alguna de las categorías detectadas
        if nombres_categorias:
            condiciones.append("""
                EXISTS (
                    SELECT 1
                    FROM   producto_categoria  pc2
                    JOIN   categorias          c2
                           ON c2.id = pc2.id_categoria
                    WHERE  pc2.id_producto      = p.id
                      AND  c2.nombre_categoria  = ANY(%s)
                )
            """)
            params.append(nombres_categorias)

        params.append(limite)
        where = " AND ".join(condiciones)

        # ── Query principal ───────────────────────────────────────────────
        query = f"""
            SELECT
                p.id,
                p.nombre,
                p.descripcion,
                p.calificacion,
                p.precio                                        AS precio_base,
                obtener_precio_vigente(p.id, NULL)              AS precio_final,
                p.stock_total,
                p.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,

                -- Precio base para referencia
                p.precio                                        AS precio_original,

                -- Descuento: se calcula comparando precio base con precio final
                CASE
                    WHEN p.precio > 0
                     AND obtener_precio_vigente(p.id, NULL) < p.precio
                    THEN ROUND(
                        (1 - obtener_precio_vigente(p.id, NULL) / p.precio) * 100,
                        2
                    )
                    ELSE NULL
                END                                             AS descuento_porcentaje,

                -- Categorías del producto como array de texto
                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias,
                ARRAY_AGG(DISTINCT c.id)                        AS ids_categorias,

                -- Interacciones en las últimas 72 horas (popularidad)
                COUNT(DISTINCT iu.id)                           AS interacciones_recientes

            FROM        productos              p
            JOIN        negocios               n
                        ON n.id = p.id_negocio
            LEFT JOIN   producto_categoria     pc
                        ON pc.id_producto = p.id
            LEFT JOIN   categorias             c
                        ON c.id = pc.id_categoria
            LEFT JOIN   interacciones_usuario  iu
                        ON  iu.id_producto = p.id
                        AND iu.fecha_hora  >= NOW() - INTERVAL '72 hours'
            WHERE       {where}
            GROUP BY
                p.id,  p.nombre,      p.descripcion,  p.calificacion,
                p.precio, p.stock_total, p.esta_activo,
                n.nombre_comercial
            ORDER BY
                interacciones_recientes DESC,
                p.calificacion          DESC NULLS LAST
            LIMIT %s
        """

        cur.execute(query, params)
        filas = cur.fetchall()
        cur.close()

        return [self._producto_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  QUERY DE SERVICIOS
    # ─────────────────────────────────────────────────────────────────────
    def _consultar_servicios(
        self,
        conn,
        nombres_categorias : list[str],
        palabras_clave     : list[str],
        precio_max         : Optional[float],
        rango_edad         : Optional[str],
        limite             : int,
    ) -> list[ItemCatalogo]:
        """
        Trae servicios activos desde la tabla servicios.
        Misma lógica que productos pero usa servicio_categoria
        para el filtro de categorías.
        """
        cur = conn.cursor(cursor_factory=RealDictCursor)

        condiciones = ["s.esta_activo = TRUE"]
        params: list = []

        if precio_max:
            condiciones.append(
                "obtener_precio_vigente(NULL, s.id) <= %s"
            )
            params.append(precio_max)

        if palabras_clave:
            partes = []
            for kw in palabras_clave:
                partes.append(
                    "(s.nombre ILIKE %s OR s.descripcion ILIKE %s)"
                )
                params.extend([f"%{kw}%", f"%{kw}%"])
            condiciones.append(f"({' OR '.join(partes)})")

        if nombres_categorias:
            condiciones.append("""
                EXISTS (
                    SELECT 1
                    FROM   servicio_categoria  sc2
                    JOIN   categorias          c2
                           ON c2.id = sc2.id_categoria
                    WHERE  sc2.id_servicio       = s.id
                      AND  c2.nombre_categoria   = ANY(%s)
                )
            """)
            params.append(nombres_categorias)

        params.append(limite)
        where = " AND ".join(condiciones)

        query = f"""
            SELECT
                s.id,
                s.nombre,
                s.descripcion,
                s.calificacion,
                s.precio_base,
                obtener_precio_vigente(NULL, s.id)              AS precio_final,
                s.duracion_minutos,
                s.esta_activo,
                n.nombre_comercial                              AS nombre_negocio,

                CASE
                    WHEN s.precio_base > 0
                     AND obtener_precio_vigente(NULL, s.id) < s.precio_base
                    THEN ROUND(
                        (1 - obtener_precio_vigente(NULL, s.id) / s.precio_base) * 100,
                        2
                    )
                    ELSE NULL
                END                                             AS descuento_porcentaje,

                ARRAY_AGG(DISTINCT c.nombre_categoria)          AS categorias,
                ARRAY_AGG(DISTINCT c.id)                        AS ids_categorias

            FROM        servicios              s
            JOIN        negocios               n
                        ON n.id = s.id_negocio
            LEFT JOIN   servicio_categoria     sc
                        ON sc.id_servicio = s.id
            LEFT JOIN   categorias             c
                        ON c.id = sc.id_categoria
            WHERE       {where}
            GROUP BY
                s.id, s.nombre,     s.descripcion,  s.calificacion,
                s.precio_base, s.duracion_minutos, s.esta_activo,
                n.nombre_comercial
            ORDER BY
                s.calificacion DESC NULLS LAST
            LIMIT %s
        """

        cur.execute(query, params)
        filas = cur.fetchall()
        cur.close()

        return [self._servicio_a_item(f) for f in filas]

    # ─────────────────────────────────────────────────────────────────────
    #  GUARDAR SUGERENCIA
    #  INSERT en la tabla sugerencias_ia cada vez que el motor
    #  genera recomendaciones para un usuario
    # ─────────────────────────────────────────────────────────────────────
    def guardar_sugerencia(self, s: SugerenciaCantidad) -> bool:
        """
        Persiste en PostgreSQL cada item sugerido por el motor.

        Si la tabla sugerencias_ia no existe en la BD, el equipo
        de BD debe ejecutar el DDL que está en bd_repositorio_v2.py
        (sección guardar_sugerencia, en el docstring).
        """
        try:
            conn = self._abrir()
            cur  = conn.cursor()
            cur.execute("""
                INSERT INTO sugerencias_ia (
                    item_id,
                    tipo_item,
                    nombre_item,
                    categoria_principal,
                    cantidad_sugerida,
                    razon_cantidad,
                    precio_unitario,
                    precio_total_estimado,
                    subcatalogo,
                    prompt_origen,
                    personas,
                    fecha_generacion
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, NOW()
                )
            """, (
                s.item_id,
                s.tipo_item,
                s.nombre_item,
                s.categoria_principal,
                s.cantidad_sugerida,
                s.razon_cantidad,
                s.precio_unitario,
                s.precio_total_estimado,
                s.subcatalogo,
                s.prompt_origen,
                s.personas,
            ))
            conn.commit()
            cur.close()
            conn.close()
            return True

        except psycopg2.ProgrammingError as e:
            logging.error(
                "Error al guardar sugerencia. "
                "Verificar que la tabla sugerencias_ia existe en la BD.\n"
                f"Detalle: {e}"
            )
            return False
        except Exception as e:
            logging.error(f"Error inesperado en guardar_sugerencia: {e}")
            return False

    # ─────────────────────────────────────────────────────────────────────
    #  CATEGORÍAS RAÍZ
    #  Devuelve las categorías principales del árbol de categorías
    #  directamente desde la BD → siempre actualizado
    # ─────────────────────────────────────────────────────────────────────
    def obtener_categorias_raiz(self) -> list[str]:
        """
        Lee las categorías principales (id_padre IS NULL) de la
        tabla categorias. Si el equipo de BD agrega una categoría
        nueva, aparece aquí automáticamente.
        """
        try:
            conn = self._abrir()
            cur  = conn.cursor()
            cur.execute("""
                SELECT nombre_categoria
                FROM   categorias
                WHERE  id_padre IS NULL
                ORDER  BY nombre_categoria
            """)
            filas = cur.fetchall()
            cur.close()
            conn.close()
            return [f[0] for f in filas]

        except Exception as e:
            logging.error(f"Error en obtener_categorias_raiz: {e}")
            return []

    # ─────────────────────────────────────────────────────────────────────
    #  CONVERTIDORES: fila de BD → ItemCatalogo
    # ─────────────────────────────────────────────────────────────────────
    def _producto_a_item(self, fila: dict) -> ItemCatalogo:
        """
        Convierte una fila de la query de productos a ItemCatalogo.

        RealDictCursor devuelve diccionarios, acceso por nombre de columna.
        Las columnas tipo ARRAY[] de PostgreSQL llegan como lista Python.
        Los None dentro del array (de LEFT JOINs sin resultado) se limpian.
        """
        categorias     = [c for c in (fila["categorias"]     or []) if c]
        ids_categorias = [i for i in (fila["ids_categorias"] or []) if i]

        return ItemCatalogo(
            item_id              = f"P-{fila['id']}",
            tipo                 = "producto",
            nombre               = fila["nombre"],
            descripcion          = fila["descripcion"] or "",
            precio               = float(fila["precio_final"]),   # precio con descuento
            calificacion         = float(fila["calificacion"]) if fila["calificacion"] else 0.0,
            esta_activo          = bool(fila["esta_activo"]) and int(fila["stock_total"]) > 0,
            categorias           = categorias,
            ids_categorias       = ids_categorias,
            nombre_negocio       = fila["nombre_negocio"] or "",
            descuento_porcentaje = float(fila["descuento_porcentaje"]) if fila["descuento_porcentaje"] else None,
            interacciones_recientes = int(fila["interacciones_recientes"]),
        )

    def _servicio_a_item(self, fila: dict) -> ItemCatalogo:
        """
        Convierte una fila de la query de servicios a ItemCatalogo.
        Los servicios no tienen stock_total ni interacciones_usuario.
        """
        categorias     = [c for c in (fila["categorias"]     or []) if c]
        ids_categorias = [i for i in (fila["ids_categorias"] or []) if i]

        return ItemCatalogo(
            item_id              = f"S-{fila['id']}",
            tipo                 = "servicio",
            nombre               = fila["nombre"],
            descripcion          = fila["descripcion"] or "",
            precio               = float(fila["precio_final"]),
            calificacion         = float(fila["calificacion"]) if fila["calificacion"] else 0.0,
            esta_activo          = bool(fila["esta_activo"]),
            categorias           = categorias,
            ids_categorias       = ids_categorias,
            nombre_negocio       = fila["nombre_negocio"] or "",
            descuento_porcentaje = float(fila["descuento_porcentaje"]) if fila["descuento_porcentaje"] else None,
            duracion_minutos     = fila["duracion_minutos"],
        )


# ═════════════════════════════════════════════════════════════════════════════
#  DIAGNÓSTICO — para verificar la conexión antes de integrar al motor
#  Ejecutar:  python conexion_bd_ia.py
# ═════════════════════════════════════════════════════════════════════════════

def _diagnostico():
    print("\n" + "="*60)
    print("  DIAGNÓSTICO DE CONEXIÓN — Módulo IA ↔ PostgreSQL")
    print("="*60)

    # 1. Verificar driver
    if not _DRIVER_OK:
        print("\n  ✗  psycopg2 no instalado.")
        print("     Ejecutar: pip install psycopg2-binary")
        return

    print("\n  ✓  psycopg2 disponible")

    # 2. Verificar que DB_CONFIG está lleno
    vacios = [k for k, v in DB_CONFIG.items() if str(v) == "LLENAR_AQUI" or v == 0000]
    if vacios:
        print(f"\n  ✗  Faltan datos en DB_CONFIG: {vacios}")
        print("     Llenar los campos indicados en este archivo.")
        return

    print(f"\n  →  Host     : {DB_CONFIG['host']}")
    print(f"  →  Puerto   : {DB_CONFIG['port']}")
    print(f"  →  BD       : {DB_CONFIG['dbname']}")
    print(f"  →  Usuario  : {DB_CONFIG['user']}")

    # 3. Intentar conectar
    try:
        import psycopg2
        conn = psycopg2.connect(**DB_CONFIG)
        cur  = conn.cursor()

        cur.execute("SELECT version();")
        version = cur.fetchone()[0]
        print(f"\n  ✓  Conexión exitosa")
        print(f"  ✓  PostgreSQL: {version[:50]}...")

        # 4. Verificar tablas requeridas
        print("\n  Verificando tablas requeridas...")
        tablas = [
            "productos", "servicios", "categorias",
            "negocios", "producto_categoria", "servicio_categoria",
            "interacciones_usuario", "sugerencias_ia",
        ]
        cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE  table_schema = 'public'
        """)
        existentes = {r[0] for r in cur.fetchall()}

        for tabla in tablas:
            estado = "✓" if tabla in existentes else "✗  NO EXISTE"
            print(f"    {estado}  {tabla}")

        # 5. Verificar función obtener_precio_vigente
        cur.execute("""
            SELECT COUNT(*) FROM pg_proc
            WHERE  proname = 'obtener_precio_vigente'
        """)
        existe_fn = cur.fetchone()[0] > 0
        fn_estado = "✓" if existe_fn else "✗  NO EXISTE — ejecutar SCHEME/FUNCTIONS.sql"
        print(f"\n  {fn_estado}  Función obtener_precio_vigente()")

        # 6. Prueba de búsqueda real
        print("\n  Prueba de búsqueda rápida...")
        repo = ConexionBDIA()
        items = repo.buscar_items(
            nombres_categorias = [],
            palabras_clave     = [],
            precio_max         = None,
            rango_edad         = None,
            incluir_servicios  = False,
            limite             = 5,
        )

        if items:
            print(f"\n  ✓  Se encontraron {len(items)} productos (mostrando hasta 5):")
            for item in items:
                print(f"       {item.item_id}  {item.nombre[:45]:<45}  ${item.precio:,.2f}")
        else:
            print("\n  ✗  No se encontraron productos.")
            print("     Verificar que los datos estén cargados en la BD.")

        cur.close()
        conn.close()

        print("\n  ✓  Todo correcto. Listo para activar en motor_prompt_v2.py")
        print()
        print("     Asegurate de usar:")
        print("       repositorio = ConexionBDIA()")

    except Exception as e:
        print(f"\n  ✗  Error: {e}")
        print("\n  Revisar DB_CONFIG y que PostgreSQL esté corriendo.")

    print("\n" + "="*60 + "\n")


if __name__ == "__main__":
    _diagnostico()