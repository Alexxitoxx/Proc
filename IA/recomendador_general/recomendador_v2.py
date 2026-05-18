import time
from datetime import datetime
from core.models_V2 import SubcatalogoResultado, ItemSugerido
from core.repositorio_db_v2 import RepositorioPostgresV2

class RecomendadorGeneral:
    def __init__(self, repositorio: RepositorioPostgresV2):
        self.repo = repositorio

    def obtener_home_recomendaciones(self, id_usuario: int, limite_por_seccion: int = 5) -> dict:
        t0 = time.time()
        
        # 1. Obtener datos crudos desde la Base de Datos
        datos_crudos = self.repo.obtener_recomendaciones_generales(id_usuario, limite_por_seccion)
        
        carruseles = []
        
        # 2. Definir los títulos de las secciones para el Frontend
        nombres_secciones = {
            "carrito": "Continúa tu compra",
            "wishlist": "De tu Lista de Deseos",
            "pedidos_anteriores": "Vuelve a pedirlo",
            "mas_comprados": "Lo más popular",
            "descuentos": "Aprovecha estas ofertas"
        }
        
        # 3. Formatear y construir los carruseles (SubcatalogoResultado)
        # Respetamos el orden específico de visualización que definimos en `nombres_secciones`
        for clave in nombres_secciones.keys():
            items_catalogo = datos_crudos.get(clave, [])
            if not items_catalogo:
                continue
                
            items_sugeridos = []
            for item in items_catalogo:
                etiqueta = ""
                if clave == "descuentos" and item.descuento_porcentaje:
                    etiqueta = f"-{int(item.descuento_porcentaje)}% OFF"
                elif clave == "mas_comprados":
                    etiqueta = "Best Seller"
                elif clave == "pedidos_anteriores":
                    etiqueta = "Comprar de nuevo"
                    
                items_sugeridos.append(ItemSugerido(
                    item_id=item.item_id,
                    tipo=item.tipo,
                    nombre=item.nombre,
                    categoria_principal="", # Se puede extender si se hace el JOIN de categorías
                    precio_unitario=item.precio,
                    precio_final=item.precio_final,
                    cantidad_sugerida=1,
                    precio_total=item.precio_final,
                    razon_cantidad="Recomendación general.",
                    score_relevancia=1.0,
                    etiqueta=etiqueta,
                    calificacion=item.calificacion,
                    descuento_porcentaje=item.descuento_porcentaje,
                    nombre_negocio=item.nombre_negocio
                ))
                
            subcat = SubcatalogoResultado(
                nombre=nombres_secciones[clave],
                items=items_sugeridos
            )
            subcat.calcular_presupuesto()
            carruseles.append(subcat)
            
        latencia = round((time.time() - t0) * 1000, 2)
        
        # 4. Retornar el payload final para la API
        return {
            "usuario_id": id_usuario,
            "carruseles": carruseles, 
            "total_items": sum(len(c.items) for c in carruseles),
            "latencia_ms": latencia,
            "generated_at": datetime.now().isoformat()
        }

if __name__ == "__main__":
    # Configuración de prueba (Ajusta estos valores con los de tu base de datos local)
    DB_CONFIG = {
        "host": "localhost",
        "database": "issi",
        "user": "miyata",
        "password": "525125",
        "port": 5432
    }

    try:
        # Instanciamos el repositorio con la config
        repo = RepositorioPostgresV2(DB_CONFIG)
        
        # Instanciamos el recomendador
        recomendador = RecomendadorGeneral(repo)
        
        # Probamos obtener recomendaciones para el usuario con ID 1
        print("Obteniendo recomendaciones para el usuario 1...\n")
        resultado = recomendador.obtener_home_recomendaciones(id_usuario=1, limite_por_seccion=3)
        
        # Imprimir resultados
        for carrusel in resultado["carruseles"]:
            print(f"=== {carrusel.nombre} ===")
            for item in carrusel.items:
                etiqueta = f" [{item.etiqueta}]" if item.etiqueta else ""
                print(f" - {item.nombre} | ${item.precio_final}{etiqueta} | Razón: {item.razon_cantidad}")
            print()
            
        print(f"Total de items recomendados: {resultado['total_items']}")
        print(f"Latencia: {resultado['latencia_ms']} ms")
        
    except Exception as e:
        print(f"\n[!] Error al ejecutar la prueba: {e}")
        print("-> Asegúrate de que DB_CONFIG tenga las credenciales correctas de tu PostgreSQL y que la base de datos exista.")