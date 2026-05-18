"""
generar_embeddings.py

Genera los vectores de embedding para productos y servicios
y los guarda en la columna embedding_vector (vector 768) de la BD.

REQUISITOS:
    pip install requests psycopg2-binary

CONFIGURAR:
    1. OLLAMA_URL      — URL de tu servidor Ollama local (por defecto: http://localhost:11434/api/embeddings)
    2. DB_CONFIG       — credenciales de PostgreSQL

CUÁNDO EJECUTAR:
    · Una vez al inicio para poblar todos los embeddings vacíos.
    · Cada vez que se agregan productos/servicios nuevos (modo incremental).

USO:
    python generar_embeddings.py              # procesa solo los que no tienen embedding
    python generar_embeddings.py --todos      # regenera TODOS
"""

import sys
import logging
import time
import requests

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Instalar: pip install psycopg2-binary")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

OLLAMA_URL = "http://localhost:11434/api/embeddings"
MODELO_EMBEDDING = "nomic-embed-text"   # 768 dims

DB_CONFIG = {
    "host":     "localhost",
    "database": "issi",
    "user":     "miyata",
    "password": "525125",
    "port":     5432,
}

BATCH_SIZE = 20                          # Cuántos items procesar por lote
PAUSA_ENTRE_LOTES = 0.5                  # Segundos entre lotes (rate limit)

# ─────────────────────────────────────────────────────────────────────────────
#  FUNCIÓN PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

def generar_texto_para_embedding(nombre: str, descripcion: str, categorias: str) -> str:
    """
    Construye el texto semántico que se enviará a Ollama.
    """
    desc = descripcion or "Sin descripción"
    cats = categorias  or "Sin categoría"
    return f"{nombre}. {desc}. Categorías: {cats}."


def obtener_embedding(texto: str) -> list[float]:
    """Llama a tu Ollama local para vectorizar la pregunta."""
    try:
        response = requests.post(OLLAMA_URL, json={
            "model": MODELO_EMBEDDING,
            "prompt": texto
        })
        response.raise_for_status()
        return response.json()["embedding"]
    except Exception as e:
        logging.error(f"Error vectorizando texto con Ollama: {e}")
        raise


def procesar_productos(conn, solo_vacios: bool = True):
    cur = conn.cursor(cursor_factory=RealDictCursor)

    filtro = "AND p.embedding_vector IS NULL" if solo_vacios else ""
    cur.execute(f"""
        SELECT
            p.id,
            p.nombre,
            p.descripcion,
            STRING_AGG(c.nombre_categoria, ', ') AS categorias
        FROM productos p
        LEFT JOIN producto_categoria pc ON pc.id_producto = p.id
        LEFT JOIN categorias c ON c.id = pc.id_categoria
        WHERE p.esta_activo = TRUE
        {filtro}
        GROUP BY p.id, p.nombre, p.descripcion
    """)
    productos = cur.fetchall()
    logging.info(f"Productos a procesar: {len(productos)}")

    cur_upd = conn.cursor()
    procesados = 0

    for i in range(0, len(productos), BATCH_SIZE):
        lote = productos[i : i + BATCH_SIZE]
        for prod in lote:
            try:
                texto     = generar_texto_para_embedding(
                    prod["nombre"], prod["descripcion"], prod["categorias"]
                )
                embedding = obtener_embedding(texto)
                if not embedding:
                    continue
                embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

                cur_upd.execute(
                    "UPDATE productos SET embedding_vector = %s::vector WHERE id = %s",
                    (embedding_str, prod["id"])
                )
                procesados += 1
                logging.info(f"  Producto P-{prod['id']} actualizado: {prod['nombre'][:40]}")

            except Exception as e:
                logging.error(f"  Error en producto P-{prod['id']}: {e}")

        conn.commit()
        time.sleep(PAUSA_ENTRE_LOTES)

    cur.close()
    cur_upd.close()
    logging.info(f"Productos completados: {procesados}/{len(productos)}")


def procesar_servicios(conn, solo_vacios: bool = True):
    cur = conn.cursor(cursor_factory=RealDictCursor)

    filtro = "AND s.embedding_vector IS NULL" if solo_vacios else ""
    cur.execute(f"""
        SELECT
            s.id,
            s.nombre,
            s.descripcion,
            STRING_AGG(c.nombre_categoria, ', ') AS categorias
        FROM servicios s
        LEFT JOIN servicio_categoria sc ON sc.id_servicio = s.id
        LEFT JOIN categorias c ON c.id = sc.id_categoria
        WHERE s.esta_activo = TRUE
        {filtro}
        GROUP BY s.id, s.nombre, s.descripcion
    """)
    servicios = cur.fetchall()
    logging.info(f"Servicios a procesar: {len(servicios)}")

    cur_upd = conn.cursor()
    procesados = 0

    for i in range(0, len(servicios), BATCH_SIZE):
        lote = servicios[i : i + BATCH_SIZE]
        for serv in lote:
            try:
                texto     = generar_texto_para_embedding(
                    serv["nombre"], serv["descripcion"], serv["categorias"]
                )
                embedding = obtener_embedding(texto)
                if not embedding:
                    continue
                embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

                cur_upd.execute(
                    "UPDATE servicios SET embedding_vector = %s::vector WHERE id = %s",
                    (embedding_str, serv["id"])
                )
                procesados += 1
                logging.info(f"  Servicio S-{serv['id']} actualizado: {serv['nombre'][:40]}")

            except Exception as e:
                logging.error(f"  Error en servicio S-{serv['id']}: {e}")

        conn.commit()
        time.sleep(PAUSA_ENTRE_LOTES)

    cur.close()
    cur_upd.close()
    logging.info(f"Servicios completados: {procesados}/{len(servicios)}")


def main():
    solo_vacios = "--todos" not in sys.argv
    modo = "incremental (solo sin embedding)" if solo_vacios else "completo (regenerar todos)"
    logging.info(f"Modo: {modo}")

    config = dict(DB_CONFIG)
    if "database" in config and "dbname" not in config:
        config["dbname"] = config.pop("database")
    conn = psycopg2.connect(**config)

    try:
        procesar_productos(conn, solo_vacios)
        procesar_servicios(conn, solo_vacios)
        logging.info("Embeddings generados correctamente con Ollama.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()