import re
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class EntidadesPrompt:
    texto_original: str
    tipo_evento: Optional[str] = None
    subtipo_evento: Optional[str] = None
    cantidad_personas: Optional[int] = None
    cantidad_estimada: Optional[int] = None
    rango_edad: Optional[str] = None
    tematica: list[str] = field(default_factory=list)
    palabras_clave: list[str] = field(default_factory=list)
    presupuesto_max: Optional[float] = None
    incluir_servicios: bool = True
    confianza: float = 0.0

    @property
    def personas_efectivas(self) -> int:
        return self.cantidad_personas or self.cantidad_estimada or 10

    @property
    def resumen(self) -> str:
        partes = []
        if self.tipo_evento:    partes.append(self.tipo_evento)
        if self.subtipo_evento: partes.append(self.subtipo_evento)
        if self.tematica:       partes.append(f"temática: {', '.join(self.tematica)}")
        if self.cantidad_personas:
            partes.append(f"{self.cantidad_personas} personas")
        elif self.cantidad_estimada:
            partes.append(f"~{self.cantidad_estimada} personas (estimado)")
        if self.rango_edad:     partes.append(f"edad: {self.rango_edad}")
        if self.presupuesto_max:partes.append(f"presupuesto: ${self.presupuesto_max:,.0f}")
        return " | ".join(partes) if partes else "sin entidades detectadas"

EVENTOS = {
    "fiesta":       ["fiesta", "festejo", "celebracion", "celebración", "party"],
    "cumpleanos":   ["cumpleaños", "cumpleanos", "cumple", "años", "birthday"],
    "boda":         ["boda", "matrimonio", "casamiento", "nupcial", "novios", "novia"],
    "graduacion":   ["graduación", "graduacion", "egreso", "titulacion", "grado"],
    "baby_shower":  ["baby shower", "babyshower", "bienvenida al bebe", "genero"],
    "xv_anos":      ["quinceañera", "quinceanera", "xv años", "quince años", "15 años"],
    "posada":       ["posada", "posadas", "navidad mexicana"],
    "navidad":      ["navidad", "navideño", "nochebuena", "christmas"],
    "halloween":    ["halloween", "dia de muertos", "terror"],
    "corporativo":  ["corporativo", "empresa", "congreso", "conferencia", "plenaria"],
    "coctel":       ["coctel", "cóctel", "cocktail", "networking", "lounge"],
    "reunion":      ["reunión", "reunion", "junta", "convivio", "convivencia"],
    "bautizo":      ["bautizo", "primera comunion", "primera comunión"],
    "san_valentin": ["san valentin", "san valentín", "14 de febrero", "amor"],
    "concierto":    ["concierto", "festival", "show", "espectaculo"],
}

SUBTIPOS = {
    "infantil": ["infantil", "niños", "ninos", "niñas", "kids", "pequeños", "chicos"],
    "juvenil":  ["juvenil", "jovenes", "adolescentes", "teens"],
    "adultos":  ["adultos", "mayores", "empresarial"],
    "formal":   ["formal", "elegante", "gala", "etiqueta", "black tie"],
    "sorpresa": ["sorpresa", "surprise"],
    "exterior": ["jardín", "jardin", "exterior", "al aire libre", "hacienda", "playa"],
}

RANGOS_EDAD = {
    "ninos":   ["niño", "niña", "nino", "nina", "infantil", "kids", "bebe", "bebé",
                "preescolar", "primaria", "0 años", "1 año", "2 años", "3 años",
                "4 años", "5 años", "6 años", "7 años", "8 años", "9 años",
                "10 años", "11 años", "12 años"],
    "jovenes": ["joven", "adolescente", "teen", "secundaria", "preparatoria",
                "13 años", "14 años", "15 años", "16 años", "17 años"],
    "adultos": ["adulto", "adulta", "mayor", "empresarial", "profesional"],
    "mixto":   ["familiar", "familia", "todos", "mixto", "generacional"],
}

