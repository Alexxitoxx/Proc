import math
import time
import re
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

from core.models_V2 import (
    ItemCatalogo, SugerenciaCantidad,
    ItemSugerido, SubcatalogoResultado, RespuestaPrompt,
)
from recomendador_prompt.extractor_entidades_v2 import ExtractorEntidades, EntidadesPrompt

REGLAS_CANTIDAD = {
    # Mobiliario (renta — 1 por persona)
    "silla":           {"factor": 1.0,  "modo": "personas",  "razon": "1 silla por persona"},
    "mesa":            {"factor": 0.1,  "modo": "personas",  "razon": "1 mesa por cada 10 personas"},
    "taburete":        {"factor": 1.0,  "modo": "personas",  "razon": "1 taburete por persona en zona lounge"},
    "sillón":          {"factor": 0.0,  "modo": "fijo",      "razon": "set lounge para zona de descanso", "fijo": 2},
    "sillon":          {"factor": 0.0,  "modo": "fijo",      "razon": "set lounge para zona de descanso", "fijo": 2},

    # Mantelería (1 por mesa)
    "mantel":          {"factor": 0.1,  "modo": "personas",  "razon": "1 mantel por mesa (1 mesa c/10 pax)"},
    "servilleta":      {"factor": 2.0,  "modo": "personas",  "razon": "2 servilletas por persona"},
    "camino":          {"factor": 0.1,  "modo": "personas",  "razon": "1 camino de mesa por mesa"},
    "funda":           {"factor": 1.0,  "modo": "personas",  "razon": "1 funda por silla/persona"},
    "moño":            {"factor": 1.0,  "modo": "personas",  "razon": "1 moño o lazo por silla"},

    # Vajilla desechable
    "plato":           {"factor": 1.0,  "modo": "personas",  "razon": "1 plato por persona"},
    "vaso":            {"factor": 1.5,  "modo": "personas",  "razon": "1-2 vasos por persona con margen"},
    "copa":            {"factor": 1.0,  "modo": "personas",  "razon": "1 copa por persona"},
    "cubierto":        {"factor": 1.0,  "modo": "personas",  "razon": "1 set de cubiertos por persona"},
    "cuchillo":        {"factor": 1.0,  "modo": "personas",  "razon": "1 cuchillo por persona"},
    "tenedor":         {"factor": 1.0,  "modo": "personas",  "razon": "1 tenedor por persona"},
    "cuchara":         {"factor": 1.0,  "modo": "personas",  "razon": "1 cuchara por persona"},

    # Globos (decoración)
    "globo":           {"factor": 2.0,  "modo": "personas",  "razon": "2 globos por persona para decorar"},
    "arco":            {"factor": 0.0,  "modo": "fijo",      "razon": "1 arco de globos para decorar la entrada", "fijo": 1},
    "guirnalda":       {"factor": 0.0,  "modo": "fijo",      "razon": "1 guirnalda decorativa para el espacio", "fijo": 1},
    "cortina":         {"factor": 0.0,  "modo": "fijo",      "razon": "1 cortina de fondo para fotografía", "fijo": 1},

    # Piñatas y dulces
    "piñata":          {"factor": 0.0,  "modo": "fijo",      "razon": "1 piñata es suficiente para el grupo", "fijo": 1},
    "pinata":          {"factor": 0.0,  "modo": "fijo",      "razon": "1 piñata es suficiente para el grupo", "fijo": 1},
    "dulce":           {"factor": 0.2,  "modo": "kg",        "razon": "200g de dulces por persona"},
    "bolsa":           {"factor": 1.0,  "modo": "personas",  "razon": "1 bolsa de recuerdo por persona"},

    # Repostería
    "pastel":          {"factor": 0.0,  "modo": "fijo",      "razon": "1 pastel para el grupo (verificar porciones)", "fijo": 1},
    "cupcake":         {"factor": 1.0,  "modo": "personas",  "razon": "1 cupcake por persona"},
    "macaron":         {"factor": 2.0,  "modo": "personas",  "razon": "2 macarons por persona"},
    "galleta":         {"factor": 2.0,  "modo": "personas",  "razon": "2 galletas por persona"},
    "brownie":         {"factor": 1.0,  "modo": "personas",  "razon": "1 brownie por persona"},
    "tarta":           {"factor": 0.0,  "modo": "fijo",      "razon": "1 tarta para el grupo", "fijo": 1},

    # Bebidas
    "refresco":        {"factor": 2.0,  "modo": "latas",     "razon": "2 latas por persona", "pack": 24},
    "agua":            {"factor": 1.0,  "modo": "latas",     "razon": "1 botella de agua por persona", "pack": 24},
    "vino":            {"factor": 0.0,  "modo": "botellas",  "razon": "1 botella por cada 4 personas", "divisor": 4},
    "champagne":       {"factor": 0.0,  "modo": "botellas",  "razon": "1 botella por cada 6 personas (brindis)", "divisor": 6},
    "cerveza":         {"factor": 2.0,  "modo": "unidades",  "razon": "2 cervezas por persona"},
    "whisky":          {"factor": 0.0,  "modo": "botellas",  "razon": "1 botella por cada 8 personas", "divisor": 8},
    "mezcal":          {"factor": 0.0,  "modo": "botellas",  "razon": "1 botella por cada 8 personas", "divisor": 8},
    "hielo":           {"factor": 0.0,  "modo": "bolsas",    "razon": "1 bolsa de 5kg por cada 10 personas", "divisor": 10},

    # Alimentos (banquetes)
    "canapé":          {"factor": 3.0,  "modo": "personas",  "razon": "3 canapés por persona en coctel"},
    "canape":          {"factor": 3.0,  "modo": "personas",  "razon": "3 canapés por persona en coctel"},
    "sushi":           {"factor": 0.0,  "modo": "rollos",    "razon": "8-10 rollos por mesa de 10", "divisor": 10, "factor_r": 1.0},

    # Pirotecnia / FX
    "chisper":         {"factor": 0.0,  "modo": "fijo",      "razon": "4 chisperos fríos como efecto especial", "fijo": 4},
    "confeti":         {"factor": 1.0,  "modo": "personas",  "razon": "1 cañón de confeti por cada 10 personas"},
    "humo":            {"factor": 0.0,  "modo": "fijo",      "razon": "1 máquina de humo para el evento", "fijo": 1},

    # Estructura y espacios
    "carpa":           {"factor": 0.0,  "modo": "m2",        "razon": "~1.5 m² por persona sentada (considerar 10x10=100 pax)", "fijo": 1},
    "tarima":          {"factor": 0.0,  "modo": "fijo",      "razon": "tarima/escenario para el evento", "fijo": 1},
    "pista":           {"factor": 0.0,  "modo": "fijo",      "razon": "pista de baile para el evento", "fijo": 1},
    "calentador":      {"factor": 0.0,  "modo": "unidades",  "razon": "1 calentador por cada 20 personas en exterior", "divisor": 20},

    # Juguetes
    "juguete":         {"factor": 0.0,  "modo": "fijo",      "razon": "1 juguete de regalo para el festejado", "fijo": 1},
    "figura":          {"factor": 0.0,  "modo": "fijo",      "razon": "1 figura de colección para el festejado", "fijo": 1},
    "kit":             {"factor": 0.0,  "modo": "fijo",      "razon": "1 kit para la actividad del evento", "fijo": 1},

    # Seguridad y logística
    "radio":           {"factor": 0.0,  "modo": "unidades",  "razon": "1 radio por cada 10 personas de staff", "divisor": 10},
    "extintor":        {"factor": 0.0,  "modo": "fijo",      "razon": "1 extintor por área del evento", "fijo": 2},
    "generador":       {"factor": 0.0,  "modo": "fijo",      "razon": "1 generador de respaldo para el evento", "fijo": 1},

    # Fotografía
    "álbum":           {"factor": 0.0,  "modo": "fijo",      "razon": "1 álbum de recuerdo del evento", "fijo": 1},
    "album":           {"factor": 0.0,  "modo": "fijo",      "razon": "1 álbum de recuerdo del evento", "fijo": 1},
    "prop":            {"factor": 0.0,  "modo": "sets",      "razon": "1 set de props para la cabina fotográfica", "fijo": 1},
}

