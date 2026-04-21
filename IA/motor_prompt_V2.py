import math
import time
import re
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

from models_V2 import (
    ItemCatalogo, SugerenciaCantidad,
    ItemSugerido, SubcatalogoResultado, RespuestaPrompt,
)
from extractor_entidades_V2 import ExtractorEntidades, EntidadesPrompt

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
    Interfaz que debe implementar el conector real a PostgreSQL.
    Por ahora usa datos mock; cuando BD esté lista se reemplaza.
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

class MockRepositorioV2(RepositorioBase):
    """
    Mock que simula los datos reales del proyecto según los SQL entregados.
    Productos y servicios extraídos de Nuevos_Productos_y_Servicios.sql
    """

    def __init__(self):
        self._items = self._cargar_items()
        self._sugerencias: list[SugerenciaCantidad] = []

    def _cargar_items(self) -> list[ItemCatalogo]:
        """
        Catálogo mock basado en los productos y servicios REALES del proyecto.
        Refleja la estructura de la BD (sin tags, con calificacion, esta_activo, etc.)
        """
        items = []

        datos = [
            # (id, tipo, nombre, descripcion, precio, calificacion, categorias, negocio)
            # ── MOBILIARIO ──────────────────────────────────────────────────
            ("P-1",  "producto", "Silla Plegable Blanca", "Silla de plástico plegable ideal para eventos.", 15.0, 4.5, ["Mobiliario", "Sillas"], "Alquiladora Universal"),
            ("P-39", "producto", "Silla Tiffany Dorada", "Elegante silla para bodas y galas.", 25.0, 4.8, ["Mobiliario", "Sillas", "Boda Elegante / Gala"], "Alquiladora Universal"),
            ("P-40", "producto", "Silla Avant Garde Blanca", "Ideal para eventos de jardín.", 22.0, 4.7, ["Mobiliario", "Sillas", "Jardín / Exterior / Picnic"], "Alquiladora Universal"),
            ("P-41", "producto", "Silla Crossback Madera", "Estilo rústico y vintage.", 35.0, 4.9, ["Mobiliario", "Sillas", "Madera"], "Alquiladora Universal"),
            ("P-2",  "producto", "Mesa Rectangular Tablón", "Mesa 240x75cm para 10 personas.", 80.0, 4.8, ["Mobiliario", "Mesas"], "Alquiladora Universal"),
            ("P-42", "producto", "Mesa Redonda Grande", "Capacidad para 10-12 personas.", 90.0, 4.6, ["Mobiliario", "Mesas"], "Alquiladora Universal"),
            ("P-44", "producto", "Silla Versalles Transparente", "Diseño en acrílico moderno.", 40.0, 4.9, ["Mobiliario", "Sillas", "Policarbonato"], "Alquiladora Universal"),
            ("P-45", "producto", "Mesa de Cóctel Alta (Periquera)", "Mesa para zonas lounge.", 70.0, 4.5, ["Mobiliario", "Mesas", "Coctel / Networking"], "Alquiladora Universal"),
            ("P-47", "producto", "Sillón Lounge Blanco", "Sofá para sala lounge de 3 plazas.", 250.0, 4.7, ["Mobiliario"], "Alquiladora Universal"),
            ("P-49", "producto", "Silla Luis XV", "Silla clásica tapizada super comfort.", 65.0, 4.9, ["Mobiliario", "Sillas", "XV Años / Fiesta Temática"], "Alquiladora Universal"),

            # ── MANTELERÍA ──────────────────────────────────────────────────
            ("P-3",  "producto", "Mantel Redondo Blanco (3m)", "Mantel de tergal especial para tablones.", 45.0, 4.6, ["Mantelería y Textiles Finos", "Manteles Redondos"], "Mantelería y Textiles Sofía"),
            ("P-4",  "producto", "Servilleta de Tela Azul Marino", "Servilletas decorativas 20x20cm.", 5.0, 4.7, ["Mantelería y Textiles Finos", "Servilletas de Tela"], "Mantelería y Textiles Sofía"),
            ("P-52", "producto", "Mantel Cuadrado Rústico", "Mantel tipo lino para mesas cuadradas.", 60.0, 4.7, ["Mantelería y Textiles Finos", "Manteles Cuadrados"], "Mantelería y Textiles Sofía"),
            ("P-53", "producto", "Camino de Mesa Macramé", "Tejido artesanal para centro de mesa.", 40.0, 4.9, ["Complementos Textiles", "Caminos de Mesa", "Macramé"], "Mantelería y Textiles Sofía"),
            ("P-54", "producto", "Funda Silla Blanca Ajustable", "Cubre silla tipo spandex.", 15.0, 4.5, ["Vestimenta de Mobiliario", "Fundas para Sillas"], "Mantelería y Textiles Sofía"),
            ("P-55", "producto", "Moño para Silla Color Salmón", "Lazo decorativo de organza.", 5.0, 4.4, ["Vestimenta de Mobiliario", "Moños y Bandas"], "Mantelería y Textiles Sofía"),
            ("P-57", "producto", "Cubre Mantel Tono Oro", "Malla brillante superior.", 45.0, 4.6, ["Mantelería y Textiles Finos"], "Mantelería y Textiles Sofía"),

            # ── CARPAS Y ESTRUCTURAS ─────────────────────────────────────────
            ("P-5",  "producto", "Carpa Blanca 10x10 Metros", "Estructura metálica con lona blanca para exteriores.", 1500.0, 4.9, ["Carpas y Toldos", "Carpas Árabes / Blancas Elegantes"], "Carpas MegaEventos"),
            ("P-65", "producto", "Carpa Transparente 10x15m", "Paredes y techo de PVC transparente.", 3500.0, 4.9, ["Carpas y Toldos", "Carpas Transparentes"], "Carpas MegaEventos"),
            ("P-6",  "producto", "Tarima para Pista de Baile 5x5m", "Estructura de madera con iluminación integrada.", 3200.0, 4.8, ["Pistas de Baile y Escenarios"], "Carpas MegaEventos"),
            ("P-69", "producto", "Pista de Baile Iluminada LED", "Módulo metro cuadrado.", 350.0, 4.8, ["Pistas de Baile y Escenarios", "Pistas Iluminadas (Pixel / Infinity)"], "Carpas MegaEventos"),
            ("P-72", "producto", "Muro Verde Sintético (Mampara)", "Base para fotos de 2x3m.", 600.0, 4.8, ["Fondos y Backdrops"], "Carpas MegaEventos"),
            ("P-75", "producto", "Estructura Truss 3m", "Estructura de soporte de aluminio.", 200.0, 4.7, ["Estructuras y Pistas", "Tramos de Truss (Aluminio)"], "Carpas MegaEventos"),
            ("P-76", "producto", "Calentador de Torre Exterior", "Calentador equipado con gas.", 650.0, 4.8, ["Complementos (Clima e Iluminación)", "Calentadores de Hongo / Pirámide"], "Carpas MegaEventos"),

            # ── GLOBOS Y DECORACIÓN ──────────────────────────────────────────
            ("P-11", "producto", "Paquete 50 Globos Metálicos (Plata)", "Globos de helio 18 pulgadas.", 450.0, 4.5, ["Globos y Arte con Globos", "Globos Metálicos y Números (Foil)"], "The Party Store"),
            ("P-104","producto", "Globo de Número Gigante (Helio)", "Medida 40 pulgadas colores plata/oro.", 150.0, 4.8, ["Globos y Arte con Globos", "Globos Metálicos y Números (Foil)"], "The Party Store"),
            ("P-105","producto", "Cortina Metálica Holográfica", "Para decoración fondo fotos.", 90.0, 4.7, ["Globos y Arte con Globos", "Desechables y Vajilla de Fiesta"], "The Party Store"),
            ("P-107","producto", "Kit Letrero Neón LED Feliz Cumpleaños", "Para venta como fondo.", 1500.0, 4.9, ["Globos y Arte con Globos", "Artículos de Animación / Batucada"], "The Party Store"),
            ("P-110","producto", "Cañón de Confeti de Aire Comprimido", "Alcanza 10 metros.", 85.0, 4.8, ["Artículos de Animación / Batucada", "Confeti, Espumas y Bengalas"], "The Party Store"),
            ("P-111","producto", "Pompones de Papel Seda (Set 5)", "Decorativos que cuelgan del techo.", 45.0, 4.4, ["Globos y Arte con Globos"], "The Party Store"),
            ("P-12", "producto", "Velas Mágicas Chispas (10 Pzs)", "Velas de chispas frías para pastel.", 120.0, 4.6, ["Artículos de Animación / Batucada", "Letreros, Velas y Cake Toppers"], "The Party Store"),

            # ── DESECHABLES ──────────────────────────────────────────────────
            ("P-109","producto", "Platos de Cartón Tema Safari (10 pzs)", "Diseños infantiles premium.", 60.0, 4.6, ["Desechables y Vajilla de Fiesta", "Platos Desechables"], "The Party Store"),
            ("P-15", "producto", "Kit 100 Cubiertos de Madera", "Cubiertos ecológicos de madera de abedul.", 180.0, 4.7, ["Vajilla y Platos Ecológicos", "Cubiertos Biodegradables"], "Eco-Party"),
            ("P-16", "producto", "Platos Compostables (50 pzs)", "Platos resistentes biodegradables.", 250.0, 4.8, ["Vajilla y Platos Ecológicos", "Vajilla y Platos Ecológicos"], "Eco-Party"),
            ("P-131","producto", "Popotes de Fibra de Agave (100 pzs)", "No se aguadan como los de papel.", 95.0, 4.9, ["Vasos y Popotes Sustentables", "Popotes de Agave / Fibras Naturales"], "Eco-Party"),

            # ── PIÑATAS ──────────────────────────────────────────────────────
            ("P-13", "producto", "Piñata de Estrella de 7 Picos", "Piñata tradicional mexicana de cartonería.", 350.0, 4.8, ["Piñatas", "Piñatas Tradicionales (Picos/Estrellas)"], "Ludoteca Central"),
            ("P-117","producto", "Piñata Tema Dinosaurio T-Rex", "Acabado realista de cartonería.", 450.0, 4.8, ["Piñatas", "Piñatas de Tambor (Personajes)"], "Ludoteca Central"),
            ("P-118","producto", "Piñata Tema Unicornio Arcoíris", "Con melena de papel crepe rizado.", 420.0, 4.7, ["Piñatas", "Piñatas de Tambor (Personajes)"], "Ludoteca Central"),
            ("P-119","producto", "Palo para Piñata Forrado", "Palo resistente de madera pulida.", 35.0, 4.5, ["Piñatas"], "Ludoteca Central"),

            # ── DULCERÍA ─────────────────────────────────────────────────────
            ("P-112","producto", "Cajas Dulceros Sorpresa Pop", "Paquete 20 piezas armables.", 120.0, 4.5, ["Bolsas, Cajas y Empaques", "Dulcería y Relleno"], "The Party Store"),
            ("P-127","producto", "Kits de Arte Mini (Lienzo y Acuarelas)", "Para actividad infantil (regalo en fiesta).", 65.0, 4.9, ["Juegos Didácticos y Ludoteca", "Arte, Manualidades y Modelado"], "Ludoteca Central"),
            ("P-129","producto", "Corona Plástico/Rey-Reina", "Juguetes simbólicos para cumpleaños.", 25.0, 4.3, ["Juguetes", "Artículos de Animación / Batucada"], "Ludoteca Central"),

            # ── REPOSTERÍA ───────────────────────────────────────────────────
            ("P-21", "producto", "Pastel de Boda Fondant (100 personas)", "Pastel clásico blanco con flores de azúcar, 3 niveles.", 4500.0, 5.0, ["Pasteles de Diseño y Celebración", "Pasteles de Boda y Aniversario"], "Pastelería Dulce Momento"),
            ("P-22", "producto", "Macarons Franceses (Caja 50 pzs)", "Surtido de macarons para mesa de postres.", 900.0, 4.8, ["Postres Individuales y Repostería Fina", "Macarons Franceses"], "Pastelería Dulce Momento"),
            ("P-169","producto", "Pastel Naked Cake Rústico", "Bizcocho de vainilla y lavanda, 30 porciones.", 1200.0, 4.8, ["Pasteles de Diseño y Celebración", "Pasteles de Boda y Aniversario"], "Pastelería Dulce Momento"),
            ("P-170","producto", "Cupcakes Gourmet Red Velvet (Docena)", "Con betún de queso crema.", 350.0, 4.9, ["Postres Individuales y Repostería Fina", "Cupcakes Decorados"], "Pastelería Dulce Momento"),
            ("P-172","producto", "Brownies Fudge con Nuez (Charola 30)", "El chocolate más intenso.", 750.0, 4.8, ["Postres Individuales y Repostería Fina", "Brownies, Blondies y Barras"], "Pastelería Dulce Momento"),
            ("P-173","producto", "Galletas Decoradas Glaseado (20 pzs)", "Diseños ad-hoc con el tema del evento.", 500.0, 4.6, ["Postres Individuales y Repostería Fina", "Galletas Decoradas (Royal Icing)"], "Pastelería Dulce Momento"),
            ("P-180","producto", "Letrero de Pastel Cake Topper", "Corte laser personalizado acrílico.", 350.0, 4.6, ["Repostería y Mesas de Dulces", "Letreros, Velas y Cake Toppers"], "Pastelería Dulce Momento"),

            # ── BEBIDAS ──────────────────────────────────────────────────────
            ("P-19", "producto", "Caja Vino Tinto Cabernet (12 botellas)", "Vino premium para brindis.", 3200.0, 4.9, ["Vinos", "Vino Tinto", "Cabernet Sauvignon"], "Cava Selecta"),
            ("P-20", "producto", "Whisky Escocés 12 Años (750ml)", "Whisky single malt para eventos.", 850.0, 4.8, ["Destilados y Espirituosas", "Whisky y Whiskey", "Single Malt"], "Cava Selecta"),
            ("P-156","producto", "Mezcal Artesanal Espadín (750ml)", "Notas ahumadas premium.", 750.0, 4.8, ["Destilados y Espirituosas", "Mezcal"], "Cava Selecta"),
            ("P-162","producto", "Champagne Francés Brut", "La máxima gala para mesas de honor.", 2100.0, 5.0, ["Vinos", "Champagne y Espumosos"], "Cava Selecta"),
            ("P-166","producto", "Hielo en Cubo Cristalino Bolsa 5kg", "Hecho de agua purificada.", 65.0, 4.6, ["Mixología y Complementos"], "Cava Selecta"),
            ("P-165","producto", "Jarabes Para Coctelería (Set de 4)", "Granadina, Goma, Menta, Frutos rojos.", 400.0, 4.7, ["Mixología y Complementos", "Jarabes, Bitters y Botánicos"], "Cava Selecta"),

            # ── BANQUETES / ALIMENTOS ────────────────────────────────────────
            ("P-17", "producto", "Charola Muestra de Canapés (30 pzs)", "Selección gourmet lista para servir.", 850.0, 4.9, ["Bocadillos, Canapés y Entradas", "Canapés Fríos"], "Banquetes Delicia Real"),
            ("P-18", "producto", "Barra de Sushi para Eventos (100 rollos)", "Selección de makis y nigiris.", 2800.0, 4.8, ["Buffets, Estaciones y Barras", "Estaciones Interactivas (Pastas, Sushi, Cortes)"], "Banquetes Delicia Real"),

            # ── AUDIO Y SONIDO ───────────────────────────────────────────────
            ("P-23", "producto", "Luz Neón LED 'Let's Party'", "Letrero decorativo LED para pistas.", 1200.0, 4.6, ["Audio y Sonido", "Iluminación Profesional"], "DJ Eclipse"),
            ("P-24", "producto", "Máquina de Humo (Renta)", "Máquina generadora de niebla.", 500.0, 4.7, ["Efectos Especiales (FX)", "Máquinas de Humo / Niebla Baja"], "DJ Eclipse"),
            ("P-182","producto", "Cabezales Robóticos LED BEAM", "Para show espectacular (Renta/un).", 450.0, 4.7, ["Iluminación Profesional", "Cabezas Móviles (Beam / Spot)"], "DJ Eclipse"),
            ("P-184","producto", "Micrófono Inalámbrico Shure", "Largo alcance para dedicatorias.", 250.0, 4.9, ["Audio y Sonido", "Microfonía Inalámbrica"], "DJ Eclipse"),
            ("P-186","producto", "Chisperos Fríos Pirotecnia (Caja)", "4 volcanes de chispas seguros 2m.", 1200.0, 4.9, ["Efectos Especiales (FX)", "Chispas Frías (Pirotecnia Interior)"], "DJ Eclipse"),

            # ── FOTOGRAFÍA / CABINAS ─────────────────────────────────────────
            ("P-25", "producto", "Paquete Props y Letreros Divertidos", "Set de 30 accesorios para fotos.", 450.0, 4.9, ["Accesorios y Props", "Props Impresos con Frases"], "Magic PhotoBooth"),
            ("P-26", "producto", "Libro de Firmas Premium", "Libro encuadernado para fotos y mensajes.", 650.0, 4.8, ["Servicios Adicionales e Impresión", "Álbum de Firmas Físico (Scrapbook)"], "Magic PhotoBooth"),
            ("P-199","producto", "Letras Gigantes LOVE (Luminosas)", "Renta de letras luminosas de 1 metro.", 1800.0, 4.9, ["Fondos y Backdrops", "Cabinas y Plataformas"], "Magic PhotoBooth"),

            # ── SEGURIDAD ────────────────────────────────────────────────────
            ("P-31", "producto", "Radios Walkie Talkie Corto Alcance (Renta)", "UHF/VHF para comunicación de staff.", 150.0, 4.6, ["Equipamiento y Perímetro", "Radios de Comunicación y Cajas Base"], "Seguridad Sentinel"),
            ("P-235","producto", "Pulseras Tyvek Neón Foliadas (1000 pzs)", "Seguridad tipo conciertos intransferibles.", 600.0, 4.9, ["Control de Acceso y Logística", "Validadores de Boletos y Pulseras"], "Seguridad Sentinel"),

            # ── GENERADORES ──────────────────────────────────────────────────
            ("P-35", "producto", "Generador Portátil 5500W (Renta)", "Planta de luz para audio e iluminación básica.", 1200.0, 4.8, ["Generadores por Capacidad (Potencia)", "Portátiles (1,000 W a 10,000 W)"], "Generadores PowerUp"),

            # ── VESTUARIO ────────────────────────────────────────────────────
            ("P-7",  "producto", "Esmoquin Negro Clásico - Renta", "Traje formal de 3 piezas con moño y faja.", 850.0, 4.7, ["Etiqueta Masculina", "Smokings / Tuxedos", "Etiqueta Rigurosa / Black Tie"], "Gala & Tux"),
            ("P-8",  "producto", "Vestido de Noche Rojo Corte Princesa", "Vestido fino en tela satinada. Renta.", 1200.0, 4.8, ["Vestidos y Moda Femenina", "Vestidos de Noche (Largos)"], "Gala & Tux"),
            ("P-9",  "producto", "Vestido de Novia Estilo Sirena", "Diseño exclusivo con pedrería fina y encaje.", 15500.0, 5.0, ["Vestidos de Novia", "Corte Sirena / Trompeta"], "Boutique Novias de Ensueño"),
            ("P-10", "producto", "Tocado de Perlas y Cristal", "Accesorio artesanal para el cabello.", 850.0, 4.9, ["Accesorios Nupciales", "Tocados, Tiaras y Peinetas"], "Boutique Novias de Ensueño"),

            # ── SERVICIOS ────────────────────────────────────────────────────
            ("S-1",  "servicio", "Montaje y Desmontaje Básico", "Personal para acomodar mesas y sillas.", 500.0, 4.8, ["Mobiliario"], "Alquiladora Universal"),
            ("S-8",  "servicio", "Drapeado Telas en Techos/Carpas", "Colocación de cielos falsos con tela ligera.", 1500.0, 5.0, ["Carpas y Toldos", "Mantelería y Textiles Finos"], "Mantelería y Textiles Sofía"),
            ("S-11", "servicio", "Montaje de Carpa Estructural", "Mano de obra para levantamiento de carpas.", 2000.0, 4.9, ["Carpas y Toldos", "Estructuras y Pistas"], "Carpas MegaEventos"),
            ("S-26", "servicio", "Armado de Arco Orgánico de Globos", "Diseño asimétrico instalado en el evento.", 1200.0, 4.9, ["Globos y Arte con Globos"], "The Party Store"),
            ("S-28", "servicio", "Decoración Integral de Mesas de Dulces", "Diseño artístico combinando papelería y postres.", 2500.0, 4.8, ["Repostería y Mesas de Dulces"], "The Party Store"),
            ("S-31", "servicio", "Show de Animador Infantil (2 hrs)", "Dinámicas, bailes y organización de piñata.", 1500.0, 4.8, ["Juguetes", "Artículos de Animación / Batucada"], "Ludoteca Central"),
            ("S-32", "servicio", "Maquillaje Pintacaritas (2hrs)", "Artistas con pintura hipoalergénica.", 950.0, 4.9, ["Artículos de Animación / Batucada"], "Ludoteca Central"),
            ("S-41", "servicio", "Banquete Premium a Tres Tiempos", "Cocina internacional in situ por invitado.", 450.0, 4.9, ["Menús de Tiempos y Platos Fuertes", "Buffets, Estaciones y Barras"], "Banquetes Delicia Real"),
            ("S-44", "servicio", "Taquiza Tradicional Mexicana", "6 guisados artesanales con tortillas a mano.", 180.0, 4.8, ["Buffets, Estaciones y Barras", "Buffet Tradicional Mexicano / Taquizas"], "Banquetes Delicia Real"),
            ("S-42", "servicio", "Servicio de Meseros Profesionales", "Staff por 5 horas (por elemento).", 850.0, 4.8, ["Menús de Tiempos y Platos Fuertes"], "Banquetes Delicia Real"),
            ("S-56", "servicio", "DJ Especializado 5 Horas Continuas", "Música variada para mantener las ganas de bailar.", 4500.0, 4.9, ["Audio y Sonido", "Equipo para DJ / Cabina"], "DJ Eclipse"),
            ("S-57", "servicio", "Maestro de Ceremonias / Animador", "Conducción experta del evento.", 2500.0, 4.8, ["Audio y Sonido"], "DJ Eclipse"),
            ("S-61", "servicio", "Renta Cabina Clásica Cerrada 3 Horas", "Impresión instantánea ilimitada. Operador incluido.", 4200.0, 4.8, ["Cabinas y Plataformas", "Paquetes de Tiempo"], "Magic PhotoBooth"),
            ("S-62", "servicio", "Plataforma Cabina 360 Video Slow Motion", "Video tipo alfombra roja musicalizado.", 5500.0, 4.9, ["Cabinas y Plataformas", "Video y Pantallas"], "Magic PhotoBooth"),
            ("S-71", "servicio", "Asiento Guardabaños en Evento (2 Personal)", "Vigilan papel, limpian lavabos (5 hrs).", 1800.0, 4.8, ["Personal y Cuadrillas", "Guardia Fija en Baños"], "Clean & Reset"),
            ("S-74", "servicio", "Limpieza Profunda Post-Evento (Reset)", "Dejar salón sin vaso ni papel al finalizar.", 3500.0, 4.9, ["Fases de Limpieza", "Limpieza Profunda Post-Evento"], "Clean & Reset"),
            ("S-76", "servicio", "Guardia Filtro Acceso Principal Cadenero", "Personal para pedir invitaciones en entrada.", 1200.0, 4.9, ["Personal Operativo y Guardias", "Seguridad Privada"], "Seguridad Sentinel"),
            ("S-80", "servicio", "Servicio Valet Parking Integral", "Acomodadores con fichas y póliza de cobertura.", 5000.0, 4.6, ["Control de Acceso y Logística"], "Seguridad Sentinel"),
            ("S-86", "servicio", "Ingeniero Electricista Encargado Planta", "Vigilante del voltaje las 10 hrs.", 2500.0, 5.0, ["Generadores Eléctricos", "Servicios Logísticos y Operativos"], "Generadores PowerUp"),
            ("S-91", "servicio", "Configuración de Red Blindada Invitados & Staff", "VLANs separadas para gestión de ancho de banda.", 1500.0, 4.9, ["Conectividad y Enlaces", "Infraestructura Inalámbrica (WiFi)"], "SkyNet"),
        ]

        for (item_id, tipo, nombre, desc, precio, cal, cats, negocio) in datos:
            items.append(ItemCatalogo(
                item_id=item_id,
                tipo=tipo,
                nombre=nombre,
                descripcion=desc,
                precio=precio,
                calificacion=cal,
                esta_activo=True,
                categorias=cats,
                ids_categorias=[],
                nombre_negocio=negocio,
                descuento_porcentaje=None,
            ))
        return items

    def buscar_items(
        self,
        nombres_categorias: list[str],
        palabras_clave: list[str],
        precio_max: Optional[float],
        rango_edad: Optional[str],
        incluir_servicios: bool,
        limite: int = 300,
    ) -> list[ItemCatalogo]:

        cats_lower = [c.lower() for c in nombres_categorias]
        kws_lower  = [k.lower() for k in palabras_clave]

        resultado = []
        for item in self._items:
            if not item.esta_activo:
                continue
            if not incluir_servicios and item.tipo == "servicio":
                continue
            if precio_max and item.precio > precio_max:
                continue

            texto = item.texto_busqueda

            # Filtro de categoría
            en_cat = not nombres_categorias or any(
                c in " ".join(item.categorias).lower() for c in cats_lower
            )

            # Filtro de palabras clave
            tiene_kw = not kws_lower or any(kw in texto for kw in kws_lower)

            # Filtro de edad
            pasa_edad = True
            if rango_edad == "ninos":
                pasa_edad = any(t in texto for t in ["infantil", "niño", "nino", "kids", "bebe"])

            if en_cat and tiene_kw and pasa_edad:
                resultado.append(item)

        return resultado[:limite]

    def guardar_sugerencia(self, s: SugerenciaCantidad) -> bool:
        self._sugerencias.append(s)
        return True

    def obtener_categorias_raiz(self) -> list[str]:
        raices = set()
        for item in self._items:
            if item.categorias:
                raices.add(item.categorias[0])
        return sorted(raices)

class MotorPromptV2:
    """
    Motor de búsqueda por prompt actualizado para la BD real del proyecto.
    Funciona con MockRepositorioV2 ahora; con BDRepositorioV2 en integración.
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

        # ── Etapa 5: Calcular cantidades y construir ItemSugerido ─────────
        items_sugeridos: list[ItemSugerido] = []
        for item, score in candidatos_scored:
            if score < 0.05:
                continue
            cantidad, razon = self._calcular_cantidad(item, personas)
            precio_total    = round(item.precio_final * cantidad, 2)
            etiqueta        = self._generar_etiqueta(item, entidades, score)

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