CANTIDADES_IMPLICITAS = {
    5:   ["pequeña", "pequeño", "íntima", "intima", "reducida", "pocos"],
    15:  ["mediana", "mediano", "algunos amigos", "amigos cercanos"],
    30:  ["grande", "numerosa", "muchas personas", "muchos invitados"],
    60:  ["muy grande", "masiva", "enorme"],
    100: ["masivo", "corporativo", "escuela", "empresa"],
}

TEMATICAS = [
    "spiderman", "spider-man", "spider man", "hombre araña",
    "batman", "superman", "wonder woman", "avengers", "vengadores",
    "iron man", "capitan america", "hulk", "thor",
    "frozen", "elsa", "moana", "rapunzel", "cenicienta",
    "princesas", "disney", "mickey", "minnie",
    "toy story", "woody", "cars", "rayo mcqueen",
    "nemo", "coco", "encanto",
    "unicornio", "unicornios", "dinosaurio", "dinosaurios", "safari",
    "futbol", "fútbol", "soccer", "basketball",
    "minecraft", "fortnite", "pokemon", "pokémon", "mario bros", "sonic",
    "luau", "hawaiana", "tropical",
    "vaquero", "cowboy", "espacio", "galaxia",
    "ciencia", "arte",
]

PALABRAS_SERVICIO = [
    "contratar", "servicio", "montar", "instalar", "armar", "desmontar",
    "animador", "personal", "staff", "meseros", "chef", "barman", "dj",
    "limpieza", "seguridad", "transporte", "flete", "montaje",
    "decorar", "organizar",
]

PRESUPUESTO_PATRONES = [
    r'\$\s*(\d[\d,\.]*)',
    r'(\d[\d,\.]*)\s*pesos',
    r'presupuesto\s+(?:de\s+)?(\d[\d,\.]*)',
    r'no\s+(?:más|mas)\s+de\s+\$?\s*(\d[\d,\.]*)',
    r'máximo\s+\$?\s*(\d[\d,\.]*)',
    r'hasta\s+\$?\s*(\d[\d,\.]*)',
    r'menos\s+de\s+\$?\s*(\d[\d,\.]*)',
]

