from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
import uvicorn

from core.conexion_bd_ia import ConexionBDIA, DB_CONFIG
from core.repositorio_db_v2 import RepositorioPostgresV2
from recomendador_prompt.motor_prompt_v2 import MotorPromptV2
from recomendador_general.recomendador_general_v2 import RecomendadorGeneral

app = FastAPI(title="Bridge IA Marketplace con Recomendador Integrado")

repo_ia = ConexionBDIA()
motor_prompt = MotorPromptV2(repo_ia)

repo_general = RepositorioPostgresV2(DB_CONFIG)
recomendador_general = RecomendadorGeneral(repo_general)

class PromptRequest(BaseModel):
    prompt: str

class ItemResponse(BaseModel):
    id: str
    nombre: str
    negocio: str
    tipo: str
    cantidad: int
    razon: str
    precio_unitario: float
    precio_total: float
    calificacion: float

class SubcatalogoResponse(BaseModel):
    nombre: str
    presupuesto: float
    items: List[ItemResponse]

class ProcesarResponse(BaseModel):
    prompt_original: str
    evento: Optional[str]
    personas: int
    presupuesto_total: float
    latencia_ms: float
    subcatalogos: List[SubcatalogoResponse]


@app.post("/procesar", response_model=ProcesarResponse)
async def procesar(request: PromptRequest):
    try:
        resultado = motor_prompt.procesar_prompt(request.prompt)

        return ProcesarResponse(
            prompt_original=resultado.prompt_original,
            evento=resultado.tipo_evento,
            personas=resultado.personas,
            presupuesto_total=resultado.presupuesto_total_estimado,
            latencia_ms=resultado.latencia_ms,
            subcatalogos=[
                {
                    "nombre": sc.nombre,
                    "presupuesto": sc.presupuesto_seccion,
                    "items": [
                        {
                            "id": i.item_id,
                            "nombre": i.nombre,
                            "negocio": i.nombre_negocio,
                            "tipo": i.tipo,
                            "cantidad": i.cantidad_sugerida,
                            "razon": i.razon_cantidad,
                            "precio_unitario": i.precio_final,
                            "precio_total": i.precio_total,
                            "calificacion": i.calificacion
                        } for i in sc.items
                    ]
                } for sc in resultado.subcatalogos
            ]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en el motor de IA (Prompt): {str(e)}")


@app.get("/recomendaciones/home/{id_usuario}")
async def obtener_home(id_usuario: int, limite: Optional[int] = 5):
    try:
        resultado = recomendador_general.obtener_home_recomendaciones(id_usuario=id_usuario, limite_por_seccion=limite)
        return resultado
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en el motor de IA (Home): {str(e)}")


@app.get("/health")
async def health_check():
    return {
        "status": "ok", 
        "motor_prompt": "activo", 
        "recomendador_general": "activo",
        "repositorio": "ConexionBDIA & RepositorioPostgresV2"
    }


if __name__ == "__main__":
    uvicorn.run("ai_bridge:app", host="127.0.0.1", port=8000, reload=True)