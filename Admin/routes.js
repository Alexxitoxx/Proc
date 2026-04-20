const express = require("express");

function createAdminRouter({ pool }) {
  const router = express.Router();

  // Calcula precio final solo para descuentos automaticos vigentes.
  function calcularPrecioConDescuento(precioBase, row) {
    const precio = Number(precioBase);
    const porcentaje = Number(row.porcentaje_descuento || 0);
    const tieneDescuentoAutomatico = row.id_descuento !== null && row.codigo_cupon === null;
    const fechaInicio = row.fecha_inicio ? new Date(row.fecha_inicio).getTime() : null;
    const fechaFin = row.fecha_fin ? new Date(row.fecha_fin).getTime() : null;
    const ahora = Date.now();
    const descuentoVigente =
      tieneDescuentoAutomatico &&
      Number.isFinite(fechaInicio) &&
      Number.isFinite(fechaFin) &&
      fechaInicio <= ahora &&
      ahora <= fechaFin;

    if (!descuentoVigente) return precio;
    return Number((precio * (1 - porcentaje / 100)).toFixed(2));
  }

  // Valida sesion y rol admin desde la informacion almacenada en session.
  function requireAdminSession(req, res) {
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

    return usuarioId;
  }

  // Refuerza la sesion con validacion en BD (usuario activo y rol admin real).
  async function requireActiveAdminSession(req, res) {
    const usuarioId = requireAdminSession(req, res);
    if (!usuarioId) return null;

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

  // Lista el catalogo completo de productos para moderacion admin.
  router.get("/admin/catalogo/productos", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const result = await pool.query(
        `SELECT
           p.id,
           p.nombre,
           p.descripcion,
           p.precio,
           p.id_descuento,
           p.stock_total,
           p.esta_activo,
           p.fecha_registro,
           d.codigo_cupon,
           d.porcentaje_descuento,
           d.fecha_inicio,
           d.fecha_fin,
           COALESCE(n.nombre_comercial, '') AS negocio
         FROM productos p
         LEFT JOIN negocios n ON n.id = p.id_negocio
         LEFT JOIN descuentos d ON d.id = p.id_descuento
         ORDER BY p.fecha_registro DESC, p.id DESC`
      );

      return res.status(200).json({
        status: "success",
        total: result.rows.length,
        productos: result.rows.map((row) => ({
          id: row.id,
          nombre: row.nombre,
          descripcion: row.descripcion,
          precio: Number(row.precio),
          precio_con_descuento: calcularPrecioConDescuento(row.precio, row),
          id_descuento: row.id_descuento,
          stock_total: Number(row.stock_total),
          esta_activo: row.esta_activo,
          estado_catalogo: row.esta_activo ? "Aprobado" : "Rechazado",
          fecha_registro: row.fecha_registro,
          negocio: row.negocio,
        })),
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener catalogo de productos" });
    }
  });

  // Lista el catalogo completo de servicios para moderacion admin.
  router.get("/admin/catalogo/servicios", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const result = await pool.query(
        `SELECT
           s.id,
           s.nombre,
           s.descripcion,
           s.precio_base,
           s.id_descuento,
           s.esta_activo,
           s.fecha_registro,
           d.codigo_cupon,
           d.porcentaje_descuento,
           d.fecha_inicio,
           d.fecha_fin,
           COALESCE(n.nombre_comercial, '') AS negocio
         FROM servicios s
         LEFT JOIN negocios n ON n.id = s.id_negocio
         LEFT JOIN descuentos d ON d.id = s.id_descuento
         ORDER BY s.fecha_registro DESC, s.id DESC`
      );

      return res.status(200).json({
        status: "success",
        total: result.rows.length,
        servicios: result.rows.map((row) => ({
          id: row.id,
          nombre: row.nombre,
          descripcion: row.descripcion,
          precio_base: Number(row.precio_base),
          precio_con_descuento: calcularPrecioConDescuento(row.precio_base, row),
          id_descuento: row.id_descuento,
          esta_activo: row.esta_activo,
          estado_catalogo: row.esta_activo ? "Aprobado" : "Rechazado",
          fecha_registro: row.fecha_registro,
          negocio: row.negocio,
        })),
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener catalogo de servicios" });
    }
  });

  // Cambia estado de aprobacion/rechazo de un producto.
  router.patch("/admin/catalogo/productos/:id/estado", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const id = Number(req.params.id);
      const estado = String(req.body?.estado || "").trim().toUpperCase();

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", mensaje: "id invalido" });
      }

      if (!["APROBADO", "RECHAZADO"].includes(estado)) {
        return res.status(400).json({ status: "error", mensaje: "Estado no valido. Usa APROBADO o RECHAZADO" });
      }

      const estaActivo = estado === "APROBADO";

      const result = await pool.query(
        `UPDATE productos
         SET esta_activo = $1
         WHERE id = $2
         RETURNING id, esta_activo`,
        [estaActivo, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Producto no encontrado" });
      }

      return res.status(200).json({
        status: "success",
        mensaje: "Estado de producto actualizado",
        data: {
          id: result.rows[0].id,
          esta_activo: result.rows[0].esta_activo,
          estado_catalogo: result.rows[0].esta_activo ? "Aprobado" : "Rechazado",
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar estado del producto" });
    }
  });

  // Cambia estado de aprobacion/rechazo de un servicio.
  router.patch("/admin/catalogo/servicios/:id/estado", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const id = Number(req.params.id);
      const estado = String(req.body?.estado || "").trim().toUpperCase();

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", mensaje: "id invalido" });
      }

      if (!["APROBADO", "RECHAZADO"].includes(estado)) {
        return res.status(400).json({ status: "error", mensaje: "Estado no valido. Usa APROBADO o RECHAZADO" });
      }

      const estaActivo = estado === "APROBADO";

      const result = await pool.query(
        `UPDATE servicios
         SET esta_activo = $1
         WHERE id = $2
         RETURNING id, esta_activo`,
        [estaActivo, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Servicio no encontrado" });
      }

      return res.status(200).json({
        status: "success",
        mensaje: "Estado de servicio actualizado",
        data: {
          id: result.rows[0].id,
          esta_activo: result.rows[0].esta_activo,
          estado_catalogo: result.rows[0].esta_activo ? "Aprobado" : "Rechazado",
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar estado del servicio" });
    }
  });

  // Lista usuarios con filtros opcionales por texto, rol y estado activo.
  router.get("/admin/usuarios", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const { q, rol, activo } = req.query;
      const filtros = [];
      const valores = [];

      if (q !== undefined && String(q).trim() !== "") {
        valores.push(`%${String(q).trim()}%`);
        const idx = valores.length;
        filtros.push(`(u.nombre ILIKE $${idx} OR u.email ILIKE $${idx})`);
      }

      if (rol !== undefined && String(rol).trim() !== "") {
        valores.push(String(rol).trim().toLowerCase());
        filtros.push(`LOWER(r.nombre_rol) = $${valores.length}`);
      }

      if (activo !== undefined && String(activo).trim() !== "") {
        const activoTexto = String(activo).trim().toLowerCase();
        if (!["true", "false", "1", "0"].includes(activoTexto)) {
          return res.status(400).json({ status: "error", mensaje: "activo invalido. Usa true o false" });
        }

        const activoBool = activoTexto === "true" || activoTexto === "1";
        valores.push(activoBool);
        filtros.push(`u.activo = $${valores.length}`);
      }

      const whereClause = filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";

      const result = await pool.query(
        `SELECT
           u.id,
           u.nombre,
           u.email,
           u.telefono,
            u.avatar_url,
           u.fecha_registro,
           u.activo,
           u.fecha_eliminacion,
           r.id AS id_rol,
           r.nombre_rol
         FROM usuarios u
         INNER JOIN roles r ON r.id = u.id_rol
         ${whereClause}
         ORDER BY u.fecha_registro DESC, u.id DESC`,
        valores
      );

      return res.status(200).json({
        status: "success",
        total: result.rows.length,
        usuarios: result.rows.map((row) => ({
          id: row.id,
          nombre: row.nombre,
          email: row.email,
          telefono: row.telefono,
          avatar_url: row.avatar_url,
          id_rol: row.id_rol,
          rol: row.nombre_rol,
          activo: row.activo,
          fecha_registro: row.fecha_registro,
          fecha_eliminacion: row.fecha_eliminacion,
        })),
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener usuarios" });
    }
  });

  // Activa o desactiva usuarios (evita desactivacion del propio admin logueado).
  router.patch("/admin/usuarios/:id/estado", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const id = Number(req.params.id);
      const estado = String(req.body?.estado || "").trim().toUpperCase();

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", mensaje: "id invalido" });
      }

      if (!["ACTIVO", "INACTIVO"].includes(estado)) {
        return res.status(400).json({ status: "error", mensaje: "Estado no valido. Usa ACTIVO o INACTIVO" });
      }

      if (id === adminId && estado === "INACTIVO") {
        return res.status(400).json({ status: "error", mensaje: "No puedes desactivar tu propio usuario" });
      }

      const activo = estado === "ACTIVO";

      const result = await pool.query(
        `UPDATE usuarios
         SET activo = $1,
             fecha_eliminacion = CASE WHEN $1 THEN NULL ELSE NOW() END
         WHERE id = $2
         RETURNING id, activo, fecha_eliminacion`,
        [activo, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Usuario no encontrado" });
      }

      return res.status(200).json({
        status: "success",
        mensaje: "Estado de usuario actualizado",
        data: result.rows[0],
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar estado del usuario" });
    }
  });

  // Reasigna el rol de un usuario validando que el rol destino exista.
  router.patch("/admin/usuarios/:id/rol", async (req, res) => {
    const adminId = await requireActiveAdminSession(req, res);
    if (!adminId) return;

    try {
      const id = Number(req.params.id);
      const idRol = Number(req.body?.id_rol);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", mensaje: "id invalido" });
      }

      if (!Number.isInteger(idRol) || idRol <= 0) {
        return res.status(400).json({ status: "error", mensaje: "id_rol invalido" });
      }

      const rolExiste = await pool.query("SELECT id, nombre_rol FROM roles WHERE id = $1 LIMIT 1", [idRol]);
      if (rolExiste.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Rol no encontrado" });
      }

      const result = await pool.query(
        `UPDATE usuarios
         SET id_rol = $1
         WHERE id = $2
         RETURNING id, id_rol`,
        [idRol, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Usuario no encontrado" });
      }

      return res.status(200).json({
        status: "success",
        mensaje: "Rol de usuario actualizado",
        data: {
          id: result.rows[0].id,
          id_rol: result.rows[0].id_rol,
          rol: rolExiste.rows[0].nombre_rol,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar rol del usuario" });
    }
  });

  return router;
}

module.exports = createAdminRouter;
