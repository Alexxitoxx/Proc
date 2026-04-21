from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from motor_prompt_V2 import MotorPromptV2, MockRepositorioV2
import uvicorn

app = FastAPI(title="Bridge IA Marketplace")

motor = MotorPromptV2(MockRepositorioV2())

class PromptRequest(BaseModel):
    prompt: str

@app.post("/procesar")
async def procesar(request: PromptRequest):
    try:
        resultado = motor.procesar_prompt(request.prompt)
        
        return {
            "prompt_original": resultado.prompt_original,
            "evento": resultado.tipo_evento,
            "personas": resultado.personas,
            "presupuesto_total": resultado.presupuesto_total_estimado,
            "subcatalogos": [
                {
                    "nombre": sc.nombre,
                    "presupuesto": sc.presupuesto_seccion,
                    "items": [
                        {
                            "id": i.item_id,
                            "nombre": i.nombre,
                            "cantidad": i.cantidad_sugerida,
                            "razon": i.razon_cantidad,
                            "precio_unitario": i.precio_unitario,
                            "precio_total": i.precio_total
                        } for i in sc.items
                    ]
                } for sc in resultado.subcatalogos
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)