MAPEO_EVENTO_CATEGORIAS = {
    "fiesta": [
        "Globos y Arte con Globos", "Desechables y Vajilla de Fiesta",
        "Artículos de Animación / Batucada", "Bolsas, Cajas y Empaques",
        "Juguetes", "Piñatas", "Dulcería y Relleno",
        "Repostería y Mesas de Dulces", "Bebidas, Mixología y Barras Libres",
        "Bocadillos, Canapés y Entradas",
    ],
    "cumpleanos": [
        "Globos y Arte con Globos", "Desechables y Vajilla de Fiesta",
        "Piñatas", "Dulcería y Relleno", "Juguetes",
        "Repostería y Mesas de Dulces", "Artículos de Animación / Batucada",
        "Bolsas, Cajas y Empaques",
    ],
    "boda": [
        "Mobiliario", "Mantelería y Textiles Finos", "Vajilla y Cristalería",
        "Carpas y Toldos", "Pistas de Baile y Escenarios",
        "Vestidos de Novia", "Accesorios Nupciales",
        "Repostería y Mesas de Dulces", "Vinos", "Destilados y Espirituosas",
        "Menús de Tiempos y Platos Fuertes", "Audio y Sonido",
        "Iluminación Profesional", "Cabinas y Plataformas",
    ],
    "xv_anos": [
        "Mobiliario", "Mantelería y Textiles Finos",
        "Globos y Arte con Globos", "Vestidos y Moda Femenina",
        "Repostería y Mesas de Dulces", "Audio y Sonido",
        "Iluminación Profesional", "Cabinas y Plataformas",
        "Menús de Tiempos y Platos Fuertes",
    ],
    "corporativo": [
        "Mobiliario", "Audio y Sonido", "Video y Pantallas",
        "Conectividad y Enlaces", "Carpas y Toldos",
        "Menús de Tiempos y Platos Fuertes",
        "Seguridad Privada", "Generadores Eléctricos",
    ],
    "baby_shower": [
        "Globos y Arte con Globos", "Desechables y Vajilla de Fiesta",
        "Juguetes y Bebés", "Repostería y Mesas de Dulces",
        "Bolsas, Cajas y Empaques",
    ],
    "halloween": [
        "Artículos de Animación / Batucada", "Desechables y Vajilla de Fiesta",
        "Juguetes", "Dulcería y Relleno", "Globos y Arte con Globos",
    ],
    "navidad": [
        "Desechables y Vajilla de Fiesta", "Dulcería y Relleno",
        "Repostería y Mesas de Dulces", "Bebidas, Mixología y Barras Libres",
        "Globos y Arte con Globos",
    ],
    "posada": [
        "Piñatas", "Dulcería y Relleno", "Desechables y Vajilla de Fiesta",
        "Bebidas, Mixología y Barras Libres",
    ],
    "coctel": [
        "Mobiliario", "Vajilla y Cristalería", "Vinos",
        "Destilados y Espirituosas", "Mixología y Complementos",
        "Bocadillos, Canapés y Entradas",
    ],
    "concierto": [
        "Audio y Sonido", "Iluminación Profesional", "Video y Pantallas",
        "Efectos Especiales (FX)", "Carpas y Toldos",
        "Seguridad Privada", "Generadores Eléctricos",
    ],
    "bautizo": [
        "Globos y Arte con Globos", "Desechables y Vajilla de Fiesta",
        "Repostería y Mesas de Dulces", "Menús de Tiempos y Platos Fuertes",
        "Mobiliario",
    ],
    "reunion": [
        "Mobiliario", "Desechables y Vajilla de Fiesta",
        "Bocadillos, Canapés y Entradas", "Bebidas, Mixología y Barras Libres",
    ],
    "graduacion": [
        "Globos y Arte con Globos", "Desechables y Vajilla de Fiesta",
        "Repostería y Mesas de Dulces", "Etiqueta Masculina",
        "Vestidos y Moda Femenina",
    ],
}

MAPEO_EDAD_CATEGORIAS_EXTRA = {
    "ninos": [
        "Juguetes", "Piñatas", "Dulcería y Relleno",
        "Juguetes y Bebés", "Juegos Didácticos y Ludoteca",
    ],
    "jovenes": [
        "Etiqueta Masculina", "Vestidos y Moda Femenina",
        "Bebidas, Mixología y Barras Libres",
    ],
    "adultos": [
        "Vinos", "Destilados y Espirituosas", "Menús de Tiempos y Platos Fuertes",
    ],
}

