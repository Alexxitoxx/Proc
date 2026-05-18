const express = require("express");
const { enviarCorreo } = require("./mail");

function createAdminReportesRouter({ pool }) {
  const router = express.Router();

  // Valida session admin y asegura que el usuario exista y sea admin en BD.
  async function requireActiveAdminSession(req, res) {
    const usuarioId = Number(req.session?.usuario_id || 0);
    const rol = String(req.session?.rol || "").toLowerCase();

    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ status: "error", mensaje: "Debes iniciar sesion" });
      return null;
    }

    if (rol !== "admin") {
      res.status(403).json({ status: "error", mensaje: "No autorizado" });
      return null;
    }

    try {
      const activo = await pool.query(
        `SELECT u.id
         FROM usuarios u
         INNER JOIN roles r ON r.id = u.id_rol
         WHERE u.id = $1
           AND activo = TRUE
           AND fecha_eliminacion IS NULL
           AND LOWER(r.nombre_rol) = 'admin'
         LIMIT 1`,
        [usuarioId]
      );

      if (activo.rows.length === 0) {
        res.status(401).json({ status: "error", mensaje: "Sesion invalida o usuario inactivo" });
        return null;
      }

      return usuarioId;
    } catch (error) {
      console.error(error);
      res.status(500).json({ status: "error", mensaje: "Error al validar sesion" });
      return null;
    }
  }

  // Mapea fila de reporte a objeto legible
  function mapReporteRow(row) {
    return {
      id: row.id,
      id_usuario: row.id_usuario,
      id_negocio: row.id_negocio,
      negocio: row.nombre_comercial,
      id_producto: row.id_producto,
      id_servicio: row.id_servicio,
      tipo_objetivo: row.id_producto ? "producto" : "servicio",
      id_objetivo: row.id_producto || row.id_servicio,
      nombre_objetivo: row.nombre_producto || row.nombre_servicio,
      motivo: row.motivo,
      descripcion: row.descripcion,
      estado_reporte: row.estado_reporte,
      fecha_creacion: row.fecha_creacion,
      fecha_resolucion: row.fecha_resolucion,
    };
  }

  async function obtenerContextoReporte(idReporte) {
    const result = await pool.query(
      `SELECT
         r.id,
         r.id_usuario AS id_reportador,
         rep.nombre AS nombre_reportador,
         rep.email AS email_reportador,
         r.id_negocio,
         n.nombre_comercial,
         nu.id AS id_reportado,
         nu.nombre AS nombre_reportado,
         nu.email AS email_reportado,
         r.id_producto,
         r.id_servicio,
         p.nombre AS nombre_producto,
         s.nombre AS nombre_servicio,
         r.motivo,
         r.descripcion,
         r.estado_reporte
       FROM reportes r
       INNER JOIN usuarios rep ON rep.id = r.id_usuario
       INNER JOIN negocios n ON n.id = r.id_negocio
       INNER JOIN usuarios nu ON nu.id = n.id_usuario
       LEFT JOIN productos p ON p.id = r.id_producto
       LEFT JOIN servicios s ON s.id = r.id_servicio
       WHERE r.id = $1
       LIMIT 1`,
      [idReporte]
    );

    return result.rows[0] || null;
  }

  async function notificarResolucionReporte(contextoReporte, detalle) {
    const destinatarios = [...new Set([
      contextoReporte.email_reportado,
      contextoReporte.email_reportador,
    ].filter(Boolean))];

    if (destinatarios.length === 0) {
      return { total: 0, enviados: 0, fallidos: [] };
    }

    const nombreObjetivo = contextoReporte.nombre_producto || contextoReporte.nombre_servicio || "N/D";
    const asunto = `Actualizacion de tu reporte #${contextoReporte.id}`;
    const texto = [
      `El reporte #${contextoReporte.id} fue resuelto.`,
      `Estado: ${contextoReporte.estado_reporte}`,
      `Negocio: ${contextoReporte.nombre_comercial}`,
      `Objetivo: ${nombreObjetivo}`,
      detalle ? `Detalle: ${detalle}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const html = [
      `<p>El reporte <strong>#${contextoReporte.id}</strong> fue resuelto.</p>`,
      `<p><strong>Estado:</strong> ${contextoReporte.estado_reporte}</p>`,
      `<p><strong>Negocio:</strong> ${contextoReporte.nombre_comercial}</p>`,
      `<p><strong>Objetivo:</strong> ${nombreObjetivo}</p>`,
      detalle ? `<p><strong>Detalle:</strong> ${detalle}</p>` : "",
    ].join("");

    const resultados = await Promise.allSettled(
      destinatarios.map((email) => enviarCorreo({ to: email, subject: asunto, text: texto, html }))
    );

    return {
      total: destinatarios.length,
      enviados: resultados.filter((resultado) => resultado.status === "fulfilled").length,
      fallidos: resultados
        .map((resultado, index) => ({ resultado, email: destinatarios[index] }))
        .filter(({ resultado }) => resultado.status === "rejected")
        .map(({ email, resultado }) => ({
          email,
          error: String(resultado.reason?.message || resultado.reason || "Error al enviar correo"),
        })),
    };
  }

  // Lista todos los reportes (admin)
  router.get("/admin/reportes", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const result = await pool.query(
        `SELECT
           r.id,
           r.id_usuario,
           r.id_negocio,
           r.id_producto,
           r.id_servicio,
           r.motivo,
           r.descripcion,
           r.estado_reporte,
           r.fecha_creacion,
           r.fecha_resolucion,
           p.nombre AS nombre_producto,
           s.nombre AS nombre_servicio,
           n.nombre_comercial
         FROM reportes r
         LEFT JOIN productos p ON p.id = r.id_producto
         LEFT JOIN servicios s ON s.id = r.id_servicio
         INNER JOIN negocios n ON n.id = r.id_negocio
         ORDER BY r.fecha_creacion DESC, r.id DESC`
      );

      return res.status(200).json({ status: "success", total: result.rows.length, reportes: result.rows.map(mapReporteRow) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener reportes" });
    }
  });

  // Detalle de un reporte
  router.get("/admin/reportes/:id", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });

    try {
      const result = await pool.query(
        `SELECT
           r.id,
           r.id_usuario,
           r.id_negocio,
           r.id_producto,
           r.id_servicio,
           r.motivo,
           r.descripcion,
           r.estado_reporte,
           r.fecha_creacion,
           r.fecha_resolucion,
           p.nombre AS nombre_producto,
           s.nombre AS nombre_servicio,
           n.nombre_comercial
         FROM reportes r
         LEFT JOIN productos p ON p.id = r.id_producto
         LEFT JOIN servicios s ON s.id = r.id_servicio
         INNER JOIN negocios n ON n.id = r.id_negocio
         WHERE r.id = $1
         LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });
      return res.status(200).json({ status: "success", reporte: mapReporteRow(result.rows[0]) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener reporte" });
    }
  });

  // Actualizar estado de un reporte (admin)
  router.patch("/admin/reportes/:id/estado", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    const estado = String(req.body?.estado || "").trim().toUpperCase();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });
    if (!estado) return res.status(400).json({ status: "error", mensaje: "estado es obligatorio" });

    try {
      const contextoAntes = await obtenerContextoReporte(id);
      if (!contextoAntes) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const result = await pool.query(
        `UPDATE reportes
         SET estado_reporte = $1,
             fecha_resolucion = CASE WHEN $1 = 'RESUELTO' THEN COALESCE(fecha_resolucion, CURRENT_TIMESTAMP) ELSE fecha_resolucion END
         WHERE id = $2
         RETURNING id, estado_reporte, fecha_resolucion`,
        [estado, id]
      );

      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const contextoFinal = { ...contextoAntes, ...result.rows[0] };
      let notificacionCorreo = { total: 0, enviados: 0, fallidos: [] };
      if (String(contextoFinal.estado_reporte || "").toUpperCase() !== "PENDIENTE") {
        notificacionCorreo = await notificarResolucionReporte(contextoFinal).catch((error) => {
          console.error("Error notificando resolucion:", error);
          return { total: 0, enviados: 0, fallidos: [] };
        });
      }

      return res.status(200).json({
        status: "success",
        mensaje: "Estado de reporte actualizado",
        reporte: result.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar reporte" });
    }
  });

  // Eliminar un reporte
  router.delete("/admin/reportes/:id", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });

    try {
      const result = await pool.query(`DELETE FROM reportes WHERE id = $1 RETURNING id, motivo`, [id]);
      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });
      return res.status(200).json({ status: "success", mensaje: "Reporte eliminado", reporte: result.rows[0] });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al eliminar reporte" });
    }
  });

  // Desestimar reporte (invalido/sin fundamento)
  router.post("/admin/reportes/:id/desestimar", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    const razon = String(req.body?.razon || "").trim();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });
    if (!razon) return res.status(400).json({ status: "error", mensaje: "razon es obligatoria" });

    try {
      const contexto = await obtenerContextoReporte(id);
      if (!contexto) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const result = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'DESESTIMADO',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });
      const notificacionCorreo = await notificarResolucionReporte(
        { ...contexto, ...result.rows[0] },
        razon
      ).catch((error) => {
        console.error("Error notificando desestimacion:", error);
        return { total: 0, enviados: 0, fallidos: [] };
      });
      return res.status(200).json({ 
        status: "success", 
        mensaje: "Reporte desestimado", 
        accion: "DESESTIMAR",
        razon,
        reporte: result.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al desestimar reporte" });
    }
  });

  // Advertencia formal (queda en historial)
  router.post("/admin/reportes/:id/advertencia", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });

    try {
      const contexto = await obtenerContextoReporte(id);
      if (!contexto) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'ADVERTENCIA_FORMAL',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      const notificacionCorreo = await notificarResolucionReporte(
        { ...contexto, ...updateResult.rows[0] },
        "Advertencia formal"
      ).catch((error) => {
        console.error("Error notificando advertencia:", error);
        return { total: 0, enviados: 0, fallidos: [] };
      });

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Advertencia formal registrada en historial", 
        accion: "ADVERTENCIA_FORMAL",
        usuario_notificado: contexto.id_reportador,
        reporte: updateResult.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al registrar advertencia" });
    }
  });

  // Suspensión temporal (cuenta inactiva X días)
  router.post("/admin/reportes/:id/suspension", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    const dias = Number(req.body?.dias || 0);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });
    if (!Number.isInteger(dias) || dias <= 0) return res.status(400).json({ status: "error", mensaje: "dias debe ser un numero positivo" });

    try {
      const contexto = await obtenerContextoReporte(id);
      if (!contexto) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'SUSPENSION_TEMPORAL',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      const notificacionCorreo = await notificarResolucionReporte(
        { ...contexto, ...updateResult.rows[0] },
        `Suspension por ${dias} dias`
      ).catch((error) => {
        console.error("Error notificando suspension:", error);
        return { total: 0, enviados: 0, fallidos: [] };
      });

      return res.status(200).json({ 
        status: "success", 
        mensaje: `Cuenta suspendida por ${dias} días`, 
        accion: "SUSPENSION_TEMPORAL",
        usuario_suspendido: contexto.id_reportador,
        duracion_dias: dias,
        fecha_reactivacion: new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString(),
        reporte: updateResult.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al aplicar suspension" });
    }
  });

  // Bloqueo permanente (cierre cuenta + ban dispositivos)
  router.post("/admin/reportes/:id/bloqueo", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    const razon = String(req.body?.razon || "").trim();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });
    if (!razon) return res.status(400).json({ status: "error", mensaje: "razon es obligatoria" });

    try {
      const contexto = await obtenerContextoReporte(id);
      if (!contexto) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'BLOQUEO_PERMANENTE',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      const notificacionCorreo = await notificarResolucionReporte(
        { ...contexto, ...updateResult.rows[0] },
        razon
      ).catch((error) => {
        console.error("Error notificando bloqueo:", error);
        return { total: 0, enviados: 0, fallidos: [] };
      });

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Cuenta bloqueada permanentemente y dispositivos baneados", 
        accion: "BLOQUEO_PERMANENTE",
        usuario_bloqueado: contexto.id_reportador,
        razon,
        reporte: updateResult.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al aplicar bloqueo" });
    }
  });

  // Eliminar contenido (sin afectar la cuenta)
  router.post("/admin/reportes/:id/eliminar-contenido", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    const id = Number(req.params.id);
    const razon = String(req.body?.razon || "").trim();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", mensaje: "id invalido" });
    if (!razon) return res.status(400).json({ status: "error", mensaje: "razon es obligatoria" });

    try {
      const contexto = await obtenerContextoReporte(id);
      if (!contexto) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const tipo_objetivo = contexto.id_producto ? "producto" : "servicio";
      const id_objetivo = contexto.id_producto || contexto.id_servicio;

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'CONTENIDO_ELIMINADO',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      const notificacionCorreo = await notificarResolucionReporte(
        { ...contexto, ...updateResult.rows[0] },
        razon
      ).catch((error) => {
        console.error("Error notificando eliminacion de contenido:", error);
        return { total: 0, enviados: 0, fallidos: [] };
      });

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Contenido eliminado sin afectar la cuenta", 
        accion: "CONTENIDO_ELIMINADO",
        usuario: contexto.id_reportador,
        tipo_objetivo,
        id_objetivo,
        razon,
        reporte: updateResult.rows[0],
        notificacion_correo: notificacionCorreo,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al eliminar contenido" });
    }
  });

  return router;
}

module.exports = createAdminReportesRouter;