SUBCATALOGOS_DEF = {
    "Mobiliario y Espacios":  [
        "silla", "mesa", "sillón", "sillon", "taburete", "lounge",
        "carpa", "toldo", "tarima", "pista", "escenario", "calentador",
        "ventilador", "truss", "estructura", "gradería",
    ],
    "Mantelería y Textiles": [
        "mantel", "servilleta", "camino", "funda", "moño", "cobertor",
        "cubre", "cortina", "tela", "drapeado", "faldón",
    ],
    "Vajilla y Desechables": [
        "plato", "vaso", "copa", "cubierto", "cuchillo", "tenedor",
        "cuchara", "cristal", "vajilla", "compostable", "biodegradable",
        "popote", "palillo", "charola",
    ],
    "Decoración y Globos": [
        "globo", "arco", "guirnalda", "cortina", "letrero", "neón",
        "neon", "confeti", "pompón", "cinta", "banderín", "backdrop",
        "muro floral", "lentejuela", "shimmer",
    ],
    "Piñatas y Dulcería": [
        "piñata", "pinata", "dulce", "caramelo", "aguinaldo",
        "bolsa", "sorpresa",
    ],
    "Repostería y Pasteles": [
        "pastel", "cupcake", "macaron", "galleta", "brownie",
        "tarta", "postre", "candy", "dulces finos", "mesa de dulces",
        "chocolate", "fondant", "alfajor", "cake pop",
    ],
    "Alimentos y Banquetes": [
        "canapé", "canape", "sushi", "taquiza", "buffet", "charola",
        "lasaña", "pechuga", "costilla", "gelatina", "fuente",
        "ensaladera", "calentador tipo", "mesero",
    ],
    "Bebidas": [
        "refresco", "agua", "vino", "champagne", "cerveza",
        "whisky", "mezcal", "tequila", "ron", "vodka", "ginebra",
        "coctel", "cóctel", "hielo", "barra", "mixer", "jarabe",
    ],
    "Juguetes y Entretenimiento": [
        "juguete", "figura", "muñeca", "brincolín", "brincolín",
        "trampolin", "boliche", "jenga", "piscina", "juego de mesa",
        "pintura", "burbujas", "corona",
    ],
    "Audio, Iluminación y Sonido": [
        "bocina", "subwoofer", "micrófono", "microfono", "consola",
        "iluminación", "iluminacion", "luz", "láser", "laser",
        "led", "pantalla", "proyector", "dj", "equipo", "cabezal",
    ],
    "Fotografía y Video": [
        "cabina", "foto", "360", "espejo mágico", "álbum", "album",
        "prop", "letrero", "backdrop", "tapete rojo", "impresión",
        "impresion", "usb", "marco",
    ],
    "Logística y Servicios": [
        "transporte", "flete", "caja", "embalaje", "radio", "walkie",
        "extintor", "generador", "seguridad", "guardia", "limpieza",
        "wifi", "internet", "red",
    ],
    "Vestuario y Moda": [
        "vestido", "traje", "esmoquin", "smoking", "tuxedo",
        "corbata", "moño", "frac", "guayabera", "zapato", "zapatilla",
        "bolso", "clutch", "tocado", "tiara", "velo",
    ],
}

