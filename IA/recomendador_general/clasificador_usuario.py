"""
clasificador_usuario.py

TIPOS:
    · cold_start     — Usuario nuevo, sin historial (< 2 pedidos, < 5 interacciones)
    · poco_activo    — Tiene algo de historial pero interacción baja
    · muy_activo     — Usuario recurrente con historial rico

Usado por: recomendador_general_v2.py
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class PerfilActividad:
    id_usuario: int
    total_pedidos: int
    total_interacciones: int
    interacciones_ultimos_7_dias: int
    items_en_carrito: int
    items_en_wishlist: int
    dias_desde_ultimo_pedido: Optional[int]   # None si nunca ha pedido

    @property
    def tipo_usuario(self) -> str:
        # ── Cold Start ────────────────────────────────────────────────────
        if self.total_pedidos == 0 and self.total_interacciones < 5:
            return "cold_start"

        # ── Muy Activo ────────────────────────────────────────────────────
        # Compra frecuente o tiene mucha actividad reciente
        if (
            self.total_pedidos >= 3
            or self.interacciones_ultimos_7_dias >= 10
            or (self.total_pedidos >= 1 and self.interacciones_ultimos_7_dias >= 5)
        ):
            return "muy_activo"

        # ── Poco Activo ───────────────────────────────────────────────────
        # Todo lo que queda en el medio
        return "poco_activo"

    @property
    def resumen(self) -> str:
        return (
            f"[{self.tipo_usuario.upper()}] "
            f"pedidos={self.total_pedidos} | "
            f"interacciones={self.total_interacciones} | "
            f"últimos 7d={self.interacciones_ultimos_7_dias} | "
            f"carrito={self.items_en_carrito} | "
            f"wishlist={self.items_en_wishlist}"
        )


class ClasificadorUsuario:
    """
    Obtiene el perfil de actividad de un usuario desde la BD y devuelve su clasificación.

    Uso:
        clasificador = ClasificadorUsuario(repo)
        perfil = clasificador.clasificar(id_usuario=5)
        print(perfil.tipo_usuario)   # "muy_activo"
    """

    def __init__(self, repo):
        """
        Instancia de RepositorioPostgresV2
        """
        self.repo = repo

    def clasificar(self, id_usuario: int) -> PerfilActividad:
        datos = self.repo.obtener_actividad_usuario(id_usuario)
        return PerfilActividad(**datos)