const express = require("express");
const axios = require("axios");

function createIARouter() {
    const router = express.Router();

    router.post("/ia/sugerir", async (req, res) => {
        try {
            const { prompt } = req.body;

            const response = await axios.post("http://127.0.0.1:8000/procesar", {
                prompt: prompt
            });

            res.json(response.data);
        } catch (error) {
            console.error("Error conectando con el motor de IA:", error.message);
            res.status(500).json({ 
                error: "El servicio de IA no está disponible",
                details: error.message 
            });
        }
    });

    return router;
}

module.exports = createIARouter;