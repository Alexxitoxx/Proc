from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

@dataclass
class CategoriaDB:
    """
    Refleja exactamente la tabla 'categorias' de PostgreSQL.
    La jerarquía se construye con id_padre (autorreferencial).
    """
    id: int
    nombre_categoria: str
    id_padre: Optional[int]       # None = categoría raíz
    tipo: str                     # 'producto' | 'servicio' | 'ambos'
    descripcion: Optional[str]

    @property
    def es_raiz(self) -> bool:
        return self.id_padre is None

@dataclass
class ProductoDB:
    """
    Refleja exactamente la tabla 'productos' de PostgreSQL.
    Las categorías asociadas vienen de la tabla producto_categoria (N:N).
    """
    id: int
    id_negocio: int
    nombre: str
    descripcion: Optional[str]
    calificacion: Optional[float]
    precio: float
    stock_total: int
    sku: Optional[str]
    esta_activo: bool
    id_descuento: Optional[int]

    categorias: list[str] = field(default_factory=list)    # nombres de categorías
    ids_categorias: list[int] = field(default_factory=list)
    nombre_negocio: str = ""
    descuento_porcentaje: Optional[float] = None           # de tabla descuentos
    interacciones_recientes: int = 0                       # de interacciones_usuario

    @property
    def disponible(self) -> bool:
        return self.esta_activo and self.stock_total > 0

    @property
    def precio_final(self) -> float:
        if self.descuento_porcentaje:
            return round(self.precio * (1 - self.descuento_porcentaje / 100), 2)
        return self.precio

    @property
    def texto_busqueda(self) -> str:
        """Texto completo para búsqueda semántica (reemplaza los 'tags' ausentes)."""
        partes = [self.nombre]
        if self.descripcion:
            partes.append(self.descripcion)
        partes.extend(self.categorias)
        if self.nombre_negocio:
            partes.append(self.nombre_negocio)
        return " ".join(partes).lower()

@dataclass
class ServicioDB:
    """
    Refleja exactamente la tabla 'servicios' de PostgreSQL.
    """
    id: int
    id_negocio: int
    nombre: str
    descripcion: Optional[str]
    precio_base: float
    duracion_minutos: Optional[int]
    calificacion: Optional[float]
    esta_activo: bool
    id_descuento: Optional[int]

    # Enriquecidos por JOIN
    categorias: list[str] = field(default_factory=list)
    ids_categorias: list[int] = field(default_factory=list)
    nombre_negocio: str = ""
    descuento_porcentaje: Optional[float] = None

    @property
    def texto_busqueda(self) -> str:
        partes = [self.nombre]
        if self.descripcion:
            partes.append(self.descripcion)
        partes.extend(self.categorias)
        return " ".join(partes).lower()

@dataclass
class ItemCatalogo:
    """
    Abstracción unificada que usa el motor de IA.
    Puede representar un Producto o un Servicio.
    """
    item_id: str           # "P-{id}" para producto, "S-{id}" para servicio
    tipo: str              # "producto" | "servicio"
    nombre: str
    descripcion: str
    precio: float
    calificacion: float
    esta_activo: bool
    categorias: list[str]
    ids_categorias: list[int]
    nombre_negocio: str
    descuento_porcentaje: Optional[float]
    interacciones_recientes: int = 0    # solo para productos
    duracion_minutos: Optional[int] = None  # solo para servicios

    @property
    def precio_final(self) -> float:
        if self.descuento_porcentaje:
            return round(self.precio * (1 - self.descuento_porcentaje / 100), 2)
        return self.precio

    @property
    def texto_busqueda(self) -> str:
        partes = [self.nombre, self.descripcion or ""]
        partes.extend(self.categorias)
        partes.append(self.nombre_negocio)
        return " ".join(partes).lower()

    @classmethod
    def desde_producto(cls, p: ProductoDB) -> "ItemCatalogo":
        return cls(
            item_id=f"P-{p.id}",
            tipo="producto",
            nombre=p.nombre,
            descripcion=p.descripcion or "",
            precio=p.precio,
            calificacion=p.calificacion or 0.0,
            esta_activo=p.disponible,
            categorias=p.categorias,
            ids_categorias=p.ids_categorias,
            nombre_negocio=p.nombre_negocio,
            descuento_porcentaje=p.descuento_porcentaje,
            interacciones_recientes=p.interacciones_recientes,
        )

    @classmethod
    def desde_servicio(cls, s: ServicioDB) -> "ItemCatalogo":
        return cls(
            item_id=f"S-{s.id}",
            tipo="servicio",
            nombre=s.nombre,
            descripcion=s.descripcion or "",
            precio=s.precio_base,
            calificacion=s.calificacion or 0.0,
            esta_activo=s.esta_activo,
            categorias=s.categorias,
            ids_categorias=s.ids_categorias,
            nombre_negocio=s.nombre_negocio,
            descuento_porcentaje=s.descuento_porcentaje,
            duracion_minutos=s.duracion_minutos,
        )

@dataclass
class SugerenciaCantidad:
    """
    Registro que se guarda en la tabla sugerencias_ia de PostgreSQL.
    """
    item_id: str                   # "P-{id}" o "S-{id}"
    tipo_item: str                 # "producto" | "servicio"
    nombre_item: str
    categoria_principal: str
    cantidad_sugerida: int
    razon_cantidad: str
    precio_unitario: float
    precio_total_estimado: float
    subcatalogo: str
    prompt_origen: str
    personas: int

@dataclass
class ItemSugerido:
    item_id: str
    tipo: str              # "producto" | "servicio"
    nombre: str
    categoria_principal: str
    precio_unitario: float
    precio_final: float
    cantidad_sugerida: int
    precio_total: float
    razon_cantidad: str
    score_relevancia: float
    etiqueta: str
    calificacion: float
    descuento_porcentaje: Optional[float]
    nombre_negocio: str
    duracion_minutos: Optional[int] = None   # solo servicios


@dataclass
class SubcatalogoResultado:
    nombre: str
    items: list[ItemSugerido] = field(default_factory=list)
    presupuesto_seccion: float = 0.0

    def calcular_presupuesto(self):
        self.presupuesto_seccion = round(
            sum(i.precio_total for i in self.items), 2
        )


@dataclass
class RespuestaPrompt:
    prompt_original: str
    subcatalogos: list[SubcatalogoResultado]
    presupuesto_total_estimado: float
    total_items: int
    personas: int
    tipo_evento: Optional[str]
    tematica: list[str]
    latencia_ms: float
    generated_at: str