class RepositorioBase:
    """
    Aquí va la interfaz que debe implementar el conector de la base de datos.
    """
    def buscar_items(
        self,
        nombres_categorias: list[str],
        palabras_clave: list[str],
        precio_max: Optional[float],
        rango_edad: Optional[str],
        incluir_servicios: bool,
        limite: int = 300,
    ) -> list[ItemCatalogo]:
        raise NotImplementedError

    def guardar_sugerencia(self, s: SugerenciaCantidad) -> bool:
        raise NotImplementedError

    def obtener_categorias_raiz(self) -> list[str]:
        raise NotImplementedError

class MotorPromptV2:
    """
    Motor de búsqueda por prompt.
    """

    def __init__(self, repositorio: RepositorioBase):
        self.repo      = repositorio
        self.extractor = ExtractorEntidades()

    def procesar_prompt(self, prompt: str) -> RespuestaPrompt:
        t0 = time.time()

        # ── Etapa 1: Extraer entidades ────────────────────────────────────
        entidades = self.extractor.extraer(prompt)

        # ── Etapa 2: Obtener categorías objetivo y palabras de búsqueda ───
        cats_objetivo  = self.extractor.obtener_categorias_objetivo(entidades)
        palabras_busq  = self._construir_palabras_busqueda(entidades)

        # ── Etapa 3: Buscar candidatos en repositorio ─────────────────────
        candidatos = self.repo.buscar_items(
            nombres_categorias = cats_objetivo,
            palabras_clave     = palabras_busq,
            precio_max         = entidades.presupuesto_max,
            rango_edad         = entidades.rango_edad,
            incluir_servicios  = entidades.incluir_servicios,
            limite             = 300,
        )

        # ── Etapa 4: Calcular score de relevancia ─────────────────────────
        personas = entidades.personas_efectivas
        candidatos_scored = [
            (item, self._score_relevancia(item, entidades))
            for item in candidatos
        ]
        candidatos_scored.sort(key=lambda x: x[1], reverse=True)

        # ── Etapa 5: Calcular cantidades y ajustar a presupuesto ─────────
        items_sugeridos: list[ItemSugerido] = []
        presupuesto_acumulado = 0.0
        presupuesto_limite = entidades.presupuesto_max or float('inf')

        for item, score in candidatos_scored:
            if score < 0.05:
                continue
            
            cantidad, razon = self._calcular_cantidad(item, personas)
            precio_total = round(item.precio_final * cantidad, 2)
            
            # Ajuste de presupuesto (Knapsack Approach)
            if presupuesto_acumulado + precio_total > presupuesto_limite:
                presupuesto_restante = presupuesto_limite - presupuesto_acumulado
                
                # Vemos si nos alcanza para al menos 1 unidad
                if presupuesto_restante >= item.precio_final:
                    cantidad = int(presupuesto_restante // item.precio_final)
                    precio_total = round(item.precio_final * cantidad, 2)
                    razon += f" (Cantidad ajustada para no exceder tu límite de ${presupuesto_limite})"
                else:
                    # No alcanza el dinero, ignoramos el producto
                    continue

            etiqueta = self._generar_etiqueta(item, entidades, score)

            items_sugeridos.append(ItemSugerido(
                item_id              = item.item_id,
                tipo                 = item.tipo,
                nombre               = item.nombre,
                categoria_principal  = item.categorias[0] if item.categorias else "",
                precio_unitario      = item.precio,
                precio_final         = item.precio_final,
                cantidad_sugerida    = cantidad,
                precio_total         = precio_total,
                razon_cantidad       = razon,
                score_relevancia     = round(score, 4),
                etiqueta             = etiqueta,
                calificacion         = item.calificacion,
                descuento_porcentaje = item.descuento_porcentaje,
                nombre_negocio       = item.nombre_negocio,
                duracion_minutos     = item.duracion_minutos,
            ))
            
            presupuesto_acumulado += precio_total

        # ── Etapa 6: Agrupar en subcatálogos ──────────────────────────────
        subcatalogos = self._agrupar_subcatalogos(items_sugeridos)

        # ── Etapa 7: Guardar sugerencias en BD ───────────────────────────
        self._guardar_sugerencias(items_sugeridos, prompt, personas)

        presupuesto_total = round(
            sum(sc.presupuesto_seccion for sc in subcatalogos), 2
        )
        latencia = round((time.time() - t0) * 1000, 2)

        return RespuestaPrompt(
            prompt_original            = prompt,
            subcatalogos               = subcatalogos,
            presupuesto_total_estimado = presupuesto_total,
            total_items                = len(items_sugeridos),
            personas                   = personas,
            tipo_evento                = entidades.tipo_evento,
            tematica                   = entidades.tematica,
            latencia_ms                = latencia,
            generated_at               = datetime.now().isoformat(),
        )

    def _construir_palabras_busqueda(self, e: EntidadesPrompt) -> list[str]:
        palabras = []
        for t in e.tematica:
            palabras.append(t.lower())
        if e.tipo_evento:
            palabras.append(e.tipo_evento.replace("_", " "))
        if e.subtipo_evento:
            palabras.append(e.subtipo_evento)
        palabras.extend(e.palabras_clave[:4])
        return list(dict.fromkeys(palabras))

    def _score_relevancia(self, item: ItemCatalogo, e: EntidadesPrompt) -> float:
        score = 0.0
        texto = item.texto_busqueda

        # Coincidencia de temática
        for t in e.tematica:
            if t.lower() in texto:
                score += 0.50
                break

        # Coincidencia de tipo de evento
        if e.tipo_evento:
            terminos = [e.tipo_evento.replace("_", " "), "fiesta", "evento"]
            if any(t in texto for t in terminos):
                score += 0.20

        # Coincidencia de edad
        if e.rango_edad == "ninos":
            if any(t in texto for t in ["infantil", "niño", "nino", "kids"]):
                score += 0.15
        elif e.rango_edad == "adultos":
            if "adulto" in texto or "gala" in texto or "formal" in texto:
                score += 0.10

        # Boost por calificación
        cal = item.calificacion or 0.0
        if cal >= 4.8:
            score += 0.10
        elif cal >= 4.5:
            score += 0.06
        elif cal < 2.5:
            score -= 0.30

        # Boost por popularidad (interacciones)
        if item.interacciones_recientes > 0:
            score += min(math.log1p(item.interacciones_recientes) / math.log1p(200), 1.0) * 0.05

        # Boost si tiene descuento activo
        if item.descuento_porcentaje and item.descuento_porcentaje > 0:
            score += 0.05

        return max(0.0, min(score, 1.0))

    def _calcular_cantidad(self, item: ItemCatalogo, personas: int) -> tuple[int, str]:
        texto = (item.nombre + " " + (item.descripcion or "")).lower()

        for keyword, regla in REGLAS_CANTIDAD.items():
            if keyword in texto:
                modo = regla["modo"]

                if modo == "fijo":
                    return regla.get("fijo", 1), regla["razon"]

                elif modo == "personas":
                    cantidad = math.ceil(personas * regla["factor"])
                    return max(1, cantidad), regla["razon"]

                elif modo == "kg":
                    cantidad = max(1, math.ceil(personas * regla["factor"]))
                    return cantidad, regla["razon"]

                elif modo == "latas":
                    pack     = regla.get("pack", 24)
                    total    = math.ceil(personas * regla["factor"])
                    packs    = max(1, math.ceil(total / pack))
                    return packs, regla["razon"]

                elif modo == "botellas":
                    divisor  = regla.get("divisor", 4)
                    botellas = max(1, math.ceil(personas / divisor))
                    return botellas, regla["razon"]

                elif modo == "unidades":
                    divisor  = regla.get("divisor", 1)
                    if divisor > 1:
                        return max(1, math.ceil(personas / divisor)), regla["razon"]
                    return max(1, math.ceil(personas * regla["factor"])), regla["razon"]

                elif modo == "bolsas":
                    divisor  = regla.get("divisor", 10)
                    return max(1, math.ceil(personas / divisor)), regla["razon"]

                elif modo == "rollos":
                    divisor  = regla.get("divisor", 10)
                    return max(1, math.ceil(personas / divisor)), regla["razon"]

                elif modo == "m2":
                    return 1, regla["razon"]

                elif modo == "sets":
                    return 1, regla["razon"]

        # Fallback: 1 unidad por cada 10 personas
        cantidad = max(1, math.ceil(personas / 10))
        return cantidad, f"1 unidad por cada 10 personas ({personas} invitados)"

    def _generar_etiqueta(
        self, item: ItemCatalogo, e: EntidadesPrompt, score: float
    ) -> str:
        texto = item.texto_busqueda

        if e.tematica and any(t.lower() in texto for t in e.tematica):
            return f"Ideal para tu {e.tipo_evento or 'evento'} de {e.tematica[0]}"
        if score > 0.6:
            return "Muy recomendado para este evento"
        if item.calificacion and item.calificacion >= 4.9:
            return "El mejor calificado en su categoría"
        if item.calificacion and item.calificacion >= 4.7:
            return "Producto altamente valorado"
        if item.descuento_porcentaje:
            return f"Con {int(item.descuento_porcentaje)}% de descuento activo"
        if e.tipo_evento:
            return f"Popular en {e.tipo_evento.replace('_', ' ')}s"
        return "Sugerido para tu evento"

    def _agrupar_subcatalogos(
        self, items: list[ItemSugerido]
    ) -> list[SubcatalogoResultado]:

        subs: dict[str, SubcatalogoResultado] = {}
        sin_clasificar: list[ItemSugerido] = []

        for item in items:
            texto = (item.nombre + " " + item.categoria_principal).lower()
            asignado = False

            for nombre_sc, keywords in SUBCATALOGOS_DEF.items():
                if any(kw in texto for kw in keywords):
                    if nombre_sc not in subs:
                        subs[nombre_sc] = SubcatalogoResultado(nombre=nombre_sc)
                    subs[nombre_sc].items.append(item)
                    asignado = True
                    break

            if not asignado:
                sin_clasificar.append(item)

        if sin_clasificar:
            sc_otros = SubcatalogoResultado(nombre="Otros")
            sc_otros.items = sin_clasificar
            subs["Otros"] = sc_otros

        resultado = []
        for sc in subs.values():
            sc.items.sort(key=lambda i: i.score_relevancia, reverse=True)
            sc.calcular_presupuesto()
            resultado.append(sc)

        resultado.sort(
            key=lambda sc: sum(i.score_relevancia for i in sc.items),
            reverse=True,
        )
        return resultado

    def _guardar_sugerencias(
        self, items: list[ItemSugerido], prompt: str, personas: int
    ):
        for item in items:
            s = SugerenciaCantidad(
                item_id              = item.item_id,
                tipo_item            = item.tipo,
                nombre_item          = item.nombre,
                categoria_principal  = item.categoria_principal,
                cantidad_sugerida    = item.cantidad_sugerida,
                razon_cantidad       = item.razon_cantidad,
                precio_unitario      = item.precio_unitario,
                precio_total_estimado= item.precio_total,
                subcatalogo          = item.categoria_principal,
                prompt_origen        = prompt,
                personas             = personas,
            )
            self.repo.guardar_sugerencia(s)