class ExtractorEntidades:

    def extraer(self, prompt: str) -> EntidadesPrompt:
        texto = prompt.lower().strip()
        e = EntidadesPrompt(texto_original=prompt)

        e.tipo_evento    = self._detectar_evento(texto)
        e.subtipo_evento = self._detectar_subtipo(texto)
        e.rango_edad     = self._detectar_edad(texto)
        e.cantidad_personas, e.cantidad_estimada = self._detectar_cantidad(texto)
        e.tematica       = self._detectar_tematica(texto)
        e.presupuesto_max = self._detectar_presupuesto(texto)
        e.incluir_servicios = self._detectar_servicios(texto)
        e.palabras_clave = self._extraer_palabras_clave(texto, e)
        e.confianza      = self._calcular_confianza(e)

        return e

    def obtener_categorias_objetivo(self, e: EntidadesPrompt) -> list[str]:
        """
        Devuelve la lista de nombres de categorías de la BD que aplican
        para las entidades detectadas.
        """
        categorias = set()

        # Por tipo de evento
        if e.tipo_evento:
            for cat in MAPEO_EVENTO_CATEGORIAS.get(e.tipo_evento, []):
                categorias.add(cat)

        # Por rango de edad
        if e.rango_edad:
            for cat in MAPEO_EDAD_CATEGORIAS_EXTRA.get(e.rango_edad, []):
                categorias.add(cat)

        # Fallback: sin evento detectado → usar categorías generales de fiesta
        if not categorias:
            for cat in MAPEO_EVENTO_CATEGORIAS.get("fiesta", []):
                categorias.add(cat)

        return list(categorias)

    def _detectar_evento(self, texto: str) -> Optional[str]:
        for evento, sinonimos in EVENTOS.items():
            for sin in sinonimos:
                if sin in texto:
                    return evento
        return None

    def _detectar_subtipo(self, texto: str) -> Optional[str]:
        for subtipo, palabras in SUBTIPOS.items():
            for p in palabras:
                if p in texto:
                    return subtipo
        return None

    def _detectar_edad(self, texto: str) -> Optional[str]:
        for rango, palabras in RANGOS_EDAD.items():
            for p in palabras:
                if p in texto:
                    return rango
        return None

    def _detectar_cantidad(self, texto: str) -> tuple[Optional[int], Optional[int]]:
        patrones = [
            r'para\s+(\d+)\s+(?:personas|invitados|niños|ninos|amigos|asistentes|adultos|jovenes|participantes)',
            r'(\d+)\s+(?:personas|invitados|niños|ninos|amigos|asistentes)',
            r'somos\s+(\d+)',
            r'seremos\s+(\d+)',
            r'asistiran\s+(\d+)',
            r'asistirán\s+(\d+)',
            r'van\s+a\s+ir\s+(\d+)',
            r'vienen\s+(\d+)',
        ]
        for patron in patrones:
            m = re.search(patron, texto)
            if m:
                return int(m.group(1)), None

        for cantidad, palabras in CANTIDADES_IMPLICITAS.items():
            for p in palabras:
                if p in texto:
                    return None, cantidad

        return None, None

    def _detectar_tematica(self, texto: str) -> list[str]:
        encontradas = []
        for t in TEMATICAS:
            if t in texto and t not in encontradas:
                encontradas.append(t.replace("-", " ").title())
        return encontradas

    def _detectar_presupuesto(self, texto: str) -> Optional[float]:
        for patron in PRESUPUESTO_PATRONES:
            m = re.search(patron, texto)
            if m:
                try:
                    return float(m.group(1).replace(",", "").replace(".", ""))
                except ValueError:
                    continue
        return None

    def _detectar_servicios(self, texto: str) -> bool:
        return any(p in texto for p in PALABRAS_SERVICIO)

    def _extraer_palabras_clave(self, texto: str, e: EntidadesPrompt) -> list[str]:
        stopwords = {
            "de","la","el","en","y","a","que","es","se","los","las","un","una",
            "con","por","para","del","al","lo","como","pero","mi","su","me","te",
            "le","nos","les","si","no","ya","hay","esto","esta","ese","esa","muy",
            "mas","más","tan","va","voy","tengo","quiero","necesito","busco",
            "quisiera","pensando","hacer","organizar","celebrar","tener","será",
            "sera","son","fue",
        }
        ya_cap = set()
        if e.tipo_evento:
            ya_cap.update(EVENTOS.get(e.tipo_evento, []))
        for t in e.tematica:
            ya_cap.add(t.lower())

        palabras = re.findall(r'\b[a-záéíóúüñ]{4,}\b', texto)
        clave, vistas = [], set()
        for p in palabras:
            if p not in stopwords and p not in ya_cap and p not in vistas:
                clave.append(p)
                vistas.add(p)
        return clave[:8]

    def _calcular_confianza(self, e: EntidadesPrompt) -> float:
        score = 0.0
        if e.tipo_evento:             score += 0.30
        if e.cantidad_personas:       score += 0.25
        elif e.cantidad_estimada:     score += 0.10
        if e.tematica:                score += 0.20
        if e.rango_edad:              score += 0.15
        if e.subtipo_evento:          score += 0.05
        if e.presupuesto_max:         score += 0.05
        return round(min(score, 1.0), 2)