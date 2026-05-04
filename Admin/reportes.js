const express = require("express");

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
      const result = await pool.query(
        `UPDATE reportes
         SET estado_reporte = $1,
             fecha_resolucion = CASE WHEN $1 = 'RESUELTO' THEN COALESCE(fecha_resolucion, CURRENT_TIMESTAMP) ELSE fecha_resolucion END
         WHERE id = $2
         RETURNING id, estado_reporte, fecha_resolucion`,
        [estado, id]
      );

      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });
      return res.status(200).json({ status: "success", mensaje: "Estado de reporte actualizado", reporte: result.rows[0] });
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
      const result = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'DESESTIMADO',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      if (result.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });
      return res.status(200).json({ 
        status: "success", 
        mensaje: "Reporte desestimado", 
        accion: "DESESTIMAR",
        razon,
        reporte: result.rows[0] 
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
      const reporteResult = await pool.query(
        `SELECT id_usuario FROM reportes WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (reporteResult.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const idUsuario = reporteResult.rows[0].id_usuario;

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'ADVERTENCIA_FORMAL',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Advertencia formal registrada en historial", 
        accion: "ADVERTENCIA_FORMAL",
        usuario_notificado: idUsuario,
        reporte: updateResult.rows[0] 
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
      const reporteResult = await pool.query(
        `SELECT id_usuario FROM reportes WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (reporteResult.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const idUsuario = reporteResult.rows[0].id_usuario;

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'SUSPENSION_TEMPORAL',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      return res.status(200).json({ 
        status: "success", 
        mensaje: `Cuenta suspendida por ${dias} días`, 
        accion: "SUSPENSION_TEMPORAL",
        usuario_suspendido: idUsuario,
        duracion_dias: dias,
        fecha_reactivacion: new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString(),
        reporte: updateResult.rows[0] 
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
      const reporteResult = await pool.query(
        `SELECT id_usuario FROM reportes WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (reporteResult.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const idUsuario = reporteResult.rows[0].id_usuario;

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'BLOQUEO_PERMANENTE',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Cuenta bloqueada permanentemente y dispositivos baneados", 
        accion: "BLOQUEO_PERMANENTE",
        usuario_bloqueado: idUsuario,
        razon,
        reporte: updateResult.rows[0] 
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
      const reporteResult = await pool.query(
        `SELECT id_usuario, id_producto, id_servicio FROM reportes WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (reporteResult.rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Reporte no encontrado" });

      const { id_usuario: idUsuario, id_producto: idProducto, id_servicio: idServicio } = reporteResult.rows[0];
      const tipo_objetivo = idProducto ? "producto" : "servicio";
      const id_objetivo = idProducto || idServicio;

      // Actualizar reporte
      const updateResult = await pool.query(
        `UPDATE reportes
         SET estado_reporte = 'CONTENIDO_ELIMINADO',
             fecha_resolucion = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, id_usuario, estado_reporte, fecha_resolucion`,
        [id]
      );

      return res.status(200).json({ 
        status: "success", 
        mensaje: "Contenido eliminado sin afectar la cuenta", 
        accion: "CONTENIDO_ELIMINADO",
        usuario: idUsuario,
        tipo_objetivo,
        id_objetivo,
        razon,
        reporte: updateResult.rows[0] 
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al eliminar contenido" });
    }
  });

  return router;
}

module.exports = createAdminReportesRouter;
